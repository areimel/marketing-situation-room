# Marketing W0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the `marketing` variant wherever the app enumerates variants, and create every shared contract scaffold from the index, so that `npm run dev:marketing` boots a map-first marketing shell with placeholder panels, the other variants stay unchanged, and W1–W9 can build in parallel.

**Architecture:** `marketing` joins `SITE_VARIANTS`. It gets its own panel and map-layer presets in `src/config/panels.ts`, and a marketing build pins `SITE_VARIANT` to `marketing`. It is not added to the public `*.worldmonitor.app` hosting and SEO surfaces, because it is self-hosted and internal (Resolution 2). Shared types live in `shared/marketing/`. The browser services live in `src/services/marketing/`, with roster and focus implemented from fixtures and in memory. A new `MarketingService` proto domain is mounted with stub handlers. The Convex tables and the `requireMarketingMember` helper are added. Six placeholder panels and three null map-layer builders give each later workstream one file to replace.

**Tech Stack:**
- TypeScript (Vite SPA) and Node 24 `node:test` via `tsx`
- Vitest (`vitest.dom.config.mts` for DOM tests, `vitest.config.mts` for Convex tests)
- sebuf v0.11.1 with buf (`make generate`)
- Convex with `convex-test`
- deck.gl

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md`. The binding contracts are in `docs/superpowers/plans/2026-10-21-marketing-00-index.md`, and its "Contract Resolutions" section overrides any text here that disagrees. `(R<n>)` below cites Resolution n. W0 builds every item the index marks (W0) before W1–W9 start.

## Global Constraints

- Every constraint in the index's "Global Constraints" section applies verbatim, in particular:
  - Behaviour is byte-for-byte unchanged when `VITE_VARIANT !== 'marketing'` and `MARKETING_DEPLOY` is unset.
  - Client data never reaches the build bundle or a public endpoint.
  - Fixtures load only behind `import.meta.env.DEV`, through a dynamic import.
- Never rename a Shared Contract name from the index: ids, files, types, RPCs, tables, panel ids or layer ids.
- Variant id `'marketing'`. The scripts are `dev:marketing` and `build:marketing`, and both set `VITE_VARIANT=marketing`.
- Theme: the standard dark theme, which `commodity` uses as its template. `src/utils/theme-manager.ts` needs no change because it only special-cases `happy`.
- English strings live in `src/locales/en.json` under `marketing.*`. Per R1, a task that adds keys runs `npm run sync:locales` (English fallbacks, no API key), plus `npm run locales:zh-tw` when zh-TW is flagged. Real translation is deferred. The locale-freshness tests do not accept this yet (see Contract Issues, new issue A).
- Server code never logs client names or query terms (R5).
- Run `npm run --silent agent:preflight -- --mode repair` before Task 1.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Heavy suites (`test:data`, `test:dom`, `test:convex`) run one at a time and only in Task 10. The per-task steps run single files.
- The deliberate non-registrations below stay out of this workstream unless the user overrides them:
  - `middleware.ts` `VARIANT_HOST_MAP`
  - `vercel.json` host rewrites and CSP
  - `src/config/variant-dashboard-html.ts` `WEB_DASHBOARD_VARIANTS`
  - `src/config/variant-seo-summaries.ts`
  - The `index.html` prepaint hostname chain
  - Public `VARIANT_SWITCHER_DASHBOARD_URLS`
  - `src/embed/embed-url.ts`
  - Sitemap and IndexNow
  - Reason: each one publishes a `marketing.worldmonitor.app` crawlable surface. Tests also pin these lists against each other (`tests/deploy-config.test.mjs:4929-4944`, `tests/variant-inline-bootstrap.test.mjs` CSP hash), so editing them would mean public-host changes with no purpose. The vite `htmlVariantPlugin` already injects `v='marketing'` into the prepaint script for a marketing build (`vite.config.ts:266-271`).

## Review Focus

1. **A stale `worldmonitor-variant` value in localStorage (for example `tech`, left over from an earlier switch) on localhost or a self-hosted domain.** Expected: `npm run dev:marketing` still boots `marketing`. Today `src/config/variant.ts:48-52` lets the stored value win on localhost, and any other non-`*.worldmonitor.app` host returns `'full'`. Pinned by Task 2 (`isPinnedBuildVariant`) and the Task 10 drive.
2. **A production marketing bundle that contains a fixture client name.** Expected: `dist/` has no `Fixture ` string, and only `roster.ts` imports `dev-fixtures.ts`, dynamically. Pinned by Task 4 (source-scan test) and Task 10 (dist grep).
3. **Client locations with NaN, out-of-range lat/lon, or a negative or zero radius.** Expected: `pointInServiceArea` returns `false` without throwing, and `milesBetween` returns `NaN` for non-finite input rather than a number. Pinned in Task 1.
4. **A user on `full` (or any public variant) opening Choose Workspace or the variant switcher.** Expected: no marketing presets and no marketing switcher entry. On `marketing`, Choose Workspace offers only the three marketing presets. Pinned in Tasks 7 and 9.
5. **Oversized or malformed RPC input:** 21 mention queries, `from_date: "tomorrow"`, or a 3-letter state code. Expected: the generated validator answers 400 before any handler runs. Pinned in Task 5.
6. **Focus set to an unknown, malformed or inactive client id** (for example from a stale URL). Expected: focus clears to `null` and listeners fire once; setting the same id again does nothing (R12, R13). Pinned in Task 4.
7. **Client query terms leaking to a cache or log.** Expected: every `MarketingService` path is `no-store`, `SearchLocalMentions` is POST, and the stubs log nothing request-derived (R5). Pinned in Task 5.

---

### Task 1: Shared marketing contracts (`shared/marketing/*`, `src/config/marketing.ts`)

**Files:**
- Create: `shared/marketing/types.ts`, copied verbatim from the index's "Domain types" block
- Create: `shared/marketing/geo.ts`
- Create: `shared/marketing/deploy-flag.ts`
- Create: `scripts/lib/marketing-deploy-flag.cjs`, the relay's JS copy (R11)
- Create: `src/config/marketing.ts`
- Test: `tests/marketing-shared-contracts.test.mts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact names from the index):
  - `MARKETING_CATEGORIES`, `MarketingCategory`, `MarketingClientLocation`, `MarketingClient`, `MarketingSignalKind`, `MarketingSignal`
  - `milesBetween(aLat: number, aLon: number, bLat: number, bLon: number): number`
  - `pointInServiceArea(loc: MarketingClientLocation, lat: number, lon: number): boolean`
  - `polygonTouchesServiceArea(loc: MarketingClientLocation, geojson: string): boolean` (R10). It accepts a GeoJSON `Polygon`, `MultiPolygon`, `Feature` or `FeatureCollection` string. It returns `true` when the service-area centre lies inside any ring (even-odd test), or when any ring vertex or edge comes within `serviceRadiusMiles` of the centre (point-to-segment distance on an equirectangular projection scaled at the centre latitude). It returns `false`, never throws, on malformed JSON, an unsupported geometry type, empty rings, or a location that `pointInServiceArea` would reject.
  - `isMarketingDeploy(env?: Record<string, string | undefined>): boolean`. It reads the real env from day one (R11); only the behaviour behind it is W9's.
  - `isMarketingDeploy(env?)` in `scripts/lib/marketing-deploy-flag.cjs` (`module.exports = { isMarketingDeploy }`), with identical semantics, for the relay (R11, R21)
  - `MARKETING_DEPLOY: boolean`, exported from `src/config/marketing.ts`

- [ ] **Step 1: Write the failing test** `tests/marketing-shared-contracts.test.mts`

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_CATEGORIES } from '../shared/marketing/types.ts';
import { milesBetween, pointInServiceArea, polygonTouchesServiceArea } from '../shared/marketing/geo.ts';
import { isMarketingDeploy } from '../shared/marketing/deploy-flag.ts';
import { createRequire } from 'node:module';
const { isMarketingDeploy: isMarketingDeployCjs } = createRequire(import.meta.url)('../scripts/lib/marketing-deploy-flag.cjs');

const loc = { id: 'l1', label: 'HQ', address: '1 Main', city: 'Austin', stateCode: 'TX', lat: 30.2672, lon: -97.7431, serviceRadiusMiles: 25 };

describe('marketing shared contracts', () => {
  it('keeps the 15 categories in contract order', () => {
    assert.equal(MARKETING_CATEGORIES.length, 15);
    assert.equal(MARKETING_CATEGORIES[0], 'hvac');
    assert.equal(MARKETING_CATEGORIES.at(-1), 'other');
  });
  it('measures NYC→LA within 5 miles of 2445', () => {
    assert.ok(Math.abs(milesBetween(40.7128, -74.006, 34.0522, -118.2437) - 2445) < 5);
  });
  it('includes a point inside the radius and excludes one outside', () => {
    assert.equal(pointInServiceArea(loc, 30.3, -97.75), true);     // ~2 mi
    assert.equal(pointInServiceArea(loc, 29.4241, -98.4936), false); // San Antonio ~74 mi
  });
  it('never throws on bad coordinates or radius (Review Focus 3)', () => {
    assert.ok(Number.isNaN(milesBetween(Number.NaN, 0, 0, 0)));
    assert.equal(pointInServiceArea({ ...loc, lat: Number.NaN }, 30.3, -97.75), false);
    assert.equal(pointInServiceArea({ ...loc, lat: 91 }, 30.3, -97.75), false);
    assert.equal(pointInServiceArea({ ...loc, lon: -181 }, 30.3, -97.75), false);
    assert.equal(pointInServiceArea({ ...loc, serviceRadiusMiles: 0 }, 30.2672, -97.7431), false);
    assert.equal(pointInServiceArea({ ...loc, serviceRadiusMiles: -5 }, 30.2672, -97.7431), false);
    assert.equal(pointInServiceArea(loc, Number.POSITIVE_INFINITY, 0), false);
  });
  it('reads the deploy flag as false by default and true only for "1"', () => {
    assert.equal(isMarketingDeploy({}), false);
    assert.equal(isMarketingDeploy({ MARKETING_DEPLOY: '0' }), false);
    assert.equal(isMarketingDeploy({ MARKETING_DEPLOY: 'true' }), false);
    assert.equal(isMarketingDeploy({ MARKETING_DEPLOY: '1' }), true);
  });
  it('keeps the relay CJS deploy flag in sync with the shared one (R11)', () => {
    for (const v of [undefined, '', '0', '1', 'true', ' 1']) {
      assert.equal(isMarketingDeployCjs({ MARKETING_DEPLOY: v }), isMarketingDeploy({ MARKETING_DEPLOY: v }));
    }
  });
  // polygonTouchesServiceArea (R10), each a one-line assert:
  // - a square containing Austin -> true; a square ~10 mi away with radius 25 -> true (edge within radius)
  // - a square over San Antonio (~74 mi) -> false; same square wrapped in Feature / FeatureCollection / MultiPolygon -> same results
  // - '', 'not json', '{"type":"Point","coordinates":[0,0]}', a Polygon with [] rings, and loc with lat NaN -> false, no throw
});
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-shared-contracts.test.mts`. Expected: it FAILS with module not found.

- [ ] **Step 3: Implement the four files.**
  - `geo.ts`:
    - Use the haversine formula with an Earth radius of 3958.8 miles.
    - `pointInServiceArea` returns `false` unless:
      - all four coordinates are finite
      - each `|lat| <= 90` and `|lon| <= 180`
      - `serviceRadiusMiles > 0`
    - Otherwise it returns `milesBetween(...) <= serviceRadiusMiles`.
  - `deploy-flag.ts`:
    - The default `env` is `(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}`.
    - It returns `env.MARKETING_DEPLOY === '1'`.
  - `polygonTouchesServiceArea` in `geo.ts`, per the Interfaces block. Pure math, no dependency.
  - `scripts/lib/marketing-deploy-flag.cjs`: the same one-line rule in CommonJS, with a header comment naming `shared/marketing/deploy-flag.ts` as the source of truth and the sync test.
  - `src/config/marketing.ts`: `export const MARKETING_DEPLOY: boolean`, computed as `isMarketingDeploy({ MARKETING_DEPLOY: <VITE_MARKETING_DEPLOY> })`. Read `import.meta.env.VITE_MARKETING_DEPLOY` inside `try/catch`, so that a node import, where `import.meta.env` is undefined, yields `false`. W9 adds every consumer.

- [ ] **Step 4: Run the test and confirm it passes.** Run the same command. Expected: PASS, with 7 tests (polygon cases grouped in one `it`).

- [ ] **Step 5: Commit.** `git add shared/marketing scripts/lib/marketing-deploy-flag.cjs src/config/marketing.ts tests/marketing-shared-contracts.test.mts && git commit -m "feat(marketing): add shared marketing domain contracts"`

---

### Task 2: Core variant registration

**Files:**
- Modify: `src/config/variant.ts`
  - `:7`: add `'marketing'` at the end of `SITE_VARIANTS`.
  - `:33-56`: add a pinned-build short-circuit.
- Modify: `api/download.js:26-34`: add `'marketing'` to `SUPPORTED_VARIANTS`.
- Modify: `shared/cloud-preferences-contract.ts:1`: append `'marketing'` to `PREFERENCE_VARIANTS`. This flows into the Convex validator at `convex/userPreferences.ts:20`.
- Modify: `src/config/webmcp.ts:148-155`: add `marketing: variantInventory(false)`.
- Modify: `src/config/variant-meta.ts`: add a `marketing` entry after `energy`.
- Modify: `vite.config.ts:230-298` (`htmlVariantPlugin`): when `activeVariant === 'marketing'`, replace the `index.html:15` robots meta with `<meta name="robots" content="noindex, nofollow" />`.
- Modify: `package.json`:
  - Add `"dev:marketing": "cross-env VITE_VARIANT=marketing vite"` after `dev:energy` at `:92`.
  - Add `"build:marketing": "npm run security:vite-env-secrets -- --strict-local && cross-env-shell VITE_VARIANT=marketing \"tsc && vite build\""` after `build:energy` at `:142`.
  - Add no `prebuild:marketing`, because the public docs and product facts are not needed for an internal build.
- Create: `public/favico/marketing/`. Copy the 7 files from `public/favico/commodity/` as placeholders: `android-chrome-192x192.png`, `android-chrome-512x512.png`, `apple-touch-icon.png`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon.ico`, `og-image.png`.
- Modify tests:
  - `tests/user-prefs-rate-limit.test.mts:468`: the variants array gains `'marketing'`.
  - `tests/webmcp-inventory.test.mts:664-673`: the expected inventory gains `marketing: []`, and the test title becomes "all seven".
  - `tests/webmcp-dashboard.test.mts:968`: the expected `SITE_VARIANTS` gains `'marketing'`.
  - `tests/webmcp.test.mjs:488-490`: the `switch_monitor` enum gains `'marketing'`.
- Test: `tests/marketing-variant-registration.test.mts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SiteVariant` includes `'marketing'`.
  - `export function isPinnedBuildVariant(buildVariant: string): boolean`, in `src/config/variant.ts`. It returns true only for `'marketing'`.
  - `VARIANT_META.marketing`.

- [ ] **Step 1: Write the failing test** `tests/marketing-variant-registration.test.mts`

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-variant-registration.test.mts`. Expected: FAIL, because `isPinnedBuildVariant` is not exported.

- [ ] **Step 3: Implement the registration edits listed under Files.**
  - In the `SITE_VARIANT` IIFE, put `if (isPinnedBuildVariant(buildVariant)) return 'marketing';` as the first statement, before the `typeof window` check. That way a marketing build ignores localStorage and hostname, while every other build follows its existing path.
  - The `VARIANT_META.marketing` fields are:
    - `title: 'Marketing Situation Room'`
    - `description: 'Internal agency dashboard tracking local weather, mentions, holidays, and demand signals for each client market.'`
    - `url: 'http://localhost:3000/dashboard'`. This is the docker-compose `WM_PORT` default, and W9 may make it env-driven. `src/services/meta-tags.ts:16` needs it to be absolute.
    - `siteName: 'Marketing Situation Room'`
    - `shortName: 'MarketingRoom'`
    - `subject: 'Local Marketing Intelligence'`
    - `classification: 'Internal Marketing Dashboard'`
    - `categories: ['business']`
    - `features`: four strings (client map, weather alerts, local mentions, marketing calendar)
    - `keywords: 'internal'`

- [ ] **Step 4: Run the new test and the four updated suites.** Run:
  `node --import tsx --test tests/marketing-variant-registration.test.mts tests/desktop-one-binary-model.test.mjs tests/user-prefs-rate-limit.test.mts tests/webmcp-inventory.test.mts tests/webmcp-dashboard.test.mts tests/webmcp.test.mjs tests/variant-meta-index-html-drift.test.mts tests/meta-tags.test.mts`
  Expected: PASS. The prototype showed that the `SITE_VARIANTS` change alone breaks exactly `desktop-one-binary-model`, `user-prefs-rate-limit`, `webmcp-inventory`, `webmcp-dashboard` and `webmcp.test.mjs`.

- [ ] **Step 5: Run the Convex preferences check.** Run `npx vitest run --config vitest.config.mts convex/__tests__/http.test.ts convex/__tests__/userPreferences.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit.** `git commit -m "feat(marketing): register marketing site variant"` with the files above.

---

### Task 3: Panel and map-layer configuration for `marketing`

**Files:**
- Modify: `src/types/index.ts:735-742`. Add optional `marketingClients?: boolean; nwsAlerts?: boolean; localMentions?: boolean;` to `MapLayers`, with a comment following the energy-layers precedent.
- Modify: `src/config/map-layer-definitions.ts`:
  - `:13`: `MapVariant` gains `'marketing'`.
  - `:129-131`: `LAYER_REGISTRY` gains `marketingClients` (`'&#128205;'`, `'marketingClients'`, `'Client Locations'`, `['deck']`), `nwsAlerts` (`'&#9928;'`, `'nwsAlerts'`, `'NWS Warnings'`, `['deck']`) and `localMentions` (`'&#128240;'`, `'localMentions'`, `'Local Mentions'`, `['deck']`).
  - `:350-392`: `VARIANT_LAYER_ORDER.marketing = ['marketingClients', 'nwsAlerts', 'localMentions', 'natural', 'fires', 'dayNight']`.
- Modify: `src/config/panels.ts`:
  - After `ENERGY_MOBILE_MAP_LAYERS` (around `:1150`), add `MARKETING_PANELS`, `MARKETING_MAP_LAYERS` and `MARKETING_MOBILE_MAP_LAYERS`.
  - `:1152`: `PanelVariant` gains `'marketing'`.
  - `:1154-1161`: `VARIANT_PANEL_CONFIGS.marketing`.
  - `:1176-1183`: `ALL_PANELS` spreads `...MARKETING_PANELS` first, so the other variants keep their labels for `map` and `insights`.
  - `:1186-1193`: `VARIANT_DEFAULTS.marketing`.
  - `:1458-1481`: add a `'marketing'` arm to `DEFAULT_MAP_LAYERS` and `MOBILE_DEFAULT_MAP_LAYERS`.
  - `PANEL_CATEGORY_MAP` (`:1504`): new `marketing: { labelKey: 'marketing.header.panelCategory', panelKeys: [...the 9 marketing-only ids], variants: ['marketing'] }`.
- Modify: `src/config/commands.ts`, near `:113`. Add 9 `{ id: 'panel:<id>', keywords: [>=3], label: 'Panel: <name>', icon, category: 'panels' }` lines, one per line, for `client-roster`, `marketing-alerts`, `weather-alerts`, `marketing-calendar`, `local-mentions`, `demand-trends`, `platform-updates`, `local-seo` and `marketing-industry`.
- Modify: `src/config/feeds.ts`:
  - Add `const MARKETING_FEEDS: Record<string, Feed[]> = {};` after `ENERGY_FEEDS` at `:1077`. It is an empty stub that W1 fills.
  - `FEEDS` at `:1107-1117` gains a `SITE_VARIANT === 'marketing' ? MARKETING_FEEDS` arm, so the variant does not fall through to `FULL_FEEDS` geopolitics.
  - `CANONICAL_FEEDS` at `:1139` gains `MARKETING_FEEDS`.
- Modify: `src/app/agent-bus-applier.ts:89` and `src/services/webmcp-map-layer-catalog.ts:47-49`: add `'marketing'` to `MAP_VARIANTS`.
- Modify tests:
  - `tests/panel-config-guardrails.test.mjs:21`: `VARIANT_FILES` gains `'marketing'`.
  - `tests/variant-layer-guardrail.test.mjs:78-85`: add `marketing: { desktop: 'MARKETING_MAP_LAYERS', mobile: 'MARKETING_MOBILE_MAP_LAYERS' }`.
- Test: `tests/marketing-variant-config.test.mts` (new)

**Interfaces:**
- Consumes: `SiteVariant` with `'marketing'` (Task 2).
- Produces:
  - Panel ids, in this exact `MARKETING_PANELS` key order: `map`, `insights`, `marketing-alerts`, `local-mentions`, `marketing-calendar`, `demand-trends`, `platform-updates`, `weather-alerts`, `client-roster`, `local-seo`, `marketing-industry`. All are `enabled: true, priority: 1`. The names are `'Client Map'`, `'AI Marketing Brief'`, `'Client Alerts'`, `'Local Mentions'`, `'Marketing Calendar'`, `'Demand Trends'`, `'Platform Updates'`, `'Weather Alerts'`, `'Client Roster'`, `'Local SEO'` and `'Marketing Industry'`.
  - Layer keys `marketingClients`, `nwsAlerts` and `localMentions`.
  - `MapVariant` and `PanelVariant` include `'marketing'`.
  - The empty `MARKETING_FEEDS`, which W1 owns from here on.
- `MARKETING_MAP_LAYERS` and `MARKETING_MOBILE_MAP_LAYERS` both copy every key of `COMMODITY_MAP_LAYERS` as `false`, including `canadaRoads: false`. They then set `marketingClients: true`, `nwsAlerts: true`, `localMentions: true` and `dayNight: false`, so every geopolitics, military and market layer is off. The existing seeded `weather` layer also stays `false` (Contract Issue 6).

- [ ] **Step 1: Write the failing test** `tests/marketing-variant-config.test.mts`

```ts
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANT_DEFAULTS, getEffectivePanelConfig, getVariantPanelCategories, getInitialPanelSettingsForVariant } from '../src/config/panels.ts';
import { getAllowedLayerKeys, LAYER_REGISTRY } from '../src/config/map-layer-definitions.ts';

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
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-variant-config.test.mts`. Expected: FAIL, because `VARIANT_DEFAULTS.marketing` is undefined.

- [ ] **Step 3: Implement the config edits listed under Files.**

- [ ] **Step 4: Run the new test and the guardrails.** Run:
  `node --import tsx --test tests/marketing-variant-config.test.mts tests/panel-config-guardrails.test.mjs tests/variant-layer-guardrail.test.mjs tests/panel-variant-config.test.mts tests/mobile-panel-nav-categories.test.mts tests/webmcp-panel-catalog.test.mts tests/feeds-client-server-parity.test.mjs tests/news-feed-key-parity.test.mts tests/docs-stats-layer-registry.test.mjs tests/iran-events-sunset.test.mts`
  Expected: PASS. `npm run typecheck` is also clean, which proves the `LAYER_REGISTRY: Record<keyof MapLayers, …>` entries exist.

- [ ] **Step 5: Commit.** `git commit -m "feat(marketing): add marketing panel and map-layer presets"`

---

### Task 4: Browser services (`src/services/marketing/roster|dev-fixtures|focus`)

**Files:**
- Create: `src/services/marketing/dev-fixtures.ts`
- Create: `src/services/marketing/roster.ts`
- Create: `src/services/marketing/focus.ts`
- Create: `shared/marketing/ids.ts`
- Test: `tests/marketing-services.test.mts`, a node test (focus, fixture invariants, import-graph scan)
- Test: `tests/dom/marketing-roster.test.mts`, a vitest DOM test where `import.meta.env.DEV` is true

**Interfaces:**
- Consumes: `MarketingClient`, `MARKETING_CATEGORIES` and `pointInServiceArea` (Task 1).
- Produces (exact names from the index):
  - `DEV_CLIENTS: MarketingClient[]`. It holds 5 clients, each name starting `Fixture `, spread across 5 US states (use TX, FL, OK, CO and NC so W4 has storm-prone areas). Every location has valid coordinates and `serviceRadiusMiles` between 10 and 40. Ids are `fixture-client-1` through `fixture-client-5`, which match the R12 id format `/^[A-Za-z0-9_-]{1,64}$/`; location ids follow the same format. The categories are distinct members of `MARKETING_CATEGORIES`. All five are `active: true`.
  - `MARKETING_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/` and `isMarketingClientId(id: unknown): id is string`, exported from `shared/marketing/ids.ts` (R12), so Convex, server and browser share one rule.
  - `getClients(): Promise<MarketingClient[]>`. It returns every client, inactive included; consumers hide inactive ones (R12).
  - `subscribeClients(cb): () => void`. It calls `cb` once with the current list (asynchronously) and returns an unsubscribe function. W2 replaces the body.
  - `getRosterStatus(): 'loading' | 'ready' | 'forbidden' | 'error'` and `onRosterStatusChange(cb: (s: MarketingRosterStatus) => void): () => void`, with `export type MarketingRosterStatus` (R18). W0 always reports `'ready'`, and the listener never fires. W2 makes it real.
  - `getFocusedClientId(): string | null`, `setFocusedClientId(id: string | null): void` and `onFocusChange(cb): () => void` (R13):
    - `onFocusChange` does not fire on subscribe.
    - Setting the current id again does nothing.
    - A malformed id (fails `isMarketingClientId`) clears focus.
    - Once a roster has been seen, an id that is unknown or belongs to an inactive client clears focus (R12). Before the first roster arrives, a well-formed id is held provisionally.
    - A throwing listener does not block the other listeners.
  - `reconcileFocusWithRoster(clients: MarketingClient[]): void`, exported from `focus.ts`. It records the set of active ids and clears focus (one notification) when the focused id is not in it. `focus.ts` calls it from a lazy `subscribeClients` subscription made on the first `setFocusedClientId`/`onFocusChange`; tests call it directly. W3 adds URL sync and map zoom on top.
- Privacy rule: `roster.ts` contains exactly `if (import.meta.env.DEV) { const { DEV_CLIENTS } = await import('./dev-fixtures'); … }`. The condition must be the literal `import.meta.env.DEV`, with no optional chaining and no wrapper function, so that Vite replaces it with `false` and Rollup drops the chunk. Outside DEV it returns `[]`.

- [ ] **Step 1: Write the failing node test** `tests/marketing-services.test.mts`. It asserts:
  - Subscribing with `onFocusChange` does not call the listener.
  - `setFocusedClientId('a')` calls listeners once with `'a'`, and a repeated `'a'` does not call them again.
  - `setFocusedClientId('bad id!')` and a 65-character id clear focus to `null`.
  - After `reconcileFocusWithRoster([...])` with `'a'` absent or `active: false`, focus is `null` with exactly one notification; `setFocusedClientId('unknown-id')` then also clears.
  - The unsubscribe function stops calls.
  - A throwing listener does not stop a second listener.
  - Every `DEV_CLIENTS` id and location id passes `isMarketingClientId`.
  - `DEV_CLIENTS.length === 5`, and every `name.startsWith('Fixture ')`.
  - Every location passes `pointInServiceArea(loc, loc.lat, loc.lon) === true`.
  - Scanning `src/**/*.ts` finds exactly one importer of `dev-fixtures` (`src/services/marketing/roster.ts`), and its import matches `/await import\('\.\/dev-fixtures'\)/` inside a block that starts `if (import.meta.env.DEV)` (Review Focus 2).
- [ ] **Step 2: Write the failing DOM test** `tests/dom/marketing-roster.test.mts`. It asserts:
  - `await getClients()` deep-equals `DEV_CLIENTS`.
  - `subscribeClients(cb)` eventually calls `cb` with 5 clients.
  - After unsubscribe, a second `subscribeClients` still works.
  - `getRosterStatus() === 'ready'`, and `onRosterStatusChange` returns a callable unsubscribe.
- [ ] **Step 3: Run both tests and confirm they fail.** Run `node --import tsx --test tests/marketing-services.test.mts` and `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-roster.test.mts`. Expected: FAIL with module not found.
- [ ] **Step 4: Implement the four files** per the Interfaces block.
- [ ] **Step 5: Run both tests and `npm run lint:boundaries`.** Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(marketing): add roster, focus and dev fixture services"`

