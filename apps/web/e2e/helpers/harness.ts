import { expect, type Page, type Route } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';

export const ALL_PERMISSIONS = [
  'auth:login', 'auth:manage_sessions',
  'reminder:view', 'reminder:acknowledge', 'reminder:snooze',
  'system:run_maintenance', 'system:view_health',
  'task:view', 'task:create', 'task:claim', 'task:complete',
  'notification:view', 'notification:mark_read', 'notification:manage_preferences',
  'vehicle:view', 'vehicle:create', 'vehicle:update', 'vehicle:archive',
  'driver:view', 'driver:create', 'driver:update', 'driver:archive', 'driver:view_pii',
  'registration:view', 'insurance:view',
  'tire:view', 'tire:create', 'tire:update', 'tire:delete',
  'report:view', 'report:export',
  'task_type:view', 'task_type:create', 'task_type:update', 'task_type:archive',
  'form:view', 'form:create', 'form:update', 'form:manage_schema', 'form:publish_version',
  'user:view', 'user:create', 'user:update', 'user:archive', 'user:reset_password', 'user:force_logout',
  'role:view', 'role:manage_permissions',
  'audit:view', 'audit:view_security',
] as const;

const PAGED = new Set([
  '/vehicles', '/drivers', '/registrations', '/insurances', '/reminders',
  '/tasks', '/tasks/available', '/users', '/tire-sets', '/task-types',
  '/notifications', '/audit-logs', '/reports/vehicles',
]);

export function envelope(data: unknown) {
  return { data, meta: {} };
}

export function paged<T>(items: readonly T[], page = 1, pageSize = 25) {
  return { items, page, pageSize, total: items.length, totalPages: items.length ? 1 : 0 };
}

export function authResponse(options: { permissions?: readonly string[]; isSuperAdmin?: boolean } = {}) {
  const isSuperAdmin = options.isSuperAdmin ?? true;
  return envelope({
    accessToken: 'e2e-memory-only-access-token',
    tokenType: 'Bearer',
    expiresIn: 600,
    refreshExpiresIn: 86_400,
    sessionId: '33333333-3333-4333-8333-333333333333',
    user: {
      id: USER_ID,
      email: 'audit@example.test',
      firstName: 'Testni',
      lastName: 'Korisnik',
      displayName: null,
      status: 'ACTIVE',
      roles: [{ id: ROLE_ID, code: isSuperAdmin ? 'SUPER_ADMIN' : 'TEST', name: 'Test' }],
      permissions: [...(options.permissions ?? ALL_PERMISSIONS)],
      permissionsVersion: 1,
      tokenVersion: 1,
      mustChangePassword: false,
      isSuperAdmin,
      allowedClientTypes: ['WEB'],
      timezone: 'Europe/Sarajevo',
      locale: 'bs-BA',
      lastLoginAt: null,
    },
  });
}

export async function mockSession(
  page: Page,
  options: { permissions?: readonly string[]; isSuperAdmin?: boolean } = {},
): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/login')) {
      await route.fulfill({ status: 200, json: authResponse(options) });
      return;
    }
    if (pathname.endsWith('/auth/refresh')) {
      await route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'No session' } } });
      return;
    }
    if (pathname.endsWith('/auth/logout') || pathname.endsWith('/auth/logout-all')) {
      await route.fulfill({ status: 200, json: envelope(null) });
      return;
    }
    if (pathname.endsWith('/auth/sessions')) {
      await route.fulfill({ status: 200, json: envelope([]) });
      return;
    }
    if (pathname.endsWith('/notifications/stream')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ':\n\n' });
      return;
    }
    if (pathname.endsWith('/notifications/unread-count')) {
      await route.fulfill({ status: 200, json: envelope({ count: 0 }) });
      return;
    }
    if (pathname.endsWith('/roles') || pathname.endsWith('/form-schemas') || pathname.endsWith('/reports')) {
      await route.fulfill({ status: 200, json: envelope([]) });
      return;
    }
    const rest = pathname.replace(/^\/api\/v1/u, '');
    if (PAGED.has(rest)) {
      await route.fulfill({ status: 200, json: envelope(paged([])) });
      return;
    }
    await route.fulfill({ status: 200, json: envelope({}) });
  });
}

export async function startApp(
  page: Page,
  options: { permissions?: readonly string[]; isSuperAdmin?: boolean; width?: number } = {},
): Promise<void> {
  await page.setViewportSize({ width: options.width ?? 1280, height: 900 });
  await mockSession(page, options);
}

export async function loginTo(page: Page, path: string): Promise<void> {
  await page.goto(`/prijava?next=${encodeURIComponent(path)}`);
  await page.getByLabel('E-mail').fill('audit@example.test');
  await page.getByLabel('Lozinka').fill('not-a-real-secret');
  await page.getByRole('button', { name: 'Prijavi se' }).click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}(?:\\?|$)`, 'u'));
}

export async function openApp(
  page: Page,
  path: string,
  options: { permissions?: readonly string[]; isSuperAdmin?: boolean; width?: number } = {},
): Promise<void> {
  await startApp(page, options);
  await loginTo(page, path);
}

export async function expectDenied(page: Page, path: string, permission: string): Promise<void> {
  await openApp(page, path, { permissions: ['auth:login'], isSuperAdmin: false });
  await expect(page.getByText('Nemate pristup', { exact: true })).toBeVisible();
  await expect(page.getByText(permission)).toBeVisible();
}
