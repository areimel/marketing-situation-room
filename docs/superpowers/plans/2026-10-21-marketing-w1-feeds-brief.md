# Marketing W1: Trade Feeds + AI Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `marketing` variant three trade-news panels (`platform-updates`, `local-seo`, `marketing-industry`) served from a dedicated server digest, plus a marketing-aware keyword classifier and AI Brief prompt.

**Architecture:** The client catalog `MARKETING_FEEDS` (`src/config/feeds.ts`) becomes the marketing `FEEDS` preset. It joins `CANONICAL_FEEDS` only when `SITE_VARIANT === 'marketing'`, so other variants stay byte-for-byte the same. The server catalog `VARIANT_FEEDS.marketing` (`server/worldmonitor/news/v1/_feeds.ts`) mirrors it name-for-name. `list-feed-digest` accepts `variant=marketing`, so the panels get a real `news:digest:v1:marketing:{lang}` digest instead of a fallback to `full`. `classifyByKeyword` and `buildArticlePrompts` each gain a `variant === 'marketing'` branch, shaped like the existing `tech` branch.

**Tech Stack:** TypeScript, node:test via tsx, esbuild test bundling (`tests/_lib/bundle-feeds-module.mts`), sebuf proto codegen (comment-only change), Mintlify docs.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md` (section "Signals", row "Industry and platform news"; "Execution plan", W1). Binding contracts: `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

