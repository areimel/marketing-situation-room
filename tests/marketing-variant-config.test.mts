import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ALL_PANELS, VARIANT_DEFAULTS, getEffectivePanelConfig, getVariantPanelCategories, getInitialPanelSettingsForVariant } from '../src/config/panels.ts';
import { getAllowedLayerKeys, getCompleteLayerCatalogKeys, LAYER_REGISTRY } from '../src/config/map-layer-definitions.ts';
import { computeStats } from '../scripts/docs-stats.mjs';

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

const MARKETING_ONLY_PANEL_IDS = ORDER.filter((id) => id !== 'map' && id !== 'insights');

// Public builds must not gain the internal variant's panels: Settings > All,
// the App.ts panel merge, the WebMCP panel catalog and CMD+K panel commands
// all key off ALL_PANELS.
it('keeps marketing-only panels out of a public build\'s ALL_PANELS', () => {
  for (const id of MARKETING_ONLY_PANEL_IDS) assert.equal(Object.hasOwn(ALL_PANELS, id), false, `public ALL_PANELS lists ${id}`);
  for (const id of MARKETING_ONLY_PANEL_IDS) {
    assert.equal(Object.hasOwn(getInitialPanelSettingsForVariant('full'), id), false, `full seed lists ${id}`);
  }
  assert.equal(ALL_PANELS.map?.name, 'Global Map');
});

it('offers marketing panel commands only in the marketing build', () => {
  // commands.ts imports i18n (import.meta.glob), so read it as text.
  const source = readFileSync(new URL('../src/config/commands.ts', import.meta.url), 'utf8');
  const block = (name: string) => {
    const m = source.match(new RegExp(`export const ${name}: Command\\[\\] = \\[([\\s\\S]*?)\\n\\];`));
    assert.ok(m, `${name} block not found`);
    return [...m[1]!.matchAll(/id: 'panel:([^'@]+)'/g)].map((x) => x[1]!);
  };
  // COMMANDS is the public palette (and the published command count).
  for (const id of MARKETING_ONLY_PANEL_IDS) assert.equal(block('COMMANDS').includes(id), false, `COMMANDS lists panel:${id}`);
  assert.deepEqual([...block('MARKETING_PANEL_COMMANDS')].sort(), [...MARKETING_ONLY_PANEL_IDS].sort());
  assert.match(source, /const SITE_COMMANDS: Command\[\] = SITE_VARIANT === 'marketing'\s*\? \[\.\.\.COMMANDS, \.\.\.MARKETING_PANEL_COMMANDS\]\s*: COMMANDS;/);
  assert.equal((source.match(/injectLocalizedKeywords\(SITE_COMMANDS\)/g) ?? []).length, 1);
  assert.match(source, /return _cachedAllCommands\.length > 0 \? _cachedAllCommands : SITE_COMMANDS;/);
  // Second gate: CMD+K hides a panel command whose target is absent from ALL_PANELS.
  for (const id of MARKETING_ONLY_PANEL_IDS) assert.equal(ALL_PANELS[id], undefined, `panel:${id} reachable on a public build`);
});

it('registers marketing-only panels in the marketing build', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'marketing-panels-'));
  try {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../src/config/panels.ts', import.meta.url))],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      write: false,
      define: { 'import.meta.env.VITE_VARIANT': '"marketing"', 'import.meta.env.DEV': 'false' },
    });
    const out = join(dir, 'panels.mjs');
    writeFileSync(out, result.outputFiles[0]!.text, 'utf8');
    const mod = await import(pathToFileURL(out).href) as typeof import('../src/config/panels.ts');
    for (const id of MARKETING_ONLY_PANEL_IDS) assert.ok(Object.hasOwn(mod.ALL_PANELS, id), `marketing ALL_PANELS lacks ${id}`);
    // Shared ids keep the public label in the registry; marketing relabels at render time.
    assert.equal(mod.ALL_PANELS.map?.name, 'Global Map');
    assert.equal(mod.getEffectivePanelConfig('map', 'marketing').name, 'Client Map');
    const seed = mod.getInitialPanelSettingsForVariant('marketing');
    assert.deepEqual(ORDER.filter((id) => seed[id]?.enabled), ORDER);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('keeps marketing-only layers out of public docs stats', () => {
  const stats = computeStats();
  const marketingOnly = ['marketingClients', 'nwsAlerts', 'localMentions'];
  assert.equal(stats.layerDefinitions, Object.keys(LAYER_REGISTRY).length - marketingOnly.length);
  for (const k of marketingOnly) assert.equal((stats.lockedLayerKeys as string[]).includes(k), false);
});
