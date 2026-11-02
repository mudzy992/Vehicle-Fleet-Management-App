export type ToastKind = 'success' | 'danger' | 'warning' | 'info';

export interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

const MAX_TOASTS = 3;
const listeners = new Set<(items: ToastItem[]) => void>();
const timers = new Map<number, number>();
let items: ToastItem[] = [];
let nextId = 1;

function emit(): void {
  listeners.forEach((listener) => listener(items));
}

export function subscribeToasts(listener: (next: ToastItem[]) => void): () => void {
  listeners.add(listener);
  listener(items);
  return () => { listeners.delete(listener); };
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  items = items.filter((item) => item.id !== id);
  emit();
}

export function clearToasts(): void {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.clear();
  items = [];
  emit();
}

export function showToast(kind: ToastKind, message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  const id = nextId;
  nextId += 1;
  items = [...items, { id, kind, message: trimmed }].slice(-MAX_TOASTS);
  emit();
  timers.set(id, window.setTimeout(() => dismissToast(id), kind === 'danger' ? 8000 : 5000));
}

export const toast = {
  success: (message: string) => showToast('success', message),
  danger: (message: string) => showToast('danger', message),
  warning: (message: string) => showToast('warning', message),
  info: (message: string) => showToast('info', message),
};

const INLINE_HTTP_STATUSES = new Set([400, 401, 409, 422]);

export function toastHttpError(input: { method?: string; path: string; status: number; message: string }): void {
  const verb = (input.method ?? 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return;
  if (input.path === '/auth/login') return;
  if (INLINE_HTTP_STATUSES.has(input.status)) return;
  toast.danger(input.message);
}
