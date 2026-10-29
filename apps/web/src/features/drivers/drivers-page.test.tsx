import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { DriverListResponse, DriverSummary } from '@vfm/shared/schemas';
import { api } from '../../lib/api.js';
import { DriversPage } from './drivers-page.js';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => session.permissions.includes(permission) }),
}));

const DRIVER: DriverSummary = {
  id: '018f0000-0000-7000-8000-000000000555',
  firstName: 'Ana',
  lastName: 'Anić',
  employeeNumber: 'D-012',
  employmentStatus: 'ACTIVE',
  status: 'ACTIVE',
  licenseExpiresAt: '2027-12-31',
  categories: ['B', 'C'],
  licenseDaysLeft: 428,
  version: 1,
  updatedAt: '2026-10-28T12:00:00.000Z',
};
const DRIVER_LIST: DriverListResponse = { items: [DRIVER], page: 1, pageSize: 25, total: 1, totalPages: 1 };
const EMPTY_LIST: DriverListResponse = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };

function renderDrivers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DriversPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  session.permissions = [];
  vi.restoreAllMocks();
});

describe('DriversPage', () => {
  it('does not render empty deadline states while the driver query is pending', async () => {
    let release!: (value: DriverListResponse) => void;
    const pending = new Promise<DriverListResponse>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, 'get').mockReturnValue(pending);

    renderDrivers();

    expect(await screen.findByText('Učitavanje rokova…')).toBeTruthy();
    expect(screen.queryByText('Nema dozvola koje ističu u 30 dana.')).toBeNull();
    expect(screen.queryByText('Registar je prazan')).toBeNull();
    release(EMPTY_LIST);
    expect(await screen.findByText('Nema dozvola koje ističu u 30 dana.')).toBeTruthy();
    expect(screen.getByText('Registar je prazan')).toBeTruthy();
  });

  it('surfaces API failures instead of presenting them as an empty registry', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderDrivers();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Registar vozača nije dostupan.')).toBeTruthy();
    expect(screen.queryByText('Registar je prazan')).toBeNull();
    expect(screen.queryByText('Nema dozvola koje ističu u 30 dana.')).toBeNull();
  });

  it('sends server-side filters and exposes create/bulk archive only to permitted users', async () => {
    session.permissions = ['driver:create', 'driver:archive'];
    const requests: string[] = [];
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      requests.push(path);
      return DRIVER_LIST as T;
    });

    renderDrivers();

    expect(await screen.findByRole('link', { name: 'Novi vozač' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Pretraga'), { target: { value: ' Ana ' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
    fireEvent.change(screen.getByLabelText('Kategorija'), { target: { value: 'CE' } });
    await waitFor(() =>
      expect(
        requests.some(
          (path) =>
            path.includes('q=Ana') && path.includes('status=ACTIVE') && path.includes('licenseCategory=CE'),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Odaberi Ana Anić' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arhiviraj odabrano (1)' }));
    expect(await screen.findByText('Arhivirano 1/1 vozača.')).toBeTruthy();
    expect(post).toHaveBeenCalled();
  });
});
