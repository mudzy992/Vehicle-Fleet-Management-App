import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './button.js';

export interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly onClose: () => void;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly closeOnOutside?: boolean;
}

/** Accessible modal primitive: focus containment/restore, Escape, scroll lock and labelled dialog. */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  closeOnOutside = true,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? dialog)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  const sizeClass = `vfm-modal--${size}`;

  return createPortal(
    <div
      className="vfm-modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnOutside && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`vfm-modal ${sizeClass}`}
      >
        <header className="vfm-modal-header">
          <div className="vfm-modal-heading">
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="sm" aria-label="Zatvori dijalog" onClick={onClose}>
            ×
          </Button>
        </header>
        <div className="vfm-modal-content">{children}</div>
        {footer ? <footer className="vfm-modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

export interface ConfirmModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly variant?: ButtonVariant;
  readonly busy?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Potvrdi',
  cancelLabel = 'Odustani',
  variant = 'danger',
  busy = false,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      closeOnOutside={!busy}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
