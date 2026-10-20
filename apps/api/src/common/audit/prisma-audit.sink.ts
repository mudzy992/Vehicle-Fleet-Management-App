/**
 * `PrismaAuditSink` — stvarna persistencija audita u `AuditLog` (docs/05 §9).
 *
 * Zamjenjuje `LoggingAuditSink` (pino) i `LoggingSecurityEventSink`: isti port
 * (`AUDIT_SINK`) i isti sigurnosni port (`SECURITY_EVENT_SINK`), pa
 * `AuditInterceptor`, guard-ovi i `AuthService` ostaju **nepromijenjeni**.
 *
 * Pravila koja ovdje važe:
 * 1. **Audit nikad ne ruši zahtjev** — `record()` vraća promise, a greška upisa
 *    se logira i guta (interceptor je već ne čeka).
 * 2. **Immutabilnost** — `AuditLog` ima DB trigger koji odbija UPDATE/DELETE
 *    (`trg_audit_immutable`), pa sink radi samo `create`.
 * 3. **Tipizirane kolone** — `actorId`/`entityId` su `uuid`, `ipAddress` je
 *    `inet`, `before`/`after`/`metadata` su `jsonb`. Neispravna vrijednost bi
 *    odbila cijeli red, zato se svaka normalizuje (UUID regex, `net.isIP`,
 *    JSON round-trip) i odbacuje ako ne prolazi.
 * 4. **Bez osjetljivih podataka** — `before`/`after` su već redaktovana u
 *    `AuditInterceptor`-u (`REDACTED_FIELDS`), a security događaji nose samo
 *    razloge i identifikatore (nikad lozinku ili token).
 *
 * ⏳ `XADD vfm:stream:audit` (SSE tok za „Audit log uživo") namjerno **nije**
 * dodan: uvodi novi Redis ključ, što po pravilima projekta traži izmjenu
 * `REDIS_ACL.md` + `infra/redis/users.acl.example` i upozorenje vlasniku.
 * Dolazi s Faza 6 (live prikaz), kad se taj ključ i ACL korisnik definišu.
 */
import { isIP } from 'node:net';
import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditSeverity, ClientType } from '@vfm/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SecurityEvent, SecurityEventSink } from './security-event.js';
import type { AuditDiffEntry, AuditRecord, AuditSink } from './audit.types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** `null` ako vrijednost nije ispravan UUID (kolona je `@db.Uuid`). */
function asUuid(value: string | undefined): string | null {
  return value && UUID_PATTERN.test(value) ? value : null;
}

/** `null` ako vrijednost nije IP (kolona je `@db.Inet`). */
function asInet(value: string | undefined): string | null {
  return value && isIP(value) !== 0 ? value : null;
}

/**
 * JSON round-trip: uklanja `undefined`/funkcije, `Date` pretvara u ISO string i
 * garantuje da vrijednost prolazi kao `jsonb`.
 */
function asJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  try {
    const roundTrip: unknown = JSON.parse(JSON.stringify(value));
    if (typeof roundTrip !== 'object' || roundTrip === null) return null;
    return roundTrip as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

/** Kratak string bez preloma (kolone `reason`/`entityCode` su TEXT, ali kratke). */
function asText(value: string | undefined, maxLength = 180): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

/** Red koji sink upisuje — sve kolone su normalizovane prije `create`. */
interface AuditLogRow {
  actorId: string | null;
  actorEmail: string | null;
  actorRoles: string[];
  action: AuditAction;
  severity: AuditSeverity;
  entityType: string | null;
  entityId: string | null;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
  changedFields: string[];
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  clientType: ClientType | null;
  metadata: Prisma.InputJsonValue | null;
  createdAt: Date;
}

@Injectable()
export class PrismaAuditSink implements AuditSink, SecurityEventSink {
  private readonly logger = new Logger(PrismaAuditSink.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prima i `AuditRecord` (interceptor) i `SecurityEvent` (guard-ovi, servisi) —
   * razlikuju se po polju `type`, koje postoji samo na sigurnosnom događaju.
   */
  record(entry: AuditRecord | SecurityEvent): Promise<void> {
    const row = isSecurityEvent(entry) ? this.fromSecurityEvent(entry) : this.fromAuditRecord(entry);
    return this.persist(row);
  }

  private async persist(row: AuditLogRow): Promise<void> {
    try {
      // `Unchecked` varijanta: FK polja (`actorId`) idu direktno, bez ugniježđenog
      // `actor: { connect }` — audit ne smije zavisiti od postojanja korisnika.
      const data: Prisma.AuditLogUncheckedCreateInput = {
          actorId: row.actorId ?? undefined,
          actorEmail: row.actorEmail ?? undefined,
          actorRoles: row.actorRoles,
          // `AuditAction`/`AuditSeverity`/`ClientType` u Prismi su string union-i
          // s istim vrijednostima kao u `@vfm/shared` (enum vrijednosti nisu
          // mapirane — docs/prisma README §A).
          action: row.action,
          severity: row.severity,
          entityType: row.entityType ?? undefined,
          entityId: row.entityId ?? undefined,
          ...(row.before ? { before: row.before } : {}),
          ...(row.after ? { after: row.after } : {}),
          changedFields: row.changedFields,
          reason: row.reason ?? undefined,
          requestId: row.requestId ?? undefined,
          ipAddress: row.ipAddress ?? undefined,
          userAgent: row.userAgent ?? undefined,
          ...(row.clientType ? { clientType: row.clientType } : {}),
          ...(row.metadata ? { metadata: row.metadata } : {}),
        createdAt: row.createdAt,
      };

      await this.prisma.auditLog.create({ data });
    } catch (error) {
      // Audit je sporedna putanja: zahtjev je već obrađen, greška se samo logira.
      this.logger.warn(
        `AuditLog upis nije uspio (action=${row.action}, requestId=${row.requestId ?? '-'}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private fromAuditRecord(record: AuditRecord): AuditLogRow {
    const diff = readDiff(record.meta);

    return {
      actorId: asUuid(record.userId),
      actorEmail: asText(record.userEmail, 320),
      actorRoles: [...(record.roles ?? [])],
      action: record.action,
      severity: record.severity,
      entityType: asText(record.resource, 120),
      entityId: asUuid(record.entityId),
      before: asJson(record.before),
      after: asJson(record.after),
      changedFields: diff.map((entry) => entry.field),
      reason: asText(record.errorCode ?? (record.success ? undefined : 'FAILED')),
      requestId: asText(record.requestId, 120),
      ipAddress: asInet(record.ip),
      userAgent: asText(record.userAgent, 400),
      clientType: record.clientType ?? null,
      metadata: asJson({
        ...(record.meta ?? {}),
        ...(diff.length > 0 ? { diff } : {}),
        method: record.method,
        path: record.path,
        success: record.success,
        durationMs: record.durationMs,
      }),
      createdAt: toDate(record.at),
    };
  }

  /**
   * SECURITY_EVENT → `AuditLog` red s `action='SECURITY'` i `severity='SECURITY'`
   * (docs/05 §9: sigurnosni događaji su dio istog, immutabilnog audit traga).
   */
  private fromSecurityEvent(event: SecurityEvent): AuditLogRow {
    return {
      actorId: asUuid(event.userId),
      actorEmail: asText(event.email, 320),
      actorRoles: [...(event.roles ?? [])],
      action: 'SECURITY',
      severity: 'SECURITY',
      entityType: 'auth',
      entityId: null,
      before: null,
      after: null,
      changedFields: [],
      reason: asText(`${event.type}${event.reason ? `:${event.reason}` : ''}`),
      requestId: asText(event.requestId, 120),
      ipAddress: asInet(event.ip),
      userAgent: asText(event.userAgent, 400),
      clientType: event.clientType ?? null,
      metadata: asJson({
        securityEventType: event.type,
        ...(event.permission ? { permission: event.permission } : {}),
        ...(event.scope ? { scope: event.scope } : {}),
        ...(event.reason ? { reason: event.reason } : {}),
        method: event.method,
        path: event.path,
      }),
      createdAt: new Date(),
    };
  }
}

function isSecurityEvent(entry: AuditRecord | SecurityEvent): entry is SecurityEvent {
  return 'type' in entry;
}

function readDiff(meta: Readonly<Record<string, unknown>> | undefined): readonly AuditDiffEntry[] {
  const value = meta?.diff;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is AuditDiffEntry =>
      typeof entry === 'object' && entry !== null && typeof (entry as { field?: unknown }).field === 'string',
  );
}

function toDate(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
