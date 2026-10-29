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

test('dashboard shows populated metrics and remains accessible at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockApi(page, (route) =>
    route.fulfill({
      status: 200,
      json: authResponse({
        permissions: [
          'vehicle:view',
          'driver:view',
          'registration:view',
          'insurance:view',
          'reminder:view',
        ],
      }),
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const expiring = url.searchParams.has('expiringInDays');
    const totals: Record<string, number> = {
      '/api/v1/vehicles': expiring ? 0 : 12,
      '/api/v1/drivers': expiring ? 2 : 8,
      '/api/v1/registrations': 3,
      '/api/v1/insurances': 4,
      '/api/v1/reminders': 2,
    };
    const total = totals[url.pathname];
    if (total === undefined) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      json: { data: { items: [], total, totalPages: total ? 1 : 0, page: 1, pageSize: 50 }, meta: {} },
    });
  });
  await page.goto('/prijava?next=%2Fnadzorna-tabla');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Nadzorna tabla' })).toBeVisible();
  await expect(page.getByText('12', { exact: true })).toBeVisible();
  await expect(page.getByText('8', { exact: true })).toBeVisible();
  await expect(page.getByText('Rokovi vozila')).toBeVisible();
  await expect(page.getByText('Nema rokova').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
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

test('task inventory supports mobile claim, tabs, and accessible populated state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const taskId = '44444444-4444-4444-8444-444444444444';
  let claimed = false;
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/refresh')) {
      await route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'No session' } } });
    } else if (pathname.endsWith('/auth/login')) {
      await route.fulfill({ status: 200, json: authResponse({ permissions: ['task:view', 'task:claim'] }) });
    } else if (pathname.endsWith('/auth/logout')) {
      await route.fulfill({ status: 200, json: { data: null, meta: {} } });
    } else if (pathname.endsWith(`/tasks/${taskId}/claim`)) {
      claimed = true;
      await route.fulfill({
        status: 200,
        json: { data: { id: taskId, code: 'Z-2026-000007', status: 'IN_PROGRESS', assigneeName: 'Testni Korisnik' }, meta: {} },
      });
    } else if (pathname.endsWith('/tasks/available')) {
      const items = claimed ? [] : [{
        id: taskId,
        code: 'Z-2026-000007',
        title: 'Pregled kočnica',
        description: 'Provjeriti kočioni sistem prije polaska.',
        vehicleInternalNo: 'V-007',
        vehicleMake: 'Škoda',
        vehicleModel: 'Octavia',
        taskTypeName: 'Redovni pregled',
        priority: 'HIGH',
        status: 'OPEN',
        dueAt: '2026-11-01T12:00:00.000Z',
      }];
      await route.fulfill({ status: 200, json: { data: { items, page: 1, pageSize: 25, total: items.length, totalPages: items.length ? 1 : 0 }, meta: {} } });
    } else if (pathname.endsWith('/tasks/mine') || pathname.endsWith('/tasks')) {
      await route.fulfill({ status: 200, json: { data: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }, meta: {} } });
    } else {
      await route.fulfill({ status: 200, json: { data: {}, meta: {} } });
    }
  });
  await page.goto('/prijava?next=%2Fzadaci');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Zadaci' })).toBeVisible();
  await expect(page.getByText('Pregled kočnica')).toBeVisible();
  await expect(page.getByText('V-007 · Škoda Octavia')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Preuzmi' }).click();
  await expect(page.getByRole('status')).toContainText('Preuzeli ste zadatak Z-2026-000007.');
  await expect(page.getByText('Nema zadataka za prikaz')).toBeVisible();
  expect(claimed).toBe(true);
  await page.getByRole('tab', { name: 'Moji' }).click();
  await expect(page.getByRole('tab', { name: 'Moji' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Nema zadataka za prikaz')).toBeVisible();
});

test('login form supports keyboard-only focus order and Enter submission', async ({ page }) => {
  await mockApi(page);
  await page.goto('/prijava');
  await assertAppMounted(page);
  // Start from the first form control explicitly; test the keyboard traversal from there.
  await page.getByLabel('E-mail').focus();
  await expect(page.getByLabel('E-mail')).toBeFocused();
  await page.keyboard.type('audit@example.test');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Lozinka')).toBeFocused();
  await page.keyboard.type('not-a-real-secret');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Prijavi se' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Pogrešan e-mail ili lozinka.');
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
  await expect(page).toHaveURL(/\/profil\?promjena=1$/);
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

test('form builder validates JSON, saves a draft, and publishes with a change note', async ({ page }) => {
  const failedRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const formId = '88888888-8888-4888-8888-888888888888';
  const versionId = '99999999-9999-4999-8999-999999999999';
  const validDefinition = {
    $schema: 'vfm-form/1',
    meta: { title: 'Podaci vozila', subject: 'VEHICLE' },
    sections: [
      {
        key: 'general',
        title: 'Opšti podaci',
        order: 1,
        visibleWhen: null,
        fields: [{ key: 'reference', type: 'TEXT', label: 'Referenca', order: 1, visibleWhen: null }],
      },
    ],
  };
  const version = {
    id: versionId,
    version: 1,
    status: 'DRAFT',
    changeNote: null,
    contentHash: null,
    mobileCompatible: true,
    publishedAt: null,
    publishedById: null,
    retiredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    recordCount: 0,
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, (route) =>
    route.fulfill({
      status: 200,
      json: authResponse({
        isSuperAdmin: true,
        permissions: ['form:view', 'form:update', 'form:manage_schema', 'form:publish_version'],
      }),
    }),
  );
  await page.route('**/api/v1/form-schemas**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/v1/form-schemas' && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          data: [
            {
              id: formId,
              key: 'vehicle-inspection',
              name: 'Pregled vozila',
              subject: 'VEHICLE',
              taskTypeId: null,
              description: null,
              ownerModule: 'vehicles',
              status: 'DRAFT',
              currentPublishedVersionId: null,
              currentPublishedVersion: null,
              versionCount: 1,
              updatedAt: '2026-01-01T00:00:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          meta: {},
        },
      });
      return;
    }
    if (url.pathname === `/api/v1/form-schemas/${formId}` && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          data: {
            id: formId,
            key: 'vehicle-inspection',
            name: 'Pregled vozila',
            subject: 'VEHICLE',
            taskTypeId: null,
            description: null,
            ownerModule: 'vehicles',
            status: 'DRAFT',
            currentPublishedVersionId: null,
            currentPublishedVersion: null,
            versionCount: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            versions: [version],
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname === `/api/v1/form-schemas/${formId}/versions/${versionId}` && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: { data: { ...version, formSchemaId: formId, definition: validDefinition, normalizedName: null }, meta: {} },
      });
      return;
    }
    if (url.pathname.endsWith('/publish') && method === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ changeNote: 'Provjera izmjene forme' });
      await route.fulfill({
        status: 200,
        json: {
          data: {
            ...version,
            status: 'PUBLISHED',
            changeNote: 'Provjera izmjene forme',
            contentHash: 'test-hash',
            publishedAt: '2026-01-02T00:00:00.000Z',
            publishedById: userId,
            formSchemaId: formId,
            definition: validDefinition,
            normalizedName: null,
          },
          meta: {},
        },
      });
      return;
    }
    if (method === 'PUT' && url.pathname.endsWith(`/versions/${versionId}`)) {
      expect(route.request().postDataJSON()).toMatchObject({ definition: validDefinition });
      await route.fulfill({
        status: 200,
        json: { data: { ...version, formSchemaId: formId, definition: validDefinition, normalizedName: null }, meta: {} },
      });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { message: 'Unexpected form API request' } } });
  });

  await page.goto('/prijava?next=%2Fforme');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/forme$/);
  await assertAppMounted(page);
  try {
    await expect(page.getByRole('heading', { name: 'Forme' })).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    throw new Error(
      `Form builder did not leave its route fallback. Root text: ${JSON.stringify(await page.locator('#root').innerText())}; ` +
        `runtime errors: ${JSON.stringify(runtimeErrors.get(page) ?? [])}; ` +
        `console errors: ${JSON.stringify(consoleErrors)}; failed requests: ${JSON.stringify(failedRequests)}`,
      { cause: error },
    );
  }
  await page.getByRole('button', { name: /Pregled vozila/ }).click();
  await expect(page.getByRole('heading', { name: 'Pregled vozila' })).toBeVisible();
  await page.getByRole('button', { name: 'v1', exact: true }).click();
  const editor = page.getByLabel('Definicija (JSON)');
  try {
    await expect(editor).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    throw new Error(
      `Form version editor did not render. Root text: ${JSON.stringify(await page.locator('#root').innerText())}; ` +
        `console errors: ${JSON.stringify(consoleErrors)}; failed requests: ${JSON.stringify(failedRequests)}`,
      { cause: error },
    );
  }
  await editor.fill('{ neispravan JSON');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Objavi…' })).toBeDisabled();

  await editor.fill(JSON.stringify(validDefinition, null, 2));
  await expect(page.getByText('Meta-shema je ispravna. Server ponovo provjerava pri čuvanju i objavi.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sačuvaj nacrt' }).click();
  await expect(page.getByRole('status')).toContainText('Nacrt je sačuvan.');
  await page.getByLabel('Bilješka o promjeni (obavezna, najmanje 5 znakova)').fill('Provjera izmjene forme');
  await page.getByRole('button', { name: 'Objavi…' }).click();
  await expect(page.getByRole('status')).toContainText('Verzija je objavljena; prethodna aktivna je povučena.');
  await expectNoA11yViolations(page);
});

