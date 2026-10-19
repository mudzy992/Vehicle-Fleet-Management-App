/**
 * Badge — oznaka statusa/prioriteta (docs/06 §5.4).
 *
 * Boje dolaze iz `statusLevel()` (`@vfm/shared/status-labels`), tako da je
 * semantika ista u web, mobilnoj aplikaciji i PDF/Excel izvozu.
 */
import type { ReactNode } from 'react';
import { statusLabel, statusLevel } from '@vfm/shared';
import type { LabelDomain } from '@vfm/shared';
import type { SemanticLevel } from '@vfm/shared';

export interface BadgeProps {
  level?: SemanticLevel;
  children: ReactNode;
  /** Tačka ispred teksta (brže skeniranje liste). */
  dot?: boolean;
  className?: string;
  title?: string;
}

const LEVEL_CLASSES: Readonly<Record<SemanticLevel, string>> = {
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  neutral: 'bg-[var(--neutral-soft)] text-[var(--neutral)]',
  default: 'bg-[var(--neutral-soft)] text-[var(--fg-muted)]',
} as const;

const DOT_CLASSES: Readonly<Record<SemanticLevel, string>> = {
  success: 'bg-[var(--success)]',
  info: 'bg-[var(--info)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--danger)]',
  neutral: 'bg-[var(--neutral)]',
  default: 'bg-[var(--fg-muted)]',
} as const;

export function Badge({ level = 'default', children, dot = false, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        LEVEL_CLASSES[level],
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {dot ? (
        <span aria-hidden="true" className={['h-1.5 w-1.5 rounded-full', DOT_CLASSES[level]].join(' ')} />
      ) : null}
      {children}
    </span>
  );
}

export interface StatusBadgeProps {
  /** Vrijednost enuma iz baze (npr. `IN_PROGRESS`, `PUBLISHED`, `EXPIRED`). */
  value: string;
  /** Prepis naziva (ako ekran treba drugačiji kontekst). */
  label?: string;
  /** Prepis nivoa boje. */
  level?: SemanticLevel;
  /**
   * Domen enuma (npr. `record` za evidencije). Otklanja dvosmislenost kada isti
   * kod postoji u više enuma (npr. `CANCELLED` = „Otkazan“ zadatak vs
   * „Otkazano“ evidencija).
   */
  domain?: LabelDomain;
  dot?: boolean;
}

/**
 * Badge koji sam uzima naziv i boju iz `@vfm/shared` za vrijednost enuma.
 *
 * Primjer: `<StatusBadge value="IN_PROGRESS" />` → „U radu“ (warning).
 */
export function StatusBadge({ value, label, level, domain, dot = true }: StatusBadgeProps) {
  return (
    <Badge level={level ?? statusLevel(value, domain)} title={value} dot={dot}>
      {label ?? statusLabel(value, domain)}
    </Badge>
  );
}
