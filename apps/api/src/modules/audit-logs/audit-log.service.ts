/**
 * `AuditLogService` — čitanje audit traga (docs/07 §7, docs/05 §9).
 *
 * Zašto odvojen modul, a ne dio `common/audit`: `common/audit` je **write** strana
 * (interceptor + sink), a ovo je read-only API nad istom tabelom. Tabela je
 * immutabilna (DB trigger odbija `UPDATE`/`DELETE`), pa servis nema mutacije.
 *
 * Pravila:
 * - `audit:view` daje uvid u poslovne zapise; **`SECURITY` redovi** (prijave,
 *   odbijanja, promjene prava) traže `audit:view_security` — bez njega se ti
 *   redovi ne vraćaju (`securityHidden: true` u odgovoru, da UI to kaže).
 * - `AuditLog.id` je `BIGINT` → u JSON-u je **string**; `Number` bi izgubio
 *   preciznost na velikim ID-jevima.
 * - `before`/`after`/`metadata` se vraćaju samo na detalju (lista bi bila
 *   nepotrebno teška); sadržaj je već redaktovan pri upisu (`REDACTED_FIELDS`).
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  AuditLogDetail,
  AuditLogListResponse,
  AuditLogQuery,
  AuditLogSummary,
} from '@vfm/shared/schemas';
import type { AuditAction, AuditSeverity, ClientType } from '@vfm/shared';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Ima li akter pravo (Super Admin ima sve — R-07). */
function allows(actor: AuthenticatedUser | undefined, permission: string): boolean {
  if (!actor) return false;
  if (actor.isSuperAdmin) return true;
  return actor.permissions?.list.includes(permission) ?? false;
}

/** Kolone za listu (bez `before`/`after`/`metadata`). */
const LIST_SELECT = {
  id: true,
  action: true,
  severity: true,
  actorId: true,
  actorEmail: true,
  actorRoles: true,
  entityType: true,
  entityId: true,
  changedFields: true,
  reason: true,
  requestId: true,
  ipAddress: true,
  userAgent: true,
  clientType: true,
  createdAt: true,
} as const;

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogQuery, actor: AuthenticatedUser | undefined): Promise<AuditLogListResponse> {
    const canSeeSecurity = allows(actor, 'audit:view_security');

    // Eksplicitan zahtjev za SECURITY redove bez prava ne smije vratiti
    // „sve ostalo" (to bi bilo obmanjujuće) — vraća se prazna stranica, a
    // `securityHidden` kaže zašto.
    if (!canSeeSecurity && query.severity === 'SECURITY') {
      return {
        items: [],
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        totalPages: 0,
        securityHidden: true,
      };
    }

    // Bez `audit:view_security` SECURITY redovi su nevidljivi — filtrira se u
    // bazi (ne u memoriji), da paginacija i `total` ostanu tačni.
    const where = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.severity && canSeeSecurity ? { severity: query.severity } : {}),
      ...(!canSeeSecurity ? { severity: { not: 'SECURITY' as const } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSummary(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      securityHidden: !canSeeSecurity,
    };
  }

  async get(id: string, actor: AuthenticatedUser | undefined): Promise<AuditLogDetail> {
    const numericId = this.parseId(id);
    const row = await this.prisma.auditLog.findUnique({
      where: { id: numericId },
      select: { ...LIST_SELECT, before: true, after: true, metadata: true },
    });

    if (!row) throw VfmErrors.notFound('audit zapis');

    // SECURITY zapis traži posebno pravo — i kad se zna ID.
    if (row.severity === 'SECURITY' && !allows(actor, 'audit:view_security')) {
      throw VfmErrors.permissionDenied([
        { path: ['id'], message: 'Za SECURITY zapise potrebno je pravo audit:view_security.' },
      ]);
    }

    return {
      ...this.toSummary(row),
      before: asRecord(row.before),
      after: asRecord(row.after),
      metadata: asRecord(row.metadata),
    };
  }

  /** `AuditLog.id` je BIGINT: prihvata samo cifre (bez `1e3`, `0x…`, negativnih). */
  private parseId(id: string): bigint {
    if (!/^\d{1,19}$/u.test(id)) throw VfmErrors.notFound('audit zapis');

    try {
      return BigInt(id);
    } catch {
      throw VfmErrors.notFound('audit zapis');
    }
  }

  private toSummary(row: {
    id: bigint;
    action: string;
    severity: string;
    actorId: string | null;
    actorEmail: string | null;
    actorRoles: string[];
    entityType: string | null;
    entityId: string | null;
    changedFields: string[];
    reason: string | null;
    requestId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    clientType: string | null;
    createdAt: Date;
  }): AuditLogSummary {
    return {
      id: row.id.toString(),
      action: row.action as AuditAction,
      severity: row.severity as AuditSeverity,
      actorId: row.actorId,
      actorEmail: row.actorEmail,
      actorRoles: [...row.actorRoles],
      entityType: row.entityType,
      entityId: row.entityId,
      changedFields: [...row.changedFields],
      reason: row.reason,
      requestId: row.requestId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      clientType: row.clientType as ClientType | null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** JSONB → objekat (nizi i skalari se ne prikazuju kao diff). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
