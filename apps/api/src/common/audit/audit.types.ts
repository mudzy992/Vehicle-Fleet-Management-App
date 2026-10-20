/**
 * Audit: tipovi, diff i kontekst (docs/05 §9).
 *
 * Svaka značajna akcija mora biti auditovana: ko (userId), šta (action + resurs),
 * prije/poslije (diff), odakle (IP, User-Agent, clientType) i pod kojom
 * korelacijom (requestId).
 *
 * Zapis ide kroz **`AuditSink` port** jer `AuditLog` piše Prisma (⛔ bloker 1).
 * Default sink logira (pino) → nijedan događaj nije izgubljen; `PrismaAuditSink`
 * se registruje čim migracija `init` bude u repou, bez izmjene interceptor-a.
 *
 * ⚠️ Nikad se ne audituju lozinke, hashovi ni tokeni — `REDACTED_FIELDS` se
 * primjenjuje i na `before` i na `after` (docs/05 §7, §9).
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditSeverity, ClientType, ErrorCode } from '@vfm/shared';
import { ERROR_CODES } from '@vfm/shared';

/** Polja koja se nikad ne smiju naći u audit logu. */
export const REDACTED_FIELDS: readonly string[] = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'newPasswordHash',
  'refreshToken',
  'refreshTokenHash',
  'tokenHash',
  'accessToken',
  'resetToken',
  'resetTokenHash',
  'secret',
  'apiKey',
  'firebaseCredentials',
];

/** Vrijednost koja zamjenjuje osjetljivo polje. */
export const REDACTED_VALUE = '[REDACTED]';

/** Audit zapis (mapira se na `AuditLog` model). */
export interface AuditRecord {
  readonly action: AuditAction;
  readonly severity: AuditSeverity;
  /** Npr. `User`, `Role`, `Vehicle`. */
  readonly resource?: string;
  readonly entityId?: string;
  readonly userId?: string;
  readonly userEmail?: string;
  readonly roles?: readonly string[];
  readonly clientType?: ClientType;
  readonly requestId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly method?: string;
  readonly path?: string;
  /** Stanje prije izmjene (bez osjetljivih polja). */
  readonly before?: Readonly<Record<string, unknown>>;
  /** Stanje poslije izmjene (bez osjetljivih polja). */
  readonly after?: Readonly<Record<string, unknown>>;
  /** Dodaci iz handler-a (npr. `permissionsVersion`, `revokedSessions`). */
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly success: boolean;
  /** Kod greške iz kataloga (ako je zahtjev odbijen). */
  readonly errorCode?: ErrorCode | string;
  readonly durationMs: number;
  readonly at: string;
}

/** Port za persistenciju audit zapisa. */
export interface AuditSink {
  /** Implementacija **ne smije bacati** — audit nikad ne ruši zahtjev. */
  record(entry: AuditRecord): void | Promise<void>;
}

/** DI token za `AuditSink`. */
export const AUDIT_SINK = Symbol('VFM_AUDIT_SINK');

/** Default sink: logira zapis (dok Prisma nije dostupna). */
@Injectable()
export class LoggingAuditSink implements AuditSink {
  private readonly logger = new Logger('Audit');

  record(entry: AuditRecord): void {
    const line = [
      `action=${entry.action}`,
      `severity=${entry.severity}`,
      entry.resource ? `resource=${entry.resource}` : undefined,
      entry.entityId ? `entity=${entry.entityId}` : undefined,
      entry.userId ? `user=${entry.userId}` : undefined,
      entry.clientType ? `client=${entry.clientType}` : undefined,
      entry.requestId ? `requestId=${entry.requestId}` : undefined,
      entry.success ? 'status=ok' : `status=fail(${entry.errorCode ?? '?'})`,
      `durationMs=${entry.durationMs}`,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' ');

    if (entry.severity === 'SECURITY' || entry.severity === 'CRITICAL') this.logger.warn(line);
    else this.logger.log(line);
  }
}

// -----------------------------------------------------------------------------
//  Diff
// -----------------------------------------------------------------------------

