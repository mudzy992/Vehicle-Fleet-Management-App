import { expect, test } from '@playwright/test';
import { envelope, expectDenied, loginTo, openApp, paged, startApp } from '../helpers/harness.js';
import { ID, userRow } from '../helpers/fixtures.js';

test('USER-EMPTY: nema korisnika', async ({ page }) => {
  await openApp(page, '/administracija/korisnici');
  await expect(page.getByLabel('Pretraga')).toBeVisible();
  await expect(page.getByText('Nema korisnika')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novi korisnik' })).toBeVisible();
});

test('USER-CRUD: kreiranje, reset, odjava i arhiva', async ({ page }) => {
  const created: Record<string, unknown>[] = [];
  await startApp(page);
  await page.route('**/api/v1/roles', (route) =>
    route.fulfill({
      status: 200,
      json: envelope([{ id: ID.role, code: 'DISPATCHER', name: 'Dispečer', description: null, isSystem: false }]),
    }),
  );
  await page.route('**/api/v1/users**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'POST' && pathname.endsWith('/users')) {
      created.push(userRow);
      await route.fulfill({
        status: 201,
        json: envelope({
          user: { id: ID.user, email: 'amina@example.test' },
          temporaryPassword: 'ONE-TIME-SECRET-42',
          mustChangePassword: true,
        }),
      });
      return;
    }
    if (pathname.endsWith('/reset-password')) {
      await route.fulfill({
        status: 200,
        json: envelope({ email: 'a***@example.test', token: 'RESET-TOKEN', expiresAt: '2026-10-31T00:00:00.000Z' }),
      });
      return;
    }
    if (pathname.endsWith('/force-logout')) {
      await route.fulfill({ status: 200, json: envelope({ revokedSessions: 2 }) });
      return;
    }
    if (pathname.endsWith('/archive')) {
      created.length = 0;
      await route.fulfill({ status: 200, json: envelope(null) });
      return;
    }
    await route.fulfill({ status: 200, json: envelope(paged(created.length ? created : [userRow])) });
  });
  await loginTo(page, '/administracija/korisnici');
  await expect(page.getByText('Lejla Hadžić')).toBeVisible();
  await page.getByRole('button', { name: 'Novi korisnik' }).click();
  await page.getByLabel('E-mail').fill('amina@example.test');
  await page.getByLabel('Ime', { exact: true }).fill('Amina');
  await page.getByLabel('Prezime', { exact: true }).fill('Kovačević');
  await page.getByLabel('Dispečer').check();
  await page.getByRole('button', { name: 'Kreiraj korisnika' }).click();
  await expect(page.getByText('Privremena lozinka za amina@example.test')).toBeVisible();
  await page.getByRole('button', { name: 'Reset lozinke' }).first().click();
  await expect(page.getByText(/Jednokratni token/)).toBeVisible();
  await page.getByRole('button', { name: 'Odjavi svuda' }).first().click();
  await page.getByRole('button', { name: 'Arhiviraj' }).first().click();
});

test('USER-DENY: bez user:view', async ({ page }) => {
  await expectDenied(page, '/administracija/korisnici', 'user:view');
});