test('insurance records fit a mobile viewport and pass axe checks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['insurance:view'] }) }),
  );
  await page.goto('/prijava?next=%2Fosiguranja');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Osiguranja', exact: true })).toBeVisible();
  await expect(page.getByText('Nema osiguranja')).toBeVisible();
  await expect(page.getByLabel('Pretraga')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('insurance records show populated entries, paginate, and pass axe checks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['insurance:view'] }) }),
  );
  await page.route('**/api/v1/insurances**', async (route) => {
    const url = new URL(route.request().url());
    const secondPage = url.searchParams.get('page') === '2';
    const item = {
      id: secondPage ? '66666666-6666-4666-8666-666666666666' : '77777777-7777-4777-8777-777777777777',
      vehicleId: '55555555-5555-4555-8555-555555555555',
      policyNumber: secondPage ? 'POL-002' : 'POL-001',
      validFrom: '2026-01-01',
      validUntil: '2027-01-01',
      status: 'ACTIVE',
      premiumAmount: 12500,
      insuranceCompany: 'Test osiguranje',
      type: 'Obavezno',
    };
    await route.fulfill({
      status: 200,
      json: { data: { items: [item], total: 26, totalPages: 2, page: secondPage ? 2 : 1, pageSize: 25 }, meta: {} },
    });
  });
  await page.route('**/api/v1/vehicles**', (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          items: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              internalNo: 'V-01',
              make: 'Škoda',
              model: 'Octavia',
            },
          ],
          total: 1,
          totalPages: 1,
          page: 1,
          pageSize: 100,
        },
        meta: {},
      },
    }),
  );
  await page.goto('/prijava?next=%2Fosiguranja');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Osiguranja', exact: true })).toBeVisible();
  await expect(page.getByText('POL-001')).toBeVisible();
  await expect(page.getByRole('link', { name: 'V-01 · Škoda Octavia', exact: true })).toBeVisible();
  await expect(page.getByText('125.00 KM')).toBeVisible();
  await expect(page.getByText('Strana 1 / 2')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Sljedeća' }).click();
  await expect(page.getByText('POL-002')).toBeVisible();
  await expect(page.getByText('Strana 2 / 2')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test('populated insurance records remain usable on mobile and send deadline filters to the server', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let expiringInDays: string | null = null;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['insurance:view'] }) }),
  );
  await page.route('**/api/v1/insurances**', async (route) => {
    const url = new URL(route.request().url());
    expiringInDays = url.searchParams.get('expiringInDays');
    await route.fulfill({
      status: 200,
      json: {
        data: {
          items: [{
            id: '77777777-7777-4777-8777-777777777777',
            vehicleId: '55555555-5555-4555-8555-555555555555',
            policyNumber: 'POL-MOBILE-01',
            validFrom: '2026-01-01',
            validUntil: '2026-11-10',
            status: 'ACTIVE',
            premiumAmount: 12500,
            insuranceCompany: 'Test osiguranje',
            type: 'Obavezno',
          }],
          total: 1,
          totalPages: 1,
          page: 1,
          pageSize: 25,
        },
        meta: {},
      },
    });
  });
  await page.route('**/api/v1/vehicles**', (route) =>
    route.fulfill({
      status: 200,
      json: { data: { items: [{ id: '55555555-5555-4555-8555-555555555555', internalNo: 'V-01', make: 'Škoda', model: 'Octavia' }], total: 1, totalPages: 1, page: 1, pageSize: 100 }, meta: {} },
    }),
  );
  await page.goto('/prijava?next=%2Fosiguranja');
  await submitLogin(page);
  await expect(page.getByText('POL-MOBILE-01')).toBeVisible();
  await expect(page.getByRole('link', { name: 'V-01 · Škoda Octavia', exact: true })).toBeVisible();
  const tableRegion = page.getByRole('region', { name: 'Evidencije — pomjerite tabelu horizontalno za pregled svih kolona' });
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();
  expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);

  await page.getByLabel('Rok').selectOption('7');
  await expect.poll(() => expiringInDays).toBe('7');
  await expect(page.getByText('POL-MOBILE-01')).toBeVisible();
});

test('reminders support acknowledge and snooze actions on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({
      status: 200,
      json: authResponse({
        permissions: ['reminder:view', 'reminder:acknowledge', 'reminder:snooze'],
      }),
    }),
  );
  await page.route('**/api/v1/reminders*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        data: {
          items: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              kind: 'SERVICE_KM',
              entityType: 'Vehicle',
              entityId: '55555555-5555-4555-8555-555555555555',
              dueDate: null,
              dueKm: 120000,
              thresholdDays: null,
              thresholdKm: 10000,
              fireAt: '2026-10-29T08:30:00.000Z',
              status: 'SCHEDULED',
              sentAt: null,
              acknowledgedAt: null,
              due: true,
              createdAt: '2026-10-28T08:30:00.000Z',
            },
          ],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
        meta: {},
      },
    });
  });
  await page.goto('/prijava?next=%2Frokovi');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Rokovi' })).toBeVisible();
  await expect(page.getByText(/120.*km/)).toBeVisible();
  const remindersRegion = page.getByRole('region', { name: 'Podsjetnici — pomjerite tabelu horizontalno za pregled svih kolona' });
  await remindersRegion.focus();
  await expect(remindersRegion).toBeFocused();
  expect(await remindersRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expectNoA11yViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Potvrdi' }).click();
  await expect(page.getByRole('status')).toContainText('Podsjetnik je potvrđen.');
  await page.getByRole('button', { name: '+7 d' }).click();
  await expect(page.getByRole('status')).toContainText('Podsjetnik je odgođen.');
});

test('reminder filters and pagination update server queries on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let requestedQuery = new URLSearchParams();
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['reminder:view'] }) }),
  );
  await page.route('**/api/v1/reminders*', async (route) => {
    const url = new URL(route.request().url());
    requestedQuery = url.searchParams;
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    const item = {
      id: pageNumber === 2 ? '55555555-5555-4555-8555-555555555555' : '44444444-4444-4444-8444-444444444444',
      kind: 'SERVICE_KM',
      entityType: 'Vehicle',
      entityId: '66666666-6666-4666-8666-666666666666',
      dueDate: null,
      dueKm: pageNumber === 2 ? 120000 : 100000,
      thresholdDays: null,
      thresholdKm: 10000,
      fireAt: '2026-10-29T08:30:00.000Z',
      status: 'SCHEDULED',
      sentAt: null,
      acknowledgedAt: null,
      due: true,
      createdAt: '2026-10-28T08:30:00.000Z',
    };
    await route.fulfill({
      status: 200,
      json: { data: { items: [item], page: pageNumber, pageSize: 50, total: 100, totalPages: 2 }, meta: {} },
    });
  });
  await page.goto('/prijava?next=%2Frokovi');
  await submitLogin(page);
  await expect(page.getByText(/100.*km/)).toBeVisible();
  const tableRegion = page.getByRole('region', { name: 'Podsjetnici — pomjerite tabelu horizontalno za pregled svih kolona' });
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();
  expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);

  await page.getByLabel('Vrsta').selectOption('SERVICE_KM');
  await expect.poll(() => requestedQuery.get('kind')).toBe('SERVICE_KM');
  await expect(page.getByText('Strana 1 / 2')).toBeVisible();
  await page.getByRole('button', { name: 'Sljedeća' }).click();
  await expect(page.getByText(/120.*km/)).toBeVisible();
  await expect.poll(() => requestedQuery.get('page')).toBe('2');
  await expectNoA11yViolations(page);
});

test('reminders render an accessible empty state on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['reminder:view'] }) }),
  );
  await page.goto('/prijava?next=%2Frokovi');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/rokovi$/);
  await expect(page.getByRole('heading', { name: 'Rokovi' })).toBeVisible();
  await expect(page.getByText('Nema podsjetnika')).toBeVisible();
  await expect(page.getByLabel('Status')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('expired authenticated request clears session and returns to login', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['vehicle:view'] }) }),
  );
  await page.route('**/api/v1/vehicles**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHENTICATED', message: 'Session expired' } },
    }),
  );
  await page.goto('/prijava?next=%2Fvozila');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/prijava\?next=%2Fvozila$/);
  await expect(page.getByRole('heading', { name: 'Prijavite se' })).toBeVisible();
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

