import { expect, test } from '@playwright/test';
import { openApp } from '../helpers/harness.js';

test('DASH-EMPTY: prazne kolekcije i Nema rokova', async ({ page }) => {
  await openApp(page, '/nadzorna-tabla');
  await expect(page.getByRole('heading', { name: 'Nadzorna tabla', exact: true })).toBeVisible();
  await expect(page.getByText('Nema rokova').first()).toBeVisible();
});
