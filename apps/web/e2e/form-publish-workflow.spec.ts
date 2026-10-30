import { expect, test } from '@playwright/test';
import { addDesignerField, startFormBuilder } from './form-versioning/session.js';
import { fieldKeysOf } from './form-versioning/form-api-stub.js';

test('FV-P9: kreira nacrt, validira, pregleda i objavljuje s bilješkom', async ({ page }) => {
  const stub = await startFormBuilder(page, 'empty');

  await page.getByRole('button', { name: 'Nova forma' }).click();
  await page.getByLabel('Naziv forme').fill('Pregled vozila');
  await page.getByLabel('Predmet forme').selectOption('VEHICLE');
  await page.getByRole('button', { name: 'Kreiraj nacrt' }).click();
  await expect(page.getByRole('heading', { name: 'Pregled vozila', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'v1', exact: true }).click();
  await expect(page.getByLabel('Naslov')).toHaveValue('Pregled vozila');
  await expect(page.getByText('Napomena', { exact: true }).first()).toBeVisible();
  await expect(page.locator('ul[role="alert"]')).toHaveCount(0);

  await addDesignerField(page, 'Inspektor');
  await page.getByRole('button', { name: 'Sačuvaj nacrt' }).click();
  await expect(page.getByText('Nacrt je sačuvan.')).toBeVisible();
  expect(fieldKeysOf(stub.lastPutDefinition)).toEqual(['napomena', 'inspektor']);

  await page.getByRole('tab', { name: 'Pregled' }).click();
  await expect(page.getByText('Pregled:')).toBeVisible();
  await expect(page.getByLabel('Napomena')).toBeVisible();
  await expect(page.getByLabel('Inspektor')).toBeVisible();
  await page.getByRole('tab', { name: 'Dizajn' }).click();

  await page.getByRole('button', { name: 'Objavi…' }).click();
  await expect(page.getByText('Bilješka je obavezna')).toBeVisible();

  await page.getByLabel('Bilješka o promjeni (obavezna, najmanje 5 znakova)').fill('Prva objava forme');
  await page.getByRole('button', { name: 'Objavi…' }).click();
  await expect(page.getByText('Verzija je objavljena; prethodna aktivna je povučena.')).toBeVisible();
  expect(stub.lastPublishNote).toBe('Prva objava forme');
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Objavi…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova verzija' })).toBeVisible();
  await expect(page.getByText('Verzija je nepromjenjiva', { exact: false })).toBeVisible();
});
