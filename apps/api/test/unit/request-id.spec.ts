import { describe, expect, it, vi } from 'vitest';
import {
  RequestIdMiddleware,
  sanitizeRequestId,
  REQUEST_ID_MAX_LENGTH,
} from '../../src/common/middleware/request-id.middleware.js';
import type { RequestWithId } from '../../src/common/middleware/request-id.middleware.js';

function createRequest(headers: Record<string, unknown> = {}): RequestWithId {
  return { headers, method: 'GET', url: '/api/v1/vehicles' } as unknown as RequestWithId;
}

function createResponse(): { setHeader: ReturnType<typeof vi.fn> } {
  return { setHeader: vi.fn() };
}

describe('sanitizeRequestId — zaštita od log injection-a', () => {
  it('prihvata UUID i Traefik formate', () => {
    expect(sanitizeRequestId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(sanitizeRequestId('abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it('odbacuje prazan, predug i ne-alfanumerički ID', () => {
    expect(sanitizeRequestId('')).toBeUndefined();
    expect(sanitizeRequestId('   ')).toBeUndefined();
    expect(sanitizeRequestId('x'.repeat(REQUEST_ID_MAX_LENGTH + 1))).toBeUndefined();
    expect(sanitizeRequestId('id\nX-Injected: true')).toBeUndefined();
    expect(sanitizeRequestId('<script>')).toBeUndefined();
    expect(sanitizeRequestId('id sa razmacima')).toBeUndefined();
  });

  it('odbacuje ne-string vrijednosti (niz iz Node headera)', () => {
    expect(sanitizeRequestId(undefined)).toBeUndefined();
    expect(sanitizeRequestId(null)).toBeUndefined();
    expect(sanitizeRequestId(42)).toBeUndefined();
    expect(sanitizeRequestId(['a', 'b'])).toBeUndefined();
  });

  it('trim-uje dozvoljeni ID', () => {
    expect(sanitizeRequestId('  abc-123  ')).toBe('abc-123');
  });
});

describe('RequestIdMiddleware', () => {
  it('koristi postojeći validan X-Request-Id i vraća ga u odgovoru', () => {
    const middleware = new RequestIdMiddleware();
    const req = createRequest({ 'x-request-id': 'trace-abc-123' });
    const res = createResponse();
    const next = vi.fn();

    middleware.use(req, res as never, next);

    expect(req.id).toBe('trace-abc-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'trace-abc-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('generiše UUID kad zaglavlje nedostaje', () => {
    const middleware = new RequestIdMiddleware();
    const req = createRequest();
    const res = createResponse();
    const next = vi.fn();

    middleware.use(req, res as never, next);

    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(next).toHaveBeenCalledOnce();
  });

  it('generiše novi ID kad je ulazni neispravan (injection pokušaj)', () => {
    const middleware = new RequestIdMiddleware();
    const req = createRequest({ 'x-request-id': 'los\nid' });
    const res = createResponse();

    middleware.use(req, res as never, vi.fn());

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(req.id).not.toContain('\n');
  });

  it('uzima prvi element ako je zaglavlje niz', () => {
    const middleware = new RequestIdMiddleware();
    const req = createRequest({ 'x-request-id': ['first-id', 'second-id'] });
    const res = createResponse();

    middleware.use(req, res as never, vi.fn());

    expect(req.id).toBe('first-id');
  });

  it('svaki zahtjev bez zaglavlja dobija različit ID', () => {
    const middleware = new RequestIdMiddleware();
    const ids = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const req = createRequest();
      middleware.use(req, createResponse() as never, vi.fn());
      ids.add(req.id ?? '');
    }
    expect(ids.size).toBe(50);
  });

  it('postavlja receivedAt (za mjerenje trajanja zahtjeva)', () => {
    const middleware = new RequestIdMiddleware();
    const req = createRequest();

    middleware.use(req, createResponse() as never, vi.fn());

    expect(typeof req.receivedAt).toBe('number');
    expect(req.receivedAt).toBeGreaterThan(0);
  });
});
