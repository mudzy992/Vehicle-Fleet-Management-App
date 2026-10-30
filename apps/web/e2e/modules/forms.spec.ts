import { expect, test } from '@playwright/test';
import { expectDenied, openApp } from '../helpers/harness.js';

test('FORM-EMPTY: katalog formi', async ({ page }) => {
  await openApp(page, '/forme');
  await expect(page.getByRole('heading', { name: 'Forme', exact: true })).toBeVisible();
  await expect(page.getByText('Nema formi')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova forma' })).toBeVisible();
});

test('FORM-DENY: bez form:view', async ({ page }) => {
  await expectDenied(page, '/forme', 'form:view');
});
