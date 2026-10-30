import { expect, test } from '@playwright/test';
import { openCatalogForm, startFormBuilder } from './form-versioning/session.js';

test('FV-IMMUTABLE: objavljena verzija nema uređivanje ni brisanje', async ({ page }) => {
  const stub = await startFormBuilder(page, 'published');
  await openCatalogForm(page);
  await expect(page.getByText('Verzija je nepromjenjiva — izmjena ide kroz novu verziju.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Obriši nacrt' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Objavi…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova verzija' })).toBeVisible();
  await expect(page.getByLabel('Naslov')).toBeDisabled();
  expect(stub.publishedPuts).toBe(0);
});

test('FV-DELETE: brisanje nacrta uklanja verziju iz kataloga', async ({ page }) => {
  await startFormBuilder(page, 'draft');
  await openCatalogForm(page);
  await expect(page.getByRole('button', { name: 'v1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Obriši nacrt' }).click();
  await expect(page.getByRole('button', { name: 'v1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toHaveCount(0);
});

test('FV-NOTE: kratka bilješka odbija objavu (VALIDATION_ERROR)', async ({ page }) => {
  const stub = await startFormBuilder(page, 'draft');
  await openCatalogForm(page);
  await page.getByLabel('Bilješka o promjeni (obavezna, najmanje 5 znakova)').fill('abc');
  await page.getByRole('button', { name: 'Objavi…' }).click();
  await expect(page.getByText('Bilješka je obavezna')).toBeVisible();
  expect(stub.lastPublishNote).toBe('abc');
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toBeVisible();
});

test('FV-COMPARE: diff nakon kopije pokazuje uklonjeno polje', async ({ page }) => {
  await startFormBuilder(page, 'published');
  await openCatalogForm(page);
  await page.getByRole('button', { name: 'Nova verzija' }).click();
  await expect(page.getByText('Kreirana verzija 2 (nacrt).')).toBeVisible();
  await page.getByRole('button', { name: 'Ukloni Napomena' }).click();
  await page.getByRole('button', { name: 'Sačuvaj nacrt' }).click();
  await expect(page.getByText('Nacrt je sačuvan.')).toBeVisible();
  await page.getByRole('button', { name: 'Uporedi s prethodnom' }).click();
  await expect(page.getByText('Diff v1 → v2')).toBeVisible();
  await expect(page.getByText('− polje napomena')).toBeVisible();
});
