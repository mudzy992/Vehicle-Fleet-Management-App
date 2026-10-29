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
  await expectNoA11yViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Potvrdi' }).click();
  await expect(page.getByRole('status')).toContainText('Podsjetnik je potvrđen.');
  await page.getByRole('button', { name: '+7 d' }).click();
  await expect(page.getByRole('status')).toContainText('Podsjetnik je odgođen.');
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
  await page.setViewportSize({ width: 1280, height: 900 });
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
  expect(await page.locator('#root').innerText()).not.toContain('lejla.hadzic@');
  await expectNoA11yViolations(page);

  await page.getByLabel('Pretraga').fill('Nepoznata osoba');
  await expect(page.getByText('Nema korisnika')).toBeVisible();
  await expect.poll(() => requestedSearch).toBe('Nepoznata osoba');
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
