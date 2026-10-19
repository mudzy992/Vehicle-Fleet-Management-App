/**
 * API klijent (Faza 0: health provjera; od Faze 1 puni `packages/api-client`).
 *
 * Pravila:
 * - Browser **nikad** ne zove drugi origin: koristi se relativni `/api/v1`
 *   (dev: Vite proxy; produkcija: nginx `/api` → `http://api:3000`).
 *   Time se izbjegava CORS i problem s preview hostom.
 * - Odgovor je `{ data, meta }` ili `{ error }` (docs/07 §1.2) →
 *   `isApiFailure()` iz `@vfm/shared`.
 * - Greške se bacaju kao `ApiError` s `code` iz kataloga, tako da UI može
 *   switch-ovati po kodu (npr. `PERMISSIONS_STALE` → ponovna prijava).
 */
import { isApiFailure } from '@vfm/shared';
import type { ApiErrorBody, ApiSuccess, ErrorCode } from '@vfm/shared';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorBody['details'],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-Client-Type': 'WEB',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text.length > 0 ? (JSON.parse(text) as unknown) : null;

  if (payload && isApiFailure(payload as never)) {
    const error = (payload as { error: ApiErrorBody }).error;
    throw new ApiError(error.code, error.message, response.status, error.details, error.requestId);
  }

  if (!response.ok) {
    throw new ApiError('INTERNAL_ERROR', `Zahtjev nije uspio (HTTP ${response.status}).`, response.status);
  }

  const success = payload as ApiSuccess<T> | null;
  return (success && 'data' in success ? success.data : (payload as T)) ?? (undefined as T);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// -----------------------------------------------------------------------------
//  Health (Faza 0 — jedini endpoint koji postoji)
// -----------------------------------------------------------------------------

export interface HealthDetails {
  status: 'ok' | 'error';
  info?: Record<string, unknown>;
  error?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export interface StartupInfo {
  status: string;
  startedAt: string;
  uptimeSeconds: number;
  env: { node: string; app: string; profile: string };
}

/** Health endpointi su IZVAN `/api/v1` (Docker/Coolify probe). */
export async function fetchLiveness(baseUrl = ''): Promise<HealthDetails> {
  const response = await fetch(`${baseUrl}/health/live`, { headers: { Accept: 'application/json' } });
  return (await response.json()) as HealthDetails;
}

export async function fetchReadiness(baseUrl = ''): Promise<{ status: number; body: HealthDetails }> {
  const response = await fetch(`${baseUrl}/health/ready`, { headers: { Accept: 'application/json' } });
  const body = (await response.json().catch(() => ({}))) as HealthDetails;
  return { status: response.status, body };
}

export async function fetchStartup(baseUrl = ''): Promise<StartupInfo> {
  const response = await fetch(`${baseUrl}/health/startup`, { headers: { Accept: 'application/json' } });
  return (await response.json()) as StartupInfo;
}
