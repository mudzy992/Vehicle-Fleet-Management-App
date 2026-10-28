/**
 * Stat — jedna metrika na nadzornoj tabli (docs/06 §5.5, ekran W02).
 *
 * Vrijednost se prikazuje tabularnim brojevima (poravnanje kolona), a
 * `level` daje semantičku boju (npr. broj probijenih rokova = danger).
 */
import type { ReactNode } from 'react';
import type { SemanticLevel } from '@vfm/shared';

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Dodatni kontekst ispod vrijednosti (npr. „+3 ove sedmice“). */
  hint?: string;
  level?: SemanticLevel;
}

const VALUE_COLORS: Readonly<Record<SemanticLevel, string>> = {
  success: 'text-[var(--success)]',
  info: 'text-[var(--info)]',
  warning: 'text-[var(--warning)]',
  danger: 'text-[var(--danger)]',
  neutral: 'text-[var(--fg)]',
  default: 'text-[var(--fg)]',
} as const;

export function Stat({ label, value, hint, level = 'default' }: StatProps) {
  return (
    <div className="vfm-stat rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      <p className="vfm-stat-label text-xs text-[var(--fg-muted)]">{label}</p>
      <p className={['tabular vfm-stat-value mt-2 text-3xl font-semibold', VALUE_COLORS[level]].join(' ')}>
        {value}
      </p>
      {hint ? <p className="vfm-stat-hint mt-2 text-[11px] text-[var(--fg-muted)]">{hint}</p> : null}
    </div>
  );
}
