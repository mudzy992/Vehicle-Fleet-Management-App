import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { driverRow } from '../helpers/fixtures.js';

test('DRV-EMPTY: prazan registar vozača', async ({ page }) => {
  await openApp(page, '/vozaci');
  await expect(page.getByRole('heading', { name: 'Vozači', exact: true })).toBeVisible();
  await expect(page.getByText('Registar je prazan')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Novi vozač' })).toBeVisible();
});

test('DRV-LIST: lista, pretraga i arhiviranje', async ({ page }) => {
  let query = '';
  let archived = false;
  await startApp(page);
  await page.route('**/api/v1/drivers**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/archive') && route.request().method() === 'POST') {
      archived = true;
      await route.fulfill({ status: 200, json: envelope(null) });
      return;
    }
    query = url.searchParams.get('q') ?? '';
    const items = archived || query ? [] : [driverRow];
    await route.fulfill({ status: 200, json: envelope(paged(items)) });
  });
  await loginTo(page, '/vozaci');
  await expect(page.getByRole('link', { name: 'Karić Aida', exact: true })).toBeVisible();
  await page.getByLabel('Odaberi Aida Karić').check();
  await page.getByRole('button', { name: /Arhiviraj odabrano/ }).click();
  await expect(page.getByText(/Arhivirano/)).toBeVisible();
  await page.getByLabel('Pretraga').fill('XYZ');
  await expect.poll(() => query).toBe('XYZ');
  await expect(page.getByText('Nema rezultata za filtere')).toBeVisible();
});

test('DRV-CREATE: forma novog vozača', async ({ page }) => {
  await openApp(page, '/vozaci/novi');
  await expect(page.getByRole('heading', { name: 'Novi vozač', exact: true })).toBeVisible();
});

test('DRV-DENY: bez driver:view', async ({ page }) => {
  await expectDenied(page, '/vozaci', 'driver:view');
});
