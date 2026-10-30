/**
 * `Field` — label + kontrola + poruka greške (bez dependencija).
 *
 * Zašto komponenta: svi ekrani Faze 1 imaju iste labele/`aria-describedby`
 * obrasce, a konzistentan `id` je uslov za pristupačnost (label ↔ input).
 */
import type { ReactNode } from 'react';

export const inputClassName =
  'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary disabled:opacity-60';

export interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  readonly error?: string | null;
  readonly children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
