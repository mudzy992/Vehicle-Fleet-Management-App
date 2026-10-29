import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { AuthUser } from '@vfm/shared/schemas';
import { ApiError, api } from '../../lib/api.js';
import { ProfilePage } from './profile-page.js';

const session = vi.hoisted(() => ({
  permissions: [] as string[],
  user: null as AuthUser | null,
  logout: vi.fn(async () => undefined),
}));

vi.mock('../auth/session.js', () => ({
  useSession: () => ({
    user: session.user,
    logout: session.logout,
    hasPermission: (permission: string) => session.permissions.includes(permission),
  }),
}));

const USER: AuthUser = {
  id: '018f0000-0000-7000-8000-000000000002',
  email: 'ana.anic@vfm.test',
  firstName: 'Ana',
  lastName: 'Anić',
  displayName: null,
  status: 'ACTIVE',
  roles: [{ id: '018f0000-0000-7000-8000-0000000000b1', code: 'ADMINISTRATOR', name: 'Administrator' }],
  permissions: ['auth:manage_sessions'],
  permissionsVersion: 3,
  tokenVersion: 4,
  mustChangePassword: false,
  isSuperAdmin: false,
  allowedClientTypes: ['WEB'],
  timezone: 'Europe/Sarajevo',
  locale: 'bs',
  lastLoginAt: null,
};

const ACTIVE_SESSION = {
  id: '018f0000-0000-7000-8000-000000000444',
  clientType: 'WEB',
  createdAt: '2026-10-28T10:00:00.000Z',
  expiresAt: '2026-11-04T10:00:00.000Z',
  lastUsedAt: '2026-10-28T11:00:00.000Z',
  ipAddress: '192.0.2.1',
  userAgent: 'Test browser',
  deviceInfo: null,
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function renderProfile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProfilePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  session.permissions = [];
  session.user = USER;
  session.logout.mockClear();
  vi.restoreAllMocks();
});

describe('ProfilePage', () => {
  it('shows a session API failure instead of a false empty state', async () => {
    session.user = USER;
    session.permissions = ['auth:manage_sessions'];
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderProfile();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju sesija.')).toBeTruthy();
    expect(screen.queryByText('Nema aktivnih sesija')).toBeNull();
  });

  it('announces failure to revoke an individual session', async () => {
    session.user = USER;
    session.permissions = ['auth:manage_sessions'];
    vi.spyOn(api, 'get').mockResolvedValue([ACTIVE_SESSION] as never);
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError('FORBIDDEN', 'Opoziv nije dozvoljen.', 403));

    renderProfile();

    expect(await screen.findByText('Test browser')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Odjavi' }));

    expect(await screen.findByText('Opoziv nije dozvoljen.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('changes the password, revokes the current session and returns to login', async () => {
    session.user = USER;
    session.permissions = ['auth:manage_sessions'];
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <MemoryRouter initialEntries={['/profil']}>
        <LocationProbe />
        <QueryClientProvider client={client}>
          <ProfilePage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Trenutna lozinka'), { target: { value: 'CurrentPassword!23' } });
    fireEvent.change(screen.getByLabelText('Nova lozinka'), { target: { value: 'NewSecurePassword!42' } });
    fireEvent.change(screen.getByLabelText('Potvrda nove lozinke'), {
      target: { value: 'NewSecurePassword!42' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Promijeni lozinku' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/auth/change-password', {
        currentPassword: 'CurrentPassword!23',
        newPassword: 'NewSecurePassword!42',
      }),
    );
    await waitFor(() => expect(session.logout).toHaveBeenCalledWith({ serverAlreadyRevoked: true }));
    await waitFor(() => expect(screen.getByTestId('current-path').textContent).toBe('/prijava'));
  });

  it('highlights forced password change and blocks mismatched confirmation', () => {
    session.user = { ...USER, mustChangePassword: true };
    session.permissions = [];
    const post = vi.spyOn(api, 'post');

    renderProfile();

    expect(screen.getByRole('heading', { level: 1, name: 'Profil' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Moj nalog' })).toBeTruthy();
    expect(screen.getByText('Potrebna je promjena lozinke')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Trenutna lozinka'), { target: { value: 'CurrentPassword!23' } });
    fireEvent.change(screen.getByLabelText('Nova lozinka'), { target: { value: 'StrongPassword!23' } });
    fireEvent.change(screen.getByLabelText('Potvrda nove lozinke'), {
      target: { value: 'DifferentPassword!23' },
    });

    expect(screen.getByText('Lozinke se ne poklapaju.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Promijeni lozinku' }).hasAttribute('disabled')).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });
});
