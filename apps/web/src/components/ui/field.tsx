/**
 * `Field` — label + kontrola + poruka greške (bez dependencija).
 *
 * Zašto komponenta: svi ekrani Faze 1 imaju iste labele/`aria-describedby`
 * obrasce, a konzistentan `id` je uslov za pristupačnost (label ↔ input).
 */
import type { ReactNode } from 'react';

export const inputClassName =
  'h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--primary)] disabled:opacity-60';

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
      <label htmlFor={htmlFor} className="block text-xs font-medium text-[var(--fg-muted)]">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-[11px] text-[var(--fg-muted)]">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
