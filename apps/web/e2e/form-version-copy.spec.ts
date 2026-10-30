import { expect, test } from '@playwright/test';
import { addDesignerField, openCatalogForm, startFormBuilder } from './form-versioning/session.js';
import { fieldKeysOf } from './form-versioning/form-api-stub.js';

test('FV-COPY: copy → ukloni/dodaj polje → Objavi nije klon prethodne verzije', async ({ page }) => {
  const stub = await startFormBuilder(page, 'published');
  await openCatalogForm(page);

  await expect(page.getByRole('button', { name: 'v1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toHaveCount(0);
  await expect(page.getByText('Napomena', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Ocjena', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Nova verzija' }).click();
  await expect(page.getByText('Kreirana verzija 2 (nacrt).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'v2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toBeVisible();
  expect(stub.lastCopyFromVersionId).toBeTruthy();

  await page.getByRole('button', { name: 'Ukloni Napomena' }).click();
  await expect(page.getByText('Napomena', { exact: true })).toHaveCount(0);
  await addDesignerField(page, 'Inspektor');

  await page.getByLabel('Bilješka o promjeni (obavezna, najmanje 5 znakova)').fill('Uklonjena napomena');
  await page.getByRole('button', { name: 'Objavi…' }).click();
  await expect(page.getByText('Verzija je objavljena; prethodna aktivna je povučena.')).toBeVisible();

  expect(fieldKeysOf(stub.lastPutDefinition).sort()).toEqual(['inspektor', 'ocjena']);
  expect(stub.lastPutDefinition?.sections[0]?.fields.some((item) => item.key === 'napomena')).toBe(false);
  expect(stub.lastPublishNote).toBe('Uklonjena napomena');

  await expect(page.getByRole('button', { name: 'Sačuvaj nacrt' })).toHaveCount(0);
  await expect(page.getByText('Ocjena', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Inspektor', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Napomena', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Objavljena').first()).toBeVisible();
  await expect(page.getByText('Povučena').first()).toBeVisible();
});
