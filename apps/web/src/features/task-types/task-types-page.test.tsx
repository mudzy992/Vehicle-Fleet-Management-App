import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { TaskTypesPage } from './task-types-page.js';

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: () => false }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskTypesPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('TaskTypesPage', () => {
  it('announces a task type list network failure', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju vrsta zadataka.')).toBeTruthy();
    expect(screen.queryByText('Nema konfigurisanih vrsta zadataka')).toBeNull();
  });
});
