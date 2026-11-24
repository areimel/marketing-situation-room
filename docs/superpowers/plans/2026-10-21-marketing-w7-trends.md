# W7 Demand Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace W0's `GetDemandTrends` stub and `DemandTrendsPanel` placeholder with a working, free-only demand signal. It has two parts: Google "trending now" terms for the US and for each client state, and 13 weeks of Wikipedia pageviews per client category, shown as sparklines.

**Architecture:** A request-time handler (`server/worldmonitor/marketing/v1/get-demand-trends.ts`) fans out to two upstreams, and each upstream response is cached separately through `cachedFetchJson()`. The upstreams are the Google Trends RSS feed (one cache key per geo) and the Wikimedia per-article pageviews API (one cache key per article and window). Pure helpers live in a private sibling file (`_demand-trends.ts`, allowed by Resolution 7): RSS parsing, the weekly window, weekly aggregation and request normalisation. The User-Agent comes from W0's `marketingUserAgent()` (Resolution 6), and the response carries W0's `degraded` flag (Resolution 4). Both pure helpers and handler are unit-tested with fixture payloads and do not touch the network. The browser panel derives the categories and states from the roster (or from the focused client), calls W0's `getDemandTrends` wrapper in `api.ts` (Resolution 8), uses W0's `empty-state.ts` for the no-clients and source-unavailable states (Resolution 18), and renders the result with the existing `sparkline()` helper from `src/utils/sparkline.ts`.

**Tech Stack:** TypeScript, sebuf-generated `MarketingService` types, `fast-xml-parser` ^5.8.0 (already a dependency, used in `server/worldmonitor/aviation/v1/_shared.ts:100`), `node:test` via tsx, Vitest + happy-dom for the panel.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md`. The binding contracts are in `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

- Everything under "Global Constraints" and "Shared Contracts" in `docs/superpowers/plans/2026-10-21-marketing-00-index.md` applies. Never rename `GetDemandTrends`, `DemandTrend`, `TrendingTerm`, `demand-trends` or `DemandTrendsPanel`.
- **Free sources only** (spec, Signals table):
  - Google "trending now" RSS, for the US and at state level.
  - Wikipedia pageviews for each category's articles, as a seasonal demand proxy.
  - The Trends API alpha is out of scope, a later upgrade.
