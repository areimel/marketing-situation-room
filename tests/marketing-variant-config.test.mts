import { it } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANT_DEFAULTS, getEffectivePanelConfig, getVariantPanelCategories, getInitialPanelSettingsForVariant } from '../src/config/panels.ts';
import { getAllowedLayerKeys, getCompleteLayerCatalogKeys, LAYER_REGISTRY } from '../src/config/map-layer-definitions.ts';

const ORDER = ['map','insights','marketing-alerts','local-mentions','marketing-calendar','demand-trends','platform-updates','weather-alerts','client-roster','local-seo','marketing-industry'];
it('uses the contract layout order', () => assert.deepEqual(VARIANT_DEFAULTS.marketing, ORDER));
it('labels marketing panels without changing other variants', () => {
  assert.equal(getEffectivePanelConfig('map', 'marketing').name, 'Client Map');
  assert.notEqual(getEffectivePanelConfig('map', 'full').name, 'Client Map');
  assert.equal(VARIANT_DEFAULTS.full.includes('client-roster'), false);
});
it('allows only marketing-safe layers', () => {
  const allowed = getAllowedLayerKeys('marketing');
  for (const k of ['marketingClients','nwsAlerts','localMentions']) { assert.ok(allowed.has(k as never)); assert.deepEqual(LAYER_REGISTRY[k as 'nwsAlerts'].renderers, ['deck']); }
  for (const k of ['conflicts','military','bases','stockExchanges','weather']) assert.equal(allowed.has(k as never), false);
  assert.equal(getAllowedLayerKeys('full').has('marketingClients' as never), false);
});
it('shows the marketing category only on marketing', () => {
  const settings = getInitialPanelSettingsForVariant('marketing');
  assert.ok(getVariantPanelCategories(settings, 'marketing').some(c => c.key === 'marketing'));
  assert.equal(getVariantPanelCategories(getInitialPanelSettingsForVariant('full'), 'full').some(c => c.key === 'marketing'), false);
});
it('keeps marketing layers out of every other variant\'s complete catalog', () => {
  const marketingKeys = ['marketingClients', 'nwsAlerts', 'localMentions'];
  for (const v of ['full', 'tech', 'finance', 'happy', 'commodity', 'energy'] as const) {
    const catalog = new Set<string>(getCompleteLayerCatalogKeys(v));
    for (const k of marketingKeys) assert.equal(catalog.has(k), false, `${v} lists ${k}`);
  }
  assert.deepEqual(getCompleteLayerCatalogKeys('marketing').slice(0, 3), marketingKeys);
});
