import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, startApp } from '../helpers/harness.js';

const catalog = {
  items: [
    { code: 'fleet-overview', title: 'Pregled flote', description: 'Status vozila', category: 'fleet' },
  ],
};
const report = {
  code: 'fleet-overview',
  title: 'Pregled flote',
  columns: ['Vozilo', 'Status'],
  rows: [['V-014', 'ACTIVE']],
};

test('REP-EMPTY: katalog bez redova', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/reports', (route) =>
    route.fulfill({ status: 200, json: envelope({ items: catalog.items }) }),
  );
  await page.route('**/api/v1/reports/vehicles**', (route) =>
    route.fulfill({ status: 200, json: envelope({ items: [] }) }),
  );
  await page.route('**/api/v1/reports/fleet-overview**', (route) =>
    route.fulfill({ status: 200, json: envelope({ ...report, rows: [] }) }),
  );
  await loginTo(page, '/izvjestaji');
  await expect(page.getByRole('heading', { name: 'Izvještaji', exact: true })).toBeVisible();
  await expect(page.getByText('Nema podataka za odabrane filtere.')).toBeVisible();
});

test('REP-EXPORT: CSV preuzimanje uz report:export', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/reports', (route) =>
    route.fulfill({ status: 200, json: envelope({ items: catalog.items }) }),
  );
  await page.route('**/api/v1/reports/vehicles**', (route) =>
    route.fulfill({ status: 200, json: envelope({ items: [] }) }),
  );
  await page.route('**/api/v1/reports/fleet-overview**', (route) =>
    route.fulfill({ status: 200, json: envelope(report) }),
  );
  await page.route('**/api/v1/reports/fleet-overview/export**', (route) =>
    route.fulfill({ status: 200, json: envelope(report) }),
  );
  await loginTo(page, '/izvjestaji');
  await expect(page.getByText('V-014')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Preuzmi CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/fleet-overview/u);
});

test('REP-DENY: bez report:view', async ({ page }) => {
  await expectDenied(page, '/izvjestaji', 'report:view');
});
