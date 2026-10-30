import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmModal, Modal } from './modal.js';

describe('Modal', () => {
  it('exposes accessible dialog name and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Potvrda" description="Opis akcije" onClose={onClose}>
        Sadržaj
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Potvrda' })).toBeTruthy();
    expect(screen.getByText('Opis akcije')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render when closed and confirms the primary action', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <ConfirmModal
        open={false}
        title="Arhivirati?"
        description="Opis"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <ConfirmModal
        open
        title="Arhivirati?"
        description="Opis"
        confirmLabel="Arhiviraj"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Arhiviraj' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
