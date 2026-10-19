import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import {
  AllExceptionsFilter,
  VfmErrors,
  VfmException,
} from '../../src/common/filters/all-exceptions.filter.js';
import { ERROR_CODES } from '@vfm/shared';

/**
 * Testovi globalnog filtera izuzetaka (docs/07 §1.5 — katalog kodova).
 *
 * Cilj: klijent uvijek dobije `{ error: { code, message, requestId? } }` s kodom
 * iz kataloga, a interna greška ne otkriva stack/SQL.
 */

function createMockHost(requestId = 'req-123', path = '/api/v1/tasks') {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const headersSent = false;

  const response = { status, json, headersSent };
  const request = { id: requestId, method: 'POST', url: path, originalUrl: path };

  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    },
    status,
    json,
  };
}

describe('AllExceptionsFilter — VfmException (domenske greške)', () => {
  it('TASK_ALREADY_CLAIMED → 409 s kodom iz kataloga', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(VfmErrors.taskAlreadyClaimed(), mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(409);
    expect(mock.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'TASK_ALREADY_CLAIMED',
          requestId: 'req-123',
        }),
      }),
    );
  });

  it('MOBILE_ACCESS_FORBIDDEN → 403 (Super Admin web-only, N-05)', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(VfmErrors.mobileAccessForbidden(), mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(ERROR_CODES.MOBILE_ACCESS_FORBIDDEN.httpStatus);
    const body = mock.json.mock.calls[0]?.[0] as { error: { message: string } };
    expect(body.error.message).toMatch(/mobilnu aplikaciju/iu);
  });

  it('VERSION_CONFLICT nosi currentVersion za klijentsko osvježavanje', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(VfmErrors.versionConflict(7), mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(409);
    const body = mock.json.mock.calls[0]?.[0] as { error: { currentVersion?: number } };
    expect(body.error.currentVersion).toBe(7);
  });

  it('RATE_LIMITED nosi retryAfterSeconds', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(VfmErrors.rateLimited(42), mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(429);
    const body = mock.json.mock.calls[0]?.[0] as { error: { retryAfterSeconds?: number } };
    expect(body.error.retryAfterSeconds).toBe(42);
  });

  it('poruka se može prepisati, ali kod ostaje iz kataloga', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(
      new VfmException('NOT_FOUND', 'Vozilo sa oznakom T12-E-456 ne postoji.'),
      mock.host as never,
    );

    expect(mock.status).toHaveBeenCalledWith(404);
    const body = mock.json.mock.calls[0]?.[0] as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Vozilo sa oznakom T12-E-456 ne postoji.');
  });
});

describe('AllExceptionsFilter — Nest HttpException mapiranje', () => {
  it.each([
    [new BadRequestException(), 400, 'VALIDATION_ERROR'],
    [new ForbiddenException(), 403, 'PERMISSION_DENIED'],
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new HttpException('custom', HttpStatus.TOO_MANY_REQUESTS), 429, 'RATE_LIMITED'],
    [new HttpException('custom', HttpStatus.SERVICE_UNAVAILABLE), 503, 'DEPENDENCY_UNAVAILABLE'],
    [new HttpException('custom', HttpStatus.UNPROCESSABLE_ENTITY), 422, 'FORM_VALIDATION_FAILED'],
  ] as const)('%s → %i / %s', (exception, expectedStatus, expectedCode) => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(exception, mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(expectedStatus);
    const body = mock.json.mock.calls[0]?.[0] as { error: { code: string } };
    expect(body.error.code).toBe(expectedCode);
  });

  it('validacijske greške s nizom poruka daju details', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(
      new BadRequestException({ message: ['page mora biti broj', 'pageSize je prevelik'] }),
      mock.host as never,
    );

    const body = mock.json.mock.calls[0]?.[0] as {
      error: { details?: { message: string }[] };
    };
    expect(body.error.details).toHaveLength(2);
    expect(body.error.details?.[0]?.message).toBe('page mora biti broj');
  });
});

describe('AllExceptionsFilter — nepoznate greške (500)', () => {
  it('ne otkriva stack ni interni detalj', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch(new Error('PGRST204: column "secret" does not exist'), mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(500);
    const body = mock.json.mock.calls[0]?.[0] as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe(ERROR_CODES.INTERNAL_ERROR.messageBs);
    expect(JSON.stringify(body)).not.toContain('PGRST204');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('string greška se također mapira na 500', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    filter.catch('neka čudna greška', mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(500);
  });
});

describe('AllExceptionsFilter — Zod greška (ZodValidationPipe, Faza 1)', () => {
  it('mapira se na 422 FORM_VALIDATION_FAILED s details po putanji', () => {
    const filter = new AllExceptionsFilter();
    const mock = createMockHost();

    const zodLike = Object.assign(new Error('Validation error'), {
      name: 'ZodError',
      issues: [
        { path: ['data', 'odometer'], message: 'Očekivan broj', code: 'invalid_type' },
        { path: ['data', 'amount', 0], message: 'Obavezan unos', code: 'too_small' },
      ],
    });

    filter.catch(zodLike, mock.host as never);

    expect(mock.status).toHaveBeenCalledWith(422);
    const body = mock.json.mock.calls[0]?.[0] as {
      error: { code: string; details?: { path: (string | number)[]; message: string }[] };
    };
    expect(body.error.code).toBe('FORM_VALIDATION_FAILED');
    expect(body.error.details).toHaveLength(2);
    expect(body.error.details?.[0]?.path).toEqual(['data', 'odometer']);
    expect(body.error.details?.[1]?.path).toEqual(['data', 'amount', 0]);
  });
});

describe('AllExceptionsFilter — rubni slučajevi', () => {
  it('ne pokušava pisati u već poslan odgovor (stream)', () => {
    const filter = new AllExceptionsFilter();
    const status = vi.fn();
    const json = vi.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ headersSent: true, status, json }),
        getRequest: () => ({ id: 'req-1', method: 'GET', url: '/api/v1/reports/1/download' }),
      }),
    };

    filter.catch(new Error('boom'), host as never);

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('radi i kad request nema id (bez requestId u odgovoru)', () => {
    const filter = new AllExceptionsFilter();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ headersSent: false, status, json }),
        getRequest: () => ({ method: 'GET', url: '/api/v1/vehicles' }),
      }),
    };

    filter.catch(VfmErrors.permissionDenied(), host as never);

    const body = json.mock.calls[0]?.[0] as { error: { requestId?: string } };
    expect(body.error.requestId).toBeUndefined();
    expect(status).toHaveBeenCalledWith(403);
  });
});
