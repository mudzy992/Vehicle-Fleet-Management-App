import { expect, test } from '@playwright/test';
import { expectDenied, loginTo, startApp } from '../helpers/harness.js';

test('HEALTH-OK: probe su zelene', async ({ page }) => {
  await startApp(page);
  await page.route('**/health/live', (route) => route.fulfill({ status: 200, json: { status: 'ok' } }));
  await page.route('**/health/ready', (route) =>
    route.fulfill({ status: 200, json: { status: 'ok', info: { database: { status: 'up' } } } }),
  );
  await page.route('**/health/startup', (route) =>
    route.fulfill({ status: 200, json: { status: 'ok', uptimeSeconds: 240 } }),
  );
  await loginTo(page, '/zdravlje');
  await expect(page.getByRole('heading', { name: 'Zdravlje sistema', exact: true })).toBeVisible();
  await expect(page.getByText('ok', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Provjeri ponovo' }).click();
  await expect(page.getByText('ok', { exact: true })).toHaveCount(3);
});

test('HEALTH-DOWN: nestanak API-ja i retry', async ({ page }) => {
  let down = true;
  await startApp(page);
  for (const path of ['/health/live', '/health/ready', '/health/startup']) {
    await page.route(`**${path}`, async (route) => {
      if (down) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: 200, json: { status: 'ok' } });
    });
  }
  await loginTo(page, '/zdravlje');
  await expect(page.getByRole('heading', { name: 'API nije dostupan' })).toBeVisible();
  down = false;
  await page.getByRole('button', { name: 'Pokušaj ponovo' }).click();
  await expect(page.getByText('ok', { exact: true })).toHaveCount(3);
});

test('HEALTH-DENY: bez system:view_health', async ({ page }) => {
  await expectDenied(page, '/zdravlje', 'system:view_health');
});
