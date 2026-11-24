import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function expectBriefDownload(page: Page, heading: string, body: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download brief' }).click();
  const download = await pending;
  const text = await readFile(await download.path(), 'utf8');
  const [title, date, separator, ...contents] = text.split('\n');
  expect(title).toBe(heading);
  expect(date).toMatch(/^Daily brief · .+/);
  expect(separator).toBe('');
  expect(contents.join('\n')).toBe(body + '\n');
}

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
  await expectBriefDownload(page, clients[1].name, clients[1].brief);
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

test('a returning agency keeps its previously selected custom client and brief', async ({ page }) => {
  // Seed a profile written before demo portfolios existed.
  await page.addInitScript(() => {
    const prefix = 'agency.workspace.v1.';
    localStorage.setItem(prefix + 'client.existing', 'Harbor Studio');
    localStorage.setItem(prefix + 'selected', 'existing');
    localStorage.setItem(prefix + 'daily-brief.existing', 'Retain the spring search budget.');
  });
  await page.goto('/dashboard');
  const roster = page.getByTestId('client-roster');
  await expect(roster.getByRole('listitem')).toHaveCount(1);
  await expect(roster.getByRole('listitem')).not.toContainText(/demo/i);
  await expect(roster.getByRole('button', { name: 'Harbor Studio', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'Daily brief' })).toHaveValue('Retain the spring search budget.');
});

test('first visit opens labeled demo clients with separate, editable briefs', async ({ page }) => {
  await page.goto('/');
  const roster = page.getByTestId('client-roster');
  const demoCopy = page.getByText(/fictional portfolio and sample competitor evidence/i);
  const brief = page.getByRole('textbox', { name: 'Daily brief' });
  const fern = roster.getByRole('button', { name: 'Fern & Field Nursery' });
  const tide = roster.getByRole('button', { name: 'Tideglass Kayaks' });
  await expect(fern).toHaveAttribute('aria-pressed', 'true');
  await expect(roster.getByText('Demo client', { exact: true })).toHaveCount(3);
  await expect(demoCopy).toBeVisible();
  await expect(brief).toHaveValue(/patio herbs/i);
  await brief.fill('Review patio campaign results.');

  await tide.click();
  await expect(brief).toHaveValue(/sunset tour/i);
  await expect(page.getByText('Shoal Line Tours', { exact: true })).toBeVisible();
  await expect(page.getByText('Glasshouse Garden Co.', { exact: true })).toHaveCount(0);
  await expectBriefDownload(page, 'Tideglass Kayaks (fictional demo client)', await brief.inputValue());
  await page.reload();
  await expect(tide).toHaveAttribute('aria-pressed', 'true');
  await expect(demoCopy).toBeVisible();
  await fern.click();
  await expect(brief).toHaveValue('Review patio campaign results.');

  await page.getByLabel('New client').fill('Harbor Custom');
  await page.getByRole('button', { name: 'Add client' }).click();
  const customRow = roster.getByRole('listitem').filter({ hasText: 'Harbor Custom' });
  await expect(customRow).not.toContainText(/demo/i);
  await expect(demoCopy).toHaveCount(0);
  await expect(brief).toHaveValue('');
});
