import { expect, test, type Page, type Route } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const roleId = '22222222-2222-4222-8222-222222222222';

function authResponse(
  options: { permissions?: string[]; isSuperAdmin?: boolean; mustChangePassword?: boolean } = {},
) {
  const user = {
    id: userId,
    email: 'audit@example.test',
    firstName: 'Testni',
    lastName: 'Korisnik',
    displayName: null,
    status: 'ACTIVE',
    roles: [{ id: roleId, code: options.isSuperAdmin ? 'SUPER_ADMIN' : 'TEST', name: 'Test' }],
    permissions: options.permissions ?? [],
    permissionsVersion: 1,
    tokenVersion: 1,
    mustChangePassword: options.mustChangePassword ?? false,
    isSuperAdmin: options.isSuperAdmin ?? false,
    allowedClientTypes: ['WEB'],
    timezone: 'Europe/Sarajevo',
    locale: 'bs-BA',
    lastLoginAt: null,
  };
  return {
    data: {
      accessToken: 'e2e-memory-only-access-token',
      tokenType: 'Bearer',
      expiresIn: 600,
      refreshExpiresIn: 86_400,
      sessionId: '33333333-3333-4333-8333-333333333333',
      user,
    },
    meta: { requestId: 'e2e-request', timestamp: '2026-01-01T00:00:00.000Z' },
  };
}

async function mockApi(
  page: Page,
  login: (route: Route) => Promise<void> = (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } },
    }),
) {
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/refresh')) {
      await route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'No session' } } });
    } else if (pathname.endsWith('/auth/login')) {
      await login(route);
    } else if (pathname.endsWith('/auth/logout')) {
      await route.fulfill({ status: 200, json: { data: null, meta: {} } });
    } else {
      await route.fulfill({ status: 200, json: { data: {}, meta: {} } });
    }
  });
}

async function submitLogin(page: Page) {
  await page.getByLabel('E-mail').fill('audit@example.test');
  await page.getByLabel('Lozinka').fill('not-a-real-secret');
  await page.getByRole('button', { name: 'Prijavi se' }).click();
}

test('protected deep link redirects to login and preserves a safe internal destination', async ({ page }) => {
  await mockApi(page);
  await page.goto('/zadaci');
  await expect(page).toHaveURL(/\/prijava\?next=%2Fzadaci$/);
  await expect(page.getByText('Prijava u web aplikaciju')).toBeVisible();
});

test('login failure is communicated without exposing credential-specific detail', async ({ page }) => {
  await mockApi(page);
  await page.goto('/prijava');
  await submitLogin(page);
  await expect(page.getByText('Pogrešan e-mail ili lozinka.')).toBeVisible();
  await expect(page).toHaveURL(/\/prijava$/);
});

test('successful login returns to the requested internal route and keeps tokens out of browser storage', async ({
  page,
}) => {
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse() }));
  await page.goto('/prijava?next=%2Fdizajn-sistem');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/dizajn-sistem$/);
  await expect(page.getByRole('heading', { name: 'Dizajn sistem' }).first()).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('external-looking next path is rejected in favor of the dashboard', async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse() }));
  await page.goto('/prijava?next=%2F%2Fevil.example');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/nadzorna-tabla$/);
  await expect(page.getByRole('heading', { name: 'Nadzorna tabla' }).first()).toBeVisible();
});

test('permission guard blocks a regular user from the vehicle module', async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse() }));
  await page.goto('/prijava?next=%2Fvozila');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Nemate pristup' })).toBeVisible();
  expect(page.url()).toContain('/vozila');
});

for (const [path, permission] of [
  ['/obavijesti', 'notification:view'],
  ['/izvjestaji', 'report:view'],
] as const) {
  test(`future-phase route ${path} stays permission guarded`, async ({ page }) => {
    await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse() }));
    await page.goto(`/prijava?next=${encodeURIComponent(path)}`);
    await submitLogin(page);
    await expect(page.getByRole('heading', { name: 'Nemate pristup' })).toBeVisible();
    await expect(page.getByText(new RegExp(permission))).toBeVisible();
  });
}

test('logout clears the in-memory session and returns to login', async ({ page }) => {
  let logoutRequested = false;
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse() }));
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutRequested = true;
    await route.fulfill({ status: 200, json: { data: null, meta: {} } });
  });
  await page.goto('/prijava?next=%2Fdizajn-sistem');
  await submitLogin(page);
  await page.getByRole('button', { name: 'Odjava' }).click();
  await expect(page).toHaveURL(/\/prijava$/);
  await expect(page.getByText('Prijava u web aplikaciju')).toBeVisible();
  expect(logoutRequested).toBe(true);
});
