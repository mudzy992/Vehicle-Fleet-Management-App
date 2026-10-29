import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { api } from '../../lib/api.js';
import { VehicleCreatePage } from './vehicle-create-page.js';

function renderCreate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <VehicleCreatePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('VehicleCreatePage', () => {
  it('announces a network failure while loading the active vehicle form', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderCreate();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju forme')).toBeTruthy();
    expect(screen.getByText(/Provjerite vezu i pokušajte ponovo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sačuvaj vozilo' })).toBeNull();
  });
});
