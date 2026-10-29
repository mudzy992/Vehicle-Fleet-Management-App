import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { ServiceCreateForm } from './service-create-form.js';

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServiceCreateForm vehicleId="018f0000-0000-7000-8000-000000000901" onCreated={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('ServiceCreateForm', () => {
  it('reports a network error rather than claiming the active form is absent', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderForm();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Greška pri učitavanju forme SERVICE/)).toBeTruthy();
    expect(screen.queryByText(/Nema ispravne objavljene forme/)).toBeNull();
  });
});