- Every item in the index's **Global Constraints** applies, in particular:
  - **Additive:** behaviour must be byte-for-byte unchanged when `VITE_VARIANT !== 'marketing'`.
  - New RSS domains go in `shared/rss-allowed-domains.json`.
  - English strings go under `marketing.*` in `src/locales/en.json`.
  - Node 24.
  - Run `npm run --silent agent:preflight -- --mode repair` before implementing.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Contract Resolutions that bind W1** (index, "Contract Resolutions"):
  - **#1 Locales:** after adding English strings to `en.json`, run `npm run sync:locales` (plus `npm run locales:zh-tw` if zh-TW is flagged) and commit the regenerated locale files. On a rebase conflict in locale JSON, take the base version and re-run `sync:locales`.
  - **#2 No public host mapping:** W1 never touches `index.html` prepaint or `middleware.ts` `VARIANT_HOST_MAP`.
  - **#6 User-Agent:** W1 keeps the existing digest fetcher's User-Agent and does not consume `marketingUserAgent()`.
  - **#20 Ownership:** W1 owns `VALID_VARIANTS` (`list-feed-digest.ts`), `NEWS_VARIANTS` (`public-rpc-cache.ts`), the news proto comment and its `make generate` rerun, `shared/publisher-families.js`, and the `InsightsPanel.ts` brief heading.
  - **Known source limits:** Search Engine Land and MarTech come through Google News `site:` searches, as in the feed table.
  - W1 consumes no W0 helper (`api.ts`, `geo.ts`, `empty-state.ts`, `_user-agent.ts`): its panels are reused `NewsPanel`s and `insights`, and none of the `MarketingService` RPCs or their cache tiers (#5) apply to the news digest.
- **Panel category keys are exactly** `platform-updates`, `local-seo`, `marketing-industry` (index, "Reused panels"). W0 owns their `MARKETING_PANELS` entries in `src/config/panels.ts`. W1 never edits `panels.ts`.
- **Free sources only.** Each feed below was checked live on 2026-10-21; the result is shown in the right-hand column. A feed with no working direct RSS was dropped as a direct feed. Where Google News still covers that publisher, the publisher is carried as a Google News `site:` query, which is the repo's standard fallback (see the Blockworks note in `tests/feeds-client-server-parity.test.mjs`).

**The feed table.** The names, URLs and tiers below are the values used everywhere in this plan. Keep the same order within each category on the client and the server.

| Category | Name | Client URL (wrapped in `rss(...)`) / server URL | Tier | Verification |
|---|---|---|---|---|
| `platform-updates` | `Google Search Central Blog` | `https://developers.google.com/search/blog/feed.xml` | 1 | 200 RSS, item 2026-10-06 |
| `platform-updates` | `Google Ads & Commerce Blog` | `https://blog.google/products/ads-commerce/rss/` | 1 | 200 RSS, item 2026-10-21 |
| `platform-updates` | `Meta Newsroom` | `https://about.fb.com/news/feed/` | 1 | 200 RSS, item 2026-10-15 |
| `platform-updates` | `Search Engine Roundtable` | `https://feeds.feedburner.com/SearchEngineRoundtable1` | 3 | 200 RSS. `www.seroundtable.com/index.xml` 302s to plain-http `feeds.seroundtable.com`, so it is not used |
| `platform-updates` | `Search Engine Land` | client `https://news.google.com/rss/search?q=site:searchengineland.com+when:3d&hl=en-US&gl=US&ceid=US:en`; server `gn('site:searchengineland.com when:3d')` | 3 | Direct `/feed` returns a 403 Cloudflare challenge. The GN query returned 42 items |
| `local-seo` | `BrightLocal` | `https://www.brightlocal.com/resources/feed/` | 4 | 200 RSS, item 2026-10-14. `/feed/` and `/blog/feed/` return HTML |
| `local-seo` | `Sterling Sky` | `https://www.sterlingsky.ca/feed/` | 4 | 200 RSS, item 2026-09-30 |
| `local-seo` | `Whitespark` | `https://whitespark.ca/feed/` | 4 | 200 RSS, item 2026-10-08 |
| `local-seo` | `Local Search News` | client `https://news.google.com/rss/search?q=("Google+Business+Profile"+OR+"local+SEO"+OR+"Google+Maps"+reviews)+when:3d&hl=en-US&gl=US&ceid=US:en`; server `gn('("Google Business Profile" OR "local SEO" OR "Google Maps" reviews) when:3d')` | 4 | GN query returned 29 items |
| `marketing-industry` | `MarTech` | client `https://news.google.com/rss/search?q=site:martech.org+when:3d&hl=en-US&gl=US&ceid=US:en`; server `gn('site:martech.org when:3d')` | 3 | Direct `/feed` returns 403. The GN query returned 13 items |
| `marketing-industry` | `Social Media Today` | `https://www.socialmediatoday.com/feeds/news/` | 3 | 200 RSS, item 2026-10-20 |
| `marketing-industry` | `Marketing Dive` | `https://www.marketingdive.com/feeds/news/` | 3 | 200 RSS, item 2026-10-21 |

- **New allowlist hosts** (insert in sorted position):
  - `about.fb.com`
  - `blog.google`
  - `developers.google.com`
  - `whitespark.ca`
  - `www.brightlocal.com`
  - `www.marketingdive.com`
  - `www.socialmediatoday.com`
  - `www.sterlingsky.ca`
  - `feeds.feedburner.com` and `news.google.com` are already listed.
- **Feed count:** 12 feeds in total, in 3 server inventory rows. The server inventory row count goes from 66 to 69.

## Review Focus

1. **Low-frequency local-SEO blogs fall outside the 96 h digest freshness floor** (`resolveMaxAgeMs`, which is global and must not change). Without a fix, `local-seo` would often be empty. The `Local Search News` Google News query keeps the panel populated. Task 1 pins this: `local-seo` must contain at least one Google News feed.
2. **A delivery-host feed hits the publisher-link gate (#8398).** Search Engine Roundtable is fetched from `feeds.feedburner.com`, but its item links point at `www.seroundtable.com`. The gate would blank those links. A domain-only publisher family fixes this. Task 2 pins it with `isItemLinkAllowed`.
3. **Marketing headlines that contain words on the generic `EXCLUSIONS` list** (`shopping`, `fitness`, `game`) would be forced to `info`, for example "Google Shopping ads…". The marketing branch skips `EXCLUSIONS`, and `full` keeps the forced `info`. Task 3 pins both.
4. **`variant=marketing` silently served the geopolitical `full` digest.** It must be accepted by `VALID_VARIANTS` and must count as a public CDN shape (`NEWS_VARIANTS`). Otherwise `publicRpcFetch` strips credentials and the request is gated. Task 2 pins both.
5. **Other variants drifting.** `full` must not gain marketing categories or sources, and must keep its prompts and classifier output. Tasks 1, 3 and 4 each pin the `full` result next to the `marketing` result.

---

### Task 1: Client `MARKETING_FEEDS`, allowlist, tiers

**Files:**
- Modify: `src/config/feeds.ts`
  - Add `export const MARKETING_FEEDS` after `ENERGY_FEEDS` (which ends near line 1104).
  - Add a branch to the `FEEDS` ternary at lines 1107-1118.
  - Update the `CANONICAL_FEEDS` merge list at lines 1138-1146.
- Modify: `shared/rss-allowed-domains.json`, `scripts/shared/rss-allowed-domains.json` (byte-identical copy), `api/_rss-allowed-domains.js` (literal mirror). All three stay sorted.
- Modify: `shared/source-tiers.json` and `scripts/shared/source-tiers.json` (byte-identical copy). Add 12 keys using the tiers from the table.
- Modify: `tests/_lib/bundle-feeds-module.mts`. Add an optional `variant` option.
- Regenerate: `shared/source-attribution-manifest.json`, `docs/source-attribution.mdx` (`npm run sources:generate`).
- Test: `tests/marketing-feeds.test.mts` (new)

**Interfaces:**
- Produces:
  - `export const MARKETING_FEEDS: Record<'platform-updates' | 'local-seo' | 'marketing-industry', Feed[]>` (declare it as `Record<string, Feed[]>`, matching its siblings).
  - `export function canonicalFeedCatalogs(variant: string): Record<string, Feed[]>[]`. It returns the existing seven catalogs in their current order, plus `MARKETING_FEEDS` last, only when `variant === 'marketing'`.
  - `CANONICAL_FEEDS = mergeCanonicalFeeds(canonicalFeedCatalogs(SITE_VARIANT))`.
  - `BundleFeedsModuleOptions.variant?: string`. The default is `'full'`, and it sets `VITE_VARIANT` in the define.

- [ ] **Step 1: Add `variant?: string` to `BundleFeedsModuleOptions`** and use `VITE_VARIANT: opts.variant ?? 'full'` in the define. Existing callers are unaffected.

- [ ] **Step 2: Write the failing test** `tests/marketing-feeds.test.mts`.
  - Build two bundles: `bundleFeedsModule({ variant: 'marketing', outfileName: 'marketing.mjs' })` and `bundleFeedsModule({ variant: 'full', outfileName: 'full.mjs' })`. Use temp dir `tmp-marketing-feeds-test`, removed in `after()`.

```ts
const MARKETING_KEYS = ['platform-updates', 'local-seo', 'marketing-industry'];
it('marketing preset is exactly the three trade categories', () => {
  assert.deepEqual(Object.keys(mk.FEEDS), MARKETING_KEYS);
  assert.deepEqual(Object.keys(mk.MARKETING_FEEDS), MARKETING_KEYS);
  for (const k of MARKETING_KEYS) assert.ok(mk.CANONICAL_FEEDS[k]?.length > 0);
});
it('full variant gains no marketing category or source', () => {
  for (const k of MARKETING_KEYS) { assert.equal(full.CANONICAL_FEEDS[k], undefined); assert.equal(full.FEEDS[k], undefined); }
  assert.ok(!full.listConfiguredFeedNames().includes('Marketing Dive'));
  assert.equal(full.FEEDS, full.FULL_FEEDS);
});
it('feed names, order and tiers match the plan table', () => {
  assert.deepEqual(mk.MARKETING_FEEDS['platform-updates'].map(f => f.name),
    ['Google Search Central Blog', 'Google Ads & Commerce Blog', 'Meta Newsroom', 'Search Engine Roundtable', 'Search Engine Land']);
  assert.deepEqual(mk.MARKETING_FEEDS['local-seo'].map(f => f.name), ['BrightLocal', 'Sterling Sky', 'Whitespark', 'Local Search News']);
  assert.deepEqual(mk.MARKETING_FEEDS['marketing-industry'].map(f => f.name), ['MarTech', 'Social Media Today', 'Marketing Dive']);
  // tier per name from the table, e.g.
  assert.equal(mk.SOURCE_TIERS['Meta Newsroom'], 1);
  assert.equal(mk.SOURCE_TIERS['Marketing Dive'], 3);
  assert.equal(mk.SOURCE_TIERS['Whitespark'], 4);
});
it('every marketing feed is https and passes the RSS proxy allowlist', () => {
  for (const f of Object.values(mk.MARKETING_FEEDS).flat()) {
    const u = new URL(f.url as string);
    assert.equal(u.protocol, 'https:');
    assert.ok(isAllowedDomain(u.hostname), `${f.name}: ${u.hostname}`);
  }
});
it('local-seo keeps a Google News feed so the 96h freshness floor never empties it (Review Focus 1)', () => {
  assert.ok(mk.MARKETING_FEEDS['local-seo'].some(f => String(f.url).includes('news.google.com/rss/search')));
});
it('never uses the Cloudflare-blocked direct SEL / MarTech feeds', () => {
  const urls = Object.values(mk.MARKETING_FEEDS).flat().map(f => String(f.url));
  assert.ok(!urls.some(u => /searchengineland\.com\/feed|martech\.org\/feed/.test(u)));
});
```

  - `isAllowedDomain` is imported from `../api/_rss-allowed-domain-match.js`, following the pattern in `tests/times-of-india-feed.test.mts`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --import tsx --test tests/marketing-feeds.test.mts`
Expected: FAIL. `mk.MARKETING_FEEDS` is undefined.

- [ ] **Step 4: Implement**
  - Add `MARKETING_FEEDS` with the entries from the table, shaped `{ name, url: rss('…') }`.
  - Add `: SITE_VARIANT === 'marketing' ? MARKETING_FEEDS` to the `FEEDS` ternary, just before the final `: FULL_FEEDS`.
  - Add `canonicalFeedCatalogs` and use it for `CANONICAL_FEEDS`.
  - Add the 8 hosts to all three allowlist mirrors.
  - Add the 12 tier keys to both `source-tiers.json` copies (append; the file is not sorted).

- [ ] **Step 5: Regenerate attribution:** `npm run sources:generate`, then `npm run sources:check`.
  - Expected: check passes.
  - The manifest gains `terms-review` feed rows for the new hosts, plus `searchengineland.com` and `martech.org` as Google News editorial hosts.
  - Inspect the diff: only marketing hosts are added.

- [ ] **Step 6: Run the tests to verify they pass, and confirm `full` is unchanged**

Run: `node --import tsx --test tests/marketing-feeds.test.mts tests/source-provenance.test.mts tests/feed-catalog-drift.test.mts tests/source-attribution.test.mjs tests/edge-functions.test.mjs tests/source-tier-docs.test.mts`
Expected: PASS.
- `source-provenance` must still pass without regenerating `shared/source-provenance-declarations.ts`. The generator bundles with `VITE_VARIANT: 'full'`, so marketing names are not "configured" there. If it fails, the canonical gating is wrong. Fix the gating; do not regenerate.

- [ ] **Step 7: Commit**

```bash
git add src/config/feeds.ts shared/rss-allowed-domains.json scripts/shared/rss-allowed-domains.json api/_rss-allowed-domains.js shared/source-tiers.json scripts/shared/source-tiers.json shared/source-attribution-manifest.json docs/source-attribution.mdx tests/_lib/bundle-feeds-module.mts tests/marketing-feeds.test.mts
git commit -m "feat(marketing): add marketing trade feed catalog"
```

---

### Task 2: Server `VARIANT_FEEDS.marketing` + accepted digest variant

**Files:**
- Modify: `server/worldmonitor/news/v1/_feeds.ts`. Insert a `  marketing: {` block after the `happy` block, before the closing `};` at line 759.
  - Use exact line shapes, which the inventory parser requires: `  marketing: {`, `    'platform-updates': [`, `    ],`, `  },`.
- Modify: `server/worldmonitor/news/v1/list-feed-digest.ts:125`. Set `VALID_VARIANTS` to `['full','tech','finance','happy','commodity','marketing']`.
- Modify: `src/shared/public-rpc-cache.ts:18`. Add `'marketing'` to `NEWS_VARIANTS`.
- Modify: `shared/publisher-families.js` and `scripts/shared/publisher-families.js` (byte-identical):
  - Add the domain-only family `'seroundtable': { publisher: "Search Engine Roundtable", labels: [] }`.
  - Add the domain entry `'seroundtable': ['seroundtable.com']`.
  - Follow the `wsj` precedent.
- Modify: `tests/publisher-families.test.mjs:237`. Change to `DOMAIN_ONLY_FAMILIES = new Set(['wsj', 'miit', 'seroundtable'])`.
- Modify: `proto/worldmonitor/news/v1/list_feed_digest.proto:9`. Change the comment to `// Digest variant: full, tech, finance, happy, commodity, marketing. Unsupported site variants, including energy, currently fall back to full.`, then run `make generate`.
- Modify docs:
  - `docs/methodology/news-digest-and-briefing.mdx` (variant table near line 79). Add the row `` | `marketing` | Search and ads platform updates, local-SEO, and marketing-industry trade streams for the agency marketing room. | ``.
  - `docs/data-sources.mdx` (after the `happy` rows near line 325). Add three rows, in server order:
    - `` | `marketing` | `platform-updates` | Google Search Central Blog; Google Ads & Commerce Blog; Meta Newsroom; Search Engine Roundtable; Search Engine Land | ``
    - `` | `marketing` | `local-seo` | BrightLocal; Sterling Sky; Whitespark; Local Search News | ``
    - `` | `marketing` | `marketing-industry` | MarTech; Social Media Today; Marketing Dive | ``
- Modify tests:
  - `tests/news-digest-methodology-parity.test.mjs`. Change line 498 `66` to `69`, and line 575 to the six-variant list ending in `'marketing'`.
  - `tests/news-feed-key-parity.test.mts:52`. Add `{ clientConst: 'MARKETING_FEEDS', serverKey: 'marketing', knownGapsClientOnly: [] }`.
- Test: `tests/marketing-feed-digest.test.mts` (new)

**Interfaces:**
- Consumes: `MARKETING_FEEDS` (Task 1).
- Produces:
  - `VARIANT_FEEDS.marketing: Record<string, ServerFeed[]>`, with the same category keys and names as `MARKETING_FEEDS`.
  - The digest accepts `variant=marketing`.

- [ ] **Step 1: Write the failing test** `tests/marketing-feed-digest.test.mts`.
  - It imports `VARIANT_FEEDS` from `../server/worldmonitor/news/v1/_feeds`, `__testing__` from `../server/worldmonitor/news/v1/list-feed-digest`, and `isPublicSharedRpcRequest` from `../src/shared/public-rpc-cache.ts`.

```ts
it('server marketing catalog mirrors the client names per category', () => {
  assert.deepEqual(Object.keys(VARIANT_FEEDS.marketing), ['platform-updates', 'local-seo', 'marketing-industry']);
  assert.deepEqual(VARIANT_FEEDS.marketing['local-seo'].map(f => f.name), ['BrightLocal', 'Sterling Sky', 'Whitespark', 'Local Search News']);
  // same for the other two categories, names from the plan table
});
it('digest builds 12 marketing feed entries', () => {
  const { allEntries } = __testing__.buildDigestFeedBatches('marketing', 'en');
  assert.equal(allEntries.length, 12);
});
it('feedburner-delivered SER links pass the publisher-link gate (Review Focus 2)', () => {
  const feed = { url: 'https://feeds.feedburner.com/SearchEngineRoundtable1' };
  const item = { source: 'Search Engine Roundtable', originPublisher: '', originPublisherTrusted: false };
  assert.equal(__testing__.isItemLinkAllowed('https://www.seroundtable.com/google-core-update-42355.html', item, feed), true);
  assert.equal(__testing__.isItemLinkAllowed('https://evil.example/x', item, feed), false);
});
it('variant=marketing is a public digest shape (Review Focus 4)', () => {
  assert.equal(isPublicSharedRpcRequest('https://api.worldmonitor.app/api/news/v1/list-feed-digest?variant=marketing&lang=en&public=1'), true);
});
```

  - The `VALID_VARIANTS` half of Review Focus 4 is pinned by the methodology test edit.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/marketing-feed-digest.test.mts`
Expected: FAIL. `VARIANT_FEEDS.marketing` is undefined.

- [ ] **Step 3: Implement**
  - Add the server block. Direct URLs are plain strings; Google News entries use `gn('…')` with the queries from the table.
  - Update `VALID_VARIANTS` and `NEWS_VARIANTS`.
  - Add the publisher family and domain to both mirrors, and update the test set.
  - Edit the proto comment, then run `make generate` (requires `make install`: buf + sebuf v0.11.1).
    - Verify with `git diff --stat`: only the `variant` field description changes, in `src/generated/**/news/v1/*` and `docs/api/*`.
  - Make the docs and test-count edits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/marketing-feed-digest.test.mts tests/feeds-client-server-parity.test.mjs tests/news-feed-key-parity.test.mts tests/news-digest-methodology-parity.test.mjs tests/publisher-families.test.mjs tests/publisher-link-gate.test.mjs tests/public-rpc-fetch.test.mts tests/edge-functions.test.mjs tests/feed-catalog-drift.test.mts`
Expected: PASS.
- The parity test needs no `KNOWN_DRIFTS` changes. The routing is the same on both sides: direct for direct feeds, Google News for the GN feeds.

Run: `npm run sources:generate && npm run sources:check`
Expected: PASS. This adds `_feeds.ts` references to the Task 1 rows.

- [ ] **Step 5: Typecheck:** `npm run typecheck:api`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/worldmonitor/news/v1/_feeds.ts server/worldmonitor/news/v1/list-feed-digest.ts src/shared/public-rpc-cache.ts shared/publisher-families.js scripts/shared/publisher-families.js proto/worldmonitor/news/v1/list_feed_digest.proto src/generated docs/api docs/methodology/news-digest-and-briefing.mdx docs/data-sources.mdx shared/source-attribution-manifest.json docs/source-attribution.mdx tests/marketing-feed-digest.test.mts tests/news-digest-methodology-parity.test.mjs tests/news-feed-key-parity.test.mts tests/publisher-families.test.mjs
git commit -m "feat(marketing): serve a dedicated marketing news digest"
```

---

### Task 3: Marketing branch in `classifyByKeyword`

**Files:**
- Modify: `server/worldmonitor/news/v1/_classifier.ts`.
  - Add three keyword maps after `TECH_LOW_KEYWORDS` (line 171-183).
  - Add the branch inside `classifyByKeyword` (lines 346-400).
- Test: `tests/news-classifier-marketing.test.mts` (new)

**Interfaces:**
- Consumes: `classifyByKeyword(title: string, variant?: string): ClassificationResult`. This signature is unchanged. It is already called with the digest variant at `list-feed-digest.ts:1173`.
- Produces: no new exports. `EventCategory` is unchanged; marketing maps only onto `'tech' | 'infrastructure' | 'economic'`.

- [ ] **Step 1: Write the failing test**

```ts
import { classifyByKeyword } from '../server/worldmonitor/news/v1/_classifier';
it('core update is high/tech for marketing, info for full', () => {
  const t = 'Google confirms October 2026 core update is rolling out';
  assert.deepEqual(classifyByKeyword(t, 'marketing'), { level: 'high', category: 'tech', confidence: 0.75, source: 'keyword' });
  assert.equal(classifyByKeyword(t, 'full').level, 'info');
});
it('marketing skips EXCLUSIONS; full still excludes (Review Focus 3)', () => {
  const t = 'Google Shopping ads add new holiday feature';
  assert.equal(classifyByKeyword(t, 'marketing').level, 'low');
  assert.equal(classifyByKeyword(t, 'marketing').category, 'tech');
  assert.deepEqual(classifyByKeyword(t, 'full'), { level: 'info', category: 'general', confidence: 0.3, source: 'keyword' });
});
it('sunset/deprecation is medium/tech', () => {
  assert.deepEqual(classifyByKeyword('Google Ads to sunset enhanced CPC bidding', 'marketing'),
    { level: 'medium', category: 'tech', confidence: 0.65, source: 'keyword' });
});
it('Business Profile suspensions are high', () => {
  assert.equal(classifyByKeyword('Google Business Profile suspensions spike for locksmiths', 'marketing').level, 'high');
});
it('generic disaster keywords still win for marketing (storms matter to local clients)', () => {
  assert.deepEqual(classifyByKeyword('Hurricane Milton forces store closures across Florida', 'marketing'),
    { level: 'high', category: 'disaster', confidence: 0.8, source: 'keyword' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/news-classifier-marketing.test.mts`
Expected: FAIL on the first assertion (`info` !== `high`).

- [ ] **Step 3: Implement**
  - Add `const isMarketing = variant === 'marketing'`.
  - Skip the `EXCLUSIONS` early return when `isMarketing`.
  - Check the marketing maps in the same three slots as the `isTech` ones, with the same confidences (0.75 / 0.65 / 0.55). The generic CRITICAL/HIGH lists and the historical downgrade still run first.
  - Keyword values (all matched by substring, so none go in `SHORT_KEYWORDS`):
    - `MARKETING_HIGH_KEYWORDS`: `'core update'`, `'algorithm update'`, `'spam update'`, `'manual action'`, `'deindex'`, `'profile suspension'` all map to `tech`; `'ads outage'` and `'search outage'` map to `infrastructure`.
    - `MARKETING_MEDIUM_KEYWORDS`: `'sunset'`, `'deprecat'`, `'ranking volatility'`, `'ai overviews'`, `'local pack'` map to `tech`; `'policy update'` and `'price increase'` map to `economic`; `'outage'` maps to `infrastructure`.
    - `MARKETING_LOW_KEYWORDS`: `'new feature'`, `'rolling out'`, `'in beta'`, `'launch'` map to `tech`; `'survey'` and `'study'` map to `economic`.

- [ ] **Step 4: Run the tests to verify they pass, and confirm no regression**

Run: `node --import tsx --test tests/news-classifier-marketing.test.mts tests/news-classifier-historical-downgrade.test.mts tests/brief-filter.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/worldmonitor/news/v1/_classifier.ts tests/news-classifier-marketing.test.mts
git commit -m "feat(marketing): marketing keyword tiers in news classifier"
```

---

### Task 4: Marketing branch in the AI Brief prompt + brief heading

**Files:**
- Modify: `server/worldmonitor/news/v1/_shared.ts`, in `buildArticlePrompts` (lines 74-141).
- Modify: `src/components/InsightsPanel.ts:788-792`, in the `renderWorldBrief` heading ternary.
- Modify: `src/locales/en.json`. Add `marketing.brief.heading` = `"MARKETING BRIEF"`, as a sibling of W0's `marketing.panel.*`.
- Regenerate: the other `src/locales/*.json` files via `npm run sync:locales` (Resolution 1; English fallbacks, no API key).
- Test: `tests/handlers.test.mts`. Add cases inside `describe('buildArticlePrompts')` (line 398).

**Interfaces:**
- Consumes: `buildArticlePrompts(headlines, uniqueHeadlines, opts: { mode; geoContext; variant; lang; bodies? })`. The signature is unchanged. `summarize-article.ts:78` already forwards `variant`, and the cache key already includes it (`summary-cache-key.ts:173`).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests** (append to `describe('buildArticlePrompts')`)

```ts
it('brief marketing variant frames local-business marketing impact', () => {
  const r = buildArticlePrompts(headlines, unique, { ...baseOpts, variant: 'marketing' });
  assert.ok(r.systemPrompt.includes('marketing'));
  assert.ok(r.systemPrompt.includes('local business'));
  assert.ok(!r.systemPrompt.includes('geopolitical'));
});
it('analysis marketing variant asks for the marketing takeaway', () => {
  const r = buildArticlePrompts(headlines, unique, { ...baseOpts, mode: 'analysis', variant: 'marketing' });
  assert.ok(r.userPrompt.includes("What's the key marketing takeaway"));
});
it('marketing variant honours the output language', () => {
  const r = buildArticlePrompts(headlines, unique, { ...baseOpts, variant: 'marketing', lang: 'es' });
  assert.ok(r.systemPrompt.includes('Output the summary in ES'));
});
it('full variant prompt keeps geopolitical framing (additivity)', () => {
  const r = buildArticlePrompts(headlines, unique, baseOpts);
  assert.ok(r.systemPrompt.includes('Provide geopolitical context appropriate for the current date.'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/handlers.test.mts`
Expected: FAIL on 'brief marketing variant…' (the prompt contains "geopolitical").

- [ ] **Step 3: Implement**
  - In `buildArticlePrompts`, add `const isMarketingVariant = opts.variant === 'marketing'`.
  - Omit the geopolitical sentence from `dateContext` when it is tech **or** marketing.
  - Add marketing system prompts for `brief`, `analysis` and the default mode, mirroring the tech structure.
    - Keep the shared rules: separate stories, pick ONE, never merge, 2 sentences, under 60 words.
    - Marketing-specific rule lines:
      - `Focus ONLY on search, ads, social, local-SEO and marketing-industry developments`
      - `Lead with the platform or company name`
      - `State what changes for local business marketing (rankings, ad costs, reviews, profiles, policies)`
      - `IGNORE geopolitics, markets and general politics unless they directly change advertising or search`
    - The brief and default modes append `${langInstruction}`.
    - The analysis `userPrompt` is `` `Each headline is a separate story. What's the key marketing takeaway for local businesses?\n${headlineText}${intelSection}` ``.
    - Translate mode is untouched.
  - In `InsightsPanel.renderWorldBrief`, add `: SITE_VARIANT === 'marketing' ? `<U+1F4E3 megaphone> ${t('marketing.brief.heading')}`` before the `briefWorld` fallback.
  - Leave the client `geoContext` empty for marketing. The framing lives server-side.
  - Run `npm run sync:locales` (Resolution 1), then `npm run locales:zh-tw` if zh-TW is flagged. Inspect the diff: each locale gains only `marketing.brief.heading` with the English value.

- [ ] **Step 4: Run the tests to verify they pass, and typecheck**

Run: `node --import tsx --test tests/handlers.test.mts tests/summary-cache-key.test.mts tests/news-digest-methodology-parity.test.mjs`, plus the locale parity suite found by `ls tests/ | grep -i locale`
Expected: PASS.

Run: `npm run typecheck && npm run typecheck:api && npm run lint:boundaries`
Expected: exit 0 each.

- [ ] **Step 5: Commit**

```bash
git add server/worldmonitor/news/v1/_shared.ts src/components/InsightsPanel.ts src/locales/ tests/handlers.test.mts
git commit -m "feat(marketing): marketing AI brief prompt and heading"
```

---

### Task 5: Generated facts, full verification, PR

**Files:**
- Regenerate: `public/product-facts.json`, `scripts/shared/inventory-facts.generated.json`, `docs/generated/stats.json`, and whatever else `npm run product:facts` writes. The feed-definition count and provider counts change.

- [ ] **Step 1: Regenerate facts:** `npm run product:facts`. Then run `npm run product:facts:check && npm run docs:check && npm run sources:check`.
  - Expected: all exit 0.
  - Inspect the diff: only counts move.

- [ ] **Step 2: Run the heavy checks one at a time**
  - `npm run lint`
  - `npm run typecheck`
  - `npm run typecheck:api`
  - `npm run lint:boundaries`
  - `npm run test:data` (CI job `unit-shards`)
  - `git diff --check`

  Expected: each exits 0. Report any failure honestly before continuing.

- [ ] **Step 3: Exercise the real path**
  - Run `npm run dev:marketing`.
  - Confirm three things:
    - The `platform-updates`, `local-seo` and `marketing-industry` panels render items.
    - The Network tab shows `list-feed-digest?variant=marketing&lang=en&public=1` → 200, with a response whose `categories` holds the three keys.
    - The AI Brief header reads "MARKETING BRIEF".
  - Run `npm run dev` and confirm `full` shows no marketing panels or sources.
  - Under the Vite dev server, if the digest is not served locally (sebuf plugin coverage), record that and rely on the per-feed fallback for the UI check.
  - Record what was not verified live: CDN caching, and Railway/relay paths.

- [ ] **Step 4: Commit**

```bash
git add public/product-facts.json scripts/shared/inventory-facts.generated.json docs/generated/stats.json
git commit -m "chore(marketing): refresh generated inventory facts for trade feeds"
```

- [ ] **Step 5: Deliver the PR** to the fork's `main`, following AGENTS.md "PR delivery".
  - Capture desktop and mobile screenshots of the three news panels and the AI Brief heading, using test data and labelled with the tested commit.
  - Attach each one with `gh pr edit <n> --attach '/abs/path.png#…'`.
  - Verify the images render in the PR description.

## Contract Issues (resolved)

1. **User-Agent constraint vs. the shared digest fetcher** -> **Resolution 6.** W1 keeps the existing digest fetcher's User-Agent; `marketingUserAgent()` is for W4, W6 and W7 only.
2. **Unlisted files W1 must edit** -> **Resolution 20.** W1 owns `VALID_VARIANTS`, `NEWS_VARIANTS`, the news proto comment and its `make generate` rerun, `shared/publisher-families.js` (and its `scripts/shared/` mirror), and the `InsightsPanel.ts` brief heading.
3. **Feed-list deviation (SEL and MarTech via Google News)** -> **Known source limits** (index): they come through Google News `site:` searches, as planned.
4. **Marketing sources stay out of the provenance generator** -> no resolution covers this; it stays a W1-local, intentional trade-off (marketing sources show "unknown" provenance badges to keep other variants unchanged). Flag in the PR description for the owner.

New, unresolved: none. (Locale handling now follows Resolution 1: `sync:locales` added to Task 4.)
