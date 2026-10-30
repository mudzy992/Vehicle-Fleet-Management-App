import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { ReportsPage } from './reports-page.js';

const hasPermission = vi.fn((permission: string) => permission === 'report:export');
vi.mock('../auth/session.js', () => ({ useSession: () => ({ hasPermission }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('ReportsPage', () => {
  it('loads a report and applies vehicle filters', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/reports') {
        return {
          items: [
            {
              code: 'fleet-overview',
              title: 'Pregled voznog parka',
              description: 'Pregled flote',
              category: 'Vozila',
            },
          ],
        } as never;
      }
      if (path === '/reports/vehicles')
        return { items: [{ id: 'vehicle-1', label: 'V-001 · Škoda Octavia' }] } as never;
      return {
        code: 'fleet-overview',
        title: 'Pregled voznog parka',
        columns: ['Broj vozila', 'Vozilo'],
        rows: [['V-001', 'Škoda Octavia']],
      } as never;
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Pregled voznog parka' })).toBeTruthy();
    expect(screen.getByText('Škoda Octavia')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Vozilo'), { target: { value: 'vehicle-1' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/reports/fleet-overview?vehicleId=vehicle-1'));
    expect(await screen.findByText('V-001')).toBeTruthy();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Preuzmi CSV' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/reports/fleet-overview/export?vehicleId=vehicle-1'),
    );
  });

  it('hides export when the user does not have report:export', async () => {
    hasPermission.mockReturnValue(false);
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/reports') return { items: [] } as never;
      if (path === '/reports/vehicles') return { items: [] } as never;
      return { code: 'fleet-overview', title: 'Pregled voznog parka', columns: [], rows: [] } as never;
    });
    renderPage();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Preuzmi CSV' })).toBeNull());
  });
});
