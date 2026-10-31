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

test('TASK-DETAIL: nalog je read-only blok s labelama', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith(`/tasks/${taskRow.id}`)) {
      await route.fulfill({
        status: 200,
        json: envelope({
          ...taskRow,
          formSchemaId: '301',
          formSchemaVersionId: '302',
          formSchemaName: 'Pranje',
          formSchemaVersion: 1,
          orderFormData: { washType: 'FULL' },
          formData: { washType: 'FULL' },
          assignments: [],
          events: [],
          attachmentIds: [],
          commentCount: 0,
        }),
      });
      return;
    }
    if (pathname.includes('/form-schemas/')) {
      await route.fulfill({
        status: 200,
        json: envelope({
          id: '302',
          formSchemaId: '301',
          version: 1,
          definition: {
            $schema: 'vfm-form/1',
            meta: { title: 'Nalog', subject: 'TASK' },
            sections: [
              {
                key: 'osnovno',
                title: 'Osnovno',
                order: 1,
                fields: [{ key: 'washType', type: 'TEXT', label: 'Vrsta pranja', order: 1 }],
              },
            ],
          },
        }),
      });
      return;
    }
    if (pathname.includes('/tasks')) {
      await route.fulfill({ status: 200, json: envelope(paged([])) });
      return;
    }
    await route.fallback();
  });
  await loginTo(page, `/zadaci/${taskRow.id}`);
  await expect(page.getByRole('heading', { name: 'Nalog' }).or(page.getByText('Nalog'))).toBeVisible();
  await expect(page.getByText('Vrsta pranja')).toBeVisible();
});

test('TASK-LINKED: complete servisa vodi na evidenciju vozila', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith(`/tasks/${taskRow.id}`)) {
      await route.fulfill({
        status: 200,
        json: envelope({
          ...taskRow,
          status: 'COMPLETED',
          formSchemaName: 'Servis',
          formSchemaVersion: 1,
          formSchemaId: '301',
          formSchemaVersionId: '302',
          orderFormData: {},
          formData: {},
          linkedRecordType: 'SERVICE',
          linkedRecordId: '77777777-7777-4777-8777-777777777777',
          vehicleId: '55555555-5555-4555-8555-555555555555',
          assignments: [],
          events: [],
          attachmentIds: [],
          commentCount: 0,
        }),
      });
      return;
    }
    await route.fallback();
  });
  await loginTo(page, `/zadaci/${taskRow.id}`);
  await expect(page.getByText('Povezana evidencija:')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Servisni zapis' })).toBeVisible();
});

test('TASK-CREATE: čarobnjak zahtijeva aktivnu vrstu', async ({ page }) => {
  await openApp(page, '/zadaci/novi');
  await expect(page.getByText('Nema aktivnih vrsta')).toBeVisible();
});

test('TASK-DENY: bez task:view', async ({ page }) => {
  await expectDenied(page, '/zadaci', 'task:view');
});
