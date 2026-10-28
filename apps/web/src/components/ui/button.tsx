/**
 * Button — osnovna akcija (docs/06 §5.3).
 *
 * Varijante: `primary` (jedna po ekranu), `secondary`, `ghost`, `danger`.
 * Veličine: `sm`, `md`. Stanja: `loading`, `disabled`.
 *
 * Stil prati shadcn/ui konvenciju (variant + size preko `cva`-like funkcije),
 * ali bez dependencije — komponente su naše i pokrivene tokenima.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Ikona ispred teksta (bez tekstualne alternative → `aria-hidden`). */
  icon?: ReactNode;
}

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90 disabled:opacity-50 shadow-[var(--shadow-sm)]',
  secondary:
    'border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-50',
  ghost: 'text-[var(--fg-muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-50',
  danger: 'bg-[var(--danger)] text-[var(--primary-fg)] hover:opacity-90 disabled:opacity-50',
} as const;

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  sm: 'min-h-8 px-3 text-xs gap-1.5',
  md: 'min-h-10 px-4 text-sm gap-2',
} as const;

export function buttonClassName(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return [
    'inline-flex items-center justify-center rounded-lg font-semibold transition-colors',
    'focus-visible:outline-2 focus-visible:outline-[var(--primary)]',
    'disabled:cursor-not-allowed',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
  ].join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[buttonClassName(variant, size), className ?? ''].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