---

### Task 5: `MarketingService` proto, generation, stub handlers, gateway, browser API

**Files:**
- Create in `proto/worldmonitor/marketing/v1/`, one message per file following the conventions in `docs/adding-endpoints.mdx:399-470`, with every element carrying a `//` comment:
  - `weather_alert.proto`, `list_weather_alerts.proto`
  - `calendar_event.proto`, `list_calendar_events.proto`
  - `mention.proto` (holds `Mention` and `MentionQuery`), `search_local_mentions.proto`
  - `demand_trend.proto` (holds `DemandTrend`, `TrendPoint` and `TrendingTerm`), `get_demand_trends.proto`
  - `service.proto`
- Generated by `make generate`, never hand-edited:
  - `src/generated/{client,server}/worldmonitor/marketing/v1/service_{client,server}.ts`
  - `src/generated/server/request_validation.ts`
  - `docs/api/MarketingService.openapi.{yaml,json}`
  - `docs/api/worldmonitor.openapi.yaml`
- Create: `server/worldmonitor/marketing/v1/`:
  - `handler.ts`, which re-exports `marketingHandler`
  - `list-weather-alerts.ts` (W4)
  - `list-calendar-events.ts` (W5)
  - `search-local-mentions.ts` (W6)
  - `get-demand-trends.ts` (W7)
  - `_user-agent.ts` (R6), shared by W4, W6 and W7
