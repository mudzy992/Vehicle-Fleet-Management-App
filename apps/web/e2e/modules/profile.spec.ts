import { expect, test } from '@playwright/test';
import { envelope, loginTo, openApp, startApp } from '../helpers/harness.js';

test('PROF-VIEW: nalog i prazne sesije', async ({ page }) => {
  await openApp(page, '/profil');
  await expect(page.getByRole('heading', { name: 'Profil', exact: true })).toBeVisible();
  await expect(page.getByText('audit@example.test')).toBeVisible();
  await expect(page.getByText('Nema aktivnih sesija')).toBeVisible();
});

test('PROF-PASSWORD: promjena lozinke odjavljuje', async ({ page }) => {
  await startApp(page);
  await page.route('**/api/v1/auth/change-password', (route) =>
    route.fulfill({ status: 200, json: envelope(null) }),
  );
  await loginTo(page, '/profil');
  await page.getByLabel('Trenutna lozinka').fill('not-a-real-secret');
  await page.getByLabel('Nova lozinka').fill('NovaLozinka12!');
  await page.getByLabel('Potvrda nove lozinke').fill('NovaLozinka12!');
  await page.getByRole('button', { name: 'Promijeni lozinku' }).click();
  await expect(page).toHaveURL(/\/prijava/);
});

test('PROF-LOGOUT-ALL: odjava svih uređaja', async ({ page }) => {
  await openApp(page, '/profil');
  await page.getByRole('button', { name: 'Odjavi sve uređaje' }).click();
  await expect(page).toHaveURL(/\/prijava/);
});
