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
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-fg',
  default: 'text-fg',
} as const;

export function Stat({ label, value, hint, level = 'default' }: StatProps) {
  return (
    <div className="vfm-stat rounded-xl border border-border bg-surface p-5 shadow-sm">
      <p className="vfm-stat-label text-xs text-fg-muted">{label}</p>
      <p className={['tabular vfm-stat-value mt-2 text-3xl font-semibold', VALUE_COLORS[level]].join(' ')}>
        {value}
      </p>
      {hint ? <p className="vfm-stat-hint mt-2 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}
