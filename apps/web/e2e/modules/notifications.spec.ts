import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { notificationRow } from '../helpers/fixtures.js';

test('NOTIF-EMPTY: prazan inbox', async ({ page }) => {
  await openApp(page, '/obavijesti');
  await expect(page.getByRole('heading', { name: 'Obavijesti', exact: true })).toBeVisible();
  await expect(page.getByText('Još nema obavijesti')).toBeVisible();
});

test('NOTIF-READ: označi pročitano i otvori postavke', async ({ page }) => {
  const item = { ...notificationRow };
  await startApp(page);
  await page.route('**/api/v1/notifications**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/notifications/stream')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'id: e2e-1\nevent: unread-count\ndata: {"count":1}\n\n',
      });
      return;
    }
    if (pathname.endsWith('/notifications/unread-count')) {
      await route.fulfill({ status: 200, json: envelope({ count: item.isRead ? 0 : 1 }) });
      return;
    }
    if (pathname.endsWith('/notifications/preferences')) {
      await route.fulfill({ status: 200, json: envelope({ items: [] }) });
      return;
    }
    if (pathname.endsWith(`/notifications/${item.id}/read`)) {
      item.isRead = true;
      item.status = 'READ';
      await route.fulfill({ status: 200, json: envelope({ ...item, readAt: '2026-10-30T10:01:00.000Z' }) });
      return;
    }
    await route.fulfill({ status: 200, json: envelope(paged([item])) });
  });
  await loginTo(page, '/obavijesti');
  await expect(page.getByRole('heading', { name: 'Novi zadatak' })).toBeVisible();
  await page.getByRole('button', { name: 'Označi pročitano' }).click();
  await expect(page.getByRole('article', { name: /pročitano$/u })).toBeVisible();
  await page.getByRole('button', { name: 'Postavke' }).click();
  await expect(page.getByRole('dialog', { name: 'Postavke obavijesti' })).toBeVisible();
});

test('NOTIF-DENY: bez notification:view', async ({ page }) => {
  await expectDenied(page, '/obavijesti', 'notification:view');
});
