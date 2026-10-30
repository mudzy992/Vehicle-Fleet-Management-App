import { expect, type Page, type Route } from '@playwright/test';
import { createFormApiStub, mountFormApi, type FormApiStub } from './form-api-stub.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';

export const FORM_PERMISSIONS = [
  'form:view',
  'form:create',
  'form:update',
  'form:manage_schema',
  'form:publish_version',
  'form:retire_version',
] as const;

export function formAuthResponse() {
  return {
    data: {
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
        roles: [{ id: ROLE_ID, code: 'SUPER_ADMIN', name: 'Super Admin' }],
        permissions: [...FORM_PERMISSIONS],
        permissionsVersion: 1,
        tokenVersion: 1,
        mustChangePassword: false,
        isSuperAdmin: true,
        allowedClientTypes: ['WEB'],
        timezone: 'Europe/Sarajevo',
        locale: 'bs-BA',
        lastLoginAt: null,
      },
    },
    meta: { requestId: 'e2e-form', timestamp: '2026-01-01T00:00:00.000Z' },
  };
}

export async function mockSession(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/login')) {
      await route.fulfill({ status: 200, json: formAuthResponse() });
      return;
    }
    if (pathname.endsWith('/auth/refresh')) {
      await route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'No session' } } });
      return;
    }
    if (pathname.endsWith('/auth/logout')) {
      await route.fulfill({ status: 200, json: { data: null, meta: {} } });
      return;
    }
    await route.fulfill({ status: 200, json: { data: {}, meta: {} } });
  });
}

export async function openFormsBuilder(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/prijava?next=%2Fforme');
  await page.getByLabel('E-mail').fill('audit@example.test');
  await page.getByLabel('Lozinka').fill('not-a-real-secret');
  await page.getByRole('button', { name: 'Prijavi se' }).click();
  await expect(page).toHaveURL(/\/forme$/);
  await expect(page.getByRole('heading', { name: 'Forme', exact: true })).toBeVisible({ timeout: 15_000 });
}

export async function startFormBuilder(
  page: Page,
  start: 'empty' | 'draft' | 'published',
): Promise<FormApiStub> {
  const stub = createFormApiStub(start);
  await mockSession(page);
  await mountFormApi(page, stub);
  await openFormsBuilder(page);
  return stub;
}

export async function openCatalogForm(page: Page, name = 'Pregled vozila'): Promise<void> {
  await page.getByRole('button', { name: new RegExp(name, 'u') }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^v\d+$/u }).first().click();
  await expect(page.getByLabel('Naslov')).toBeVisible();
}

export async function addDesignerField(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Dodaj polje' }).click();
  await page.getByLabel('Naziv polja').fill(label);
  await page.getByRole('button', { name: 'Sačuvaj polje' }).click();
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
}
