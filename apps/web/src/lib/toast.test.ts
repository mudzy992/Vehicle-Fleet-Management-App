import { afterEach, describe, expect, it } from 'vitest';
import { clearToasts, subscribeToasts, toastHttpError, type ToastItem } from './toast.js';

afterEach(() => {
  clearToasts();
});

describe('toastHttpError', () => {
  it('skips GET, login, and inline form statuses', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToasts((items) => { seen.push(items); });
    seen.length = 0;
    toastHttpError({ method: 'GET', path: '/vehicles', status: 500, message: 'x' });
    toastHttpError({ method: 'POST', path: '/auth/login', status: 403, message: 'x' });
    toastHttpError({ method: 'POST', path: '/vehicles', status: 409, message: 'exists' });
    toastHttpError({ method: 'POST', path: '/odometer', status: 422, message: 'low' });
    toastHttpError({ method: 'POST', path: '/forms', status: 400, message: 'note' });
    toastHttpError({ method: 'POST', path: '/auth/refresh', status: 401, message: 'expired' });
    expect(seen).toEqual([]);
    unsubscribe();
  });

  it('toasts unexpected mutation failures', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToasts((items) => { seen.push(items); });
    seen.length = 0;
    toastHttpError({ method: 'POST', path: '/vehicles', status: 500, message: 'pad' });
    expect(seen.at(-1)?.map((item) => item.message)).toEqual(['pad']);
    unsubscribe();
  });
});
