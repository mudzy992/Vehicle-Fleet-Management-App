import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { vehicleRow } from '../helpers/fixtures.js';

test('VEH-EMPTY: prazan registar', async ({ page }) => {
  await openApp(page, '/vozila');
  await expect(page.getByRole('heading', { name: 'Vozila', exact: true })).toBeVisible();
  await expect(page.getByText('Registar je prazan')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Novo vozilo' })).toBeVisible();
});

test('VEH-LIST: pretraga i arhiviranje odabranog', async ({ page }) => {
  let query = '';
  let archived = false;
  await startApp(page);
  await page.route('**/api/v1/vehicles**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith('/archive') && method === 'POST') {
      archived = true;
      await route.fulfill({ status: 200, json: envelope(null) });
      return;
    }
    query = url.searchParams.get('q') ?? '';
    const items = archived || query ? [] : [vehicleRow];
    await route.fulfill({ status: 200, json: envelope(paged(items)) });
  });
  await loginTo(page, '/vozila');
  await expect(page.getByRole('link', { name: 'V-014', exact: true })).toBeVisible();
  await page.getByLabel(`Odaberi ${vehicleRow.internalNo}`).check();
  await page.getByRole('button', { name: /Arhiviraj odabrano/ }).click();
  await expect(page.getByText(/Arhivirano 1\/1/)).toBeVisible();
  await page.getByLabel('Pretraga').fill('NEMA');
  await expect.poll(() => query).toBe('NEMA');
  await expect(page.getByText('Nema rezultata za filtere')).toBeVisible();
});

test('VEH-CREATE: forma novog vozila', async ({ page }) => {
  await openApp(page, '/vozila/novo');
  await expect(page.getByRole('heading', { name: 'Novo vozilo', exact: true })).toBeVisible();
});

test('VEH-DENY: bez vehicle:view', async ({ page }) => {
  await expectDenied(page, '/vozila', 'vehicle:view');
});
