import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { FormsPage } from './forms-page.js';

const { permissions } = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => permissions.has(permission) }),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FormsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  permissions.clear();
  vi.restoreAllMocks();
});

describe('FormsPage', () => {
  it('shows catalog API failure rather than an empty selection prompt', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Katalog nije dostupan.')).toBeTruthy();
    expect(screen.queryByText('Odaberi formu iz kataloga')).toBeNull();
  });

  it('starts a form draft from visual metadata rather than raw JSON', async () => {
    permissions.add('form:create');
    vi.spyOn(api, 'get').mockImplementation(async (path) =>
      path === '/form-schemas' ? ([] as never) : ({ versions: [] } as never),
    );
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Pregled vozila',
      versions: [],
    } as never);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Nova forma' }));
    fireEvent.change(screen.getByLabelText('Naziv forme'), { target: { value: 'Pregled vozila' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kreiraj nacrt' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const payload = post.mock.calls[0]?.[1] as {
      key: string;
      definition: { sections: unknown[]; meta: { title: string } };
    };
    expect(payload.key).toBe('pregled_vozila');
    expect(payload.definition.meta.title).toBe('Pregled vozila');
    expect(payload.definition.sections).toHaveLength(1);
  });
});
