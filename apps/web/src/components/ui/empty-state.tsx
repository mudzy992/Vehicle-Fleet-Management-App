/**
 * EmptyState — prazno stanje liste (docs/06 §7.2: svaka lista ima prazno
 * stanje s jasnom porukom i sljedećom akcijom).
 */
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface-muted px-6 py-10 text-center">
      {icon ? (
        <span aria-hidden="true" className="text-2xl text-fg-muted">
          {icon}
        </span>
      ) : null}
      <h3 className="vfm-empty-title">{title}</h3>
      {description ? <p className="max-w-md text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
