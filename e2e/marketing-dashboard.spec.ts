import { expect, test } from '@playwright/test';

for (const path of ['/', '/dashboard']) {
  test(`${path} opens the agency workspace without a variant switcher`, async ({ page }) => {
    if (path === '/dashboard') {
      await page.addInitScript(() => localStorage.setItem('worldmonitor-variant', 'tech'));
    }

    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Client roster' })).toBeVisible();
    await expect(page.locator('.variant-switcher, .variant-option')).toHaveCount(0);
  });
}

test('restores the selected client and keeps each daily brief with its client', async ({ page }) => {
  await page.route('**/api/agency-headlines', route => route.fulfill({ json: { items: [] } }));
  await page.goto('/');
  const brief = page.getByRole('textbox', { name: 'Daily brief' });
  const clients = [
    { name: 'Aster Agency', brief: 'Review the search campaign.' },
    { name: 'Birch Studio', brief: 'Prepare the summer launch.' },
  ];
  for (const client of clients) {
    await page.getByLabel('New client').fill(client.name);
    await page.getByRole('button', { name: 'Add client' }).click();
    await expect(brief).toHaveValue('');
    await brief.fill(client.brief);
  }

  const firstClient = page.getByRole('button', { name: clients[0].name });
  await firstClient.click();
  await page.goto('/dashboard');
  await expect(firstClient).toHaveAttribute('aria-pressed', 'true');
  await expect(brief).toHaveValue(clients[0].brief);
  await page.getByRole('button', { name: clients[1].name }).click();
  await expect(brief).toHaveValue(clients[1].brief);
});
