import { t } from '@/lib/i18n';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly details?: Array<{ path: string[]; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Envelope<T> =
  | { data: T }
  | { error: { code?: string; message?: string; requestId?: string; details?: Array<{ path: string[]; message: string }> } };

export function toUserMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof ApiError)) return cause instanceof Error ? cause.message : fallback;
  if (cause.status === 0 || cause.code === 'NETWORK_ERROR') return t('noNetwork');
  if (cause.status === 401 && cause.code !== 'INVALID_CREDENTIALS') return t('sessionExpired');
  if (cause.code === 'MOBILE_ACCESS_FORBIDDEN' || cause.code === 'MOBILE_SCOPE_NOT_ALLOWED') {
    return t('mobileAccessForbidden');
  }
  if (cause.status === 403) return t('generic403');
  if (cause.status === 404) return t('generic404');
  if (cause.code === 'TASK_ALREADY_CLAIMED') return cause.message || t('generic409');
  if (cause.status === 409) return t('generic409');
  if (cause.status === 429) return t('generic429');
  if (cause.status >= 500) return t('generic5xx');
  return cause.message || fallback;
}

export function isOfflineError(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 0 || cause.code === 'NETWORK_ERROR');
}