test('vehicle registry renders populated mobile inventory and sends search to the server', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let requestedQuery = '';
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['vehicle:view'] }) }),
  );
  await page.route('**/api/v1/vehicles**', async (route) => {
    const url = new URL(route.request().url());
    requestedQuery = url.searchParams.get('q') ?? '';
    const items = requestedQuery ? [] : [{
      id: '55555555-5555-4555-8555-555555555555',
      internalNo: 'V-014',
      make: 'Škoda',
      model: 'Octavia',
      year: 2022,
      plateNumber: 'E12-M-345',
      fuelType: 'DIESEL',
      status: 'ACTIVE',
      odometerKm: 84500,
      odometerUpdatedAt: '2026-10-28T08:30:00.000Z',
      registrationExpiresAt: null,
      insuranceExpiresAt: null,
      archivedAt: null,
      version: 1,
      updatedAt: '2026-10-28T08:30:00.000Z',
    }];
    await route.fulfill({
      status: 200,
      json: { data: { items, page: 1, pageSize: 25, total: items.length, totalPages: items.length ? 1 : 0 }, meta: {} },
    });
  });
  await page.goto('/prijava?next=%2Fvozila');
  await submitLogin(page);
  await expect(page.getByRole('link', { name: 'V-014', exact: true })).toBeVisible();
  await expect(page.getByText('Škoda Octavia (2022)')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'V-014' })).toContainText(/84/);
  const vehicleTable = page.getByRole('region', { name: 'Lista vozila — pomjerite tabelu horizontalno za pregled svih kolona' });
  await vehicleTable.focus();
  await expect(vehicleTable).toBeFocused();
  expect(await vehicleTable.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('link', { name: 'Novo vozilo' })).toHaveCount(0);
  await expectNoA11yViolations(page);

  await page.getByLabel('Pretraga').fill('NEPOSTOJEĆE');
  await expect.poll(() => requestedQuery).toBe('NEPOSTOJEĆE');
  await expect(page.getByText('Nema rezultata za filtere')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('vehicle detail is readable on mobile without mutation permissions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const vehicleId = '55555555-5555-4555-8555-555555555555';
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['vehicle:view'] }) }),
  );
  await page.route(`**/api/v1/vehicles/${vehicleId}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          id: vehicleId,
          internalNo: 'V-014',
          make: 'Škoda',
          model: 'Octavia',
          year: 2022,
          plateNumber: 'E12-M-345',
          fuelType: 'DIESEL',
          status: 'ACTIVE',
          odometerKm: 84500,
          odometerUpdatedAt: '2026-10-28T08:30:00.000Z',
          registrationExpiresAt: null,
          insuranceExpiresAt: null,
          archivedAt: null,
          version: 1,
          updatedAt: '2026-10-28T08:30:00.000Z',
          vin: null,
          transmission: null,
          color: null,
          bodyType: null,
          engineCcm: null,
          enginePowerKw: null,
          seats: null,
          ownershipType: 'OWNED',
          acquisitionDate: null,
          acquisitionPrice: null,
          costCenter: null,
          nextServiceDueDate: null,
          nextServiceDueKm: null,
          notes: null,
          photoAttachmentId: null,
          formSchemaId: '77777777-7777-4777-8777-777777777777',
          formSchemaVersionId: '88888888-8888-4888-8888-888888888888',
          formData: {},
          createdAt: '2026-01-01T08:00:00.000Z',
        },
        meta: {},
      },
    }),
  );
  await page.goto(`/prijava?next=%2Fvozila%2F${vehicleId}`);
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'V-014 · Škoda Octavia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Osnovno' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Uredi' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Arhiviraj' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);

});

test('driver detail masks PII and is readable without edit permissions on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['driver:view'] }) }),
  );
  await page.route('**/api/v1/drivers/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/license-categories')) {
      await route.fulfill({ status: 200, json: { data: { items: [] }, meta: {} } });
      return;
    }
    if (pathname !== `/api/v1/drivers/${driverId}`) {
      await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        data: {
          id: driverId,
          firstName: 'Aida',
          lastName: 'Karić',
          employeeNumber: 'DRV-017',
          employmentStatus: 'ACTIVE',
          status: 'ACTIVE',
          licenseExpiresAt: '2027-12-31',
          categories: ['B', 'C'],
          licenseDaysLeft: 428,
          version: 1,
          updatedAt: '2026-10-28T12:00:00.000Z',
          phone: null,
          email: null,
          dateOfBirth: null,
          address: null,
          licenseNumber: null,
          licenseIssuedAt: null,
          licenseIssuingAuthority: null,
          restrictions: null,
          notes: null,
          photoAttachmentId: null,
          formSchemaId: '77777777-7777-4777-8777-777777777777',
          formSchemaVersionId: '88888888-8888-4888-8888-888888888888',
          formData: {},
          piiRedacted: true,
          createdAt: '2026-01-01T08:00:00.000Z',
        },
        meta: {},
      },
    });
  });
  await page.goto(`/prijava?next=%2Fvozaci%2F${driverId}`);
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Aida Karić' })).toBeVisible();
  await expect(page.getByText(/Lični podaci su maskirani/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arhiviraj' })).toHaveCount(0);
  await expect(page.getByText('DRV-017')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('driver detail route is denied before data fetch without driver:view', async ({ page }) => {
  const driverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let detailRequests = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: [] }) }),
  );
  await page.route('**/api/v1/drivers/**', async (route) => {
    detailRequests += 1;
    await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } } });
  });
  await page.goto(`/prijava?next=%2Fvozaci%2F${driverId}`);
  await submitLogin(page);
  await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aida Karić' })).toHaveCount(0);
  expect(detailRequests).toBe(0);
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

test('driver registry shows populated results accessibly and applies server search without exposing PII', async ({ page }) => {
  const driverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const driver = {
    id: driverId,
    firstName: 'Aida',
    lastName: 'Karić',
    employeeNumber: 'DRV-017',
    employmentStatus: 'ACTIVE',
    status: 'ACTIVE',
    licenseExpiresAt: null,
    categories: ['B', 'C'],
    licenseDaysLeft: null,
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  let requestedQuery = '';
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['driver:view'] }) }),
  );
  await page.route('**/api/v1/drivers**', async (route) => {
    const url = new URL(route.request().url());
    requestedQuery = url.searchParams.get('q') ?? '';
    const items = requestedQuery ? [] : [driver];
    await route.fulfill({
      status: 200,
      json: {
        data: { items, page: 1, pageSize: 25, total: items.length, totalPages: items.length ? 1 : 0 },
        meta: {},
      },
    });
  });
  await page.goto('/prijava?next=%2Fvozaci');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Vozači' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Karić Aida', exact: true })).toBeVisible();
  await expect(page.getByText('DRV-017')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'B, C', exact: true })).toBeVisible();
  const driverTable = page.getByRole('region', { name: 'Lista vozača — pomjerite tabelu horizontalno za pregled svih kolona' });
  await driverTable.focus();
  await expect(driverTable).toBeFocused();
  expect(await driverTable.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator('#root').innerText()).not.toMatch(/aida.*@|\+387|telefon:/iu);
  await expectNoA11yViolations(page);

  await page.getByLabel('Pretraga').fill('Nepostojeći vozač');
  await expect(page.getByText('Nema rezultata za filtere')).toBeVisible();
  await expect.poll(() => requestedQuery).toBe('Nepostojeći vozač');
  await expectNoA11yViolations(page);
});

test('user administration respects the server-masked identity and search filter', async ({ page }) => {
  let requestedSearch = '';
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['user:view'] }) }),
  );
  await page.route('**/api/v1/users**', async (route) => {
    const url = new URL(route.request().url());
    requestedSearch = url.searchParams.get('q') ?? '';
    const items = requestedSearch
      ? []
      : [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            email: 'a***@example.test',
            firstName: 'Lejla',
            lastName: 'Hadžić',
            displayName: null,
            phone: null,
            status: 'ACTIVE',
            mustChangePassword: false,
            roles: [{ id: roleId, code: 'DISPATCHER', name: 'Dispečer' }],
            lastLoginAt: null,
            lockedUntil: null,
            piiRedacted: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ];
    await route.fulfill({
      status: 200,
      json: { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 }, meta: {} },
    });
  });
  await page.goto('/prijava?next=%2Fadministracija%2Fkorisnici');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/administracija\/korisnici$/);
  await expect(page.getByLabel('Pretraga')).toBeVisible();
  await expect(page.getByText('Lejla Hadžić')).toBeVisible();
  await expect(page.getByText('a***@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novi korisnik' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset lozinke' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Odjavi svuda' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Arhiviraj' })).toHaveCount(0);
  expect(await page.locator('#root').innerText()).not.toContain('lejla.hadzic@');
  await expectNoA11yViolations(page);

  await page.getByLabel('Pretraga').fill('Nepoznata osoba');
  await expect(page.getByText('Nema korisnika')).toBeVisible();
  await expect.poll(() => requestedSearch).toBe('Nepoznata osoba');
  await expectNoA11yViolations(page);
});

test('user list API failure is announced instead of rendering an empty state', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['user:view'] }) }),
  );
  await page.route('**/api/v1/users**', (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: 'INTERNAL_ERROR', message: 'Privremeni prekid servisa.' } },
    }),
  );
  await page.goto('/prijava?next=%2Fadministracija%2Fkorisnici');
  await submitLogin(page);
  await expect(page.getByRole('alert')).toContainText('Privremeni prekid servisa.');
  await expect(page.getByText('Nema korisnika')).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test('Super Admin creates a user and reveals the temporary password only once on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const newUserId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let createdUser: Record<string, unknown> | null = null;
  await mockApi(page, (route) =>
    route.fulfill({
      status: 200,
      json: authResponse({ isSuperAdmin: true, permissions: ['user:view', 'user:create'] }),
    }),
  );
  await page.route('**/api/v1/roles', (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: [{ id: roleId, code: 'DISPATCHER', name: 'Dispečer', description: null, isSystem: false }],
        meta: {},
      },
    }),
  );
  await page.route('**/api/v1/users**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({
        email: 'amina@example.test',
        firstName: 'Amina',
        lastName: 'Kovačević',
        roleIds: [roleId],
      });
      createdUser = {
        id: newUserId,
        email: 'a***@example.test',
        firstName: 'Amina',
        lastName: 'Kovačević',
        phone: null,
        status: 'PENDING_PASSWORD_CHANGE',
        mustChangePassword: true,
        roles: [{ id: roleId, code: 'DISPATCHER', name: 'Dispečer' }],
        lastLoginAt: null,
        lockedUntil: null,
        piiRedacted: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await route.fulfill({
        status: 201,
        json: {
          data: {
            user: { id: newUserId, email: 'amina@example.test' },
            temporaryPassword: 'ONE-TIME-SECRET-42',
            mustChangePassword: true,
          },
          meta: {},
        },
      });
      return;
    }
    const items = createdUser ? [createdUser] : [];
    await route.fulfill({
      status: 200,
      json: { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 }, meta: {} },
    });
  });
  await page.goto('/prijava?next=%2Fadministracija%2Fkorisnici');
  await submitLogin(page);
  await expect(page.getByLabel('Pretraga')).toBeVisible();
  await page.getByRole('button', { name: 'Novi korisnik' }).click();
  await page.getByLabel('E-mail').fill('amina@example.test');
  await page.getByLabel('Ime', { exact: true }).fill('Amina');
  await page.getByLabel('Prezime', { exact: true }).fill('Kovačević');
  await page.getByLabel('Dispečer').check();
  await page.getByRole('button', { name: 'Kreiraj korisnika' }).click();
  await expect(page.getByText('Privremena lozinka za amina@example.test')).toBeVisible();
  await expect(page.getByText('ONE-TIME-SECRET-42', { exact: true })).toBeVisible();
  await expect(page.getByText('Amina Kovačević')).toBeVisible();
  const usersRegion = page.getByRole('region', { name: 'Korisnici — pomjerite tabelu horizontalno za pregled svih kolona' });
  await usersRegion.focus();
  await expect(usersRegion).toBeFocused();
  expect(await usersRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Sakrij' }).click();
  await expect(page.getByText('ONE-TIME-SECRET-42', { exact: true })).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test('Super Admin reset, force logout, and archive actions work for a user on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const targetId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  let archived = false;
  let forceLogoutCalls = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ isSuperAdmin: true, permissions: [
      'user:view', 'user:reset_password', 'user:force_logout', 'user:archive',
    ] }) }),
  );
  await page.route('**/api/v1/users**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      const items = archived ? [] : [{
        id: targetId,
        email: 'driver@example.test',
        firstName: 'Adnan',
        lastName: 'Hodžić',
        displayName: null,
        phone: null,
        status: 'ACTIVE',
        mustChangePassword: false,
        roles: [{ id: roleId, code: 'DRIVER', name: 'Vozač' }],
        lastLoginAt: null,
        lockedUntil: null,
        piiRedacted: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }];
      await route.fulfill({
        status: 200,
        json: { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 }, meta: {} },
      });
      return;
    }
    if (url.pathname.endsWith('/reset-password')) {
      await route.fulfill({
        status: 200,
        json: {
          data: {
            userId: targetId,
            email: 'driver@example.test',
            token: 'RESET-ONCE-TOKEN-73',
            expiresAt: '2026-10-29T12:00:00.000Z',
          },
          meta: {},
        },
      });
      return;
    }
    if (url.pathname.endsWith('/force-logout')) {
      forceLogoutCalls += 1;
      await route.fulfill({ status: 200, json: { data: { revokedSessions: 3 }, meta: {} } });
      return;
    }
    if (url.pathname.endsWith('/archive')) {
      archived = true;
      await route.fulfill({ status: 200, json: { data: null, meta: {} } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Not allowed' } } });
  });

  await page.goto('/prijava?next=%2Fadministracija%2Fkorisnici');
  await submitLogin(page);
  await expect(page.getByText('Adnan Hodžić')).toBeVisible();
  await page.getByRole('button', { name: 'Reset lozinke' }).click();
  await expect(page.getByText('Jednokratni token za reset lozinke (driver@example.test)')).toBeVisible();
  await expect(page.getByText('RESET-ONCE-TOKEN-73', { exact: true })).toBeVisible();
  await expect(page.getByText(/token važi do/)).toBeVisible();
  await page.getByRole('button', { name: 'Sakrij' }).click();
  await expect(page.getByText('RESET-ONCE-TOKEN-73', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Odjavi svuda' }).click();
  await expect.poll(() => forceLogoutCalls).toBe(1);
  await expect(page.getByText('Adnan Hodžić')).toBeVisible();
  await page.getByRole('button', { name: 'Arhiviraj' }).click();
  await expect(page.getByText('Nema korisnika')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('audit log filters and lazy details are accessible on mobile while security rows stay hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const auditId = '42';
  let lastListQuery: URLSearchParams | null = null;
  let detailCalls = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['audit:view'] }) }),
  );
  await page.route('**/api/v1/audit-logs**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/audit-logs/${auditId}`)) {
      detailCalls += 1;
      await route.fulfill({
        status: 200,
        json: {
          data: {
            id: auditId,
            action: 'ROLE_CHANGE',
            severity: 'WARN',
            actorId: userId,
            actorEmail: 'admin@example.test',
            actorRoles: ['Administrator'],
            entityType: 'User',
            entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            changedFields: ['roles'],
            reason: null,
            requestId: 'e2e-audit-request',
            ipAddress: null,
            userAgent: null,
            clientType: 'WEB',
            createdAt: '2026-10-29T10:00:00.000Z',
            before: { role: 'Viewer' },
            after: { role: 'Dispatcher' },
            metadata: null,
          },
          meta: {},
        },
      });
      return;
    }
    lastListQuery = url.searchParams;
    await route.fulfill({
      status: 200,
      json: {
        data: {
          items: [{
            id: auditId,
            action: 'ROLE_CHANGE',
            severity: 'WARN',
            actorId: userId,
            actorEmail: 'admin@example.test',
            actorRoles: ['Administrator'],
            entityType: 'User',
            entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            changedFields: ['roles'],
            reason: null,
            requestId: 'e2e-audit-request',
            ipAddress: null,
            userAgent: null,
            clientType: 'WEB',
            createdAt: '2026-10-29T10:00:00.000Z',
          }],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
          securityHidden: true,
        },
        meta: {},
      },
    });
  });

  await page.goto('/prijava?next=%2Faudit-log');
  await submitLogin(page);
  await expect(page.getByRole('cell', { name: 'ROLE_CHANGE', exact: true })).toBeVisible();
  await expect(page.getByText(/Sigurnosni zapisi/)).toBeVisible();
  await expect(page.getByText('SECURITY_EVENT')).toHaveCount(0);
  expect(detailCalls).toBe(0);
  await page.getByLabel('Akcija').selectOption('ROLE_CHANGE');
  await page.getByLabel('Ozbiljnost').selectOption('WARN');
  await expect.poll(() => lastListQuery?.get('action')).toBe('ROLE_CHANGE');
  await expect.poll(() => lastListQuery?.get('severity')).toBe('WARN');

  const auditRegion = page.getByRole('region', { name: 'Audit zapisi — pomjerite tabelu horizontalno za pregled svih kolona' });
  await auditRegion.focus();
  await expect(auditRegion).toBeFocused();
  expect(await auditRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Detalj' }).click();
  await expect(page.getByText('Prije', { exact: true })).toBeVisible();
  await expect(page.getByText('Poslije', { exact: true })).toBeVisible();
  await expect(page.getByText(/Viewer/)).toBeVisible();
  await expect(page.getByText(/Dispatcher/)).toBeVisible();
  await expect.poll(() => detailCalls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('direct audit-log route denies users without audit:view before fetching records', async ({ page }) => {
  let auditRequests = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['user:view'] }) }),
  );
  await page.route('**/api/v1/audit-logs**', async (route) => {
    auditRequests += 1;
    await route.fulfill({ status: 200, json: { data: { items: [] }, meta: {} } });
  });
  await page.goto('/prijava?next=%2Faudit-log');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/audit-log$/);
  await expect(page.getByText('Nemate pristup')).toBeVisible();
  await expect(page.getByText(/potrebno pravo "audit:view"/)).toBeVisible();
  await expect.poll(() => auditRequests).toBe(0);
  await expectNoA11yViolations(page);
});