- Create: `api/marketing/v1/[rpc].ts`, copied from `api/climate/v1/[rpc].ts` with `createMarketingServiceRoutes`.
- Modify: `vite.config.ts:502-595` (`sebufApiPlugin`): add `marketingServerMod, marketingHandlerMod` imports and a `...createMarketingServiceRoutes(...)` mount.
- Modify: `server/gateway.ts:254` (`RPC_CACHE_TIER`), per R5: all four paths, including the POST mentions route, are `'no-store'` (the existing private/no-store tier at `:217`/`:235`). W0 sets them statically, which satisfies "no-store when `isMarketingDeploy()` is on" and also keeps a non-deploy dev build from ever CDN-caching client terms. A comment above the block cites R5 so W9 does not relax it.
  - Do not add anything to `PUBLIC_NO_AUTH_RPC_PATHS`.
- Modify: `src/services/generated-rpc-clients.ts`: add a type import near `:25` and a `MarketingServiceClient = createLazyRpcClientConstructor(...)` near `:189`, following the `SafetyServiceClient` pattern.
- Create: `src/services/marketing/api.ts`
- Modify tests:
  - `tests/mcp-api-parity.test.mjs:86`: add 4 `EXCLUDED_FROM_MCP_PARITY` entries whose reason starts `admin:` ("internal agency marketing RPC; gated to signed-in members under MARKETING_DEPLOY by W9; never an open MCP tool").
  - `tests/openapi-examples-contract.test.mjs`: change `38` to `39` at `:650`, and `238` to `242` at `:655`, `:667`, `:669`, `:708`, `:714` and `:715`.
