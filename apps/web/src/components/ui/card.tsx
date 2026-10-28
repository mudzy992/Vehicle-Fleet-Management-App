/**
 * Card — kontejner za sekcije ekrana (docs/06 §5.3).
 *
 * Struktura: `Card > CardHeader > CardContent > CardFooter`.
 * Bez dependencija; stilovi preko dizajn tokena.
 */
import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** `true` → bez paddinga (za tabele koje idu od ivice do ivice). */
  flush?: boolean;
}

export function Card({ children, className, flush = false }: CardProps) {
  return (
    <section
      className={[
        'vfm-card rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]',
        flush ? '' : 'p-4',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold tracking-tight text-[var(--fg)]">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ?? ''}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
      {children}
    </footer>
  );
}
