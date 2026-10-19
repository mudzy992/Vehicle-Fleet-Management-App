import { describe, expect, it } from 'vitest';
import {
  ALL_ERROR_CODES,
  buildPaginationMeta,
  ERROR_CODES,
  getErrorHttpStatus,
  getErrorMeta,
  isApiFailure,
  isApiSuccess,
  isErrorCode,
} from '../dist/index.js';

describe('katalog kodova grešaka', () => {
  it('sadrži sve kodove navedene u docs/07 §1.5', () => {
    const required = [
      'MOBILE_ACCESS_FORBIDDEN',
      'MOBILE_SCOPE_NOT_ALLOWED',
      'PERMISSION_DENIED',
      'SCOPE_DENIED',
      'PERMISSIONS_STALE',
      'TOKEN_REVOKED',
      'TASK_ALREADY_CLAIMED',
      'NOT_ASSIGNEE',
      'VERSION_CONFLICT',
      'PERIOD_OVERLAP',
      'TIRE_ALREADY_MOUNTED',
      'ODOMETER_REGRESSION',
      'FORM_VALIDATION_FAILED',
      'RESERVED_FIELD_KEY',
      'FORM_VERSION_NOT_PUBLISHED',
      'NORMALIZATION_MISMATCH',
      'UNKNOWN_FIELD',
      'FIELD_NOT_VISIBLE',
      'IDEMPOTENCY_KEY_REUSED',
      'RATE_LIMITED',
      'DEPENDENCY_UNAVAILABLE',
      'LAST_SUPER_ADMIN_PROTECTED',
    ];
    for (const code of required) {
      expect(ALL_ERROR_CODES, `nedostaje kod ${code}`).toContain(code);
    }
  });

  it('svaki unos ima konzistentne metapodatke', () => {
    for (const code of ALL_ERROR_CODES) {
      const meta = getErrorMeta(code);
      expect(meta.code).toBe(code);
      expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
      expect(meta.httpStatus).toBeLessThan(600);
      expect(['AUTH', 'VALIDATION', 'DOMAIN', 'SECURITY', 'INFRA', 'RATE_LIMIT']).toContain(
        meta.category,
      );
      expect(typeof meta.securityRelevant).toBe('boolean');
      expect(typeof meta.retryable).toBe('boolean');
      expect(meta.messageBs.length).toBeGreaterThan(5);
      expect(getErrorHttpStatus(code)).toBe(meta.httpStatus);
    }
  });

  it('sigurnosno relevantne greške su označene (audit SECURITY)', () => {
    expect(ERROR_CODES.MOBILE_ACCESS_FORBIDDEN.securityRelevant).toBe(true);
    expect(ERROR_CODES.PERMISSION_DENIED.securityRelevant).toBe(true);
    expect(ERROR_CODES.RATE_LIMITED.securityRelevant).toBe(true);
    expect(ERROR_CODES.REFRESH_TOKEN_REUSE_DETECTED.securityRelevant).toBe(true);
    expect(ERROR_CODES.TASK_ALREADY_CLAIMED.securityRelevant).toBe(false);
  });

  it('401 greške su retryable (klijent osvježava token)', () => {
    expect(ERROR_CODES.PERMISSIONS_STALE.httpStatus).toBe(401);
    expect(ERROR_CODES.PERMISSIONS_STALE.retryable).toBe(true);
    expect(ERROR_CODES.TOKEN_REVOKED.httpStatus).toBe(401);
    expect(ERROR_CODES.TOKEN_REVOKED.retryable).toBe(true);
  });

  it('konfliktni kodovi koriste 409', () => {
    for (const code of [
      'TASK_ALREADY_CLAIMED',
      'VERSION_CONFLICT',
      'PERIOD_OVERLAP',
      'TIRE_ALREADY_MOUNTED',
      'FORM_VERSION_NOT_PUBLISHED',
      'LAST_SUPER_ADMIN_PROTECTED',
    ] as const) {
      expect(ERROR_CODES[code].httpStatus, `${code} treba 409`).toBe(409);
    }
  });

  it('poruke su na bosanskom i ne otkrivaju interni detalj', () => {
    expect(ERROR_CODES.INTERNAL_ERROR.messageBs).toBe('Došlo je do interne greške.');
    expect(ERROR_CODES.INVALID_CREDENTIALS.messageBs).not.toMatch(/lozinka je pogrešna za korisnika/iu);
    for (const code of ALL_ERROR_CODES) {
      expect(ERROR_CODES[code].messageBs).not.toMatch(/stack|prisma|postgres|redis/iu);
    }
  });

  it('isErrorCode prepoznaje poznate i odbacuje nepoznate', () => {
    expect(isErrorCode('RATE_LIMITED')).toBe(true);
    expect(isErrorCode('NEPOZNATO')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
  });
});

describe('API envelope', () => {
  it('isApiSuccess / isApiFailure razlikuju oblike', () => {
    const success = { data: { id: '1' } };
    const failure = { error: { code: 'NOT_FOUND', message: 'Nema' } };
    expect(isApiSuccess(success)).toBe(true);
    expect(isApiFailure(success)).toBe(false);
    expect(isApiFailure(failure)).toBe(true);
    expect(isApiSuccess(failure)).toBe(false);
  });

  it('buildPaginationMeta računa stranice i hasMore', () => {
    expect(buildPaginationMeta(1, 25, 0)).toMatchObject({
      page: 1,
      pageSize: 25,
      totalItems: 0,
      totalPages: 1,
      hasMore: false,
    });
    expect(buildPaginationMeta(1, 25, 26)).toMatchObject({ totalPages: 2, hasMore: true });
    expect(buildPaginationMeta(2, 25, 26)).toMatchObject({ totalPages: 2, hasMore: false });
    expect(buildPaginationMeta(1, 0, 10)).toMatchObject({ pageSize: 1, totalPages: 10 });
  });
});