- Test: `tests/marketing-rpc-stubs.test.mts` (new)
- Test: `tests/dom/marketing-api.test.mts` (new): with `premiumFetch` mocked via `vi.mock('@/services/premium-fetch')`, each wrapper sends its request through it (mentions as POST with the body, never in the URL) and returns the response object unchanged, `degraded` included; a rejected fetch rejects the wrapper.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (RPC names, fields and handler files exactly as in the index table; `service base_path: "/api/marketing/v1"`):
  - `ListWeatherAlerts`:
    - Path: `GET /list-weather-alerts`.
    - Request: `repeated string state_codes` with query name `state_codes`, `max_items 60`, each item `len 2` and pattern `^[A-Z]{2}$`.
    - Response: `alerts`, plus `bool degraded` (R4). `WeatherAlert{id, event, severity, headline, area_desc, int64 onset, int64 expires, polygon_geojson, repeated string zone_codes, repeated string state_codes}`. `severity` holds the mapped value `info`|`watch`|`warning` (R4). Times are epoch ms with `INT64_ENCODING_NUMBER` (R3).
  - `ListCalendarEvents`:
    - Path: `GET /list-calendar-events`.
    - Request: `from_date` and `to_date` (pattern `^\d{4}-\d{2}-\d{2}$`, required), plus `repeated string categories` (`max_items 15`). An empty `categories` means all categories (R14), stated in the field comment.
    - Response: `events`, plus `bool degraded`. `CalendarEvent{id, date (YYYY-MM-DD string, a calendar date, not a timestamp), name, kind, repeated categories}`.
  - `SearchLocalMentions`:
    - Path: `POST /search-local-mentions`. It is POST so that client terms never appear in URLs or CDN keys.
    - Request: `repeated MentionQuery queries` with `max_items 20`, where `MentionQuery{client_id required, repeated terms max_items 10, city, state_code}`.
    - Request field comment: queries carry client names; never cached publicly and never logged (R5).
    - Response: `mentions`, plus `bool degraded`. `Mention{id, client_id, title, source, url, int64 published_at, double lat, double lon}`. `published_at` is epoch ms; `lat/lon` of `0,0` means "no location", and the browser substitutes the client location's coordinates (R3).
  - `GetDemandTrends`:
    - Path: `GET /get-demand-trends`.
    - Request: `repeated string categories` (empty means all, R14) and `repeated string state_codes`.
    - Response: `trends: DemandTrend{category, repeated TrendPoint points}` with `TrendPoint{int64 date, double value}` (R4), `trending_now: TrendingTerm{term, geo, string traffic}` (R4), plus `bool degraded`.
  - Handlers:
    - `marketingHandler: MarketingServiceHandler` with `listWeatherAlerts`, `listCalendarEvents`, `searchLocalMentions` and `getDemandTrends`.
    - Each stub is typed `MarketingServiceHandler['<rpc>']` and returns empty arrays with `degraded: false`: `{alerts: [], degraded: false}`, `{events: [], degraded: false}`, `{mentions: [], degraded: false}` and `{trends: [], trendingNow: [], degraded: false}`. Stubs log nothing.
  - `server/worldmonitor/marketing/v1/_user-agent.ts` (R6): `marketingUserAgent(env?: Record<string, string | undefined>): string` returns `MarketingSituationRoom/1.0 (+mailto:${MARKETING_CONTACT_EMAIL})`. When the email is unset or blank it throws `Error('MARKETING_CONTACT_EMAIL is required')` if `env.NODE_ENV === 'production'` or `env.VERCEL_ENV === 'production'`, and otherwise returns `MarketingSituationRoom/1.0 (+mailto:unset@localhost)`. The env is read per call, never at module scope. W1 does not use it.
  - `src/services/marketing/api.ts` (R8). Each wrapper takes the generated request object and resolves to the generated response type, so `degraded` reaches the panel:
    - `listWeatherAlerts(req: ListWeatherAlertsRequest): Promise<ListWeatherAlertsResponse>`
    - `listCalendarEvents(req: ListCalendarEventsRequest): Promise<ListCalendarEventsResponse>`
    - `searchLocalMentions(req: SearchLocalMentionsRequest): Promise<SearchLocalMentionsResponse>`
    - `getDemandTrends(req: GetDemandTrendsRequest): Promise<GetDemandTrendsResponse>`
    - The client is `createLazyClient(() => new MarketingServiceClient(getRpcBaseUrl(), { fetch: premiumFetch }))`, with `premiumFetch` from `@/services/premium-fetch`, so the Clerk token is attached (R8).
    - Each one rejects on transport failure, with no circuit-breaker fallback, so that panels can show "source unavailable" (index Review Focus 3).
    - It re-exports the generated message types (`WeatherAlert`, `CalendarEvent`, `Mention`, `MentionQuery`, `DemandTrend`, `TrendPoint`, `TrendingTerm` and the request/response types).

