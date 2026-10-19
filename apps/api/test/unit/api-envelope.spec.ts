import { describe, expect, it, vi } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { ApiEnvelopeInterceptor } from '../../src/common/interceptors/api-envelope.interceptor.js';

/**
 * Envelope interceptor (docs/07 §1.2): `{ data, meta }` za uspješne odgovore,
 * bez omotača za health i binarne odgovore.
 */
function createContext(path: string, requestId = 'req-1') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path, url: path, id: requestId, method: 'GET' }),
      getResponse: () => ({ setHeader: vi.fn() }),
    }),
  };
}

async function run(path: string, payload: unknown): Promise<unknown> {
  const interceptor = new ApiEnvelopeInterceptor();
  const next = { handle: () => of(payload) };
  return lastValueFrom(interceptor.intercept(createContext(path) as never, next as never));
}

describe('ApiEnvelopeInterceptor — omatanje', () => {
  it('objekat dobija { data, meta }', async () => {
    const result = (await run('/api/v1/vehicles', { id: 'v1' })) as {
      data: { id: string };
      meta: { requestId: string; timestamp: string };
    };
    expect(result.data).toEqual({ id: 'v1' });
    expect(result.meta.requestId).toBe('req-1');
    expect(result.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('niz dobija { data: [...] }', async () => {
    const result = (await run('/api/v1/vehicles', [{ id: 'v1' }, { id: 'v2' }])) as {
      data: unknown[];
    };
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('null/undefined → data: null', async () => {
    expect(((await run('/api/v1/x', null)) as { data: unknown }).data).toBeNull();
    expect(((await run('/api/v1/x', undefined)) as { data: unknown }).data).toBeNull();
  });

  it('već omotan odgovor se ne duplira', async () => {
    const payload = { data: { id: 'v1' }, meta: { page: { page: 1 } } };
    const result = (await run('/api/v1/vehicles', payload)) as {
      data: { id: string };
      meta: { requestId?: string; page?: unknown };
    };
    expect(result.data).toEqual({ id: 'v1' });
    expect(result.meta.requestId).toBe('req-1');
    expect(result.meta.page).toEqual({ page: 1 });
  });
});

describe('ApiEnvelopeInterceptor — izuzeci', () => {
  it('health endpointi se ne omataju (Docker/Coolify probe)', async () => {
    for (const path of ['/health/live', '/health/ready', '/health/startup', '/health/diagnostics']) {
      const result = (await run(path, { status: 'ok' })) as { data?: unknown; status: string };
      expect(result.status, `${path} treba ostati sirov`).toBe('ok');
      expect(result.data).toBeUndefined();
    }
  });

  it('binarni payload (PDF/Excel export) prolazi neizmijenjen', async () => {
    const buffer = Buffer.from('PDF-sadrzaj');
    expect(await run('/api/v1/reports/1/download', buffer)).toBe(buffer);

    const streamLike = { pipe: vi.fn() };
    expect(await run('/api/v1/reports/2/download', streamLike)).toBe(streamLike);
  });

  it('string odgovor se ne omata (npr. CSV tekst)', async () => {
    expect(await run('/api/v1/reports/3/download', 'a,b,c')).toBe('a,b,c');
  });
});
