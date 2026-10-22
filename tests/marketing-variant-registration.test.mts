import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_VARIANTS, isSiteVariant, isPinnedBuildVariant } from '../src/config/variant.ts';
import { VARIANT_META } from '../src/config/variant-meta.ts';
import { PREFERENCE_VARIANTS } from '../shared/cloud-preferences-contract.ts';
import { SUPPORTED_VARIANTS } from '../api/download.js';
import { readFileSync, existsSync } from 'node:fs';

it('registers marketing as a site variant everywhere the app enumerates them', () => {
  assert.equal(SITE_VARIANTS.at(-1), 'marketing');
  assert.equal(isSiteVariant('marketing'), true);
  assert.ok(PREFERENCE_VARIANTS.includes('marketing' as never));
  assert.ok(SUPPORTED_VARIANTS.has('marketing'));
  assert.equal(VARIANT_META.marketing.siteName, 'Marketing Situation Room');
});
it('pins only the marketing build variant over stored/hostname variants (Review Focus 1)', () => {
  assert.equal(isPinnedBuildVariant('marketing'), true);
  for (const v of ['full', 'tech', 'finance', 'happy', 'commodity', 'energy']) assert.equal(isPinnedBuildVariant(v), false);
});
it('ships dev/build scripts and a favicon set', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts['dev:marketing'], /VITE_VARIANT=marketing vite$/);
  assert.match(pkg.scripts['build:marketing'], /VITE_VARIANT=marketing/);
  assert.ok(existsSync('public/favico/marketing/favicon-32x32.png'));
});
it('does not publish a public marketing host (deliberate non-registration)', () => {
  assert.doesNotMatch(readFileSync('middleware.ts', 'utf8'), /marketing\.worldmonitor\.app/);
  assert.doesNotMatch(readFileSync('vercel.json', 'utf8'), /marketing/);
});
it('keeps the internal marketing variant out of public switch surfaces on non-marketing builds (Additive)', async () => {
  const { SWITCHABLE_SITE_VARIANTS, isSwitchableSiteVariant } = await import('../src/config/variant.ts');
  assert.deepEqual([...SWITCHABLE_SITE_VARIANTS], ['full', 'tech', 'finance', 'happy', 'commodity', 'energy']);
  assert.equal(isSwitchableSiteVariant('marketing'), false);
  assert.equal(isSwitchableSiteVariant('tech'), true);
  const { WEBMCP_MONITOR_KEYS } = await import('../src/services/webmcp.ts');
  assert.deepEqual([...WEBMCP_MONITOR_KEYS], ['full', 'tech', 'finance', 'happy', 'commodity', 'energy']);
});
it('ignores a stored marketing variant on a localhost non-marketing build', async () => {
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  const prevStorage = g.localStorage;
  g.window = { location: { hostname: 'localhost' } };
  g.localStorage = { getItem: (key: string) => (key === 'worldmonitor-variant' ? 'marketing' : null) };
  try {
    const mod = await import('../src/config/variant.ts?stored-marketing');
    assert.equal(mod.SITE_VARIANT, 'full');
  } finally {
    g.window = prevWindow;
    g.localStorage = prevStorage;
  }
});