- [ ] **Step 1: Install the toolchain.** Run `make install`. Go is present, and buf and the sebuf plugins are installed by this step. Expected: `buf --version` prints, and `~/go/bin/protoc-gen-ts-client` exists.
- [ ] **Step 2: Write the failing test** `tests/marketing-rpc-stubs.test.mts`. It asserts:
  - Each of the 4 handlers resolves to its empty response shape with `degraded: false`, given a minimal `ServerContext` built from `new Request('http://x')`.
  - `RPC_CACHE_TIER` maps all four marketing paths to `'no-store'` (R5, Review Focus 7), and a mentions request through the routes yields `Cache-Control: no-store`.
  - `marketingUserAgent({ MARKETING_CONTACT_EMAIL: 'ops@example.com' })` equals `MarketingSituationRoom/1.0 (+mailto:ops@example.com)`; it throws with the email unset and `NODE_ENV=production`; it does not throw in dev.
  - The generated `WeatherAlert` has `zoneCodes`/`stateCodes`, and every response type has `degraded` (a type-level `satisfies` check that `typecheck:api` enforces).
  - `createMarketingServiceRoutes(marketingHandler, serverOptions)` (with `serverOptions` from `server/gateway.ts`) exposes exactly the 4 paths above with the stated methods.
  - Validation (Review Focus 5). Each of these gets status 400 and no handler call:
    - POSTing 21 `queries` to the mentions route handler
    - GET `?from_date=tomorrow&to_date=2026-10-31` on calendar
    - GET `?state_codes=TEX` on weather
- [ ] **Step 3: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-rpc-stubs.test.mts`. Expected: FAIL with module not found.
- [ ] **Step 4: Write the protos, then generate.** Run `make lint && make generate`. Expected: both succeed, `git status` shows only new `marketing` generated files plus regenerated `request_validation.ts` and OpenAPI bundles, and no diff in other domains' generated files. Verify with `git diff --stat src/generated | grep -v marketing`, which must list only `request_validation.ts`.
- [ ] **Step 5: Implement the handlers, `_user-agent.ts`, gateway entry, vite mount, tiers, client registry, `api.ts` and the two test-count edits.**
- [ ] **Step 6: Run the contract suites.** Run:
  `node --import tsx --test tests/marketing-rpc-stubs.test.mts tests/route-cache-tier.test.mjs tests/mcp-api-parity.test.mjs tests/openapi-examples-contract.test.mjs tests/edge-functions.test.mjs tests/edge-function-bundles.test.mjs tests/api-route-exceptions.test.mjs tests/gateway-rpc-no-store-contract.test.mts`
  then `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-api.test.mts`, `npm run lint:api-contract`, `npm run typecheck:api` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat(marketing): add MarketingService proto, stub handlers and gateway"`

---

### Task 6: Convex tables and `convex/marketing/access.ts`

**Files:**
- Create: `convex/marketing/validators.ts`
- Modify: `convex/schema.ts`. Inside `defineSchema({...})` (which opens at `:114`), append the 5 tables after the last existing table.
- Create: `convex/marketing/access.ts`
- Regenerate: `convex/_generated/` via `npx convex codegen` (R17)
- Test: `convex/__tests__/marketingAccess.test.ts`

**Interfaces:**
- Consumes: `MARKETING_CATEGORIES` and the `MarketingSignalKind` values (Task 1), imported via `../../shared/marketing/types` (the precedent is `convex/userPreferences.ts:17`).
- Produces:
  - In `validators.ts`:
    - `marketingCategoryValidator`, a `v.union` of `v.literal` built from `MARKETING_CATEGORIES`
    - `marketingClientLocationValidator`, a `v.object` with the 8 `MarketingClientLocation` fields
    - `marketingSignalKindValidator`
    - `marketingSeverityValidator`, built from `'info' | 'watch' | 'warning'`
    - `marketingRoleValidator`, built from `'admin' | 'member'`
  - Tables, with field names exactly as in the index:
    - `marketingMembers {email: string, role, addedBy: string, addedAt: number}`, `.index('by_email', ['email'])`
    - `marketingClients {name, category, locations: v.array(location), competitors: v.array(v.string()), keywords: v.array(v.string()), accountManagerEmail: v.union(v.string(), v.null()), active: v.boolean(), updatedAt: v.number(), updatedBy: v.string()}`
    - `marketingAlertChannel {kind: v.union(v.literal('slack'), v.literal('email')), target: v.string(), updatedAt: v.number()}`
    - `clientAlertRules {clientId: v.id('marketingClients'), kind, enabled: v.boolean(), params: v.any(), createdAt: v.number()}`, `.index('by_client', ['clientId'])`
    - `marketingAlertEvents {dedupKey: v.string(), clientId: v.id('marketingClients'), kind, title: v.string(), url: v.union(v.string(), v.null()), severity, firedAt: v.number(), delivered: v.boolean()}`, `.index('by_dedup', ['dedupKey'])` and `.index('by_client_firedAt', ['clientId', 'firedAt'])` (R16)
  - `requireMarketingMember(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<{ email: string; role: 'admin' | 'member' }>`:
    - The identity comes from `ctx.auth.getUserIdentity()`.
    - It requires `identity.emailVerified === true` and a non-empty `identity.email`. The precedent is `convex/notificationChannels.ts:549`.
    - The email is trimmed and lowercased (R15).
    - If it equals the lowercased `process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL`, the result is `{email, role: 'admin'}`, with no table row needed.
    - Otherwise it looks the email up in `marketingMembers` `by_email` and uses that row's role.
    - Every other case throws `new ConvexError({ code: 'MARKETING_FORBIDDEN' })` (R15): no identity, an unverified email, or no row.
    - It is `getMyMembership` plus a throw on `null`.
    - The module reads env inside the function, never at module scope (`convex/lib/env.ts:3`). For an `ActionCtx`, which has no `db`, the member lookup goes through `ctx.runQuery(internal.marketing.access.getMemberByEmail, {email})`.
  - `findMarketingMemberByEmail(ctx: QueryCtx | MutationCtx | ActionCtx, email: string): Promise<{ email: string; role: 'admin' | 'member' } | null>` (R15). It normalizes the email, applies the bootstrap-admin rule, then the `by_email` lookup. It does not check identity and never throws.
  - `getMyMembership(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<{ email: string; role: 'admin' | 'member' } | null>` (R15). It returns `null`, without throwing, for no identity, an unverified email or no membership; otherwise `findMarketingMemberByEmail(ctx, identity.email)`.
  - `export const getMemberByEmail = internalQuery(...)`, which returns `{role}` or null.
  - No `gate.ts` (R15); W2 extends `access.ts` and W9 consumes it.

