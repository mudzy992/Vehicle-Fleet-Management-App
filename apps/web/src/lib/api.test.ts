import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, refreshAccessToken, setAccessToken, setSessionExpiredHandler } from './api.js';

/**
 * API klijent (docs/05 §5.2, docs/07 §1.2).
 *
 * Testira se ono što se u produkciji ne vidi iz koda na prvi pogled:
 * - **single-flight refresh**: N paralelnih 401 ne smije rotirati isti refresh
 *   token N puta (server bi to prepoznao kao reuse i revokovao sve sesije),
 * - **retry nakon refresh-a** nosi novi token,
 * - kad refresh padne, klijent zove `sessionExpired` handler (UI → prijava),
 * - `ApiError` nosi `code` iz kataloga, a ne poruku.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  setAccessToken(null);
  setSessionExpiredHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api klijent', () => {
  it('šalje access token u Authorization zaglavlju i X-Client-Type: WEB', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('token-1');

    await api.get<{ ok: boolean }>('/auth/me');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/me');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['X-Client-Type']).toBe('WEB');
    expect(init.credentials).toBe('include');
  });

  it('na 401 osvježi sesiju i ponovi zahtjev s novim tokenom', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse({ data: { accessToken: 'token-2' } });
      }
      const authorized = calls.filter((call) => call.endsWith('/users')).length > 1;
      return authorized ? jsonResponse({ data: { items: [] } }) : jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.get<{ items: unknown[] }>('/users');

    expect(result).toEqual({ items: [] });
    expect(calls.filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith('/users'))).toHaveLength(2);
  });

  it('paralelni 401 dijele jedan refresh (single-flight)', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse({ data: { accessToken: 'token-2' } });
      }
      return refreshCalls > 0
        ? jsonResponse({ data: { ok: true } })
        : jsonResponse({ error: { code: 'TOKEN_EXPIRED', message: 'istekao' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it('kad refresh padne, zove sessionExpired handler i baca ApiError', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) return jsonResponse({ error: { code: 'UNAUTHENTICATED' } }, 401);
      return jsonResponse({ error: { code: 'TOKEN_EXPIRED', message: 'istekao' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/users')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('refreshAccessToken vraća false kad cookie ne postoji', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHENTICATED' } }, 401)));

    await expect(refreshAccessToken()).resolves.toBe(false);
  });

  it('204 odgovor vraća undefined bez JSON parse greške', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

    await expect(api.post('/users/1/archive')).resolves.toBeUndefined();
  });
});
