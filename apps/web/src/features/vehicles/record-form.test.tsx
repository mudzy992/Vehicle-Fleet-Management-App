import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { VehicleRecordForm } from './record-form.js';

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: () => true }),
}));

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VehicleRecordForm kind="REGISTRATION" vehicleId="018f0000-0000-7000-8000-000000000801" onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('VehicleRecordForm', () => {
  it('announces a network failure loading the active record form', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderForm();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Greška pri učitavanju forme „Nova registracija“/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sačuvaj' })).toBeNull();
  });
});