- [ ] **Step 1: Write the failing test** `convex/__tests__/marketingAccess.test.ts`. Follow the `convexTest(schema, modules)` and `t.withIdentity(...)` pattern from `convex/__tests__/alertRules.test.ts:1-8`. Inside `t.withIdentity(id).run(ctx => requireMarketingMember(ctx))`, it asserts:
  - The bootstrap email, in mixed case and with `MARKETING_BOOTSTRAP_ADMIN_EMAIL` set, resolves to `{email: lowercased, role: 'admin'}`.
  - A seeded `marketingMembers` row with role `'member'` resolves to that role.
  - A verified email that is not listed rejects with a `ConvexError` whose `data` deep-equals `{ code: 'MARKETING_FORBIDDEN' }`. All forbidden cases below assert that same `data` shape.
  - A member row stored as `ops@x.com` matches an identity email `'  Ops@X.com '`.
  - `emailVerified: false` rejects with `MARKETING_FORBIDDEN`.
  - No identity (`t.run`) rejects with `MARKETING_FORBIDDEN`.
  - Unset bootstrap env with no rows rejects with `MARKETING_FORBIDDEN`.
  - `getMyMembership` returns `null` (no throw) for no identity, `emailVerified: false` and an unlisted email, and the member object for a listed one.
  - `findMarketingMemberByEmail(ctx, ' OPS@x.com')` finds the `ops@x.com` row and returns `null` for an unknown email.
  - A query on `marketingAlertEvents` `.withIndex('by_client_firedAt', q => q.eq('clientId', id).gt('firedAt', t0))` returns only that client's newer events.
  - An `insert` into each of the 5 tables with valid shapes succeeds, which proves the schema.
- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run --config vitest.config.mts convex/__tests__/marketingAccess.test.ts`. Expected: FAIL with module not found.
- [ ] **Step 3: Implement `validators.ts`, the schema tables and `access.ts`.**
- [ ] **Step 4: Regenerate Convex bindings, run the test, then `npm run typecheck:api`.** Run `npx convex codegen` so `convex/_generated/api.d.ts` gains `marketing/access` (R17; regenerate, never hand-merge, including after any rebase). The typecheck includes `audit-convex-string-calls`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(marketing): add marketing Convex tables and member access helper"`

---

### Task 7: Placeholder panels, shared empty states, `createPanels()` wiring, switcher, i18n

**Files:**
- Create: `src/components/marketing/MarketingPlaceholderPanel.ts`
- Create: `src/components/marketing/empty-state.ts` (R18)
- Create: `src/components/marketing/{ClientRosterPanel,MarketingAlertsPanel,WeatherAlertsPanel,MarketingCalendarPanel,LocalMentionsPanel,DemandTrendsPanel}.ts`
- Modify: `src/app/panel-layout.ts`:
  - `createPanels()` (starts at `:2689`): after the energy `lazyPanel` block at `:2741-2755`, add `if (SITE_VARIANT === 'marketing') { … }` containing six `this.lazyDefaultPanel('<id>', () => import('@/components/marketing/<File>'), '<ExportName>')` calls. `lazyDefaultPanel` routes through `this.importPanel(...)` at `:4000`.
  - Desktop switcher (`:1068-1129`): when `SITE_VARIANT === 'marketing'`, render one `<a href="#" class="variant-option active" data-variant="marketing">` with icon `📣` and label `t('marketing.header.switcherLabel')`, in place of the six options. The other variants render the existing markup unchanged.
  - Mobile list (`:1189-1196`): when `SITE_VARIANT === 'marketing'`, the `variants` array is only `[{ key: 'marketing', icon: '📣', label: t('marketing.header.switcherLabel') }]`.
  - Do not add `marketing` to `VARIANT_SWITCHER_DASHBOARD_URLS` (`:240`).
- Modify: `src/locales/en.json`. Add keys:
  - `marketing.panel.comingSoon` = "Coming soon — this panel is being built."
  - `marketing.header.switcherLabel` = "MARKETING"
  - `marketing.header.panelCategory` = "Marketing"
  - `marketing.panels.{clientRoster,alerts,weatherAlerts,calendar,localMentions,demandTrends}`, with the names from Task 3
  - `marketing.empty.noClients` = "Add your first client to see signals here." (R18)
  - `marketing.common.sourceUnavailable` = "Source unavailable — showing nothing until it recovers." (R18)
  - `marketing.category.<id>` for all 15 `MARKETING_CATEGORIES` ids (for example `marketing.category.pest-control` = "Pest control") (R18)
- Modify: the other 27 `src/locales/*.json` files, through `npm run sync:locales` in Step 4 (R1).
- Modify test: `tests/dom/variant-navigation.test.mts`. Add an assertion that `VARIANT_SWITCHER_DASHBOARD_URLS` has no `marketing` key (Review Focus 4).
- Test: `tests/dom/marketing-placeholder-panels.test.mts`

**Interfaces:**
- Consumes: the panel ids (Task 3).
- Produces:
  - `export class MarketingPlaceholderPanel extends Panel`, with `constructor(id: string, titleKey: string)`. It renders `<p class="marketing-coming-soon">` with `textContent = t('marketing.panel.comingSoon')` through `this.setContentNodes(...)`, so no HTML string is set and lint:safe-html passes.
  - Six classes with a no-arg constructor. The export names match the file names, and the ids and title keys are:
    - `ClientRosterPanel`: `'client-roster'`, `'marketing.panels.clientRoster'`
    - `MarketingAlertsPanel`: `'marketing-alerts'`, `'marketing.panels.alerts'`
    - `WeatherAlertsPanel`: `'weather-alerts'`, `'marketing.panels.weatherAlerts'`
    - `MarketingCalendarPanel`: `'marketing-calendar'`, `'marketing.panels.calendar'`
    - `LocalMentionsPanel`: `'local-mentions'`, `'marketing.panels.localMentions'`
    - `DemandTrendsPanel`: `'demand-trends'`, `'marketing.panels.demandTrends'`
  - Each owning workstream replaces only its own file. It may extend `Panel` directly, but it keeps the export name and a no-arg constructor.
  - `empty-state.ts` (R18), DOM builders so callers stay safe-html clean:
    - `renderNoClientsState(): HTMLElement`, a `<div class="marketing-empty marketing-empty--no-clients">` whose text is `t('marketing.empty.noClients')`.
    - `renderSourceUnavailable(): HTMLElement`, a `<div class="marketing-empty marketing-empty--source-unavailable" role="status">` whose text is `t('marketing.common.sourceUnavailable')`.
    - `categoryLabel(id: MarketingCategory): string` returns `t('marketing.category.' + id)`.
    - Panels pass the result to `setContentNodes(...)`. Index Review Focus 1 and 3 owners use these instead of their own copies.

- [ ] **Step 1: Write the failing DOM test** `tests/dom/marketing-placeholder-panels.test.mts`. Call `initTestI18n()` from `tests/dom/helpers/i18n.mts`. For each of the 6 classes:
  - `new X().getElement().dataset.panel` equals the contract id. `Panel` sets it at `src/components/Panel.ts:204`.
  - `.panel-content .marketing-coming-soon` text equals `en.marketing.panel.comingSoon`.
  Also assert that `renderNoClientsState().textContent` equals `en.marketing.empty.noClients`, `renderSourceUnavailable()` has `role="status"` and the `sourceUnavailable` text, and `categoryLabel(c)` is a non-empty string different from its key for every `MARKETING_CATEGORIES` id.
- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-placeholder-panels.test.mts tests/dom/variant-navigation.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement the panels, `empty-state.ts`, the wiring, the switcher branches and the en.json keys.**
- [ ] **Step 4: Sync locales with English fallbacks (R1).**
  - Run `npm run sync:locales`, then `npm run sync:locales -- --check`. Expected: no gap.
  - `sync-locale-keys.mjs` skips generated `zh-TW.json`, so zh-TW is flagged: run `pip install opencc-python-reimplemented && npm run locales:zh-tw`.
  - Do not run `translate-locales.mjs`; real translation is deferred (R1).
  - On a rebase conflict in locale JSON, take the base version and re-run `sync:locales` (R1).
  - `tests/app-locale-freshness.test.mjs` will still fail on the baseline, stale-key and English-ceiling checks (new issue A). Record the exact failing assertions; do not edit that test or the baseline without an index decision.
- [ ] **Step 5: Run the DOM tests and the locale and guardrail suites.** Run:
  - `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-placeholder-panels.test.mts tests/dom/variant-navigation.test.mts`
  - `node --import tsx --test tests/locale-completeness.test.mjs tests/locale-keys-resolvable.test.mjs tests/panel-config-guardrails.test.mjs`
  - `node --import tsx --test tests/app-locale-freshness.test.mjs` (expected to fail only as recorded in Step 4 until new issue A is decided)
  - `npm run locales:zh-tw:check`
  - `npm run lint`
  Expected: all PASS except the recorded freshness assertions.
- [ ] **Step 6: Commit.** `git commit -m "feat(marketing): add placeholder marketing panels and variant switcher entry"`

---

### Task 8: Map-layer hook (`src/components/marketing/map/*` + DeckGLMap)

**Files:**
- Create: `src/components/marketing/map/types.ts`. It holds `MarketingLayerContext` as in the index plus the R9 fields.
- Create: `src/components/marketing/map/{clients-layer,nws-layer,mentions-layer}.ts`
- Create: `src/components/marketing/map/index.ts`
- Modify: `src/components/DeckGLMap.ts`:
  - Add the field `private marketingLayerContext: MarketingLayerData = EMPTY_MARKETING_LAYER_DATA`.
  - Add the public `setMarketingLayerContext(patch)` next to `setWeatherAlerts` (`:7044`).
  - In `buildLayers()`, just before `const result = layers.filter(Boolean)` (`:2407`), add `if (SITE_VARIANT === 'marketing') layers.push(...buildMarketingLayers(this.getMarketingLayerContext()));`.
  - In the private `getTooltip(info)` (`:4939`), after the `!info.object` guard, add `if (layerId.startsWith('marketing-')) return getMarketingTooltip(info);`. Every other layer id takes the existing switch unchanged.
- Modify: `src/components/MapContainer.ts`. Add the passthrough `setMarketingLayerContext(patch)` next to `setWeatherAlerts` (`:1101`) (R9). It merges into a `cachedMarketingLayerContext` and replays it wherever the other `cached*` fields are replayed into a newly created `deckGLMap`.
- Test: `tests/marketing-map-layers.test.mts`

**Interfaces:**
- Consumes: `MarketingClient` and `MarketingSignal` (Task 1); `getFocusedClientId()` (Task 4); `WeatherAlert` and `Mention` re-exported from `@/services/marketing/api` (Task 5); the layer keys (Task 3).
- Produces:
  - `MarketingLayerContext = { clients: MarketingClient[]; focusedClientId: string | null; signals: MarketingSignal[]; visibleLayerIds: Set<string>; weatherAlerts: WeatherAlert[]; mentions: Mention[] }` (R9). `signals` stays for W8. It is re-exported from `index.ts`.
  - `MarketingLayerData = Omit<MarketingLayerContext, 'visibleLayerIds'>` and `EMPTY_MARKETING_LAYER_DATA` (all arrays empty, `focusedClientId: null`).
  - `buildMarketingClientsLayer(ctx)` (W3), `buildNwsAlertsLayer(ctx)` (W4) and `buildLocalMentionsLayer(ctx)` (W6). Each returns `Layer | null`; a `CompositeLayer` is allowed (R9). Each is a `return null` stub in W0. Layer ids must start with `marketing-` (`marketing-clients`, `marketing-nws`, `marketing-mentions`, or sub-layers of those).
  - Tooltips (R9): each builder file also exports `get<Name>Tooltip(info: PickingInfo): { html: string } | null` (`getMarketingClientsTooltip`, `getNwsAlertsTooltip`, `getLocalMentionsTooltip`), a `return null` stub in W0 that the layer owner fills. `index.ts` exports `getMarketingTooltip(info): { html: string } | null`, which routes by layer-id prefix to the owning file and catches a throwing tooltip (returns `null`). Owners must escape text (`escapeHtml`), as the existing tooltips do.
  - `buildMarketingLayers(ctx: MarketingLayerContext): Layer[]`:
    - It calls a builder only when its layer id is in `ctx.visibleLayerIds`, mapping `marketingClients` → clients, `nwsAlerts` → nws and `localMentions` → mentions.
    - It drops `null` results.
    - It catches a throwing builder and logs `console.warn('[marketing-map] <id> failed', err)`, so that one broken layer never blanks the map.
  - `setMarketingLayerContext(patch: Partial<MarketingLayerData>): void` on `DeckGLMap` and `MapContainer` (R9). It shallow-merges the patch (each key replaces that key only, so W3 `clients`, W4 `weatherAlerts`, W6 `mentions` and W8 `signals` never overwrite each other) and triggers one rebuild via `this.render()`. A `visibleLayerIds` key in the patch is ignored.
  - `mergeMarketingLayerData(prev: MarketingLayerData, patch: Partial<MarketingLayerData>): MarketingLayerData`, exported from `index.ts` as the pure merge both classes use.
  - `getMarketingLayerContext()` is private. It returns the stored data plus `visibleLayerIds`, derived each build from the `true` keys among the three marketing layer ids in `this.state.layers`. `focusedClientId` starts from `getFocusedClientId()`. W3 adds the `onFocusChange` → `setMarketingLayerContext({focusedClientId})` wiring and the roster → `setMarketingLayerContext({clients})` wiring.

- [ ] **Step 1: Write the failing test** `tests/marketing-map-layers.test.mts`. Use `node:test` `mock.module`, or pass builders through an injectable second parameter `builders = DEFAULT_BUILDERS`; if you use the parameter, add it to the `buildMarketingLayers` signature as optional, and give `getMarketingTooltip` the same optional `tooltips = DEFAULT_TOOLTIPS` parameter. Assert:
  - With the stubs, `buildMarketingLayers(ctx)` deep-equals `[]`.
  - With fake builders returning sentinel objects, only the ids in `visibleLayerIds` are called.
  - A builder that throws is skipped and the others still return.
  - Empty `clients` with all three ids visible does not throw.
  - `mergeMarketingLayerData`: a `{weatherAlerts}` patch keeps prior `clients`, `mentions` and `signals`; a later `{mentions}` patch keeps the alerts; an empty patch returns equal data; a `visibleLayerIds` key is dropped.
  - `getMarketingTooltip`: `null` for every stub and for a non-marketing layer id; a fake tooltip that throws returns `null`; a fake routed by `marketing-nws-*` prefix is called and its result returned.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-map-layers.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement the map files, `setMarketingLayerContext` on DeckGLMap and MapContainer, the `buildLayers` hook and the `getTooltip` hook.**
- [ ] **Step 4: Run the new test, the existing map suites and the checks.** Run `node --import tsx --test tests/marketing-map-layers.test.mts tests/map-overlay-budget-disclosure.test.mjs tests/resilience-map-layer.test.mts`, then `npm run typecheck` and `npm run lint:boundaries`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(marketing): add marketing map-layer builder hook"`

---

### Task 9: Marketing mission presets

**Files:**
- Modify: `shared/mission-domain.ts:1-11`. Append `'marketing-overview'`, `'marketing-client-focus'` and `'marketing-storm-watch'` to `MISSION_PRESET_IDS`.
- Modify: `src/services/mission-presets.ts`:
  - Append three presets after `country-watcher` (`:361`).
  - Change `isMissionPresetAvailableForVariant` (`:431-437`) so that when `variant === 'marketing'`, it returns `preset.variants?.includes('marketing') === true`. Other variants keep their current logic.
- Modify tests:
  - `tests/mission-presets.test.mts:647-660`: the expected id list gains the three ids.
  - `tests/mission-presets.test.mts:69`: `VARIANTS` gains `'marketing'`.
- Test: `tests/marketing-mission-presets.test.mts`

