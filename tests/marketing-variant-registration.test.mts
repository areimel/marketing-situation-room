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
