import { expect, test } from '@playwright/test';
import { expectDenied, mockSession, openApp } from '../helpers/harness.js';

test('AUTH-GUARD: zaštićena ruta ide na prijavu sa next', async ({ page }) => {
  await mockSession(page);
  await page.goto('/zadaci');
  await expect(page).toHaveURL(/\/prijava\?next=%2Fzadaci$/);
  await expect(page.getByText('Prijava u web aplikaciju')).toBeVisible();
});

test('AUTH-LOGIN: uspješna prijava vodi na traženu rutu', async ({ page }) => {
  await openApp(page, '/nadzorna-tabla');
  await expect(page.getByRole('heading', { name: 'Nadzorna tabla', exact: true })).toBeVisible();
});

test('AUTH-FAIL: pogrešne vjerodajnice ne otkrivaju detalj', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/login')) {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } },
      });
      return;
    }
    await route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'No session' } } });
  });
  await page.goto('/prijava');
  await page.getByLabel('E-mail').fill('audit@example.test');
  await page.getByLabel('Lozinka').fill('wrong');
  await page.getByRole('button', { name: 'Prijavi se' }).click();
  await expect(page.getByText('Pogrešan e-mail ili lozinka.')).toBeVisible();
  await expect(page).toHaveURL(/\/prijava/);
});

test('AUTH-LOGOUT: odjava briše sesiju i vraća na prijavu', async ({ page }) => {
  await openApp(page, '/nadzorna-tabla');
  await page.getByRole('button', { name: 'Odjava' }).click();
  await expect(page).toHaveURL(/\/prijava/);
  await expect(page.getByText('Prijava u web aplikaciju')).toBeVisible();
});

test('AUTH-DENY: vozila bez vehicle:view', async ({ page }) => {
  await expectDenied(page, '/vozila', 'vehicle:view');
});