test('permission matrix is readable but immutable without the management permission', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['role:view'] }) }),
  );
  await page.route('**/api/v1/roles/matrix', (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          modules: [
            {
              module: 'Vozila',
              permissions: [
                {
                  code: 'vehicle:view',
                  action: 'view',
                  description: 'Pregled vozila',
                  isSensitive: false,
                  inDatabase: true,
                },
              ],
            },
          ],
          roles: [
            {
              id: roleId,
              code: 'DISPATCHER',
              name: 'Dispečer',
              description: null,
              isSystem: false,
              allowedClientTypes: ['WEB'],
              permissionsVersion: 1,
              priority: 10,
              activeUserCount: 2,
              grantedCount: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          grants: [
            {
              roleId,
              permission: 'vehicle:view',
              scope: 'ALL',
              scopeVehicleIds: [],
              scopeDriverIds: [],
              conditions: null,
              grantedAt: null,
            },
          ],
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
        meta: {},
      },
    }),
  );
  await page.goto('/prijava?next=%2Fadministracija%2Fprava');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/administracija\/prava$/);
  await expect(page.getByText('Matrica prava (1 permisija)')).toBeVisible();
  const scope = page.getByLabel('Dispečer → vehicle:view');
  await expect(scope).toHaveValue('ALL');
  await expect(scope).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sačuvaj matricu' })).toBeDisabled();
  await expectNoA11yViolations(page);
});

