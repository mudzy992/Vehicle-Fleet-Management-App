import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { MatrixPage } from './matrix-page.js';

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: () => false }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MatrixPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('MatrixPage', () => {
  it('announces the matrix load failure accessibly', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/matrica nije dostupna/)).toBeTruthy();
  });
});
