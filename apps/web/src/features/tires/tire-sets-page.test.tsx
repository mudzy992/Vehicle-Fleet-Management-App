import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { api } from '../../lib/api.js';
import { TireSetsPage } from './tire-sets-page.js';

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: () => false }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TireSetsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('TireSetsPage', () => {
  it('does not render a false empty state when the list request fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju kompleta.')).toBeTruthy();
    expect(screen.queryByText('Evidencija kompleta je prazna')).toBeNull();
  });
});
