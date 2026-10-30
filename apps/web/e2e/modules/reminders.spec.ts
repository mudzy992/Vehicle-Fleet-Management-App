import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { reminderRow } from '../helpers/fixtures.js';

test('REM-EMPTY: prazan katalog rokova', async ({ page }) => {
  await openApp(page, '/rokovi');
  await expect(page.getByRole('heading', { name: 'Rokovi', exact: true })).toBeVisible();
  await expect(page.getByText('Nema podsjetnika')).toBeVisible();
});

test('REM-ACTIONS: potvrda, odgoda i skener', async ({ page }) => {
  let acknowledged = false;
  let snoozed = false;
  let scanned = false;
  await startApp(page);
  await page.route('**/api/v1/reminders**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname.endsWith('/acknowledge') && method === 'POST') {
      acknowledged = true;
      await route.fulfill({ status: 200, json: envelope({}) });
      return;
    }
    if (pathname.endsWith('/snooze') && method === 'POST') {
      snoozed = true;
      await route.fulfill({ status: 200, json: envelope({}) });
      return;
    }
    if (pathname.endsWith('/scan') && method === 'POST') {
      scanned = true;
      await route.fulfill({ status: 200, json: envelope({ candidates: 3, created: 1 }) });
      return;
    }
    await route.fulfill({ status: 200, json: envelope(paged([reminderRow])) });
  });
  await loginTo(page, '/rokovi');
  await expect(page.getByText(/120.*km/)).toBeVisible();
  await page.getByRole('button', { name: 'Potvrdi' }).click();
  await expect(page.getByText('Podsjetnik je potvrđen.')).toBeVisible();
  await page.getByRole('button', { name: '+7 d' }).click();
  await expect(page.getByText('Podsjetnik je odgođen.')).toBeVisible();
  await page.getByRole('button', { name: 'Pokreni skener' }).click();
  await expect(page.getByText(/Sken završen/)).toBeVisible();
  expect(acknowledged && snoozed && scanned).toBe(true);
});

test('REM-DENY: bez reminder:view', async ({ page }) => {
  await expectDenied(page, '/rokovi', 'reminder:view');
});
