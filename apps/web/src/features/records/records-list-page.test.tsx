import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { api } from '../../lib/api.js';
import { RecordsListPage } from './records-list-page.js';

const VEHICLE_ID = '018f0000-0000-7000-8000-000000000111';
const VEHICLES = {
  items: [{ id: VEHICLE_ID, internalNo: 'V-001', make: 'Toyota', model: 'Corolla' }],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};
const RECORD = {
  id: '018f0000-0000-7000-8000-000000000222',
  vehicleId: VEHICLE_ID,
  registrationNumber: 'SA-123-AB',
  validFrom: '2026-01-01',
  validUntil: '2027-01-01',
  status: 'ACTIVE',
  costAmount: 12500,
  issuedBy: 'MUP KS',
};
const RECORDS = { items: [RECORD], page: 1, pageSize: 25, total: 1, totalPages: 1 };
const EMPTY_VEHICLES = { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 };

function renderRecords() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RecordsListPage kind="REGISTRATION" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('RecordsListPage', () => {
  it('distinguishes a pending vehicle lookup from a missing vehicle', async () => {
    let release!: (value: typeof VEHICLES) => void;
    const pendingVehicles = new Promise<typeof VEHICLES>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      if (path.startsWith('/vehicles?')) return pendingVehicles as T;
      return RECORDS as T;
    });

    renderRecords();

    expect(await screen.findByText('SA-123-AB')).toBeTruthy();
    expect(screen.getByText('Učitavanje vozila…')).toBeTruthy();
    expect(screen.queryByText('Nepoznato vozilo')).toBeNull();
    release(VEHICLES);
    expect(await screen.findByRole('link', { name: 'V-001 · Toyota Corolla' })).toBeTruthy();
  });

  it('applies text, status and deadline filters to the server query', async () => {
    const requests: string[] = [];
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      requests.push(path);
      return path.startsWith('/vehicles?') ? (VEHICLES as T) : (RECORDS as T);
    });

    renderRecords();
    await screen.findByText('SA-123-AB');
    fireEvent.change(screen.getByLabelText('Pretraga'), { target: { value: '  SA-123  ' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
    fireEvent.change(screen.getByLabelText('Rok'), { target: { value: '30' } });

    await waitFor(() =>
      expect(
        requests.some(
          (path) =>
            path.includes('q=SA-123') && path.includes('status=ACTIVE') && path.includes('expiringInDays=30'),
        ),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Očisti filtere' })).toBeTruthy();
  });

  it('shows an error, not a false empty state, when the records endpoint is unavailable', async () => {
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      if (path.startsWith('/vehicles?')) return EMPTY_VEHICLES as T;
      throw new TypeError('network unavailable');
    });

    renderRecords();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Evidencija nije dostupna.')).toBeTruthy();
    expect(screen.queryByText('Nema registracije')).toBeNull();
  });
});
