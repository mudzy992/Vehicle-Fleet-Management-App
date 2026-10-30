/** Semantički button za površine koje nisu akcione CTA kontrole (npr. scrim). */
import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface BareButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className: string;
}

export const BareButton = forwardRef<HTMLButtonElement, BareButtonProps>(
  function BareButton({ type = 'button', className, ...props }, ref) {
    return <button ref={ref} type={type} className={className} {...props} />;
  },
);
BareButton.displayName = 'BareButton';