test('task type configuration remains navigable on a narrow screen with keyboard-scrollable table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const taskTypeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['task_type:view'] }) }),
  );
  await page.route('**/api/v1/task-types**', (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          items: [{
            id: taskTypeId,
            code: 'OIL_CHANGE',
            name: 'Zamjena ulja i filtera',
            description: 'Redovni servis vozila',
            iconName: null,
            colorHex: null,
            requiresVehicle: true,
            requiresOdometer: true,
            requiresPhotos: false,
            defaultPriority: 'NORMAL',
            defaultAssignMode: 'OPEN_CLAIM',
            allowMultipleClaimants: false,
            dueOffsetHours: 48,
            formSchemaId: null,
            formSchemaKey: null,
            formSchemaName: null,
            formSchemaVersion: null,
            active: true,
            sortOrder: 1,
            completionRequirementCount: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        },
        meta: {},
      },
    }),
  );
  await page.goto('/prijava?next=%2Fvrste-zadataka');
  await submitLogin(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Vrste zadataka' })).toBeVisible();
  await expect(page.getByText('Zamjena ulja i filtera')).toBeVisible();
  const taskTypesRegion = page.getByRole('region', { name: 'Vrste zadataka — za pregled svih kolona pomjerite tabelu horizontalno' });
  await taskTypesRegion.focus();
  await expect(taskTypesRegion).toBeFocused();
  expect(await taskTypesRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('Super Admin can create, edit, and configure completion requirements for a task type', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const taskTypeId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  let currentName: string | null = null;
  let requirements: Array<{
    id: string;
    taskTypeId: string;
    fieldKey: string;
    required: boolean;
    stage: string;
    minPhotos: number;
  }> = [];
  const taskType = () => ({
    id: taskTypeId,
    code: 'FUEL_REFILL',
    name: currentName ?? 'Dopuna goriva',
    description: 'Opis vrste zadatka',
    iconName: null,
    colorHex: '#2E7D32',
    requiresVehicle: true,
    requiresOdometer: false,
    requiresPhotos: false,
    defaultPriority: 'NORMAL',
    defaultAssignMode: 'OPEN_CLAIM',
    allowMultipleClaimants: false,
    dueOffsetHours: 48,
    formSchemaId: null,
    formSchemaKey: null,
    formSchemaName: null,
    formSchemaVersion: null,
    active: true,
    sortOrder: 100,
    completionRequirementCount: requirements.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['task_type:view', 'task_type:create', 'task_type:update'] }) }),
  );
  await page.route('**/api/v1/form-schemas*', (route) =>
    route.fulfill({ status: 200, json: { data: [], meta: {} } }),
  );
  await page.route('**/api/v1/task-types**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (method === 'GET' && path === '/api/v1/task-types') {
      const row = taskType();
      const items = currentName ? [row] : [];
      await route.fulfill({
        status: 200,
        json: { data: { items, page: 1, pageSize: 25, total: items.length, totalPages: items.length ? 1 : 0 }, meta: {} },
      });
      return;
    }
    if (method === 'POST' && path === '/api/v1/task-types') {
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({ code: 'FUEL_REFILL', name: 'Dopuna goriva', colorHex: '#2E7D32' });
      currentName = 'Dopuna goriva';
      await route.fulfill({ status: 201, json: { data: { ...taskType(), completionRequirements: [] }, meta: {} } });
      return;
    }
    if (method === 'GET' && path === `/api/v1/task-types/${taskTypeId}`) {
      await route.fulfill({ status: 200, json: { data: { ...taskType(), completionRequirements: [] }, meta: {} } });
      return;
    }
    if (method === 'PATCH' && path === `/api/v1/task-types/${taskTypeId}`) {
      const payload = route.request().postDataJSON();
      expect(payload).toEqual({ name: 'Dopuna goriva i aditiva' });
      currentName = 'Dopuna goriva i aditiva';
      await route.fulfill({ status: 200, json: { data: { ...taskType(), completionRequirements: requirements }, meta: {} } });
      return;
    }
    if (method === 'GET' && path === `/api/v1/task-types/${taskTypeId}/completion-requirements`) {
      await route.fulfill({ status: 200, json: { data: { taskTypeId, requirements }, meta: {} } });
      return;
    }
    if (method === 'PUT' && path === `/api/v1/task-types/${taskTypeId}/completion-requirements`) {
      expect(route.request().postDataJSON()).toEqual({
        requirements: [{ fieldKey: 'photoEvidence', required: true, stage: 'ON_COMPLETE', minPhotos: 0 }],
      });
      requirements = [{
        id: 'abababab-abab-4bab-8bab-abababababab',
        taskTypeId,
        fieldKey: 'photoEvidence',
        required: true,
        stage: 'ON_COMPLETE',
        minPhotos: 0,
      }];
      await route.fulfill({ status: 200, json: { data: { taskTypeId, requirements }, meta: {} } });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { message: `Unexpected task type request: ${method} ${path}` } } });
  });
  await page.goto('/prijava?next=%2Fvrste-zadataka');
  await submitLogin(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Vrste zadataka' })).toBeVisible();
  await page.getByRole('button', { name: 'Nova vrsta' }).click();
  await page.getByLabel('Kod vrste').fill('FUEL_REFILL');
  await page.getByLabel('Naziv vrste').fill('Dopuna goriva');
  await page.getByLabel('Boja', { exact: true }).fill('#2E7D32');
  await page.getByRole('button', { name: 'Sačuvaj vrstu' }).click();
  await expect(page.getByRole('status')).toContainText('Nova vrsta zadatka FUEL_REFILL je sačuvana.');
  await expect(page.getByText('Dopuna goriva', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Uredi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Izmjena vrste FUEL_REFILL' })).toBeVisible();
  await page.getByLabel('Naziv vrste').fill('Dopuna goriva i aditiva');
  await expect(page.getByLabel('Kod vrste')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Sačuvaj izmjene' }).click();
  await expect(page.getByRole('status')).toContainText('Vrsta zadatka FUEL_REFILL je izmijenjena.');
  await expect(page.getByText('Dopuna goriva i aditiva', { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Zahtjevi završetka vrste FUEL_REFILL' }).click();
  await expect(page.getByText('Zahtjevi završetka — FUEL_REFILL')).toBeVisible();
  await page.getByRole('button', { name: 'Dodaj zahtjev' }).click();
  await page.getByLabel('Polje forme 1').fill('photoEvidence');
  await page.getByRole('button', { name: 'Sačuvaj zahtjeve' }).click();
  await expect(page.getByText('Zahtjevi završetka su sačuvani.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Super Admin can update a role scope and sees a conflict without losing edits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const savedPayloads: unknown[] = [];
  let saveAttempts = 0;
  const superAdminRoleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const modules = [{
    module: 'Vozila',
    permissions: [{
      code: 'vehicle:view',
      action: 'view',
      description: 'Pregled vozila',
      isSensitive: false,
      inDatabase: true,
    }],
  }];
  const roles = [
    {
      id: roleId,
      code: 'DISPATCHER',
      name: 'Dispečer',
      description: null,
      isSystem: false,
      allowedClientTypes: ['WEB'],
      permissionsVersion: 1,
      priority: 10,
      activeUserCount: 2,
      grantedCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    ...['FLEET_MANAGER', 'MECHANIC', 'VIEWER', 'AUDITOR'].map((code, index) => ({
      id: `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, '0')}`,
      code,
      name: code.replaceAll('_', ' '),
      description: null,
      isSystem: false,
      allowedClientTypes: ['WEB'],
      permissionsVersion: 1,
      priority: 20 + index,
      activeUserCount: 1,
      grantedCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    {
      id: superAdminRoleId,
      code: 'SUPER_ADMIN',
      name: 'Super Admin',
      description: null,
      isSystem: true,
      allowedClientTypes: ['WEB'],
      permissionsVersion: 1,
      priority: 100,
      activeUserCount: 1,
      grantedCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['role:view', 'role:manage_permissions'] }) }),
  );
  await page.route('**/api/v1/roles/matrix', async (route) => {
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON();
      savedPayloads.push(payload);
      saveAttempts += 1;
      if (saveAttempts === 2) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT', message: 'Matrica je u međuvremenu izmijenjena.' } },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        json: { data: { affectedRoles: 1, added: 0, removed: 0, scopeChanged: 1, permissionsVersion: { [roleId]: 2 } }, meta: {} },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        data: {
          modules,
          roles,
          grants: [{
            roleId,
            permission: 'vehicle:view',
            scope: 'ALL',
            scopeVehicleIds: [],
            scopeDriverIds: [],
            conditions: null,
            grantedAt: null,
          }],
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
        meta: {},
      },
    });
  });
  await page.goto('/prijava?next=%2Fadministracija%2Fprava');
  await submitLogin(page);
  await expect(page.getByLabel('Dispečer → vehicle:view')).toHaveValue('ALL');
  await expect(page.getByRole('columnheader', { name: 'Super Admin' })).toHaveCount(0);
  const matrixRegion = page.getByRole('region', { name: 'Matrica prava — za pregled svih rola pomjerite tabelu horizontalno' });
  await matrixRegion.focus();
  await expect(matrixRegion).toBeFocused();
  expect(await matrixRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByLabel('Dispečer → vehicle:view').selectOption('OWN');
  await expect(page.getByText('Nesačuvane izmjene')).toBeVisible();
  await page.getByRole('button', { name: 'Sačuvaj matricu' }).click();
  await expect(page.getByRole('status')).toContainText('Sačuvano: 1 rola');
  expect(savedPayloads).toEqual([{ roles: [{ roleId, grants: [{ permission: 'vehicle:view', scope: 'OWN' }] }] }]);
  expect(JSON.stringify(savedPayloads)).not.toContain(superAdminRoleId);

  await page.getByLabel('Dispečer → vehicle:view').selectOption('OWN');
  await page.getByRole('button', { name: 'Sačuvaj matricu' }).click();
  await expect(page.getByRole('alert')).toContainText('Matrica je u međuvremenu izmijenjena.');
  await expect(page.getByText('Nesačuvane izmjene')).toBeVisible();
  await expect(page.getByLabel('Dispečer → vehicle:view')).toHaveValue('OWN');
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

test('profile can revoke another device session without leaving the current session on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const revokedSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const currentSessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let sessionItems = [
    {
      id: currentSessionId,
      clientType: 'WEB',
      createdAt: '2026-10-29T08:00:00.000Z',
      expiresAt: '2026-10-30T08:00:00.000Z',
      lastUsedAt: '2026-10-29T09:00:00.000Z',
      ipAddress: '192.0.2.10',
      userAgent: 'Chrome on Linux',
      deviceInfo: null,
    },
    {
      id: revokedSessionId,
      clientType: 'MOBILE',
      createdAt: '2026-10-28T08:00:00.000Z',
      expiresAt: '2026-11-04T08:00:00.000Z',
      lastUsedAt: '2026-10-29T07:00:00.000Z',
      ipAddress: '192.0.2.20',
      userAgent: null,
      deviceInfo: { model: 'Pixel 9', osVersion: 'Android 15', appVersion: '3.1.0' },
    },
  ];
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['auth:login', 'auth:manage_sessions'] }) }),
  );
  await page.route('**/api/v1/auth/sessions**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { data: sessionItems, meta: {} } });
      return;
    }
    if (request.method() === 'DELETE' && url.pathname.endsWith(`/${revokedSessionId}`)) {
      sessionItems = sessionItems.filter((session) => session.id !== revokedSessionId);
      await route.fulfill({ status: 200, json: { data: { currentSessionRevoked: false }, meta: {} } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Not allowed' } } });
  });

  await page.goto('/prijava?next=%2Fprofil');
  await submitLogin(page);
  await expect(page.getByText('Pixel 9 · Android 15 · 3.1.0')).toBeVisible();
  const sessionsRegion = page.getByRole('region', { name: 'Aktivne sesije — pomjerite tabelu horizontalno za pregled svih kolona' });
  await sessionsRegion.focus();
  await expect(sessionsRegion).toBeFocused();
  expect(await sessionsRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expectNoA11yViolations(page);
  await page.getByRole('row').filter({ hasText: 'Pixel 9' }).getByRole('button', { name: 'Odjavi' }).click();
  await expect(page.getByText('Pixel 9 · Android 15 · 3.1.0')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
  await expect(page.getByText('Aktivne sesije')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('profile logout-all revokes every device and returns to login on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let logoutAllCalls = 0;
  let logoutCalls = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['auth:login', 'auth:manage_sessions'] }) }),
  );
  await page.route('**/api/v1/auth/sessions', (route) =>
    route.fulfill({ status: 200, json: { data: [], meta: {} } }),
  );
  await page.route('**/api/v1/auth/logout-all', async (route) => {
    logoutAllCalls += 1;
    await route.fulfill({ status: 200, json: { data: { revokedSessions: 2 }, meta: {} } });
  });
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCalls += 1;
    await route.fulfill({ status: 200, json: { data: null, meta: {} } });
  });

  await page.goto('/prijava?next=%2Fprofil');
  await submitLogin(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Odjavi sve uređaje' }).click();
  await expect(page).toHaveURL(/\/prijava\?next=%2Fprofil$/);
  await expect(page.getByRole('heading', { name: 'Prijavite se' })).toBeVisible();
  expect(logoutAllCalls).toBe(1);
  expect(logoutCalls).toBe(0);
});

