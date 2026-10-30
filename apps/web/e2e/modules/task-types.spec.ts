import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { taskTypeRow } from '../helpers/fixtures.js';

test('TT-EMPTY: nema konfigurisanih vrsta', async ({ page }) => {
  await openApp(page, '/vrste-zadataka');
  await expect(page.getByRole('heading', { name: 'Vrste zadataka', exact: true })).toBeVisible();
  await expect(page.getByText('Nema konfigurisanih vrsta zadataka')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova vrsta' })).toBeVisible();
});

test('TT-ARCHIVE: arhiviranje vrste', async ({ page }) => {
  let archived = false;
  await startApp(page);
  await page.route('**/api/v1/task-types**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/archive') && route.request().method() === 'POST') {
      archived = true;
      await route.fulfill({ status: 200, json: envelope({}) });
      return;
    }
    await route.fulfill({ status: 200, json: envelope(paged(archived ? [] : [taskTypeRow])) });
  });
  await loginTo(page, '/vrste-zadataka');
  await expect(page.getByText('Zamjena ulja i filtera')).toBeVisible();
  await page.getByRole('button', { name: `Arhiviraj vrstu ${taskTypeRow.code}` }).click();
  await page.getByRole('button', { name: 'Arhiviraj vrstu', exact: true }).click();
  await expect(page.getByText(`Vrsta zadatka ${taskTypeRow.code} (${taskTypeRow.name}) je arhivirana.`)).toBeVisible();
  expect(archived).toBe(true);
});

test('TT-DENY: bez task_type:view', async ({ page }) => {
  await expectDenied(page, '/vrste-zadataka', 'task_type:view');
});
