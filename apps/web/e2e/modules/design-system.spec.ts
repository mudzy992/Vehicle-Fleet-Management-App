import { expect, test } from '@playwright/test';
import { openApp } from '../helpers/harness.js';

test('DS-VIEW: showcase dizajn sistema', async ({ page }) => {
  await openApp(page, '/dizajn-sistem');
  await expect(page.getByRole('heading', { name: 'Dizajn sistem', exact: true })).toBeVisible();
});