test('revoking the current profile session clears the client session and returns to login', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const currentSessionId = '33333333-3333-4333-8333-333333333333';
  let revokedPath = '';
  let logoutCalls = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['auth:login', 'auth:manage_sessions'] }) }),
  );
  await page.route('**/api/v1/auth/sessions**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          data: [{
            id: currentSessionId,
            clientType: 'WEB',
            createdAt: '2026-10-29T08:00:00.000Z',
            expiresAt: '2026-10-30T08:00:00.000Z',
            lastUsedAt: '2026-10-29T09:00:00.000Z',
            ipAddress: '192.0.2.10',
            userAgent: 'Chrome on Linux',
            deviceInfo: null,
          }],
          meta: {},
        },
      });
      return;
    }
    if (request.method() === 'DELETE') {
      revokedPath = url.pathname;
      await route.fulfill({ status: 200, json: { data: { currentSessionRevoked: true }, meta: {} } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Not allowed' } } });
  });
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCalls += 1;
    await route.fulfill({ status: 200, json: { data: null, meta: {} } });
  });

  await page.goto('/prijava?next=%2Fprofil');
  await submitLogin(page);
  await expect(page.getByText('Chrome on Linux')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('row').filter({ hasText: 'Chrome on Linux' }).getByRole('button', { name: 'Odjavi' }).click();
  await expect(page).toHaveURL(/\/prijava\?next=%2Fprofil$/);
  await expect(page.getByRole('heading', { name: 'Prijavite se' })).toBeVisible();
  expect(revokedPath).toBe(`/api/v1/auth/sessions/${currentSessionId}`);
  expect(logoutCalls).toBe(0);
});

test('vehicle service history is readable and action controls follow permissions on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const vehicleId = '55555555-5555-4555-8555-555555555555';
  const serviceId = '66666666-6666-4666-8666-666666666666';
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['vehicle:view', 'service:view'] }) }),
  );
  await page.route(`**/api/v1/vehicles/${vehicleId}`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          id: vehicleId,
          internalNo: 'V-21',
          make: 'Toyota',
          model: 'Corolla',
          year: 2022,
          plateNumber: 'A21-T-021',
          fuelType: 'PETROL',
          status: 'ACTIVE',
          odometerKm: 65432,
          odometerUpdatedAt: '2026-10-29T08:00:00.000Z',
          registrationExpiresAt: '2027-01-01',
          insuranceExpiresAt: '2027-01-01',
          archivedAt: null,
          version: 1,
          updatedAt: '2026-10-29T08:00:00.000Z',
          vin: null,
          transmission: 'AUTOMATIC',
          color: 'Siva',
          bodyType: null,
          engineCcm: 1800,
          enginePowerKw: 90,
          seats: 5,
          ownershipType: 'OWNED',
          acquisitionDate: '2022-01-01',
          acquisitionPrice: null,
          costCenter: null,
          nextServiceDueDate: null,
          nextServiceDueKm: null,
          notes: null,
          photoAttachmentId: null,
          formSchemaId: '77777777-7777-4777-8777-777777777777',
          formSchemaVersionId: '88888888-8888-4888-8888-888888888888',
          formData: {},
          createdAt: '2022-01-01T00:00:00.000Z',
        },
        meta: {},
      },
    }),
  );
  await page.route('**/api/v1/services**', (route) =>
    route.fulfill({
      status: 200,
      json: {
        data: {
          items: [{
            id: serviceId,
            vehicleId,
            serviceDate: '2026-10-01',
            serviceType: 'Redovni servis',
            workshopName: 'Auto Centar',
            description: 'Zamjena ulja i filtera',
            odometerKm: 64000,
            totalCost: 18450,
            currency: 'BAM',
            nextServiceDueDate: '2027-04-01',
            nextServiceDueKm: 74000,
            status: 'ACTIVE',
            formSchemaId: '77777777-7777-4777-8777-777777777777',
            formSchemaVersionId: '88888888-8888-4888-8888-888888888888',
            version: 1,
          }],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        },
        meta: {},
      },
    }),
  );
  await page.goto(`/prijava?next=${encodeURIComponent(`/vozila/${vehicleId}`)}`);
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'V-21 · Toyota Corolla' })).toBeVisible();
  await page.getByRole('button', { name: 'Servisi' }).click();
  await expect(page.getByText('Redovni servis')).toBeVisible();
  await expect(page.getByText('Auto Centar')).toBeVisible();
  await expect(page.getByText('184.50 KM')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novi servis' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Uredi servis' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Obriši servis/ })).toHaveCount(0);
  const servicesRegion = page.getByRole('region', { name: 'Servisi vozila — pomjerite tabelu horizontalno za pregled svih kolona' });
  await servicesRegion.focus();
  await expect(servicesRegion).toBeFocused();
  expect(await servicesRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('tire set inventory filters and read-only permissions work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let lastQuery: URLSearchParams | null = null;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['tire:view'] }) }),
  );
  await page.route('**/api/v1/tire-sets**', async (route) => {
    const url = new URL(route.request().url());
    lastQuery = url.searchParams;
    const items = url.searchParams.get('season') === 'WINTER' ? [] : [{
      id: '99999999-9999-4999-8999-999999999999',
      code: 'G-Z-021',
      brand: 'Continental',
      model: 'WinterContact',
      size: '205/55 R16 91V',
      season: 'SUMMER',
      tireCount: 4,
      purchaseDate: '2025-10-01',
      purchasePrice: 62000,
      currency: 'BAM',
      status: 'IN_STOCK',
      currentLocation: 'Centralno skladište',
      notes: 'Set za službeno vozilo',
      mountedVehicleId: null,
      mountedVehicleInternalNo: null,
      mountedVehiclePlateNumber: null,
      version: 1,
      formSchemaId: null,
      formSchemaVersionId: null,
    }];
    await route.fulfill({
      status: 200,
      json: { data: { items, page: 1, pageSize: 25, total: items.length, totalPages: items.length ? 1 : 0 }, meta: {} },
    });
  });

  await page.goto('/prijava?next=%2Fgume');
  await submitLogin(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Kompleti guma' })).toBeVisible();
  await expect(page.getByText('G-Z-021')).toBeVisible();
  await expect(page.getByText('Continental WinterContact')).toBeVisible();
  await expect(page.getByText('Centralno skladište')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novi komplet' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Uredi', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Obriši komplet G-Z-021' })).toHaveCount(0);
  const tireSetsRegion = page.getByRole('region', { name: 'Skupovi guma — pomjerite tabelu horizontalno za pregled svih kolona' });
  await tireSetsRegion.focus();
  await expect(tireSetsRegion).toBeFocused();
  expect(await tireSetsRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);

  await page.getByLabel('Sezona').selectOption('WINTER');
  await expect.poll(() => lastQuery?.get('season')).toBe('WINTER');
  await expect(page.getByText('Nema kompleta za odabrane filtere')).toBeVisible();
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

test('user administration route is denied before loading identities without user:view', async ({ page }) => {
  let userDataRequests = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: [] }) }),
  );
  await page.route('**/api/v1/users**', async (route) => {
    userDataRequests += 1;
    await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } } });
  });
  await page.goto('/prijava?next=%2Fadministracija%2Fkorisnici');
  await submitLogin(page);
  await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Korisnici' })).toHaveCount(0);
  expect(userDataRequests).toBe(0);
});

