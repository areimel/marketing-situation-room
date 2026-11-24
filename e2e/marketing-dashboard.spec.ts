import { expect, test } from '@playwright/test';

for (const path of ['/', '/dashboard']) {
  test(`${path} opens the agency workspace without a variant switcher`, async ({ page }) => {
    if (path === '/dashboard') {
      await page.addInitScript(() => localStorage.setItem('worldmonitor-variant', 'tech'));
    }

    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByText(/client/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /brief/i }).first()).toBeVisible();
    await expect(page.locator('.variant-switcher, .variant-option')).toHaveCount(0);
  });
}
