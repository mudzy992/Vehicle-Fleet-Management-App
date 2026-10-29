import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const roleId = '22222222-2222-4222-8222-222222222222';
const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.stack || error.message || String(error)));
});

async function assertAppMounted(page: Page) {
  await page.waitForTimeout(250);
  const errors = runtimeErrors.get(page) ?? [];
  if (errors.length > 0) throw new Error(`Browser runtime error(s): ${JSON.stringify(errors)}`);
  const rootHtml = await page.locator('#root').innerHTML();
  if (!rootHtml.trim()) throw new Error('React root stayed empty after page load.');
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })),
    })),
  ).toEqual([]);
}

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
    } else if (
      ['/vehicles', '/drivers', '/registrations', '/insurances', '/reminders', '/tasks'].some((path) =>
        pathname.endsWith(path),
      )
    ) {
      await route.fulfill({
        status: 200,
        json: { data: { items: [], total: 0, totalPages: 0, page: 1, pageSize: 50 }, meta: {} },
      });
    } else {
      await route.fulfill({ status: 200, json: { data: {}, meta: {} } });
    }
  });
}

async function submitLogin(page: Page) {
  await assertAppMounted(page);
  await page.getByLabel('E-mail').fill('audit@example.test');
  await page.getByLabel('Lozinka').fill('not-a-real-secret');
  await page.getByRole('button', { name: 'Prijavi se' }).click();
}

test('protected deep link redirects to login and preserves a safe internal destination', async ({ page }) => {
  await mockApi(page);
  await page.goto('/zadaci');
  await assertAppMounted(page);
  await expect(page).toHaveURL(/\/prijava\?next=%2Fzadaci$/);
  await expect(page.getByText('Prijava u web aplikaciju')).toBeVisible();
});

test('dashboard renders mocked empty collections without accessibility violations', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({
      status: 200,
      json: authResponse({
        permissions: ['vehicle:view', 'driver:view', 'registration:view', 'insurance:view', 'reminder:view'],
      }),
    }),
  );
  await page.goto('/prijava?next=%2Fnadzorna-tabla');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Nadzorna tabla' })).toBeVisible();
  await expect(page.getByText('Nema rokova').first()).toBeVisible();
  await expectNoA11yViolations(page);
});

test('system health screen renders successful probes accessibly', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['system:view_health'] }) }),
  );
  await page.route('**/health/live', (route) => route.fulfill({ status: 200, json: { status: 'ok' } }));
  await page.route('**/health/ready', (route) =>
    route.fulfill({ status: 200, json: { status: 'ok', info: { database: { status: 'up' } } } }),
  );
  await page.route('**/health/startup', (route) =>
    route.fulfill({ status: 200, json: { status: 'ok', uptimeSeconds: 240 } }),
  );
  await page.goto('/prijava?next=%2Fzdravlje');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/zdravlje$/);
  await expect(page.getByRole('heading', { name: 'Zdravlje sistema' })).toBeVisible();
  await expect(page.getByText('ok', { exact: true })).toHaveCount(3);
  await expectNoA11yViolations(page);
});

test('system health outage is announced and retry recovers', async ({ page }) => {
  let outage = true;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['system:view_health'] }) }),
  );
  for (const [path, body] of [
    ['/health/live', { status: 'ok' }],
    ['/health/ready', { status: 'ok', info: { database: { status: 'up' } } }],
    ['/health/startup', { status: 'ok', uptimeSeconds: 240 }],
  ] as const) {
    await page.route(`**${path}`, async (route) => {
      if (outage) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: 200, json: body });
    });
  }
  await page.goto('/prijava?next=%2Fzdravlje');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Zdravlje sistema' })).toBeVisible();
  await expect(page.getByRole('alert').getByRole('heading', { name: 'API nije dostupan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pokušaj ponovo' })).toBeVisible();
  outage = false;
  await page.getByRole('button', { name: 'Pokušaj ponovo' }).click();
  await expect(page.getByText('ok', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('health screen permission guard blocks users without health access', async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse() }));
  await page.goto('/prijava?next=%2Fzdravlje');
  await submitLogin(page);
  await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zdravlje sistema' })).toHaveCount(0);
});

test('task list handles empty collections accessibly on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['task:view', 'task:claim'] }) }),
  );
  await page.goto('/prijava?next=%2Fzadaci');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Zadaci' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Prikaz zadataka' })).toBeVisible();
  await expect(page.getByText('Nema zadataka za prikaz')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('responsive login keeps the form reachable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/prijava');
  await assertAppMounted(page);
  await expect(page.getByRole('heading', { name: 'Prijavite se' })).toBeVisible();
  await expect(page.locator('.vfm-login-story')).toBeHidden();
  await expect(page.locator('.vfm-login-mobile-brand')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.getByLabel('Lozinka')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('design system showcase passes axe WCAG checks', async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse() }));
  await page.goto('/prijava?next=%2Fdizajn-sistem');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Dizajn sistem' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('rate-limited login explains the temporary wait', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({
      status: 429,
      json: { error: { code: 'RATE_LIMITED', message: 'Too many attempts' } },
    }),
  );
  await page.goto('/prijava');
  await submitLogin(page);
  await expect(page.getByRole('alert')).toContainText('Previše pokušaja prijave. Sačekajte pa pokušajte ponovo.');
});

test('forced password change overrides the requested destination', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({
      status: 200,
      json: authResponse({ permissions: ['auth:login'], mustChangePassword: true }),
    }),
  );
  await page.goto('/prijava?next=%2Fzdravlje');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByText('Potrebna je promjena lozinke')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Promijeni lozinku' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zdravlje sistema' })).toHaveCount(0);
});

test('login failure is communicated without exposing credential-specific detail', async ({ page }) => {
  await mockApi(page);
  await page.goto('/prijava');
  await submitLogin(page);
  await expect(page.getByText('Pogrešan e-mail ili lozinka.')).toBeVisible();
  await expect(page).toHaveURL(/\/prijava(?:\?next=%2Fdizajn-sistem)?$/);
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

test('vehicle register mounts for an authorized user and mobile navigation opens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['vehicle:view'] }) }),
  );
  await page.goto('/prijava?next=%2Fvozila');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/vozila$/);
  await expect(page.getByRole('heading', { name: 'Vozila' })).toBeVisible();
  await expect(page.getByText('Registar je prazan')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Otvori navigaciju' }).click();
  const sidebar = page.locator('[data-testid="sidebar"]');
  await expect(sidebar).toHaveClass(/is-open/);
  await expect(sidebar.getByRole('link', { name: /Vozila/ })).toBeVisible();
  await expectNoA11yViolations(page);
  await expect(sidebar.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toHaveClass(/is-open/);
  await expect(page.getByRole('button', { name: 'Otvori navigaciju' })).toBeFocused();
});

test('driver registry renders an accessible empty state on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['driver:view'] }) }),
  );
  await page.goto('/prijava?next=%2Fvozaci');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/vozaci$/);
  await expect(page.getByRole('heading', { name: 'Vozači' })).toBeVisible();
  await expect(page.getByText('Registar je prazan')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('profile stays accessible and fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['auth:login'] }) }),
  );
  await page.goto('/prijava?next=%2Fprofil');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Promjena lozinke' })).toBeVisible();
  await expect(page.getByText('Pregled sesija nije dozvoljen')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
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
  await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
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
  await expect(page).toHaveURL(/\/prijava(?:\?next=%2Fdizajn-sistem)?$/);
  await expect(page.getByText('Prijava u web aplikaciju')).toBeVisible();
  expect(logoutRequested).toBe(true);
});