test('task creation wizard submits the published form snapshot and opens the new task', async ({ page }) => {
  const taskTypeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const vehicleId = '66666666-6666-4666-8666-666666666666';
  const formId = '77777777-7777-4777-8777-777777777777';
  const formVersionId = '88888888-8888-4888-8888-888888888888';
  const taskId = '99999999-9999-4999-8999-999999999999';
  const definition = {
    $schema: 'vfm-form/1',
    meta: { title: 'Pregled', subject: 'TASK' },
    sections: [{
      key: 'notes',
      title: 'Napomene',
      order: 1,
      visibleWhen: null,
      fields: [{ key: 'inspectionNote', type: 'TEXT', label: 'Napomena', order: 1, visibleWhen: null }],
    }],
  };
  const formVersion = {
    id: formVersionId,
    formSchemaId: formId,
    version: 2,
    status: 'PUBLISHED',
    definition,
    normalizedName: null,
  };
  const task = {
    id: taskId,
    code: 'Z-2026-000010',
    title: 'Servis Octavie',
    description: 'Provjera kočnica',
    vehicleInternalNo: 'V-010',
    vehicleMake: 'Škoda',
    vehicleModel: 'Octavia',
    taskTypeName: 'Redovni servis',
    priority: 'HIGH',
    status: 'OPEN',
    dueAt: null,
    createdByName: 'Testni Korisnik',
    assigneeName: null,
    formData: { inspectionNote: 'Provjera kočnica' },
    formSchemaVersion: 2,
    version: 1,
    assignments: [],
    events: [],
    commentCount: 0,
  };
  let createPayload: Record<string, unknown> | null = null;
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['task:create', 'task:view'] }) }),
  );
  await page.route('**/api/v1/task-types**', (route) =>
    route.fulfill({
      status: 200,
      json: { data: { items: [{
        id: taskTypeId,
        code: 'SERVICE',
        name: 'Redovni servis',
        description: null,
        iconName: null,
        colorHex: null,
        requiresVehicle: true,
        requiresOdometer: false,
        requiresPhotos: false,
        defaultPriority: 'HIGH',
        defaultAssignMode: 'OPEN_CLAIM',
        allowMultipleClaimants: true,
        dueOffsetHours: 48,
        formSchemaId: formId,
        formSchemaKey: 'service',
        formSchemaName: 'Servis forma',
        formSchemaVersion: 2,
        active: true,
        sortOrder: 1,
        completionRequirementCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }], page: 1, pageSize: 100, total: 1, totalPages: 1 }, meta: {} },
    }),
  );
  await page.route('**/api/v1/vehicles**', (route) =>
    route.fulfill({
      status: 200,
      json: { data: { items: [{ id: vehicleId, internalNo: 'V-010', make: 'Škoda', model: 'Octavia', plateNumber: 'A10-K-010' }], page: 1, pageSize: 100, total: 1, totalPages: 1 }, meta: {} },
    }),
  );
  await page.route('**/api/v1/form-schemas**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/versions/${formVersionId}`)) {
      await route.fulfill({ status: 200, json: { data: formVersion, meta: {} } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { data: [{ id: formId, key: 'service', name: 'Servis forma', subject: 'TASK', taskTypeId, status: 'PUBLISHED', currentPublishedVersionId: formVersionId }], meta: {} },
    });
  });
  await page.route('**/api/v1/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/tasks' && route.request().method() === 'POST') {
      createPayload = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { data: task, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}/comments`) {
      await route.fulfill({ status: 200, json: { data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}`) {
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
  });

  await page.goto('/prijava?next=%2Fzadaci%2Fnovi');
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Novi zadatak' })).toBeVisible();
  await page.getByLabel('Vrsta zadatka *').selectOption(taskTypeId);
  await page.getByLabel('Vozilo *').selectOption(vehicleId);
  await page.getByRole('button', { name: 'Nastavi' }).click();
  await expect(page.getByText('Korak 2 od 3')).toBeVisible();
  await page.getByLabel('Naslov').fill('Servis Octavie');
  await page.getByLabel('Opis').fill('Provjera kočnica');
  await page.getByRole('button', { name: 'Nastavi' }).click();
  await expect(page.getByText('Korak 3 od 3')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Napredak' })).toHaveAttribute('aria-valuenow', '3');
  await page.getByLabel('Napomena').fill('Provjera kočnica');
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Kreiraj zadatak' }).click();
  await expect(page).toHaveURL(new RegExp(`/zadaci/${taskId}$`));
  await expect(page.getByRole('heading', { name: 'Servis Octavie' })).toBeVisible();
  expect(createPayload).toMatchObject({
    taskTypeId,
    vehicleId,
    title: 'Servis Octavie',
    description: 'Provjera kočnica',
    priority: 'HIGH',
    assignMode: 'OPEN_CLAIM',
    observerUserIds: [],
    formData: { inspectionNote: 'Provjera kočnica' },
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('task detail supports mobile comments and preserves task status on a server conflict', async ({ page }) => {
  const taskId = '44444444-4444-4444-8444-444444444444';
  let savedComment: string | null = null;
  let cancelPayload: unknown = null;
  let cancelAttempts = 0;
  const task = {
    id: taskId,
    code: 'Z-2026-000007',
    title: 'Pregled kočnica',
    description: 'Provjeriti kočioni sistem prije polaska.',
    vehicleInternalNo: 'V-007',
    vehicleMake: 'Škoda',
    vehicleModel: 'Octavia',
    taskTypeName: 'Redovni pregled',
    priority: 'NORMAL',
    status: 'OPEN',
    dueAt: null,
    createdByName: 'Testni Korisnik',
    assigneeName: null,
    formData: {},
    formSchemaVersion: 1,
    version: 1,
    assignments: [],
    events: [],
    commentCount: 0,
  };
  const comment = {
    id: '55555555-5555-4555-8555-555555555555',
    taskId,
    authorId: userId,
    authorName: 'Testni Korisnik',
    body: savedComment ?? '',
    mentionsUserIds: [],
    createdAt: '2026-10-29T10:00:00.000Z',
    updatedAt: '2026-10-29T10:00:00.000Z',
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['task:view', 'task:comment', 'task:cancel', 'task:reopen'] }) }),
  );
  await page.route('**/api/v1/tasks/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/tasks/${taskId}/reopen` && route.request().method() === 'POST') {
      task.status = 'OPEN';
      task.version = 3;
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}/cancel` && route.request().method() === 'POST') {
      cancelPayload = route.request().postDataJSON();
      cancelAttempts += 1;
      if (cancelAttempts === 1) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT', message: 'Zadatak je izmijenjen u drugoj sesiji.' } },
        });
        return;
      }
      task.status = 'CANCELLED';
      task.version = 2;
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}/comments` && route.request().method() === 'POST') {
      savedComment = route.request().postDataJSON().body as string;
      await route.fulfill({ status: 201, json: { data: { ...comment, body: savedComment }, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}/comments`) {
      await route.fulfill({
        status: 200,
        json: { data: { items: savedComment ? [{ ...comment, body: savedComment }] : [], page: 1, pageSize: 20, total: savedComment ? 1 : 0, totalPages: savedComment ? 1 : 0 }, meta: {} },
      });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}`) {
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
  });
  await page.goto(`/prijava?next=${encodeURIComponent(`/zadaci/${taskId}`)}`);
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Pregled kočnica' })).toBeVisible();
  await expect(page.getByText('V-007 · Škoda · Octavia')).toBeVisible();
  await page.getByLabel('Novi komentar').fill('Kočnice provjerene, sve je ispravno.');
  await page.getByRole('button', { name: 'Dodaj komentar' }).click();
  await expect(page.getByRole('status')).toContainText('Komentar je dodan.');
  await expect(page.getByText('Kočnice provjerene, sve je ispravno.')).toBeVisible();
  expect(savedComment).toBe('Kočnice provjerene, sve je ispravno.');

  await page.getByRole('button', { name: 'Otkaži zadatak' }).click();
  await page.getByLabel('Razlog otkazivanja *').fill('Potreban je ponovni pregled.');
  await page.getByRole('button', { name: 'Potvrdi: Otkaži zadatak' }).click();
  await expect(page.getByRole('alert')).toContainText('Zadatak je izmijenjen u drugoj sesiji.');
  expect(cancelPayload).toEqual({ version: 1, reason: 'Potreban je ponovni pregled.' });
  await expect(page.getByLabel('Razlog otkazivanja *')).toHaveValue('Potreban je ponovni pregled.');
  await page.getByRole('button', { name: 'Potvrdi: Otkaži zadatak' }).click();
  await expect(page.getByText('Otkazan', { exact: true })).toBeVisible();
  expect(cancelAttempts).toBe(2);
  expect(cancelPayload).toEqual({ version: 1, reason: 'Potreban je ponovni pregled.' });

  await page.getByRole('button', { name: 'Ponovo otvori' }).click();
  await page.getByRole('button', { name: 'Potvrdi: Ponovo otvori' }).click();
  await expect(page.getByText('Otvoren', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('task status release returns an in-progress task to the open pool', async ({ page }) => {
  const taskId = '44444444-4444-4444-8444-444444444444';
  const task = {
    id: taskId, code: 'Z-2026-000008', title: 'Pregled kočnica', description: 'Provjeriti kočioni sistem.',
    vehicleInternalNo: 'V-007', vehicleMake: 'Škoda', vehicleModel: 'Octavia', taskTypeName: 'Redovni pregled',
    priority: 'NORMAL', status: 'IN_PROGRESS', dueAt: null, createdByName: 'Testni Korisnik', assigneeName: 'Testni Korisnik',
    formData: {}, formSchemaVersion: 1, version: 4, assignments: [], events: [], commentCount: 0,
  };
  let releasePayload: unknown = null;
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse({ permissions: ['task:view', 'task:release'] }) }));
  await page.route('**/api/v1/tasks/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/tasks/${taskId}/release` && route.request().method() === 'POST') {
      releasePayload = route.request().postDataJSON();
      task.status = 'OPEN';
      task.assigneeName = null;
      task.version = 5;
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}/comments`) {
      await route.fulfill({ status: 200, json: { data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}`) {
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
  });
  await page.goto(`/prijava?next=${encodeURIComponent(`/zadaci/${taskId}`)}`);
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Pregled kočnica' })).toBeVisible();
  await expect(page.getByText('U radu', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vrati među slobodne' }).click();
  await page.getByRole('button', { name: 'Potvrdi: Vrati među slobodne' }).click();
  await expect(page.getByRole('status')).toContainText('Zadatak je vraćen među slobodne.');
  await expect(page.getByText('Otvoren', { exact: true })).toBeVisible();
  expect(releasePayload).toEqual({ version: 4 });
  await expectNoA11yViolations(page);
});

