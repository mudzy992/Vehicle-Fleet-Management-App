import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { insuranceRow, vehicleRow } from '../helpers/fixtures.js';

test('INS-EMPTY: nema osiguranja', async ({ page }) => {
  await openApp(page, '/osiguranja');
  await expect(page.getByRole('heading', { name: 'Osiguranja', exact: true })).toBeVisible();
  await expect(page.getByText('Nema osiguranja')).toBeVisible();
});

test('INS-LIST: polisa i paginacija', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/insurances**', async (route) => {
    const pageNo = new URL(route.request().url()).searchParams.get('page') === '2' ? 2 : 1;
    const item = { ...insuranceRow, id: pageNo === 2 ? '66666666-6666-4666-8666-666666666666' : insuranceRow.id, policyNumber: pageNo === 2 ? 'POL-002' : 'POL-001' };
    await route.fulfill({
      status: 200,
      json: envelope({ items: [item], total: 26, totalPages: 2, page: pageNo, pageSize: 25 }),
    });
  });
  await page.route('**/api/v1/vehicles**', (route) =>
    route.fulfill({ status: 200, json: envelope(paged([vehicleRow])) }),
  );
  await loginTo(page, '/osiguranja');
  await expect(page.getByText('POL-001')).toBeVisible();
  await page.getByRole('button', { name: 'Sljedeća' }).click();
  await expect(page.getByText('POL-002')).toBeVisible();
});

test('INS-DENY: bez insurance:view', async ({ page }) => {
  await expectDenied(page, '/osiguranja', 'insurance:view');
});
