import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { taskRow } from '../helpers/fixtures.js';

test('TASK-EMPTY: nema slobodnih zadataka', async ({ page }) => {
  await openApp(page, '/zadaci');
  await expect(page.getByRole('heading', { name: 'Zadaci', exact: true })).toBeVisible();
  await expect(page.getByText('Nema zadataka za prikaz')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Novi zadatak' })).toBeVisible();
});

test('TASK-CLAIM: preuzimanje sa liste slobodnih', async ({ page }) => {
  let claimed = false;
  await startApp(page);
  await page.route('**/api/v1/tasks**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith(`/tasks/${taskRow.id}/claim`)) {
      claimed = true;
      await route.fulfill({
        status: 200,
        json: envelope({ ...taskRow, status: 'IN_PROGRESS', assigneeName: 'Testni Korisnik' }),
      });
      return;
    }
    if (pathname.endsWith('/tasks/available')) {
      await route.fulfill({ status: 200, json: envelope(paged(claimed ? [] : [taskRow])) });
      return;
    }
    await route.fulfill({ status: 200, json: envelope(paged([])) });
  });
  await loginTo(page, '/zadaci');
  await expect(page.getByText('Pregled kočnica')).toBeVisible();
  await page.getByRole('button', { name: 'Preuzmi' }).click();
  await expect(page.getByText('Preuzeli ste zadatak Z-2026-000007.')).toBeVisible();
  await expect(page.getByText('Nema zadataka za prikaz')).toBeVisible();
  await page.getByRole('tab', { name: 'Moji' }).click();
  await expect(page.getByRole('tab', { name: 'Moji' })).toHaveAttribute('aria-selected', 'true');
});

test('TASK-CREATE: čarobnjak zahtijeva aktivnu vrstu', async ({ page }) => {
  await openApp(page, '/zadaci/novi');
  await expect(page.getByText('Nema aktivnih vrsta')).toBeVisible();
});

test('TASK-DENY: bez task:view', async ({ page }) => {
  await expectDenied(page, '/zadaci', 'task:view');
});