test('task completion submits the form snapshot, comment and odometer then refreshes status', async ({ page }) => {
  const taskId = '44444444-4444-4444-8444-444444444444';
  const formId = '77777777-7777-4777-8777-777777777777';
  const formVersionId = '88888888-8888-4888-8888-888888888888';
  const definition = {
    $schema: 'vfm-form/1',
    meta: { title: 'Kontrola', subject: 'TASK' },
    sections: [{ key: 'kontrola', title: 'Kontrola', order: 1, fields: [{ key: 'napomena', type: 'TEXT', label: 'Napomena', order: 1 }] }],
  };
  const version = { id: formVersionId, formSchemaId: formId, version: 3, status: 'PUBLISHED', definition };
  const task = {
    id: taskId, code: 'Z-2026-000009', title: 'Pregled nakon vožnje', description: 'Kontrola završetka',
    vehicleInternalNo: 'V-007', vehicleMake: 'Škoda', vehicleModel: 'Octavia', taskTypeName: 'Redovni pregled',
    priority: 'NORMAL', status: 'IN_PROGRESS', dueAt: null, createdByName: 'Testni Korisnik', assigneeName: 'Testni Korisnik',
    formData: {}, formSchemaId: formId, formSchemaVersionId: formVersionId, formSchemaVersion: 3,
    version: 6, assignments: [], events: [], commentCount: 0,
  };
  let completionPayload: Record<string, unknown> | null = null;
  let completionAttempts = 0;
  await mockApi(page, (route) => route.fulfill({ status: 200, json: authResponse({ permissions: ['task:view', 'task:complete'] }) }));
  await page.route('**/api/v1/form-schemas/**', (route) => route.fulfill({ status: 200, json: { data: version, meta: {} } }));
  await page.route('**/api/v1/tasks/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/tasks/${taskId}/complete` && route.request().method() === 'POST') {
      completionPayload = route.request().postDataJSON();
      completionAttempts += 1;
      if (completionAttempts === 1) {
        await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: 'Zadatak je izmijenjen u drugoj sesiji.' } } });
        return;
      }
      task.status = 'COMPLETED';
      task.version = 7;
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}/comments`) {
      await route.fulfill({ status: 200, json: { data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }, meta: {} } });
      return;
    }
    if (url.pathname === `/api/v1/tasks/${taskId}`) {
      await route.fulfill({ status: 200, json: { data: task, meta: {} } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
  });
  await page.goto(`/prijava?next=${encodeURIComponent(`/zadaci/${taskId}`)}`);
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Pregled nakon vožnje' })).toBeVisible();
  await page.getByLabel('Napomena').fill('Sve provjereno.');
  await page.getByLabel('Kilometraža (km), ako je primjenjivo').fill('123456');
  await page.getByLabel('Komentar uz završetak').fill('Vozilo spremno.');
  await page.getByRole('button', { name: 'Završi zadatak' }).click();
  await expect(page.getByRole('alert')).toContainText('Zadatak je izmijenjen u drugoj sesiji.');
  await expect(page.getByLabel('Napomena')).toHaveValue('Sve provjereno.');
  await expect(page.getByLabel('Kilometraža (km), ako je primjenjivo')).toHaveValue('123456');
  await expect(page.getByLabel('Komentar uz završetak')).toHaveValue('Vozilo spremno.');
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Završi zadatak' }).click();
  await expect(page.getByText('Završen', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Zadatak je završen.');
  expect(completionAttempts).toBe(2);
  expect(completionPayload).toMatchObject({ version: 6, formData: { napomena: 'Sve provjereno.' }, comment: 'Vozilo spremno.', odometerKm: 123456 });
  await expectNoA11yViolations(page);
});

test('task detail API failure gives an accessible recovery path instead of a blank detail', async ({ page }) => {
  const taskId = '44444444-4444-4444-8444-444444444444';
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: ['task:view'] }) }),
  );
  await page.route(`**/api/v1/tasks/${taskId}`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Zadatak privremeno nije dostupan.' } },
    }),
  );
  await page.goto(`/prijava?next=${encodeURIComponent(`/zadaci/${taskId}`)}`);
  await submitLogin(page);
  await expect(page.getByRole('heading', { name: 'Zadatak nije dostupan' })).toBeVisible();
  await expect(page.getByText('Zadatak privremeno nije dostupan.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nazad na zadatke' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoA11yViolations(page);
});

test('task detail route is denied before loading task data without task:view', async ({ page }) => {
  const taskId = '44444444-4444-4444-8444-444444444444';
  let taskDataRequests = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: [] }) }),
  );
  await page.route('**/api/v1/tasks/**', async (route) => {
    taskDataRequests += 1;
    await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } } });
  });
  await page.goto(`/prijava?next=${encodeURIComponent(`/zadaci/${taskId}`)}`);
  await submitLogin(page);
  await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Zadatak/ })).toHaveCount(0);
  expect(taskDataRequests).toBe(0);
});

test('role matrix route is denied before loading role data without role:view', async ({ page }) => {
  let roleDataRequests = 0;
  await mockApi(page, (route) =>
    route.fulfill({ status: 200, json: authResponse({ permissions: [] }) }),
  );
  await page.route('**/api/v1/roles**', async (route) => {
    roleDataRequests += 1;
    await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } } });
  });
  await page.goto('/prijava?next=%2Fadministracija%2Fprava');
  await submitLogin(page);
  await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
  expect(roleDataRequests).toBe(0);
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
