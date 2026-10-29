import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { FormsPage } from './forms-page.js';

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: () => false }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FormsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('FormsPage', () => {
  it('shows catalog API failure rather than an empty selection prompt', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Katalog nije dostupan.')).toBeTruthy();
    expect(screen.queryByText('Odaberi formu iz kataloga')).toBeNull();
  });
});
