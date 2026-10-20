/**
 * Tabela — minimalni primitivi (bez TanStack Table u Fazi 1).
 *
 * Pravila iz docs/06 §7.3: zaglavlje je „sticky" po potrebi, brojevi su
 * desno poravnati, a prazno stanje ide kroz `EmptyState` (ne prazna tabela).
 */
import type { ReactNode } from 'react';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={['overflow-x-auto', className ?? ''].filter(Boolean).join(' ')}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-[var(--border)]">{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={['hover:bg-[var(--hover)]', className ?? ''].filter(Boolean).join(' ')}>{children}</tr>;
}

export function TH({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-2 py-2 font-semibold ${align === 'right' ? 'text-right' : ''}`}>{children}</th>;
}

export function TD({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`px-2 py-2 align-middle ${align === 'right' ? 'text-right' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}
