import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { auditRow, ID } from '../helpers/fixtures.js';

test('AUDIT-EMPTY: nema zapisa', async ({ page }) => {
  await openApp(page, '/audit-log');
  await expect(page.getByText('Nema zapisa')).toBeVisible();
});

test('AUDIT-DETAIL: filter i lazy detalj', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/audit-logs**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/audit-logs/${ID.audit}`)) {
      await route.fulfill({
        status: 200,
        json: envelope({ ...auditRow, before: { role: 'Viewer' }, after: { role: 'Dispatcher' }, metadata: null, reason: null, requestId: 'e2e', ipAddress: null, userAgent: null, clientType: 'WEB' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: envelope({ ...paged([auditRow]), securityHidden: true }),
    });
  });
  await loginTo(page, '/audit-log');
  await expect(page.getByRole('cell', { name: 'ROLE_CHANGE' })).toBeVisible();
  await expect(page.getByText(/Sigurnosni zapisi/)).toBeVisible();
  await page.getByRole('button', { name: 'Detalj' }).click();
  await expect(page.getByText(`Detalj zapisa #${ID.audit}`)).toBeVisible();
  await expect(page.getByText('Dispatcher')).toBeVisible();
});

test('AUDIT-DENY: bez audit:view', async ({ page }) => {
  await expectDenied(page, '/audit-log', 'audit:view');
});
