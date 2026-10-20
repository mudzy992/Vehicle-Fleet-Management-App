/**
 * VFM — domenske greške s kodom iz kataloga (`packages/shared/src/errors.ts`).
 *
 * Zašto zaseban fajl (a ne unutar filtera): `VfmException`/`VfmErrors` koriste
 * guard-ovi, servisi, pipe-ovi i interceptor-i u svim modulima; filter je samo
 * mjesto gdje se greška pretvara u HTTP odgovor (envelope).
 *
 * Pravila (docs/07-API_SPECIFIKACIJA.md §1.5):
 * - klijent switch-uje po `code`, nikad po poruci,
 * - HTTP status dolazi iz kataloga (`ERROR_CODES[code].httpStatus`),
 * - `details[]` nosi Zod greške po polju (`path`, `message`, `code`),
 * - `extra` nosi mašinski čitljive dodatke (`currentVersion`, `retryAfterSeconds`, …).
 */
import { ERROR_CODES } from '@vfm/shared';
import type { ApiErrorDetail, ErrorCode } from '@vfm/shared';

/** Greška koju domenski kod baca s eksplicitnim kodom iz kataloga. */
export class VfmException extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: readonly ApiErrorDetail[],
    readonly extra?: Readonly<Record<string, unknown>>,
  ) {
    super(message ?? ERROR_CODES[code].messageBs);
    this.name = 'VfmException';
  }

  get httpStatus(): number {
    return ERROR_CODES[this.code].httpStatus;
  }

  get securityRelevant(): boolean {
    return ERROR_CODES[this.code].securityRelevant;
  }
}

/** Convenience konstruktori (Faza 1: auth, RBAC, validacija). */
export const VfmErrors = {
  // --- Autentifikacija i sesije (docs/05 §5) ---
  unauthenticated: (message?: string) => new VfmException('UNAUTHENTICATED', message),
  tokenExpired: () => new VfmException('TOKEN_EXPIRED'),
  tokenRevoked: () => new VfmException('TOKEN_REVOKED'),
  permissionsStale: () => new VfmException('PERMISSIONS_STALE'),
  invalidCredentials: () => new VfmException('INVALID_CREDENTIALS'),
  accountLocked: (retryAfterSeconds?: number) =>
    new VfmException(
      'ACCOUNT_LOCKED',
      undefined,
      undefined,
      retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
    ),
  accountInactive: () => new VfmException('ACCOUNT_INACTIVE'),
  passwordChangeRequired: () => new VfmException('PASSWORD_CHANGE_REQUIRED'),
  refreshReuseDetected: () => new VfmException('REFRESH_TOKEN_REUSE_DETECTED'),

  // --- Autorizacija i klijent (N-05, P1) ---
  permissionDenied: (details?: readonly ApiErrorDetail[]) =>
    new VfmException('PERMISSION_DENIED', undefined, details),
  scopeDenied: (details?: readonly ApiErrorDetail[]) => new VfmException('SCOPE_DENIED', undefined, details),
  mobileAccessForbidden: () => new VfmException('MOBILE_ACCESS_FORBIDDEN'),
  mobileScopeNotAllowed: () => new VfmException('MOBILE_SCOPE_NOT_ALLOWED'),
  lastSuperAdminProtected: () => new VfmException('LAST_SUPER_ADMIN_PROTECTED'),

  // --- Validacija ---
  validationError: (details: readonly ApiErrorDetail[]) =>
    new VfmException('VALIDATION_ERROR', undefined, details),
  unknownField: (details: readonly ApiErrorDetail[]) => new VfmException('UNKNOWN_FIELD', undefined, details),

  // --- Domena i infrastruktura ---
  notFound: (resource?: string) =>
    new VfmException('NOT_FOUND', resource ? `Traženi resurs (${resource}) nije pronađen.` : undefined),
  versionConflict: (currentVersion: number) =>
    new VfmException('VERSION_CONFLICT', undefined, undefined, { currentVersion }),
  taskAlreadyClaimed: () => new VfmException('TASK_ALREADY_CLAIMED'),
  rateLimited: (retryAfterSeconds: number) =>
    new VfmException('RATE_LIMITED', undefined, undefined, { retryAfterSeconds }),
  dependencyUnavailable: (dependency: string) =>
    new VfmException('DEPENDENCY_UNAVAILABLE', `Servis "${dependency}" je privremeno nedostupan.`),
  internal: () => new VfmException('INTERNAL_ERROR'),
} as const;
