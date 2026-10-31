import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, startApp } from '../helpers/harness.js';
import { roleMatrix } from '../helpers/fixtures.js';

test('ROLE-READ: matrica je čitljiva', async ({ page }) => {
  await startApp(page, { permissions: ['role:view'], isSuperAdmin: false });
  await page.route('**/api/v1/roles/matrix', (route) =>
    route.fulfill({ status: 200, json: envelope(roleMatrix) }),
  );
  await loginTo(page, '/administracija/prava');
  await expect(page.getByText('Matrica prava (1 permisija)')).toBeVisible();
  await expect(page.getByLabel('Dispečer → vehicle:view')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sačuvaj matricu' })).toBeDisabled();
});

test('ROLE-SAVE: izmjena opsega i čuvanje', async ({ page }) => {
  let saved = false;
  await startApp(page);
  await page.route('**/api/v1/roles/matrix', async (route) => {
    if (route.request().method() === 'PUT') {
      saved = true;
      await route.fulfill({
        status: 200,
        json: envelope({ affectedRoles: 1, added: 0, removed: 0, scopeChanged: 1, permissionsVersion: { DISPATCHER: 2 } }),
      });
      return;
    }
    await route.fulfill({ status: 200, json: envelope(roleMatrix) });
  });
  await loginTo(page, '/administracija/prava');
  await page.getByLabel('Dispečer → vehicle:view').selectOption('OWN');
  await expect(page.getByText('Nesačuvane izmjene')).toBeVisible();
  await page.getByRole('button', { name: 'Sačuvaj matricu' }).click();
  await expect(page.getByText(/Sačuvano: 1 rola/)).toBeVisible();
  expect(saved).toBe(true);
});

test('ROLE-DENY: bez role:view', async ({ page }) => {
  await expectDenied(page, '/administracija/prava', 'role:view');
});
