import * as SecureStore from 'expo-secure-store';
import { ApiError, type Envelope } from '@/lib/api-error';
import { isFormDataBody } from '@/lib/api-form-data';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://api.vehicle.ba101.top/api/v1').replace(/\/$/u, '');
const REFRESH_KEY = 'vfm.refresh-token';
const DEVICE_TOKEN_KEY = 'vfm.device-token-id';

let accessToken: string | null = null;
let sessionId: string | null = null;
let refreshFlight: Promise<boolean> | null = null;
const authExpiredListeners = new Set<() => void>();

export function currentAccessToken(): string | null {
  return accessToken;
}

export function currentSessionId(): string | null {
  return sessionId;
}

export function setSession(next: { accessToken: string; sessionId: string | null }): void {
  accessToken = next.accessToken;
  sessionId = next.sessionId;
}

export function clearSessionMemory(): void {
  accessToken = null;
  sessionId = null;
}

export function onAuthExpired(listener: () => void): () => void {
  authExpiredListeners.add(listener);
  return () => { authExpiredListeners.delete(listener); };
}

export function emitAuthExpired(): void {
  authExpiredListeners.forEach((listener) => listener());
}

export async function storeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_KEY, token);
}

export async function readRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function storeDeviceTokenId(id: string): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, id);
}

export async function readDeviceTokenId(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
}

export async function clearDeviceTokenId(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
}

async function refresh(): Promise<boolean> {
  if (refreshFlight) return refreshFlight;
  const promise = (async () => {
    const refreshToken = await readRefreshToken();
    if (!refreshToken) return false;
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Client-Type': 'MOBILE_ANDROID' },
        body: JSON.stringify({ refreshToken, clientType: 'MOBILE_ANDROID' }),
      });
    } catch {
      throw new ApiError('Nema mrežne veze. Provjerite internet i pokušajte ponovo.', 0, 'NETWORK_ERROR');
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ApiError('Usluga trenutno nije dostupna. Pokušajte ponovo za nekoliko trenutaka.', response.status, 'HTTP_ERROR');
    }
    let body: Envelope<{ accessToken: string; refreshToken: string; sessionId: string }>;
    try {
      body = (await response.json()) as Envelope<{ accessToken: string; refreshToken: string; sessionId: string }>;
    } catch {
      return false;
    }
    if (!response.ok || !('data' in body) || !body.data.accessToken || !body.data.refreshToken) return false;
    setSession({ accessToken: body.data.accessToken, sessionId: body.data.sessionId ?? null });
    await storeRefreshToken(body.data.refreshToken);
    return true;
  })();
  refreshFlight = promise;
  try {
    return await promise;
  } finally {
    if (refreshFlight === promise) refreshFlight = null;
  }
}

export async function request<T>(path: string, init: RequestInit = {}, mayRefresh = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'X-Client-Type': 'MOBILE_ANDROID',
        ...(init.body && !isFormDataBody(init.body) ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError('Nema mrežne veze. Provjerite internet i pokušajte ponovo.', 0, 'NETWORK_ERROR');
  }
  const authRouteDoesNotUseBearer = ['/auth/login', '/auth/refresh', '/auth/logout'].includes(path);
  if (response.status === 401 && !authRouteDoesNotUseBearer) {
    if (mayRefresh && await refresh()) return request<T>(path, init, false);
    clearSessionMemory();
    await clearRefreshToken();
    emitAuthExpired();
  }
  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    if (!response.ok) throw new ApiError(`Zahtjev nije uspio (HTTP ${response.status}).`, response.status, 'HTTP_ERROR');
  }
  if (!response.ok) {
    const error = body && 'error' in body ? body.error : {};
    throw new ApiError(error.message ?? `Zahtjev nije uspio (HTTP ${response.status}).`, response.status, error.code ?? 'HTTP_ERROR', error.requestId, error.details);
  }
  return body && 'data' in body ? body.data : (body as T);
}

export async function restoreSession(): Promise<boolean> {
  return refresh();
}
