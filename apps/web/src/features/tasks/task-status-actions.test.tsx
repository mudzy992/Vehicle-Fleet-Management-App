import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaskDetail } from '@vfm/shared/schemas';
import { TaskStatusActions } from './task-status-actions.js';

const TASK_ID = '018f0000-0000-7000-8000-000000000101';
const task = (status: string): TaskDetail => ({
  id: TASK_ID,
  status,
  version: 7,
} as TaskDetail);

function renderActions(status: string, props: { canCancel?: boolean; canRelease?: boolean; canReopen?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskStatusActions task={task(status)} canCancel={props.canCancel ?? false} canRelease={props.canRelease ?? false} canReopen={props.canReopen ?? false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TaskStatusActions', () => {
  it('traži razlog za otkazivanje i šalje CAS verziju s razlogom', async () => {
    let requestBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: { ...task('CANCELLED') } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    renderActions('IN_PROGRESS', { canCancel: true });

    fireEvent.click(screen.getByRole('button', { name: 'Otkaži zadatak' }));
    const confirm = screen.getByRole('button', { name: 'Potvrdi: Otkaži zadatak' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: /Razlog otkazivanja/ }), { target: { value: '  Kvar vozila  ' } });
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);

    expect((await screen.findByRole('status')).textContent).toContain('Zadatak je otkazan.');
    await waitFor(() => expect(requestBody).toEqual({ version: 7, reason: 'Kvar vozila' }));
  });

  it('zadržava uspješnu statusnu najavu nakon što promjena ukloni dostupne radnje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: task('OPEN') }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const renderAction = (status: string, version: number) => (
      <QueryClientProvider client={client}>
        <TaskStatusActions task={{ ...task(status), version } as TaskDetail} canCancel={false} canRelease={true} canReopen={false} />
      </QueryClientProvider>
    );
    const { rerender } = render(renderAction('IN_PROGRESS', 7));

    fireEvent.click(screen.getByRole('button', { name: 'Vrati među slobodne' }));
    fireEvent.click(screen.getByRole('button', { name: 'Potvrdi: Vrati među slobodne' }));
    expect((await screen.findByRole('status')).textContent).toContain('Zadatak je vraćen među slobodne.');

    rerender(renderAction('OPEN', 8));
    expect(screen.getByRole('status').textContent).toContain('Zadatak je vraćen među slobodne.');
    expect(screen.queryByRole('button', { name: 'Vrati među slobodne' })).toBeNull();
  });

  it('prikazuje samo statusno dozvoljene radnje za aktivni status i permisije', () => {
    const { rerender } = renderActions('OPEN', { canRelease: true, canReopen: true });
    expect(screen.queryByRole('button', { name: 'Vrati među slobodne' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ponovo otvori' })).toBeNull();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TaskStatusActions task={task('COMPLETED')} canCancel={true} canRelease={true} canReopen={true} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Ponovo otvori' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Otkaži zadatak' })).toBeNull();
  });
});
