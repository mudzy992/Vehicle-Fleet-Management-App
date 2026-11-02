import { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastItem, type ToastKind } from '../../lib/toast.js';

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-success bg-success-soft text-success',
  danger: 'border-danger bg-danger-soft text-danger',
  warning: 'border-warning bg-warning-soft text-warning',
  info: 'border-info bg-info-soft text-info',
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (items.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed top-4 right-4 z-50 flex w-[min(100%-2rem,22rem)] flex-col gap-2"
      aria-live={items.some((item) => item.kind === 'danger' || item.kind === 'warning') ? 'assertive' : 'polite'}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-md ${KIND_CLASS[item.kind]}`}
        >
          <button type="button" className="w-full text-left" onClick={() => dismissToast(item.id)}>
            {item.message}
          </button>
        </div>
      ))}
    </div>
  );
}
