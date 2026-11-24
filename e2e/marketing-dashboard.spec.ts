import { expect, test } from '@playwright/test';

for (const profile of ['fresh', 'returning'] as const) {
  test(`${profile} visitor lands on the agency dashboard without a variant switcher`, async ({ page }) => {
    if (profile === 'returning') {
      await page.addInitScript(() => localStorage.setItem('worldmonitor-variant', 'tech'));
    }

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true', { timeout: 45_000 });
    await expect(page.locator('html')).toHaveAttribute('data-variant', 'marketing');
    await expect(page.locator('#panelsGrid [data-panel="client-roster"]')).toBeVisible();
    await expect(page.locator('.variant-switcher, .variant-option')).toHaveCount(0);
  });
}
