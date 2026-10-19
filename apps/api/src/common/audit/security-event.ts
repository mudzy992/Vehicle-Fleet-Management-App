/**
 * Sigurnosni događaji (docs/05 §9, docs/09 P1).
 *
 * Guard-ovi ne smiju zavisiti od `AuditService` (koji piše u `AuditLog` preko
 * Prisme — bloker 1), pa se događaji prijavljuju kroz **sink interfejs**.
 * Default implementacija logira (pino) tako da nijedan sigurnosni događaj nije
 * izgubljen; `AuditModule` (Faza 1, chunk C) registruje sink koji i upisuje u
 * bazu s `severity = SECURITY`.
 *
 * Događaji koje Faza 1 mora bilježiti:
 * - `MOBILE_ACCESS_FORBIDDEN` — Super Admin s mobilnog klijenta (P1),
 * - `LOGIN_FAILED` / `ACCOUNT_LOCKED` — neuspjeli pokušaji i zaključavanje,
 * - `PERMISSION_DENIED` / `SCOPE_DENIED` — odbijen pristup,
 * - `REFRESH_REUSE_DETECTED` — reuse detection (rotacija refresh tokena),
 * - `PERMISSIONS_STALE` — zahtjev s tokenom izdatim prije revokacije prava (P3).
 */
import { Injectable, Logger } from '@nestjs/common';
import type { ClientType } from '@vfm/shared';

/** Tipovi sigurnosnih događaja (uz `AUDIT_ACTIONS.SECURITY` u audit logu). */
export const SECURITY_EVENT_TYPES = [
  'MOBILE_ACCESS_FORBIDDEN',
  'MOBILE_SCOPE_NOT_ALLOWED',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'PERMISSION_DENIED',
  'SCOPE_DENIED',
  'REFRESH_REUSE_DETECTED',
  'PERMISSIONS_STALE',
  'TOKEN_REVOKED',
  'UNAUTHENTICATED',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/** Podaci o sigurnosnom događaju (za audit zapis + log). */
export interface SecurityEvent {
  readonly type: SecurityEventType;
  /** UUID korisnika (ako je poznat — kod neuspjelog logina može biti `undefined`). */
  readonly userId?: string;
  /** E-mail iz pokušaja (samo za LOGIN_FAILED; ne logira se lozinka — docs/05 §7). */
  readonly email?: string;
  readonly clientType?: ClientType;
  readonly roles?: readonly string[];
  readonly permission?: string;
  readonly scope?: string;
  /** `requestId` (korelacija s logovima). */
  readonly requestId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  /** Kratak razlog (bez osjetljivih podataka). */
  readonly reason?: string;
  readonly path?: string;
  readonly method?: string;
}

/** Prijava sigurnosnih događaja (implementira je `AuditService` od chunka C). */
export interface SecurityEventSink {
  /**
   * Prijavljuje događaj. Implementacija **ne smije bacati** — audit je sporedna
   * putanja i ne smije srušiti zahtjev koji je već ispravno odbijen.
   */
  record(event: SecurityEvent): void | Promise<void>;
}

/** DI token za `SecurityEventSink`. */
export const SECURITY_EVENT_SINK = Symbol('VFM_SECURITY_EVENT_SINK');

/**
 * Prijavljuje događaj bez rizika da audit sruši zahtjev.
 *
 * Audit je sporedna putanja: greška sink-a se guta (i logira) jer zahtjev koji je
 * odbijen iz sigurnosnih razloga **mora** vratiti svoj 401/403.
 */
export function reportSecurityEvent(sink: SecurityEventSink | undefined, event: SecurityEvent): void {
  if (!sink) return;
  try {
    const result = sink.record(event) as unknown;
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // Namjerno bez reakcije.
  }
}

/** Zaglavlja/relevantni podaci zahtjeva koji idu u svaki sigurnosni događaj. */
export function securityContextFromRequest(request: {
  readonly id?: string;
  readonly ip?: string;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}): Pick<SecurityEvent, 'requestId' | 'ip' | 'userAgent' | 'path' | 'method'> {
  const header = (name: string): string | undefined => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    requestId: request.id ?? header('x-request-id'),
    ip: request.ip ?? header('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: header('user-agent'),
    path: request.url,
    method: request.method,
  };
}

/**
 * Default sink: logira upozorenje (vidljivo u Coolify logovima odmah).
 *
 * `AuditModule` ga prepisuje svojim providerom koji piše u `AuditLog`.
 */
@Injectable()
export class LoggingSecurityEventSink implements SecurityEventSink {
  private readonly logger = new Logger('SecurityEvent');

  record(event: SecurityEvent): void {
    const parts = [
      `type=${event.type}`,
      event.userId ? `user=${event.userId}` : undefined,
      event.email ? `email=${event.email}` : undefined,
      event.clientType ? `client=${event.clientType}` : undefined,
      event.permission ? `permission=${event.permission}` : undefined,
      event.requestId ? `requestId=${event.requestId}` : undefined,
      event.ip ? `ip=${event.ip}` : undefined,
      event.path ? `path=${event.method ?? ''} ${event.path}`.trim() : undefined,
      event.reason ? `reason=${event.reason}` : undefined,
    ].filter((part): part is string => Boolean(part));

    this.logger.warn(`SECURITY_EVENT ${parts.join(' ')}`);
  }
}
