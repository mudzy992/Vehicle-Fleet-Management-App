import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { TireSetCreateForm } from './tire-set-create-form.js';

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TireSetCreateForm onCreated={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('TireSetCreateForm', () => {
  it('reports a network failure loading the active form instead of claiming no form is configured', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderForm();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Greška pri učitavanju forme TIRE_SET/)).toBeTruthy();
    expect(screen.queryByText(/Nema ispravne objavljene forme TIRE_SET/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Sačuvaj komplet' }).hasAttribute('disabled')).toBe(true);
  });
});
