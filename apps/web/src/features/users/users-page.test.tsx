import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ApiError, api } from '../../lib/api.js';
import { UsersPage } from './users-page.js';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => session.permissions.includes(permission) }),
}));

function renderUsers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <UsersPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  session.permissions = [];
  vi.restoreAllMocks();
});

describe('UsersPage', () => {
  it('shows an accessible error rather than an empty state when the user request fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderUsers();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju korisnika.')).toBeTruthy();
    expect(screen.queryByText('Nema korisnika')).toBeNull();
  });

  it('announces archive failures after an authorized action', async () => {
    session.permissions = ['user:archive'];
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) =>
      (path.startsWith('/users?')
        ? {
            items: [
              {
                id: '018f0000-0000-7000-8000-000000000601',
                email: 'person@example.test',
                firstName: 'Amina',
                lastName: 'K.',
                displayName: null,
                phone: null,
                status: 'ACTIVE',
                mustChangePassword: false,
                roles: [],
                lastLoginAt: null,
                lockedUntil: null,
                piiRedacted: false,
                createdAt: '2026-10-28T12:00:00.000Z',
                updatedAt: '2026-10-28T12:00:00.000Z',
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
          }
        : []) as T,
    );
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError('CONFLICT', 'Korisnik ima aktivne zadatke.', 409));

    renderUsers();

    fireEvent.click(await screen.findByRole('button', { name: 'Arhiviraj' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Korisnik ima aktivne zadatke.')).toBeTruthy();
  });
});