- **Verified upstream facts** (checked 2026-10-21):
  - **Google Trends RSS:**
    - `https://trends.google.com/trending/rss?geo=US` returns `200 text/xml`, about 10 `<item>`s.
    - Each item has `<title>`, `<ht:approx_traffic>` (e.g. `2000+`), `<pubDate>` and nested `<ht:news_item>`.
    - `geo=US-TX` returns 200 with a different list.
    - `geo=US-ZZ` returns an HTML 400.
  - **Wikimedia pageviews:**
    - `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/<Article>/daily/<YYYYMMDD>/<YYYYMMDD>` returns `{"items":[{"timestamp":"2026072000","views":1209,…}]}`.
    - An unknown article returns a 404 JSON.
  - **Wikimedia rate limits** (from mediawiki.org's Wikimedia_APIs/Rate_limits page):
    - 10 req/min with no identifying User-Agent, 200 req/min with a compliant User-Agent that carries contact information.
    - Keep concurrency at 3 or lower, and back off on 429.
    - A burst of about 40 sequential probes without contact info hit 429 within seconds.
- **User-Agent** on every upstream fetch: `marketingUserAgent()` from `server/worldmonitor/marketing/v1/_user-agent.ts` (W0, Resolution 6), which yields `MarketingSituationRoom/1.0 (+mailto:${MARKETING_CONTACT_EMAIL})` and throws in production when the env var is unset. W7 defines no UA builder of its own. Call it inside the handler per request (not at module load), so a missing env var fails the request rather than the edge bundle import.
- **Window:** the 13 most recent complete Monday–Sunday UTC weeks that end on or before yesterday (UTC), which is 91 days, about "90 days". A point is the generated `TrendPoint{int64 date, double value}` (Resolution 4): `date` is the week's Monday 00:00 UTC as epoch ms (Resolution 3), and `value` is the sum of daily views across the category's articles.
- **Caps:**
  - At most 15 categories (every `MARKETING_CATEGORIES` member) and 10 state codes per request.
  - An empty `categories` request means all 15 categories (Resolution 14). A non-empty request whose values are all unknown yields no categories.
  - Unknown values are dropped, never thrown on.
  - At most 10 trending terms per geo.
- **Cache keys** (every request-varying input is included):
  - `marketing:trending-now:v1:<geo>`, TTL 1800 s.
  - `marketing:wiki-pageviews:v1:<article>:<fromYmd>:<toYmd>`, TTL 43200 s.
- **Degraded:** `degraded: true` on the response whenever any upstream fetch failed (429/5xx/timeout/reject), including partial failures; a 404 article (no data) is not a failure (Resolution 4).
- **Privacy and caching:** the gateway's private no-store `RPC_CACHE_TIER` entry under `isMarketingDeploy()` is W0's (Resolution 5); W7 adds none. Server logs carry only the upstream source name and a failure count, never categories, article titles, client names or terms.
- i18n keys W7 adds live under `marketing.trends.*` in `src/locales/en.json`. Shared keys `marketing.empty.noClients`, `marketing.common.sourceUnavailable` and `marketing.category.<id>` are W0's (Resolution 18) and are consumed, not redefined. After editing `en.json`, run `npm run sync:locales` (and `npm run locales:zh-tw` if flagged); on rebase conflicts in locale files take base and re-run (Resolution 1).

## Review Focus

1. **A Wikimedia 429 or 5xx for some articles:** the category still renders from the articles that succeeded, the run logs `[demand-trends] degraded`, and no exception reaches the gateway. Pinned in Task 3 (`partial wikimedia failure keeps the other articles`).
2. **A state code that isn't real, or is lowercase** (`tx`, `ZZ`, `US-TX`): it's normalised or dropped before a URL is built, so Google never sees a 400 request. Pinned in Task 2 (`normalizeDemandRequest`).
3. **A roster where every client shares one category, or a client has no locations:** the panel requests that one category and only the US geo, without crashing. Pinned in Task 4 (`derives categories and states from roster`).
4. **Both upstreams down:** the handler returns empty `trends` and `trendingNow` arrays with `degraded: true`, and the panel shows W0's `renderSourceUnavailable()`, not a spinner or the empty-roster copy. A partial outage renders what succeeded plus a small source-unavailable note. Pinned in Task 3 and Task 4.
5. **RSS with one item, entity-escaped titles (`&apos;`), or a missing `ht:approx_traffic`:** it parses to an array, and the title comes out decoded and HTML-escaped at render, with `traffic: ''`. Pinned in Task 2 (`parseTrendingRss`) and Task 4 (escaping assertion).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `shared/marketing/category-articles.json` | Create (W7) | Curated mapping from `MarketingCategory` to its en.wikipedia article titles |
| `server/worldmonitor/marketing/v1/_demand-trends.ts` | Create (W7, Resolution 7) | Pure helpers: request normalisation, window, RSS parse, weekly aggregation, concurrency map |
| `server/worldmonitor/marketing/v1/get-demand-trends.ts` | Replace W0 stub body (W7) | Upstream fetches, caching and assembly of the response |
| `src/components/marketing/DemandTrendsPanel.ts` | Replace W0 placeholder (W7) | Sparkline rows and trending-now lists |
| `src/locales/en.json` | Modify: add the `marketing.trends` object inside W0's `marketing` block | Copy |
| `src/locales/*.json` (other locales) | Regenerated by `npm run sync:locales` (Resolution 1) | English fallbacks |
| `tests/marketing-category-articles.test.mts` | Create | Map shape test |
| `tests/marketing-demand-trends.test.mts` | Create | Pure helper tests |
| `tests/marketing-demand-trends-handler.test.mts` | Create | Handler tests with stubbed `globalThis.fetch` |
| `tests/dom/marketing-demand-trends-panel.test.mts` | Create | Panel behaviour tests |

W7 doesn't touch `proto/`, `src/generated/`, `src/services/marketing/*`, `src/components/marketing/empty-state.ts`, `_user-agent.ts`, `panel-layout.ts` or the gateway (`RPC_CACHE_TIER` included). Those belong to W0 and W9.

---

### Task 1: Category → Wikipedia articles map

**Files:**
- Create: `shared/marketing/category-articles.json`
- Test: `tests/marketing-category-articles.test.mts`

**Interfaces:**
- Consumes: `MARKETING_CATEGORIES` from `shared/marketing/types.ts` (W0).
- Produces: a JSON object of shape `Record<MarketingCategory, string[]>`. Each title uses en.wikipedia canonical form: underscores, no spaces, not a redirect.

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import map from '../shared/marketing/category-articles.json' with { type: 'json' };
import { MARKETING_CATEGORIES } from '../shared/marketing/types.ts';

describe('category-articles map', () => {
  it('has exactly one entry per MarketingCategory', () => {
    assert.deepEqual(Object.keys(map).sort(), [...MARKETING_CATEGORIES].sort());
  });
  it('lists 1-3 canonical titles per category', () => {
    for (const [cat, titles] of Object.entries(map)) {
      assert.ok(Array.isArray(titles) && titles.length >= 1 && titles.length <= 3, cat);
      for (const t of titles) assert.match(t, /^[A-Z][^\s/]*$/, `${cat}: ${t}`);
    }
  });
  it('maps hvac to the heating and cooling articles', () => {
    assert.deepEqual(map.hvac, ['Air_conditioning', 'Heat_pump', 'Furnace_(central_heating)']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --import tsx --test tests/marketing-category-articles.test.mts`
Expected: FAIL, because `category-articles.json` can't be found.

- [ ] **Step 3: Create the JSON**

Start from these candidates:

| Category | Candidate articles |
|---|---|
| hvac | `Air_conditioning`, `Heat_pump`, `Furnace_(central_heating)` (all three return 200, verified) |
| roofing | `Roof`, `Roof_shingle`, `Rain_gutter` |
| plumbing | `Plumbing`, `Water_heating`, `Septic_tank` |
| electrical | `Electrician`, `Electrical_wiring`, `Solar_panel` |
| landscaping | `Landscaping`, `Lawn`, `Lawn_mower` |
| pest-control | `Pest_control`, `Termite`, `Bed_bug` |
| dental | `Dentistry`, `Dental_implant`, `Orthodontics` |
| medical | `Influenza`, `Influenza_vaccine`, `Primary_care` |
| legal | `Personal_injury`, `Divorce`, `Estate_planning` |
| restaurant | `Restaurant`, `Pizza`, `Food_delivery` |
| retail | `Black_Friday_(shopping)`, `Cyber_Monday`, `Small_Business_Saturday` |
| auto | `Tire`, `Auto_mechanic`, `Car_dealership` |
| real-estate | `Real_estate`, `Mortgage_loan`, `Real_estate_agent` |
| fitness | `Physical_fitness`, `Personal_trainer`, `New_Year's_resolution` |
| other | `Small_business` |

Pageviews are not counted across redirects, so every title must be a canonical article, not a redirect.

To check titles, send one sequential batch request to `https://en.wikipedia.org/w/api.php?action=query&redirects=1&format=json&titles=<a|b|…>` with the contact User-Agent:
- Up to 50 titles fit in one call. Send one call only, because rapid probes return 429.
- Replace any title that appears under `redirects` with its `to` target.
- Replace any title that appears as `missing` with the nearest canonical article.
- Paste the check output into the PR description.

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --import tsx --test tests/marketing-category-articles.test.mts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/marketing/category-articles.json tests/marketing-category-articles.test.mts
git commit -m "feat(marketing): add category to wikipedia article map for demand trends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure demand-trend helpers

**Files:**
- Create: `server/worldmonitor/marketing/v1/_demand-trends.ts`
- Test: `tests/marketing-demand-trends.test.mts`

**Interfaces:**
- Consumes:
  - `MARKETING_CATEGORIES` and `MarketingCategory` (`shared/marketing/types.ts`).
  - The generated `GetDemandTrendsRequest`, `DemandTrend`, `TrendPoint` and `TrendingTerm` from `src/generated/server/worldmonitor/marketing/v1/service_server` (W0, Resolution 4).
  - `XMLParser` from `fast-xml-parser`.
- Produces (all exported):
  - `export const US_STATE_CODES: ReadonlySet<string>`: the 50 states plus `DC`.
  - `normalizeDemandRequest(req: GetDemandTrendsRequest): { categories: MarketingCategory[]; geos: string[] }`
    - `geos` always starts with `'US'`, followed by `US-XX` for each valid state, deduped, with at most 10 states.
    - It accepts `tx`, `TX` and `US-TX`, and drops anything else.
    - Categories are deduped and filtered to `MARKETING_CATEGORIES`, in request order. An empty `categories` array expands to all of `MARKETING_CATEGORIES` in declaration order (Resolution 14); a non-empty all-unknown array yields `[]`.
  - `weeklyWindow(now: Date): { fromYmd: string; toYmd: string; weekStarts: number[] }`
    - `toYmd` is the latest Sunday that is at most yesterday (UTC).
    - `fromYmd` is the Monday 12 weeks before that Sunday's week, so 13 weeks in all.
    - `fromYmd`/`toYmd` use the `YYYYMMDD` format (the Wikimedia path format). `weekStarts` holds 13 Monday 00:00 UTC epoch-ms values in ascending order (Resolution 3).
  - `aggregateWeekly(seriesByArticle: Array<Array<{ timestamp: string; views: number }> | null>, weekStarts: number[]): TrendPoint[]`
    - Each daily item is assigned to the week it falls in. Item timestamps look like `2026072000`.
    - `null` series (failed articles) are skipped.
    - It returns `[]` when every series is null. Otherwise it returns one point for each week in `weekStarts`, with value 0 when a week has no data.
  - `parseTrendingRss(xml: string, geo: string, limit = 10): TrendingTerm[]`
    - Each term is `{ term: decoded title, geo, traffic: ht:approx_traffic text or '' }`.
    - It returns `[]` for non-RSS input.
  - `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>`
    - Results keep input order. No existing helper was found under `server/_shared/` or `src/utils/`.

- [ ] **Step 1: Write the failing tests** in `tests/marketing-demand-trends.test.mts`. Keep fixture XML inline, copied from the real feed shape above (`xmlns:ht`, `<ht:approx_traffic>`, `&apos;`).

```ts
describe('normalizeDemandRequest', () => {
  it('normalises state codes and always leads with US', () => {
    const r = normalizeDemandRequest({ categories: ['hvac', 'hvac', 'bogus', 'dental'], stateCodes: ['tx', 'US-FL', 'ZZ', 'TX', ''] });
    assert.deepEqual(r, { categories: ['hvac', 'dental'], geos: ['US', 'US-TX', 'US-FL'] });
  });
  it('treats empty categories as all categories (Resolution 14)', () => {
    assert.deepEqual(normalizeDemandRequest({ categories: [], stateCodes: [] }).categories, [...MARKETING_CATEGORIES]);
  });
  it('all-unknown categories yield none', () => {
    assert.deepEqual(normalizeDemandRequest({ categories: ['bogus'], stateCodes: [] }).categories, []);
  });
  it('caps states at 10', () => {
    const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID'];
    assert.equal(normalizeDemandRequest({ categories: [], stateCodes: states }).geos.length, 11);
  });
});

describe('weeklyWindow', () => {
  it('ends on the last full Sunday before today (UTC)', () => {
    const w = weeklyWindow(new Date('2026-10-21T12:00:00Z')); // Wednesday
    assert.equal(w.toYmd, '20261018');
    assert.equal(w.fromYmd, '20260720');
    assert.equal(w.weekStarts.length, 13);
    assert.equal(w.weekStarts[0], Date.UTC(2026, 6, 20));
    assert.equal(w.weekStarts[12], Date.UTC(2026, 9, 12));
  });
  it('on a Monday, yesterday-Sunday is the end', () => {
    assert.equal(weeklyWindow(new Date('2026-10-19T00:30:00Z')).toYmd, '20261018');
  });
  it('on a Sunday, the previous Sunday is the end (today is incomplete)', () => {
    assert.equal(weeklyWindow(new Date('2026-10-18T23:00:00Z')).toYmd, '20261011');
  });
});

describe('aggregateWeekly', () => {
  it('sums articles per week and skips failed series', () => {
    const weeks = [Date.UTC(2026, 6, 20), Date.UTC(2026, 6, 27)];
    const pts = aggregateWeekly([
      [{ timestamp: '2026072000', views: 10 }, { timestamp: '2026072600', views: 5 }, { timestamp: '2026072700', views: 7 }],
      null,
      [{ timestamp: '2026072100', views: 1 }],
    ], weeks);
    assert.deepEqual(pts, [{ date: weeks[0], value: 16 }, { date: weeks[1], value: 7 }]);
  });
  it('returns [] when every article failed', () => {
    assert.deepEqual(aggregateWeekly([null, null], [Date.UTC(2026, 6, 20)]), []);
  });
});

describe('parseTrendingRss', () => {
  it('parses items, decodes entities, tolerates missing traffic', () => { /* 2-item fixture, 2nd has no ht:approx_traffic */
    assert.deepEqual(parseTrendingRss(XML_TWO, 'US-TX'), [
      { term: "kylian mbappé", geo: 'US-TX', traffic: '2000+' },
      { term: "o'reilly", geo: 'US-TX', traffic: '' },
    ]);
  });
  it('handles a single-item feed as an array', () => { assert.equal(parseTrendingRss(XML_ONE, 'US').length, 1); });
  it('returns [] for HTML error bodies', () => { assert.deepEqual(parseTrendingRss('<html><title>Error 400</title></html>', 'US'), []); });
  it('respects the limit', () => { assert.equal(parseTrendingRss(XML_TWELVE, 'US').length, 10); });
});

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` at once and preserves order', async () => { /* track active count with deferred promises; assert max === 3 and output order */ });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --import tsx --test tests/marketing-demand-trends.test.mts`
Expected: FAIL, because `_demand-trends.ts` can't be found.

- [ ] **Step 3: Implement the helpers in `server/worldmonitor/marketing/v1/_demand-trends.ts`**

- Configure the parser with `new XMLParser({ ignoreAttributes: true, processEntities: true, isArray: (name) => name === 'item' })`. Read `rss.channel.item[].title` and `['ht:approx_traffic']`.
- Do all date maths in UTC with `Date.UTC`, because the local timezone must not shift weeks.
- The file must not import `src/` code other than `src/generated/` (AGENTS.md boundary), and no `node:*` modules.

- [ ] **Step 4: Run them and confirm they pass**

Run: `node --import tsx --test tests/marketing-demand-trends.test.mts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/worldmonitor/marketing/v1/_demand-trends.ts tests/marketing-demand-trends.test.mts
git commit -m "feat(marketing): add demand-trend parsing and weekly aggregation helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `getDemandTrends` handler

**Files:**
- Modify: `server/worldmonitor/marketing/v1/get-demand-trends.ts` (replace W0's stub body; keep the exported name and signature W0 wired into `handler.ts`)
- Test: `tests/marketing-demand-trends-handler.test.mts`

**Interfaces:**
- Consumes:
  - Everything Task 2 produces.
  - `cachedFetchJson` from `server/_shared/redis.ts:922`.
  - `categoryArticles` from `shared/marketing/category-articles.json`, as a JSON import. `server/worldmonitor/research/v1/list-tech-events.ts:21` already imports shared JSON the same way.
  - `marketingUserAgent()` from `./_user-agent` (W0, Resolution 6).
- Produces:
  - `export async function getDemandTrends(ctx: ServerContext, req: GetDemandTrendsRequest): Promise<GetDemandTrendsResponse>`. This is the W0 name. If W0's stub uses a different export name, keep W0's.
  - `export async function buildDemandTrends(req: GetDemandTrendsRequest, deps: { now: Date; fetchImpl: typeof fetch; userAgent: string }): Promise<GetDemandTrendsResponse>`. The handler calls it with `{ now: new Date(), fetchImpl: (...a) => globalThis.fetch(...a), userAgent: marketingUserAgent() }`. Use that arrow form, never `fetch.bind`, per AGENTS.md. Tests pass a literal `userAgent` and so don't depend on W0's env handling.
  - `GetDemandTrendsResponse` is `{ trends, trendingNow, degraded }` (Resolution 4).

- [ ] **Step 1: Write the failing tests**

Stub `fetchImpl` by URL prefix (`trends.google.com/trending/rss?geo=` and `wikimedia.org/api/rest_v1/metrics/pageviews/per-article/`). Leave `UPSTASH_REDIS_REST_URL` unset so that `cachedFetchJson` reads miss and calls the fetcher.

`cachedFetchJson` also keeps isolate-local negative and inflight maps (`server/_shared/redis.ts:516-519,820`). Give each test a different `now` week or category so that cache keys never collide across tests.

```ts
it('returns one 13-point trend per requested category and trending terms per geo', async () => {
  const res = await buildDemandTrends({ categories: ['hvac'], stateCodes: ['TX'] }, deps(new Date('2026-10-21T12:00:00Z')));
  assert.equal(res.trends.length, 1);
  assert.equal(res.trends[0].category, 'hvac');
  assert.equal(res.trends[0].points.length, 13);
  assert.equal(res.trends[0].points[0].date, Date.UTC(2026, 6, 20)); // epoch ms Monday
  assert.equal(res.degraded, false);
  assert.deepEqual([...new Set(res.trendingNow.map((t) => t.geo))], ['US', 'US-TX']);
});
it('requests every hvac article with the contact User-Agent and 13-week window', async () => {
  // now = 2026-10-14T12:00Z (distinct week from test 1) -> assert the 3 wikimedia URLs end with /daily/20260713/20261011,
  // titles passed through encodeURIComponent (Furnace_%28central_heating%29 or literal parens, match either),
  // and every call's headers['User-Agent'] === deps.userAgent ('MarketingSituationRoom/1.0 (+mailto:ops@agency.test)')
});
it('partial wikimedia failure keeps the other articles', async () => {
  // Heat_pump -> 429, Furnace_(central_heating) -> 404; Air_conditioning -> fixture
  // assert points sum equals Air_conditioning fixture only, res.degraded === true, and console.warn called with /\[demand-trends\] degraded/
  // assert no console.warn argument contains 'hvac' or any article title (Resolution 5: no terms in logs)
});
it('both upstreams down -> empty arrays, no throw', async () => {
  // fetchImpl rejects for all URLs
  assert.deepEqual(res, { trends: [], trendingNow: [], degraded: true });
});
it('no valid categories -> no wikimedia calls, still US trending', async () => {
  // categories: ['bogus'] -> zero wikimedia URLs fetched; trendingNow geo 'US' only; degraded false
});
it('empty categories fetch every category article (Resolution 14)', async () => {
  // categories: [] -> wikimedia URL set equals the union of all category-articles.json titles; trends covers every category with data
});
it('a 404 article is not degraded', async () => {
  // Furnace_(central_heating) -> 404, others fixture -> res.degraded === false
});
it('never fires more than 3 wikimedia requests concurrently', async () => {
  // categories: ['hvac','roofing','plumbing'] (9 articles), deferred responses, track max in-flight wikimedia === 3
});
it('cache keys include geo and window', async () => {
  // spy is not possible on ESM export; instead call twice with different stateCodes and assert the second geo was fetched (no cross-geo cache reuse)
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --import tsx --test tests/marketing-demand-trends-handler.test.mts`
Expected: FAIL, because `buildDemandTrends` isn't exported (only W0's stub exists).

- [ ] **Step 3: Implement `buildDemandTrends` and the `getDemandTrends` wrapper**

- **Trending fetch:** for each geo, `cachedFetchJson<{ terms: TrendingTerm[] }>(`marketing:trending-now:v1:${geo}`, 1800, fetcher, 120, { timeoutMs: 10_000 })`. The fetcher sends `Accept: application/rss+xml, application/xml, text/xml`, and its timeout is `AbortSignal.timeout(8000)`.
  - It returns `null` on non-2xx or zero parsed items, so a negative entry is cached.
- **Pageviews fetch:**
  - Collect the unique articles of the normalised categories, then call `mapWithConcurrency(articles, 3, …)`, with each article cached at `marketing:wiki-pageviews:v1:${article}:${fromYmd}:${toYmd}`, TTL 43200.
  - The fetcher returns `{ items: [] }` on a 404, because the article has no data for the window and that result should be cached. It returns `null` on a 429/5xx/timeout, which keeps the default 120 s negative TTL and so acts as the back-off.
  - Each category gets `aggregateWeekly(seriesForItsArticles, weekStarts)`. A category whose result is `[]` is left out of `trends`.
- **Degradation:** wrap each upstream group in try/catch. Set `degraded = true` when any trending geo or any article fetch failed (a cached `null` negative entry counts as failed; a 404 `{ items: [] }` does not). On any failure, log once per group: `console.warn('[demand-trends] degraded', { source: 'google-trends' | 'wikimedia', failed: n })`. Never log categories, article titles, geos tied to clients, or client data (Resolution 5).

- [ ] **Step 4: Run them and confirm they pass**

Run: `node --import tsx --test tests/marketing-demand-trends-handler.test.mts tests/marketing-demand-trends.test.mts`
Expected: PASS

- [ ] **Step 5: Check the API types and the edge bundle**

Run: `npm run typecheck:api`
Expected: exits 0.

Run: `node --import tsx --test tests/edge-functions.test.mjs`
Expected: PASS. This is the edge import guard, which covers the `api/marketing/v1/[rpc].ts` bundle.

- [ ] **Step 6: Commit**

```bash
git add server/worldmonitor/marketing/v1/get-demand-trends.ts tests/marketing-demand-trends-handler.test.mts
git commit -m "feat(marketing): serve demand trends from google trending rss and wikipedia pageviews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `DemandTrendsPanel`

**Files:**
- Modify: `src/components/marketing/DemandTrendsPanel.ts` (replace W0's placeholder; keep the zero-arg constructor that `panel-layout.ts` calls as `new DemandTrendsPanel()`, and keep panel id `demand-trends`)
- Modify: `src/locales/en.json` (add `marketing.trends` inside W0's `marketing` object), then regenerate other locales with `npm run sync:locales` (Resolution 1)
- Test: `tests/dom/marketing-demand-trends-panel.test.mts`

**Interfaces:**
- Consumes:
  - `getClients()`, `subscribeClients(cb)`, `getRosterStatus()` and `onRosterStatusChange(cb)` from `@/services/marketing/roster` (Resolution 18).
  - `getFocusedClientId()` and `onFocusChange(cb)` from `@/services/marketing/focus`. `onFocusChange` doesn't fire on subscribe (Resolution 13), so the constructor reads `getFocusedClientId()` for the first fetch.
  - `getDemandTrends(req: GetDemandTrendsRequest): Promise<GetDemandTrendsResponse>` from `@/services/marketing/api` (W0, Resolution 8; goes through `premiumFetch`).
  - `renderNoClientsState()` and `renderSourceUnavailable()` from `@/components/marketing/empty-state` (W0, Resolution 18).
  - `sparkline(data, color, w, h, style, { label })` from `@/utils/sparkline` (`src/utils/sparkline.ts:17`).
  - `safeHtml`, `joinSafeHtml` and `unsafeRawHtml` from `@/utils/sanitize`. The sparkline SVG goes through `unsafeRawHtml(svg, 'sparkline() builds numeric-only SVG; label escaped inside')`.
  - `Panel.setSafeContent` and `Panel.destroy` from `src/components/Panel.ts:1494,1669`.
  - `t` from `@/services/i18n`.
- Produces:
  - `export class DemandTrendsPanel extends Panel`.
  - `export function deriveTrendInputs(clients: MarketingClient[], focusedId: string | null): { categories: MarketingCategory[]; stateCodes: string[] }`:
    - It uses active clients only (Resolution 12), and narrows to the focused client when that id is present among active clients; otherwise it uses all active clients.
    - It never returns an empty `categories` for a non-empty active roster, so the "empty means all" rule (Resolution 14) is only hit deliberately.
    - Categories and states are deduped and sorted.
    - Locations whose `stateCode` isn't a two-letter code are ignored.
- Category labels use W0's `marketing.category.<id>` keys; the empty roster and outage states use W0's `marketing.empty.noClients` and `marketing.common.sourceUnavailable` via `empty-state.ts` (Resolution 18).
- en.json keys W7 adds: `marketing.trends.title` ("Demand Trends"), `marketing.trends.partial` ("Some trend sources are unavailable"), `marketing.trends.trendingNow` ("Trending now"), `marketing.trends.weekChange` ("{{pct}} vs 4-wk avg"), `marketing.trends.sparkLabel` ("{{category}} weekly Wikipedia views, 13 weeks"), `marketing.trends.noData` ("No data for this category").

- [ ] **Step 1: Write the failing tests.** Mock `@/services/marketing/{roster,focus,api}` with `vi.hoisted` and `vi.mock`, following the pattern in `tests/dom/consumer-prices-stale-fetch.test.mts`, and call `initTestI18n()` from `tests/dom/helpers/i18n.mts`.

```ts
it('derives categories and states from roster', () => {
  expect(deriveTrendInputs([hvacTx, hvacFl, noLocDental, inactiveRoofing], null))
    .toEqual({ categories: ['dental', 'hvac'], stateCodes: ['FL', 'TX'] });
  expect(deriveTrendInputs([hvacTx, hvacFl], hvacFl.id)).toEqual({ categories: ['hvac'], stateCodes: ['FL'] });
});
it('shows the empty-roster copy and never calls the RPC when there are no clients', async () => {
  // getClients -> []; expect text t('marketing.empty.noClients') (renderNoClientsState); expect(mockGetDemandTrends).not.toHaveBeenCalled()
});
it('waits for roster status and does not fetch while loading or forbidden', async () => {
  // getRosterStatus -> 'loading' then 'forbidden': no RPC call, no noClients copy; 'error' -> renderSourceUnavailable; 'ready' via onRosterStatusChange -> fetches
});
it('fetches once on construction using the current focus without waiting for onFocusChange', async () => {
  // getFocusedClientId -> hvacFl.id; expect first RPC call { categories: ['hvac'], stateCodes: ['FL'] }
});
it('labels rows with marketing.category.<id>', async () => { /* row text equals t('marketing.category.hvac') */ });
it('renders one sparkline row per trend with an accessible label', async () => {
  // response with hvac 13 points -> element.querySelectorAll('svg[role="img"]').length === 1, aria-label contains 'hvac'
});
it('shows sourceUnavailable when degraded is true and both arrays are empty', async () => { /* renderSourceUnavailable() text t('marketing.common.sourceUnavailable') */ });
it('renders rows plus the partial note when degraded is true but some data came back', async () => { /* ... */ });
it('shows noData, not sourceUnavailable, when degraded is false and arrays are empty', async () => { /* ... */ });
it('shows sourceUnavailable when the RPC rejects', async () => { /* ... */ });
it('escapes trending terms', async () => {
  // trendingNow [{ term: '<img src=x onerror=1>', geo: 'US', traffic: '500+' }] -> no <img> element; text includes the literal term
});
it('refetches with the focused client inputs on focus change and ignores stale responses', async () => {
  // first call deferred, trigger onFocusChange(hvacFl.id), resolve second then first -> rendered rows match second
});
it('unsubscribes roster and focus listeners on destroy', () => { /* both unsubscribe fns called */ });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-demand-trends-panel.test.mts`
Expected: FAIL, because `deriveTrendInputs` isn't exported and the placeholder renders `comingSoon`.

- [ ] **Step 3: Implement the panel**

- **Constructor:** `super({ id: 'demand-trends', title: t('marketing.trends.title'), showCount: false })`.
  - Subscribe to the roster, roster status and focus changes. On any one, recompute the inputs and call `refresh()`. Run one `refresh()` from the constructor, since `onFocusChange` doesn't fire on subscribe (Resolution 13).
  - `refresh()` renders by roster status first: `loading` keeps the panel's loading state, `forbidden` renders nothing roster-derived (W9's gate owns that screen), `error` renders `renderSourceUnavailable()`, and `ready` with no active clients renders `renderNoClientsState()` without calling the RPC.
  - Poll every 30 min with `setInterval`, and clear the interval in `destroy()`.
- **Stale responses:** guard them with a monotonically increasing request sequence number.
- **Each trend row:**
  - The category label, from the `marketing.category.<id>` key.
  - `sparkline(points.map(p => p.value), 'var(--accent)', 120, 24, '', { label: t('marketing.trends.sparkLabel', { category }) })`.
  - The percent change of the last point against the mean of the previous 4 points. Show `—` when that mean is 0.
- **Trending now:** one compact list per geo, top 5 terms each, showing `traffic` when it isn't empty. The full 10-term list is collapsed behind a `<details>`.
- **Outage display:** `degraded && trends.length === 0 && trendingNow.length === 0` renders `renderSourceUnavailable()`; `degraded` with data renders rows plus `marketing.trends.partial`; an RPC rejection renders `renderSourceUnavailable()`.
- **Rendering:** all output goes through `setSafeContent(safeHtml\`…\`)`. Never assign `innerHTML`, because `npm run lint` runs `scripts/enforce-safe-html.mjs`.

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-demand-trends-panel.test.mts`
Expected: PASS

- [ ] **Step 5: Run the browser checks**

Run: `npm run sync:locales` (then `npm run locales:zh-tw` if it flags zh-TW).
Expected: other locale files gain English fallbacks for the new `marketing.trends.*` keys.

Run: `npm run typecheck && npm run lint:boundaries && npm run lint`
Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/marketing/DemandTrendsPanel.ts src/locales/ tests/dom/marketing-demand-trends-panel.test.mts
git commit -m "feat(marketing): render demand trend sparklines and trending-now terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end verification and PR

**Files:** none new. This task covers evidence and delivery.

- [ ] **Step 1: Run preflight**

Run: `npm run --silent agent:preflight -- --mode repair`
Expected: no blocker. If one appears, follow its `nextAction`.

- [ ] **Step 2: Run the live smoke test against the dev server**

Run `npm run dev:marketing` with `MARKETING_CONTACT_EMAIL` set, and keep the dev fixtures loaded.

Expected:
- The Demand Trends panel shows a sparkline for each fixture client category.
- It shows trending terms for `US` plus each fixture state.
- Focusing a client narrows both.
- The dev-server log shows no `[demand-trends] degraded` lines.

- [ ] **Step 3: Run the full suites one at a time**

Run them sequentially: `npm run test:data`, then `npm run test:dom`, then `git diff --check`.
Expected: everything passes. Report any failures, and attribute pre-existing ones to their cause.

- [ ] **Step 4: Run the privacy check**

Run: `npm run build:marketing && ! grep -rl "Fixture " dist/`
Expected: no matches.

- [ ] **Step 5: Push and open the PR**

- Push the branch and open the PR to the fork's `main`. Include in the description:
  - The redirect-check output from Task 1.
  - What the tests exercise: parsing, the window, aggregation, degradation, concurrency, and panel states.
  - What stays unverified: live Wikimedia 429 behaviour under production load.
- Attach desktop and mobile screenshots for three states, using test data and labelled with the commit: populated, empty roster, and source unavailable. To force the source-unavailable state, block `trends.google.com` and `wikimedia.org`.
  - Use `gh pr edit <n> --attach '/abs/path.png#Demand Trends — populated (commit <sha>)'`.
  - Confirm the images render in the PR body.

---

## Contract Issues (resolved)

1. Unnamed point message and `value` type -> Resolution 4 (`TrendPoint{int64 date, double value}`) and Resolution 3 (`date` is epoch ms). The `DemandTrendPoint` alias is deleted; helpers use the generated `TrendPoint`.
2. No `degraded` field -> Resolution 4 (`bool degraded` on every response). The handler sets it; the panel no longer infers outages from empty arrays.
3. `TrendingTerm.traffic` type -> Resolution 4 (`string`).
4. `api.ts` wrapper name -> Resolution 8 (`getDemandTrends`, via `premiumFetch`).
5. Literal User-Agent text and duplicated builders -> Resolution 6 (`marketingUserAgent()` in W0's `_user-agent.ts`). W7's `buildMarketingUserAgent` and its test are deleted.
6. Private sibling files -> Resolution 7 (`_*.ts` next to the owner's handler is allowed).
7. Gateway cache tier -> Resolution 5 (W0 adds a private no-store tier for every `MarketingService` RPC under `isMarketingDeploy()`).

### New unresolved issues

1. **`TrendPoint.date` int64 encoding.** Resolution 3 makes it `int64` epoch ms but doesn't name the sebuf encoding. This plan assumes W0 annotates it with `INT64_ENCODING_NUMBER` (as W0 does for `WeatherAlert` times and as `prediction/v1` does), so the generated TS type is `number`. Without the annotation the generated type is `string` and `aggregateWeekly` and the tests must emit strings.
