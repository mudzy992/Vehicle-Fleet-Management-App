/**
 * API klijent (Faza 1: auth + prvi moduli).
 *
 * Pravila:
 * - Browser **nikad** ne zove drugi origin: koristi se relativni `/api/v1`
 *   (dev: Vite proxy; produkcija: nginx `/api` → `http://api:3000`).
 *   Time se izbjegava CORS i problem s preview hostom.
 * - **Access token živi samo u memoriji** (nikad `localStorage`): XSS ne može
 *   pročitati refresh token (httpOnly cookie), a ukradeni access token važi
 *   najviše 10 min. Refresh cookie ide automatski (`credentials: 'include'`).
 * - Na `401` klijent pokušava **jedan** refresh (single-flight) i ponavlja
 *   zahtjev; ako refresh padne, javlja `sessionExpired` handleru (UI vodi na
 *   `/prijava`). Bez toga bi svaki istekli token rušio ekran.
 * - Odgovor je `{ data, meta }` ili `{ error }` (docs/07 §1.2) →
 *   `isApiFailure()` iz `@vfm/shared`.
 */
import { isApiFailure } from '@vfm/shared';
import type { ApiErrorBody, ApiSuccess, ErrorCode } from '@vfm/shared';

export const API_BASE = '/api/v1';

/** Zaglavlje koje server provjerava na svakom zahtjevu (N-05/P1). */
const CLIENT_TYPE = 'WEB';

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

// -----------------------------------------------------------------------------
//  Access token (memorija) + refresh
// -----------------------------------------------------------------------------

let accessToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;
let refreshPromise: Promise<boolean> | null = null;

/** Postavlja (ili briše) access token — poziva `SessionProvider`. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Handler koji se zove kad refresh ne uspije (sesija je istekla). */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

/**
 * Rotira refresh sesiju i pamti novi access token.
 *
 * `single-flight`: paralelni zahtjevi koji dobiju 401 dijele **jedan** refresh.
 * Bez toga bi N istovremenih poziva rotiralo isti refresh token → reuse
 * detection na serveru revokovala bi sve sesije korisniku.
 */
export async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  const promise = (async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Client-Type': CLIENT_TYPE },
      });
      if (!response.ok) return false;

      const payload = (await response.json()) as ApiSuccess<{ accessToken?: string }> | null;
      const token = payload && 'data' in payload ? payload.data.accessToken : undefined;
      if (typeof token !== 'string' || token.length === 0) return false;

      accessToken = token;
      return true;
    } catch {
      return false;
    }
  })();

  refreshPromise = promise;
  try {
    return await promise;
  } finally {
    if (refreshPromise === promise) refreshPromise = null;
  }
}

// -----------------------------------------------------------------------------
//  Osnovni zahtjev
// -----------------------------------------------------------------------------

async function request<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Client-Type': CLIENT_TYPE,
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
    headers[key] = value;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  // 401 → jedan pokušaj refresha (login/refresh sami ne pokreću refresh petlju).
  const retryable = allowRetry && path !== '/auth/login' && path !== '/auth/refresh';
  if (response.status === 401 && retryable) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, init, false);
    sessionExpiredHandler?.();
  }

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
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// -----------------------------------------------------------------------------
//  Health (Faza 0 — izvan `/api/v1`)
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