/** Jedna promjena u diff-u. */
export interface AuditDiffEntry {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

/**
 * Diff dva objekta (plići + stabilan redoslijed ključeva).
 *
 * Pravila:
 * - uključuje samo polja koja su se **stvarno** promijenila (JSON poredba),
 * - uklanja osjetljiva polja iz obje strane,
 * - `undefined` i nedostajuće polje se tretiraju jednako (bez lažnih promjena),
 * - vraća praznu listu ako nema promjena (interceptor tada ne piše UPDATE diff).
 */
export function buildAuditDiff(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>> | undefined,
): readonly AuditDiffEntry[] {
  const left = redactRecord(before);
  const right = redactRecord(after);
  if (!left && !right) return [];

  const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort();
  const diff: AuditDiffEntry[] = [];

  for (const field of keys) {
    const beforeValue = left?.[field];
    const afterValue = right?.[field];
    if (isSameValue(beforeValue, afterValue)) continue;
    diff.push({ field, before: beforeValue ?? null, after: afterValue ?? null });
  }

  return diff;
}

/** Uklanja osjetljiva polja (case-insensitively) iz objekta. */
export function redactRecord(
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REDACTED_FIELDS.some((field) => field.toLowerCase() === key.toLowerCase())) {
      result[key] = REDACTED_VALUE;
      continue;
    }
    result[key] = entry;
  }
  return result;
}

/** JSON-ekvivalentnost (null/undefined se ne razlikuju, redoslijed ključeva bitan). */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null) return b === undefined || b === null;
  if (b === undefined || b === null) return false;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string | Date).getTime() === new Date(b as string | Date).getTime();
  }
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Severity za odbijen zahtjev: kodovi označeni kao `securityRelevant` u katalogu
 * dobijaju `SECURITY`, ostali `WARN` (docs/05 §9).
 */
export function severityForError(code: ErrorCode | string): AuditSeverity {
  const meta = ERROR_CODES[code as ErrorCode];
  if (!meta) return 'WARN';
  return meta.securityRelevant ? 'SECURITY' : 'WARN';
}

// -----------------------------------------------------------------------------
//  Kontekst (handler/servis dodaje podatke koje interceptor ne može znati)
// -----------------------------------------------------------------------------

/** Simbol pod kojim se kontekst čuva na request objektu. */
export const AUDIT_CONTEXT_KEY = Symbol('VFM_AUDIT_CONTEXT');

/**
 * Kontekst audita za jedan zahtjev.
 *
 * Servisi ga koriste da dodaju `before` snapshot (interceptor ga ne može znati),
 * ID entiteta i proizvoljne metapodatke:
 * ```ts
 * AuditContext.from(request).setBefore(role).setEntityId(role.id).set('permissionsVersion', 7);
 * ```
 */
export class AuditContext {
  private beforeValue: Readonly<Record<string, unknown>> | undefined;
  private afterValue: Readonly<Record<string, unknown>> | undefined;
  private readonly metaValue: Record<string, unknown> = {};
  private entityIdValue: string | undefined;
  private resourceValue: string | undefined;

  /** Dohvata (ili kreira) kontekst vezan za request. */
  static from(request: object): AuditContext {
    const target = request as Record<symbol, AuditContext | undefined>;
    const existing = target[AUDIT_CONTEXT_KEY];
    if (existing) return existing;
    const created = new AuditContext();
    target[AUDIT_CONTEXT_KEY] = created;
    return created;
  }

  /** Postavlja stanje prije izmjene. */
  setBefore(value: Readonly<Record<string, unknown>> | undefined): this {
    this.beforeValue = value;
    return this;
  }

  get before(): Readonly<Record<string, unknown>> | undefined {
    return this.beforeValue;
  }

  /** ID entiteta nad kojim je akcija izvršena. */
  setEntityId(value: string | undefined): this {
    this.entityIdValue = value;
    return this;
  }

  get entityId(): string | undefined {
    return this.entityIdValue;
  }

  /**
   * Postavlja stanje **poslije** izmjene.
   *
   * Zašto postoji: interceptor inače uzima `after` iz odgovora handlera, što je
   * za složene odgovore (npr. matrica prava) neuporedivo s `before` snapshotom.
   * Servis može predati oba u istom obliku → diff je tačan po polju.
   */
  setAfter(value: Readonly<Record<string, unknown>> | undefined): this {
    this.afterValue = value;
    return this;
  }

  get after(): Readonly<Record<string, unknown>> | undefined {
    return this.afterValue;
  }

  /** Naziv resursa (ima prednost nad onim iz `@Audit`). */
  setResource(value: string | undefined): this {
    this.resourceValue = value;
    return this;
  }

  get resource(): string | undefined {
    return this.resourceValue;
  }

  /** Dodaje metapodatak (npr. `revokedSessions: 3`). */
  set(key: string, value: unknown): this {
    this.metaValue[key] = value;
    return this;
  }

  get meta(): Readonly<Record<string, unknown>> {
    return { ...this.metaValue };
  }
}
