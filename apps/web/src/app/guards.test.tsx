import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { AuthUser } from '@vfm/shared/schemas';
import { setAccessToken, setSessionExpiredHandler } from '../lib/api.js';
import { SessionProvider } from '../features/auth/session.js';
import { RequireAuth, RequirePermission } from './guards.js';

/**
 * Route guard-ovi (P14): korisnik bez prava ne smije ni vidjeti ekran, a
 * neprijavljeni se preusmjerava na `/prijava?next=…`.
 *
 * 🔴 Ovo je UX sloj — server i dalje odbija zahtjev. Testovi dokazuju da UI
 * ne pokreće upite za ekrane bez prava (nema „praznog" ekrana s podacima).
 */

const USER: AuthUser = {
  id: '018f0000-0000-7000-8000-000000000002',
  email: 'ana.anic@vfm.test',
  firstName: 'Ana',
  lastName: 'Anić',
  displayName: null,
  status: 'ACTIVE',
  roles: [{ id: '018f0000-0000-7000-8000-0000000000b1', code: 'ADMINISTRATOR', name: 'Administrator' }],
  permissions: ['user:view'],
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

function mockSession(user: AuthUser | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (user === null) return jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401);
      if (url.endsWith('/auth/refresh')) return jsonResponse({ data: { accessToken: 'token-1' } });
      if (url.endsWith('/auth/me')) return jsonResponse({ data: user });
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404);
    }),
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

describe('Route guard-ovi', () => {
  it('neprijavljenog korisnika vodi na /prijava s povratnom putanjom', async () => {
    mockSession(null);

    render(
      <SessionProvider>
        <MemoryRouter initialEntries={['/administracija/korisnici']}>
          <Routes>
            <Route path="/prijava" element={<p>ekran prijave</p>} />
            <Route element={<RequireAuth />}>
              <Route path="/administracija/korisnici" element={<p>tajni ekran</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText('ekran prijave')).toBeDefined());
    expect(screen.queryByText('tajni ekran')).toBeNull();
  });

  it('prijavljeni korisnik vidi zaštićeni ekran', async () => {
    mockSession(USER);

    render(
      <SessionProvider>
        <MemoryRouter initialEntries={['/administracija/korisnici']}>
          <Routes>
            <Route path="/prijava" element={<p>ekran prijave</p>} />
            <Route element={<RequireAuth />}>
              <Route path="/administracija/korisnici" element={<p>tajni ekran</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText('tajni ekran')).toBeDefined());
  });

  it('bez prava prikazuje „Nemate pristup" umjesto sadržaja (P14)', async () => {
    mockSession(USER);

    render(
      <SessionProvider>
        <MemoryRouter>
          <RequirePermission permission="role:manage_permissions">
            <p>matrica prava</p>
          </RequirePermission>
        </MemoryRouter>
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText('Nemate pristup')).toBeDefined());
    expect(screen.queryByText('matrica prava')).toBeNull();
    expect(document.body.textContent).toContain('role:manage_permissions');
  });

  it('s pravom prikazuje sadržaj', async () => {
    mockSession(USER);

    render(
      <SessionProvider>
        <MemoryRouter>
          <RequirePermission permission="user:view">
            <p>lista korisnika</p>
          </RequirePermission>
        </MemoryRouter>
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText('lista korisnika')).toBeDefined());
  });
});