**Interfaces:**
- Consumes: the panel ids and layer keys (Task 3).
- Produces three presets, all with `variants: ['marketing']`. `marketing-overview` comes first and is the default, so it is listed first:
  - `marketing-overview`:
    - Label `'Agency Overview'`, short label `'Overview'`, description `'Every client market at a glance: alerts, mentions, calendar, and demand.'`, icon `'M'`.
    - View `'america'`, zoom `3.6`, time range `'24h'`.
    - Panels: `['map','insights','marketing-alerts','local-mentions','marketing-calendar','demand-trends','platform-updates']`.
    - Layers: `['marketingClients','nwsAlerts','localMentions']`.
  - `marketing-client-focus`:
    - Label `'Client Focus'`, short label `'Client'`, description `'Drill into one client: its mentions, alerts, weather, and calendar.'`, icon `'C'`.
    - View `'america'`, zoom `4.2`, time range `'7d'`.
    - Panels: `['map','local-mentions','marketing-alerts','weather-alerts','marketing-calendar','client-roster']`.
    - Layers: `['marketingClients','localMentions','nwsAlerts']`.
  - `marketing-storm-watch`:
    - Label `'Storm Watch'`, short label `'Storms'`, description `'Weather-first: NWS warnings crossing client service areas.'`, icon `'W'`.
    - View `'america'`, zoom `3.8`, time range `'24h'`.
    - Panels: `['map','weather-alerts','marketing-alerts','local-mentions','client-roster']`.
    - Layers: `['nwsAlerts','marketingClients']`.

- [ ] **Step 1: Write the failing test** `tests/marketing-mission-presets.test.mts`. It asserts:
  - `getMissionPresetsForVariant('marketing').map(p => p.id)` deep-equals the three ids in the order above.
  - `getMissionPresetsForVariant('full')` contains none of them (Review Focus 4).
  - `getMissionPresetsForVariant('full').length` is unchanged from before. Pin the current count of 8 as a literal.
  - `applyMissionPresetToState('marketing-storm-watch', getInitialPanelSettingsForVariant('marketing'), DEFAULT_MAP_LAYERS, 'marketing').mapLayers.nwsAlerts === true`.
  - The applied result enables at least 2 panels.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-mission-presets.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement the ids, the presets and the availability rule.**
- [ ] **Step 4: Run the preset suites.** Run `node --import tsx --test tests/marketing-mission-presets.test.mts tests/mission-presets.test.mts tests/mission-funnel-events.test.mts tests/webmcp-mission-presets.test.mts`. Expected: PASS. In particular, `finance.count === full.count + 1` at `tests/webmcp-mission-presets.test.mts:110` must still hold.
- [ ] **Step 5: Commit.** `git commit -m "feat(marketing): add marketing mission presets"`

---

### Task 10: Whole-variant verification and PR

**Files:**
- Modify (only if the generator changes them): the inventory and product-facts outputs written by `npm run inventory:facts`. Find them with `git status` after running it. Layer, panel and endpoint counts change.
- No new source.

**Interfaces:**
- Consumes: everything above.
- Produces: the W0 PR that W1–W9 branch from.

- [ ] **Step 1: Regenerate the inventory facts.** Run `npm run inventory:facts`, then `node --import tsx --test tests/public-product-facts.test.mjs tests/docs-stats-api-endpoints.test.mts tests/docs-stats-layer-registry.test.mjs`. Expected: PASS. Commit any regenerated files: `git commit -m "chore(marketing): refresh inventory facts"`.
- [ ] **Step 2: Drive the marketing boot.**
  - Run `WM_VERIFY_VARIANT=marketing .agents/skills/verify-worldmonitor/scripts/wm-verify.sh launch`, then `doctor`, then `drive dashboard-boot.mjs --name marketing-boot`.
  - Repeat the drive with localStorage seeded to `worldmonitor-variant=tech` (Review Focus 1).
  - Expected:
    - `<html data-variant="marketing">`.
    - The map plus the six placeholder panels render in the index layout order. The three news panels are absent until W1 adds feeds.
    - Choose Workspace lists only Agency Overview, Client Focus and Storm Watch.
    - The switcher shows only MARKETING.
    - The console has no uncaught errors.
  - Capture desktop and mobile screenshots. Then run `cleanup`.
- [ ] **Step 3: Check the other variants.** Launch with `WM_VERIFY_VARIANT=full`, drive `dashboard-boot.mjs` and run `cleanup`, then do the same for `WM_VERIFY_VARIANT=commodity`. Expected: the switcher has the same six options, Choose Workspace has no marketing presets, and boot is clean.
- [ ] **Step 4: Run the full checks one at a time.**
  - `npm run typecheck`, `npm run typecheck:api`, `npm run lint`, `npm run lint:boundaries` and `git diff --check`
  - Then `npm run test:data`, `npm run test:dom` and `npm run test:convex`
  - Expected: no new failures against `main` other than the `app-locale-freshness` assertions recorded in Task 7 (new issue A). Record any pre-existing failures with their names. If issue A is still open, the PR description states it as a known failure, and the PR is not marked ready until the index decides it.
- [ ] **Step 5: Check the bundle for privacy (Review Focus 2).** Run `npm run build:marketing && ! grep -rl "Fixture " dist/`. Expected: the build succeeds and grep finds nothing. Then run `grep -l 'noindex, nofollow' dist/index.html`, which is expected to match.
- [ ] **Step 6: Open the PR to the fork's `main`.**
  - Run preflight `--mode repair` first, and refresh the base.
  - Open the PR to the fork `areimel/marketing-situation-room`.
  - Upload the screenshots: `gh pr edit <n> --attach '/abs/marketing-boot-desktop.png#Marketing variant boot (desktop)' --attach '/abs/marketing-boot-mobile.png#Marketing variant boot (mobile)'`.
  - End the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Contract Issues (resolved)

1. i18n fallback vs. the repo's locale tests -> **R1** (`sync:locales` English fallbacks; translation deferred). Its test conflict remains open as new issue A.
2. `index.html` prepaint and `middleware.ts` `VARIANT_HOST_MAP` not registered -> **R2** (confirmed; W0 pins the build variant with `isPinnedBuildVariant`).
3. `MarketingLayerContext.signals` had no defined writer -> **R9** (`setMarketingLayerContext(patch)` replaces the per-kind setters; context gains `weatherAlerts` and `mentions`; `signals` stays for W8).
4. Proto field types unstated -> **R3** and **R4** (int64 epoch ms; `0,0` = no location; `degraded` on every response; `WeatherAlert.zone_codes/state_codes` and mapped `severity`; `TrendPoint`; string `traffic`).
5. News variant allow-lists unowned -> **R20** (W1 owns `VALID_VARIANTS`, `NEWS_VARIANTS`, the news proto comment and rerun). W0 still adds only the empty `MARKETING_FEEDS` stub.
6. Existing `weather` layer overlaps `nwsAlerts` -> not addressed by a resolution; W0 keeps `weather` off in `MARKETING_MAP_LAYERS`, and W4 decides whether to reuse it.
7. MCP `admin:` exclusion before the gate exists -> partly **R5** (all four paths `no-store`, mentions POST, no logging) and **R21/R23** (W9's gateway check). Until W9 lands, the stubs are reachable but return empty lists and carry no client data.

### New unresolved issues

A. **R1 conflicts with `tests/app-locale-freshness.test.mjs`.** `sync:locales` writes English copies, but that suite (1) requires `scripts/locale-baselines/app.json` to equal `en.json` for every key, and its only documented refresh path is `translate-locales.mjs` (needs `ANTHROPIC_API_KEY`); and (2) caps English-identical values per locale with `ENGLISH_CEILING`. Roughly 30 new `marketing.*` keys copied into 26 locales will exceed the ceilings. The index needs to choose one: exempt the `marketing.` prefix in that test (internal variant), raise each ceiling by the marketing key count and refresh the baseline by script, or allow `translate-locales.mjs` after all. Until then W0's PR has a known failing suite, and every W1–W9 PR that adds keys inherits it.
B. **R9's "tooltip through deck.gl `getTooltip` on its layer" has no per-layer hook in deck.gl.** `getTooltip` is a single `Deck` prop, and DeckGLMap routes it through one private switch (`:4939`). W0 adds a `marketing-` prefix dispatch to per-file `get<Name>Tooltip` exports (Task 8). W3, W4 and W6 should confirm that they will fill those exports and keep their layer ids under the `marketing-` prefix.
C. **R5 says no-store "when `isMarketingDeploy()` is on".** W0 makes the four paths `no-store` unconditionally, because `RPC_CACHE_TIER` is a static map. This is stricter, not looser. Flagged only so that W9 does not add a deploy-flag branch that re-enables caching when the flag is off.
