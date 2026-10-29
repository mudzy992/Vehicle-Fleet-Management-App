import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { api } from '../../lib/api.js';
import { DriverCreatePage } from './driver-create-page.js';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DriverCreatePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('DriverCreatePage', () => {
  it('announces a network failure loading the active driver form', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju forme')).toBeTruthy();
    expect(screen.getByText(/Provjerite vezu i pokušajte ponovo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sačuvaj vozača' })).toBeNull();
  });
});
