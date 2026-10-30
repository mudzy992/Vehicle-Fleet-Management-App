import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { tireRow } from '../helpers/fixtures.js';

test('TIRE-EMPTY: evidencija kompleta prazna', async ({ page }) => {
  await openApp(page, '/gume');
  await expect(page.getByRole('heading', { name: 'Kompleti guma', exact: true })).toBeVisible();
  await expect(page.getByText('Evidencija kompleta je prazna')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novi komplet' })).toBeVisible();
});

test('TIRE-LIST: filter sezone i brisanje kompleta', async ({ page }) => {
  let season = '';
  let deleted = false;
  await startApp(page);
  await page.route('**/api/v1/tire-sets**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'DELETE') {
      deleted = true;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    season = url.searchParams.get('season') ?? '';
    const items = deleted || season === 'WINTER' ? [] : [tireRow];
    await route.fulfill({ status: 200, json: envelope(paged(items)) });
  });
  await loginTo(page, '/gume');
  await expect(page.getByText('G-Z-021')).toBeVisible();
  await page.getByRole('button', { name: 'Obriši komplet G-Z-021' }).click();
  await page.getByRole('button', { name: 'Obriši komplet', exact: true }).click();
  await expect(page.getByText(/Komplet G-Z-021 je obrisan/)).toBeVisible();
  await page.getByLabel('Sezona').selectOption('WINTER');
  await expect.poll(() => season).toBe('WINTER');
  await expect(page.getByText('Nema kompleta za odabrane filtere')).toBeVisible();
});

test('TIRE-DENY: bez tire:view', async ({ page }) => {
  await expectDenied(page, '/gume', 'tire:view');
});
