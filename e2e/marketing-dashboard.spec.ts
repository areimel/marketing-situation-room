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
  await page.route('**/api/agency-headlines', route => route.fulfill({ contentType: 'application/rss+xml', body: '<rss><channel/></rss>' }));
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

test('competitor evidence stays with its client through reload and removal', async ({ page }) => {
  await page.goto('/');
  async function addClient(name: string) {
    await page.getByLabel('New client').fill(name);
    await page.getByRole('button', { name: 'Add client' }).click();
  }
  await addClient('Maple');
  await page.getByLabel('Competitor or brand').fill('Elm');
  await page.getByLabel('Source URL').fill('https://example.org/pricing');
  await page.getByLabel('Observed change').fill('Introduced a starter plan');
  await page.getByRole('button', { name: 'Add evidence' }).click();
  const source = page.getByRole('link', { name: 'View source' });
  await expect(source).toHaveAttribute('href', 'https://example.org/pricing');
  await addClient('Spruce');
  await expect(source).toHaveCount(0);
  await page.getByRole('button', { name: 'Maple' }).click();
  await page.reload();
  await expect(page.getByText('Elm', { exact: true })).toBeVisible();
  await expect(page.getByText('Introduced a starter plan')).toBeVisible();
  await expect(source).toHaveAttribute('href', 'https://example.org/pricing');
  await page.getByRole('button', { name: 'Remove evidence' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Competitor evidence' })).toBeVisible();
  await expect(source).toHaveCount(0);
});
