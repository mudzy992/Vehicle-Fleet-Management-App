import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { registrationRow, vehicleRow } from '../helpers/fixtures.js';

test('REG-EMPTY: nema registracija', async ({ page }) => {
  await openApp(page, '/registracije');
  await expect(page.getByRole('heading', { name: 'Registracije', exact: true })).toBeVisible();
  await expect(page.getByText('Nema registracije')).toBeVisible();
});

test('REG-LIST: zapis i filter vozila', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/registrations**', (route) =>
    route.fulfill({ status: 200, json: envelope(paged([registrationRow])) }),
  );
  await page.route('**/api/v1/vehicles**', (route) =>
    route.fulfill({ status: 200, json: envelope(paged([vehicleRow])) }),
  );
  await loginTo(page, '/registracije');
  await expect(page.getByText('E12-M-345')).toBeVisible();
  await expect(page.getByRole('link', { name: /V-014/ })).toBeVisible();
});

test('REG-DENY: bez registration:view', async ({ page }) => {
  await expectDenied(page, '/registracije', 'registration:view');
});
