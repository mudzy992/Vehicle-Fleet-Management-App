import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthUser } from '@vfm/shared/schemas';
import { api, setAccessToken, setSessionExpiredHandler } from '../../lib/api.js';
import { SessionProvider, usePermission, useSession } from './session.js';

/**
 * `SessionProvider` — bootstrap sesije (docs/05 §5.2).
 *
 * Ključna ponašanja:
 * - bez refresh cookie-ja korisnik je `anonymous` (UI ide na `/prijava`),
 * - s validnom sesijom: `POST /auth/refresh` → `GET /auth/me` → `authenticated`,
 * - `hasPermission` poštuje R-07 (Super Admin ima sve) i `PERMISSIONS_STALE`
 *   scenarij: osvježen profil mijenja prava bez ponovne prijave.
 */

const USER: AuthUser = {
  id: '018f0000-0000-7000-8000-000000000002',
  email: 'ana.anic@vfm.test',
  firstName: 'Ana',
  lastName: 'Anić',
  displayName: null,
  status: 'ACTIVE',
  roles: [{ id: '018f0000-0000-7000-8000-0000000000b1', code: 'ADMINISTRATOR', name: 'Administrator' }],
  permissions: ['vehicle:view', 'user:view'],
  permissionsVersion: 3,
  tokenVersion: 4,
  mustChangePassword: false,
  isSuperAdmin: false,
  allowedClientTypes: ['WEB'],
  timezone: 'Europe/Sarajevo',
  locale: 'bs',
  lastLoginAt: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Mala sonda koja ispisuje stanje sesije i prava. */
function Probe() {
  const { status, user, logout } = useSession();
  const canViewUsers = usePermission('user:view');
  const canManageRoles = usePermission('role:manage_permissions');

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? '-'}</span>
      <span data-testid="users">{canViewUsers ? 'da' : 'ne'}</span>
      <span data-testid="roles">{canManageRoles ? 'da' : 'ne'}</span>
      <button type="button" onClick={() => void logout({ serverAlreadyRevoked: true })}>
        Odjava nakon revokacije
      </button>
    </div>
  );
}

beforeEach(() => {
  setAccessToken(null);
  setSessionExpiredHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionProvider', () => {
  it('bez refresh cookie-ja prelazi u anonymous', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'nema sesije' } }, 401)),
    );

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('user').textContent).toBe('-');
    expect(screen.getByTestId('users').textContent).toBe('ne');
  });

  it('s validnom sesijom učitava profil i prava', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) return jsonResponse({ data: { accessToken: 'token-1' } });
      if (url.endsWith('/auth/me')) return jsonResponse({ data: USER });
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('user').textContent).toBe('ana.anic@vfm.test');
    expect(screen.getByTestId('users').textContent).toBe('da');
    // Prava koja korisnik nema moraju biti `ne` — UI tada ne prikazuje akciju.
    expect(screen.getByTestId('roles').textContent).toBe('ne');
  });

  it('odjava nakon serverske revokacije ne šalje drugi refresh/logout zahtjev', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) return jsonResponse({ data: { accessToken: 'token-1' } });
      if (url.endsWith('/auth/me')) return jsonResponse({ data: USER });
      return jsonResponse({ data: null });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Odjava nakon revokacije' })));

    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/logout'))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('Super Admin ima sve permisije (R-07)', async () => {
    const superUser: AuthUser = { ...USER, isSuperAdmin: true, permissions: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/refresh')) return jsonResponse({ data: { accessToken: 'token-1' } });
        if (url.endsWith('/auth/me')) return jsonResponse({ data: superUser });
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404);
      }),
    );

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('roles').textContent).toBe('da');
  });

  it('kad refresh padne na kasnijem zahtjevu, sesija prelazi u anonymous', async () => {
    let sessionValid = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!sessionValid) {
          return jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'istekla' } }, 401);
        }
        if (url.endsWith('/auth/refresh')) return jsonResponse({ data: { accessToken: 'token-1' } });
        if (url.endsWith('/auth/me')) return jsonResponse({ data: USER });
        return jsonResponse({ data: { items: [] } });
      }),
    );

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    // Sesija istekne: sljedeći zahtjev dobija 401, refresh također pada.
    sessionValid = false;
    await act(async () => {
      await api.get('/users').catch(() => undefined);
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('user').textContent).toBe('-');
  });
});
