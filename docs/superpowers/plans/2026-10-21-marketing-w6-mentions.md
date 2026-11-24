# W6 Local Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For each client, find recent local news that mentions the client, its competitors or "category + city". Show the results in a Local Mentions panel grouped by client and as dots on the map, filtered by the focused client.

**Architecture:**
- The browser turns each roster client into up to three `MentionQuery`s and sends them in chunks of 20 to the request-time `SearchLocalMentions` RPC.
- The handler turns each query into one Google News RSS search URL and caches the parsed result per query with `cachedFetchJson()`. The cache key is a SHA-256 of the exact query, so a key never holds a client name in plain text.
- The handler parses the XML with the `fast-xml-parser` setup that `server/worldmonitor/market/v1/stock-news-search.ts` already uses for the same Google News feed. It sniffs bodies with the exported `looksLikeRssXml`, then dedupes and returns `Mention`s.
- The response carries `degraded = true` when any upstream query failed (Resolution 4), so the panel can tell "source unavailable" apart from "no mentions".
- Coordinates come from the client's own location. The server always returns `lat/lon = 0,0` ("no location", Resolution 3) and the browser fills them in, because only the browser holds the roster. GDELT GEO is not used (index "Known source limits").
- The panel publishes coordinate-resolved mentions to a small store in `src/services/marketing/mentions.ts`; the map reads them from `MarketingLayerContext.mentions` (Resolution 9). Who pushes the store into `MapContainer.setMarketingLayerContext` is an open issue (see Contract Issues).

**Tech Stack:** TypeScript, sebuf generated `MarketingService` types, `fast-xml-parser` ^5.8.0, Upstash Redis via `server/_shared/redis.ts`, deck.gl `ScatterplotLayer`, `Panel` + `h()` DOM helpers, node:test (tsx), vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md`. The binding contracts are in `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

- Every Global Constraint and Shared Contract in `2026-10-21-marketing-00-index.md` applies verbatim. Read it first.
- Contracts used here, never renamed:
  - `SearchLocalMentions`
    - Request: `queries: repeated MentionQuery{client_id, terms, city, state_code}`, max 20.
    - Response: `mentions: repeated Mention{id, client_id, title, source, url, int64 published_at (epoch ms, INT64_ENCODING_NUMBER), double lat, double lon}`, plus `bool degraded` (Resolutions 3, 4).
    - Route: `POST /search-local-mentions`, private no-store cache tier under `isMarketingDeploy()` (W0, Resolution 5).
  - `marketingUserAgent(): string` from `server/worldmonitor/marketing/v1/_user-agent.ts` (W0, Resolution 6).
  - `searchLocalMentions(req: SearchLocalMentionsRequest): Promise<SearchLocalMentionsResponse>` from `src/services/marketing/api.ts`, via `premiumFetch` (W0, Resolution 8).
  - `MapContainer.setMarketingLayerContext(patch)` and `MarketingLayerContext.mentions: Mention[]` (W0, Resolution 9).
  - `renderNoClientsState()`, `renderSourceUnavailable()` from `src/components/marketing/empty-state.ts`; `getRosterStatus()`, `onRosterStatusChange(cb)` from `roster.ts` (W0, Resolution 18).
  - Panel id `local-mentions` / `LocalMentionsPanel.ts`.
  - Layer id `localMentions` / `mentions-layer.ts` exporting `buildLocalMentionsLayer(ctx: MarketingLayerContext): Layer | null`.
  - `MarketingSignal` with `kind: 'mention'` is not produced by W6: `signals` stays for W8 (Resolution 9), and the map reads `ctx.mentions`.
- Files W6 owns:
  - `server/worldmonitor/marketing/v1/search-local-mentions.ts`
  - `src/components/marketing/map/mentions-layer.ts`
  - `src/components/marketing/LocalMentionsPanel.ts`
  - new `src/services/marketing/mentions.ts`
  - its own tests
  - `marketing.mentions.*` keys in `src/locales/en.json`, plus the English fallbacks `npm run sync:locales` writes to the other locales (Resolution 1)
  - optionally private `_*.ts` helpers next to its handler (Resolution 7)
- W6 does not edit `api.ts`, `roster.ts`, `focus.ts`, `empty-state.ts`, `_user-agent.ts`, `map/index.ts`, `map/types.ts`, `MapContainer.ts`, `DeckGLMap.ts`, `panel-layout.ts`, `gateway.ts`, the proto or `src/generated/`.
- Google News search URL format, exactly: `https://news.google.com/rss/search?q=<encodeURIComponent(query)>&hl=en-US&gl=US&ceid=US:en`.
- User-Agent on every upstream fetch: `marketingUserAgent()` (Resolution 6), which yields `MarketingSituationRoom/1.0 (+mailto:<MARKETING_CONTACT_EMAIL>)`. A live probe on 2026-10-21 confirmed Google News returns 200 for this UA shape. Tests set `MARKETING_CONTACT_EMAIL=test@example.com`.
- **Privacy:** query text and client names must never appear in:
  - a log line (Resolution 5: server code never logs client names or query terms)
  - a Redis key (use `sha256Hex`, `server/_shared/hash.ts:25`)
  - a cacheable response. W0's private no-store tier covers the route (Resolution 5); W6 also calls `markNoCacheResponse` (`server/_shared/response-headers.ts:21`) as a backstop.
  - a relay URL. There is no relay fallback: `fetchAndParseRss` would put the query in `/rss?url=` and log it at `list-feed-digest.ts:986-989`, so do not reuse it.
- **Limits:**
  - at most 20 queries per request
  - `client_id` must match `/^[A-Za-z0-9_-]{1,64}$/` (Resolution 12); other queries are skipped
  - upstream concurrency 4
  - per-fetch timeout 8000 ms
  - at most 10 items per query
  - Google search operator `when:7d`
- **Cache:** healthy TTL 1800 s. An upstream failure caches nothing (`cacheFetcherErrors: false`). A valid feed with no items caches as an empty list for 1800 s.
- **Test commands** (AGENTS.md table):
  - node suites: `node --import tsx --test tests/<file>.test.mts` (CI job `unit-shards`, `npm run test:data`)
  - DOM: `npx vitest run --config vitest.dom.config.mts tests/dom/<file>` (CI job `dom-tests`)

## Review Focus

1. **Google News down, 429, or HTML interstitial:** that query yields no mentions, nothing is cached, the response has `degraded: true`, and one `[marketing-mentions] degraded` log line carries counts only. Other queries in the same request still return. If the RPC rejects or returns `degraded` with no mentions, the panel shows `renderSourceUnavailable()`; with partial results it lists them plus the notice. Pinned in Task 2 and Task 4.
2. **A client with no locations, or a location with NaN or (0,0) coords:**
   - its name query still runs
   - its mentions list in the panel
   - the mention keeps `lat/lon = 0,0`, no map dot is drawn and nothing throws
   - Pinned in Task 3 and Task 4.
3. **Roster larger than 20 queries (e.g. 12 clients × 3):** the browser splits the queries into RPC calls of at most 20. The server drops anything past 20 without error. Pinned in Task 2 and Task 3.
4. **The same article returned by the name and competitor queries, or by two pages:** it appears once per client, and the `id` is stable across polls. W8 dedupes on it. Pinned in Task 2.
5. **Empty roster or roster not ready:** `'ready'` with no clients shows `renderNoClientsState()` with no RPC call; `'loading'` shows loading; `'error'` shows `renderSourceUnavailable()`; `'forbidden'` renders no roster data and makes no RPC call. Pinned in Task 4.
6. **Client names with quotes, `&`, apostrophes or non-ASCII (e.g. `Joe's "Best" Café & Grill`):** the URL is correctly encoded, embedded `"` is stripped from phrase terms, and nothing is logged. Pinned in Task 1.

---

### Task 1: Query building and RSS parsing helpers (server, pure)

**Files:**
- Modify: `server/worldmonitor/marketing/v1/search-local-mentions.ts` (W0 stub; this task adds exported pure helpers above the handler)
- Test: `tests/marketing-search-local-mentions.test.mts`

**Interfaces:**
- Consumes:
  - `MentionQuery` from `src/generated/server/worldmonitor/marketing/v1/service_server.ts`, camelCase `{clientId: string; terms: string[]; city: string; stateCode: string}`
  - `looksLikeRssXml(text: string): boolean` (`server/worldmonitor/news/v1/list-feed-digest.ts:793`)
  - `sha256Hex(input: string): Promise<string>` (`server/_shared/hash.ts:25`)
  - `XMLParser` from `fast-xml-parser`, with the same options as `stock-news-search.ts:42-46`
- Produces:
  - `MAX_MENTION_QUERIES = 20`, `MAX_ITEMS_PER_QUERY = 10`, `CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/`
  - `buildGoogleNewsQuery(q: MentionQuery): string | null`
  - `buildGoogleNewsRssUrl(query: string): string`
  - `mentionsCacheKey(query: string): Promise<string>`
  - `interface ParsedNewsItem { title: string; source: string; url: string; publishedAt: number }`, epoch ms, `0` when the date is missing or invalid (Resolution 3)
  - `parseGoogleNewsRss(xml: string): ParsedNewsItem[] | null`, which returns null when the body is not RSS

- [ ] **Step 1: Write the failing tests**

```ts
describe('buildGoogleNewsQuery', () => {
  it('quotes a single term and adds the recency operator', () => {
    assert.equal(buildGoogleNewsQuery({ clientId: 'c1', terms: ['Fixture Plumbing Co'], city: '', stateCode: '' }),
      '"Fixture Plumbing Co" when:7d');
  });
  it('ORs several terms and anchors to the city and state', () => {
    assert.equal(buildGoogleNewsQuery({ clientId: 'c1', terms: ['Acme Air', 'Best HVAC'], city: 'Austin', stateCode: 'TX' }),
      '("Acme Air" OR "Best HVAC") "Austin" TX when:7d');
  });
  it('strips embedded double quotes and trims; drops empty terms', () => {
    assert.equal(buildGoogleNewsQuery({ clientId: 'c1', terms: [' Joe\'s "Best" Café & Grill ', '  '], city: '', stateCode: '' }),
      '"Joe\'s Best Café & Grill" when:7d');
  });
  it('returns null when no usable term remains', () => {
    assert.equal(buildGoogleNewsQuery({ clientId: 'c1', terms: ['', '"'], city: 'Austin', stateCode: 'TX' }), null);
  });
});

it('buildGoogleNewsRssUrl encodes the whole query', () => {
  assert.equal(buildGoogleNewsRssUrl('"Joe\'s Café & Grill" when:7d'),
    'https://news.google.com/rss/search?q=%22Joe\'s%20Caf%C3%A9%20%26%20Grill%22%20when%3A7d&hl=en-US&gl=US&ceid=US:en');
});

it('mentionsCacheKey hashes the query and never contains it', async () => {
  const key = await mentionsCacheKey('"Fixture Plumbing Co" when:7d');
  assert.match(key, /^marketing:local-mentions:v1:[0-9a-f]{64}$/);
  assert.ok(!key.includes('Fixture'));
  assert.notEqual(key, await mentionsCacheKey('"Fixture Roofing" when:7d'));
});

describe('parseGoogleNewsRss', () => {
  // GN_FIXTURE: an <rss><channel> with 2 <item>s, each having title "Headline - Austin Daily",
  // <link>, <pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate>, <source url="...">Austin Daily</source>
  it('maps items, strips the " - Source" title suffix, epoch-ms dates', () => {
    const items = parseGoogleNewsRss(GN_FIXTURE)!;
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], { title: 'Headline', source: 'Austin Daily', url: 'https://news.google.com/rss/articles/abc', publishedAt: Date.UTC(2026, 9, 21, 12) });
  });
  it('an invalid pubDate becomes 0', () => { /* <pubDate>garbage</pubDate> → publishedAt 0 */ });
  it('handles a single <item> (non-array) and an empty channel', () => {
    assert.equal(parseGoogleNewsRss(ONE_ITEM_FIXTURE)!.length, 1);
    assert.deepEqual(parseGoogleNewsRss('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'), []);
  });
  it('returns null for an HTML interstitial', () => {
    assert.equal(parseGoogleNewsRss('<!DOCTYPE html><html><body>captcha</body></html>'), null);
  });
  it('caps at MAX_ITEMS_PER_QUERY and drops items missing title or link', () => { /* 14 items, 2 without link → length 10 */ });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/marketing-search-local-mentions.test.mts`
Expected: FAIL. `buildGoogleNewsQuery` and the other helpers are not exported yet.

- [ ] **Step 3: Implement the helpers in `search-local-mentions.ts`**

- **Query format:** quote each term after removing `"` and collapsing whitespace. Join several terms with ` OR ` inside parentheses. Append `"<city>"` when there is a city, then the bare `stateCode`, then `when:7d`.
- **Cache key prefix:** `marketing:local-mentions:v1:`.
- **Parsing:** read `source` from either a string or `{'#text'}`, as `stock-news-search.ts:381-386` does. Remove the title suffix ` - ${source}` only when it is an exact match. Dates are `Date.parse` epoch ms; invalid dates become `0`.
- **Dependencies:** do not edit `stock-news-search.ts`, which is upstream code.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/marketing-search-local-mentions.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/worldmonitor/marketing/v1/search-local-mentions.ts tests/marketing-search-local-mentions.test.mts
git commit -m "feat(marketing): google news query + rss parse helpers for local mentions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `searchLocalMentions` handler

**Files:**
- Modify: `server/worldmonitor/marketing/v1/search-local-mentions.ts` (replace the W0 stub body)
- Test: `tests/marketing-search-local-mentions.test.mts` (append)

**Interfaces:**
- Consumes:
  - Task 1 helpers
  - `cachedFetchJson<T>(key, ttlSeconds, fetcher, negativeTtlSeconds?, opts?: { cacheFetcherErrors?: boolean })` (`server/_shared/redis.ts:922`)
  - `markNoCacheResponse(req: Request)`
  - `ServerContext`, `SearchLocalMentionsRequest`, `SearchLocalMentionsResponse`, `Mention` from the generated marketing `service_server.ts`
  - `marketingUserAgent()` (`./_user-agent`, W0, Resolution 6)
- Produces:
  - `searchLocalMentions(ctx: ServerContext, req: SearchLocalMentionsRequest): Promise<SearchLocalMentionsResponse>`. The name and signature W0's stub exports are kept, so `handler.ts` stays untouched.
  - `mentionId(clientId: string, url: string): Promise<string>`, the first 16 hex chars of `sha256Hex(clientId + '|' + normalizedUrl)`
  - `Mention.lat` and `Mention.lon` are always `0,0`, meaning "no location" (Resolution 3); the browser fills them in (Task 3).
  - `Mention.publishedAt` is epoch ms, or `0` when unknown.
  - `SearchLocalMentionsResponse.degraded` is `true` exactly when at least one query's upstream fetch failed (Resolution 4).

- [ ] **Step 1: Write the failing tests** (mock `globalThis.fetch` as `tests/stock-news-search.test.mts:30-47` does. With no Upstash env, `cachedFetchJson` runs the fetcher directly. Set `process.env.MARKETING_CONTACT_EMAIL = 'test@example.com'` before importing.)

```ts
const ctx = () => ({ request: new Request('https://x/api/marketing/v1/search-local-mentions', { method: 'POST' }), pathParams: {}, headers: {} });

it('fetches one Google News URL per valid query, with the marketing UA', async () => { /* 2 queries → 2 URLs starting with https://news.google.com/rss/search?q= ; headers['User-Agent'] === marketingUserAgent() */ });
it('caps at 20 queries without throwing', async () => { /* 25 distinct queries → fetch called 20 times */ });
it('skips queries with no usable term or an invalid client_id', async () => { /* terms [''], clientId '', or clientId 'bad id!' → 0 fetches, mentions [], degraded false */ });
it('dedupes the same link within a client but keeps it for two clients', async () => {
  // c1 name query + c1 competitor query both return link L; c2 query returns L
  const res = await searchLocalMentions(ctx(), { queries: [qC1a, qC1b, qC2] });
  assert.equal(res.mentions.filter(m => m.clientId === 'c1').length, 1);
  assert.equal(res.mentions.filter(m => m.clientId === 'c2').length, 1);
});
it('id is stable for the same client+url across calls', async () => { /* two calls → equal ids, /^[0-9a-f]{16}$/ */ });
it('sorts newest first, unknown dates (0) last, and returns lat/lon 0,0', async () => { /* ... */ });
it('all queries healthy → degraded false', async () => { /* ... */ });
it('marks the response no-store', async () => {
  const c = ctx(); await searchLocalMentions(c, { queries: [qC1a] });
  assert.equal(drainResponseHeaders(c.request)?.['X-No-Cache'], '1');
});
it('upstream 500 / HTML body: returns other queries, logs degraded without the query', async () => {
  // q1 → 500, q2 → HTML interstitial, q3 → GN_FIXTURE; capture console.log/warn/error
  const res = await searchLocalMentions(ctx(), { queries: [q1, q2, q3] });
  assert.equal(res.mentions.length, 2);
  assert.equal(res.degraded, true);
  const logged = captured.join('\n');
  assert.match(logged, /\[marketing-mentions\] degraded failed=2 total=3/);
  assert.ok(!logged.includes('Fixture') && !logged.includes('news.google.com'));
});
it('a thrown fetch (timeout) is a failed query, not a rejected RPC', async () => { /* fetch throws → mentions [], degraded true, resolves */ });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/marketing-search-local-mentions.test.mts`
Expected: FAIL. The stub returns `{ mentions: [], degraded: false }` and makes no fetch calls.

- [ ] **Step 3: Implement `searchLocalMentions`**

- **Setup:** call `markNoCacheResponse(ctx.request)` first. Then take `req.queries.slice(0, MAX_MENTION_QUERIES)`, drop queries whose `clientId` fails `CLIENT_ID_RE`, and build each query string.
- **Fetching:** run at most 4 at a time, using a small local worker-pool loop.
- **Each query:**
  - Call `cachedFetchJson(await mentionsCacheKey(query), 1800, fetcher, 120, { cacheFetcherErrors: false })`.
  - The fetcher calls `fetch(url, { headers: { 'User-Agent': marketingUserAgent(), Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(8000) })`.
  - The fetcher throws on `!ok` or when `parseGoogleNewsRss` returns null. The throw keeps the failure out of the cache.
  - The outer try/catch counts the failure.
- **Dedupe:** within one client, use the key `normalizedUrl || lowercased title`. Normalize a URL by lowercasing the host and stripping the hash.
- **Degraded:** return `{ mentions, degraded: failed > 0 }`.
- **Logging:** print exactly one `console.warn('[marketing-mentions] degraded failed=N total=M')`, and only when N > 0. The log never includes query text, URLs or client ids.
- **User-Agent:** `marketingUserAgent()` only; no local UA constant.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/marketing-search-local-mentions.test.mts`
Expected: PASS.

- [ ] **Step 5: Run the API typecheck and the edge import guard**

Run: `npm run typecheck:api && node --import tsx --test tests/edge-functions.test.mjs`
Expected: both exit 0. The `fast-xml-parser` and `list-feed-digest` imports are edge-safe, because `market` and `intelligence` already bundle them.

- [ ] **Step 6: Commit**

```bash
git add server/worldmonitor/marketing/v1/search-local-mentions.ts tests/marketing-search-local-mentions.test.mts
git commit -m "feat(marketing): SearchLocalMentions handler over Google News RSS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Browser mentions service (queries, chunking, coordinates, store)

**Files:**
- Create: `src/services/marketing/mentions.ts`
- Test: `tests/marketing-mentions-service.test.mts`

**Interfaces:**
- Consumes:
  - `MarketingClient`, `MarketingClientLocation` from `shared/marketing/types.ts`
  - the W0 `api.ts` wrapper `searchLocalMentions(req: SearchLocalMentionsRequest): Promise<SearchLocalMentionsResponse>` (Resolution 8), with its re-exported generated types `MentionQuery`, `Mention`, `SearchLocalMentionsRequest`, `SearchLocalMentionsResponse`
- Produces:
  - `buildMentionQueries(client: MarketingClient): MentionQuery[]`, which returns 0 to 3 queries:
    - client name: `terms: [name]`, no city
    - competitors: `terms: competitors.slice(0,5)`, plus the primary location's city and stateCode, only when competitors exist and a primary location exists
    - category: `terms: [category label]` plus city and stateCode. The label is the category with `-` replaced by a space. This query is skipped for `'other'` and when there is no location.
    - Inactive clients get `[]` (Resolution 12).
  - `chunkQueries(qs: MentionQuery[], size = 20): MentionQuery[][]`
  - `fetchClientMentions(clients: MarketingClient[], search = searchLocalMentions): Promise<{ mentions: Mention[]; degraded: boolean }>`. It sends each chunk sequentially. `degraded` is true when any chunk rejected or any response had `degraded: true`. It rejects only when every chunk rejected.
  - `resolveMentionCoords(m: Mention, client: MarketingClient | undefined): Mention`. When `m` is `0,0`, it copies the first client location with finite, non-(0,0) coordinates; otherwise it leaves `0,0` (Resolution 3).
  - `setLocalMentions(m: Mention[]): void`
  - `getLocalMentions(): Mention[]`
  - `onLocalMentionsChange(cb: (m: Mention[]) => void): () => void`. It does not fire on subscribe, matching Resolution 13's focus semantics.

- [ ] **Step 1: Write the failing tests** (import from `@/services/marketing/mentions`; node tests already resolve `@/`, e.g. `tests/auth-state-disabled-clerk.test.mts:4`)

```ts
const client = { id: 'c1', name: 'Fixture Air', category: 'pest-control', competitors: ['Rival A'], keywords: [], accountManagerEmail: null, active: true,
  locations: [{ id: 'l1', label: 'HQ', address: '', city: 'Austin', stateCode: 'TX', lat: 30.27, lon: -97.74, serviceRadiusMiles: 20 }] };
it('builds name, competitor and category+city queries', () => {
  assert.deepEqual(buildMentionQueries(client), [
    { clientId: 'c1', terms: ['Fixture Air'], city: '', stateCode: '' },
    { clientId: 'c1', terms: ['Rival A'], city: 'Austin', stateCode: 'TX' },
    { clientId: 'c1', terms: ['pest control'], city: 'Austin', stateCode: 'TX' },
  ]);
});
it('no locations → only the name query; inactive → none', () => { /* ... */ });
it('splits 36 queries into 20 + 16 and calls search once per chunk', async () => { /* 12 clients × 3 */ });
it('one failed chunk still returns the other chunk with degraded true; all failed rejects', async () => { /* ... */ });
it('a chunk response with degraded true marks the result degraded', async () => { /* ... */ });
it('resolveMentionCoords uses the client location, keeps 0,0 for NaN/(0,0)/no location/unknown client', () => {
  assert.equal(resolveMentionCoords(m, client).lat, 30.27);
  assert.equal(resolveMentionCoords(m, { ...client, locations: [{ ...client.locations[0], lat: NaN }] }).lat, 0);
  assert.equal(resolveMentionCoords(m, undefined).lat, 0);
});
it('onLocalMentionsChange does not fire on subscribe, notifies on set, and unsubscribes', () => { /* ... */ });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/marketing-mentions-service.test.mts`
Expected: FAIL with "Cannot find module '@/services/marketing/mentions'".

- [ ] **Step 3: Implement `src/services/marketing/mentions.ts` with the signatures above**

- **Imports:** only `shared/` types and `./api` (including its re-exported generated types), following the `services` import direction.
- **State:** the store is a module-level array plus a `Set` of listeners.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/marketing-mentions-service.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/marketing/mentions.ts tests/marketing-mentions-service.test.mts
git commit -m "feat(marketing): browser mentions service with query chunking and coord fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `LocalMentionsPanel`

**Files:**
- Modify: `src/components/marketing/LocalMentionsPanel.ts` (replace the W0 placeholder)
- Modify: `src/locales/en.json` (add the `marketing.mentions` object only), then the other `src/locales/*.json` via `npm run sync:locales` (Resolution 1)
- Test: `tests/dom/marketing-local-mentions-panel.test.mts`

**Interfaces:**
- Consumes:
  - `getClients()`, `subscribeClients(cb)`, `getRosterStatus()`, `onRosterStatusChange(cb)` (`@/services/marketing/roster`, Resolution 18)
  - `getFocusedClientId()`, `onFocusChange(cb)` (`@/services/marketing/focus`). `onFocusChange` does not fire on subscribe (Resolution 13), so the constructor triggers the first refresh itself.
  - `renderNoClientsState()`, `renderSourceUnavailable()` (`@/components/marketing/empty-state`, Resolution 18)
  - Task 3 `fetchClientMentions`, `resolveMentionCoords`, `setLocalMentions`
  - `Panel` and `setContentNodes(...children)` (`src/components/Panel.ts:1469`), `showLoading()` (:1023), `setCount(n)` (:1396), `destroy()` (:1669)
  - `h()` (`src/utils/dom-utils.ts:20`), `sanitizeUrl` (`src/utils/sanitize.ts:72`), `t()` (`@/services/i18n`)
- Produces:
  - `class LocalMentionsPanel extends Panel`, with `constructor()` keeping the W0 placeholder's constructor shape, id `'local-mentions'`
  - `public refresh(): Promise<void>`
  - Every successful refresh calls `setLocalMentions(...)` with coordinate-resolved mentions, which feeds the map layer.
- en.json keys (the title is W0's `marketing.panels.localMentions`; empty and unavailable states use W0's `marketing.empty.noClients` and `marketing.common.sourceUnavailable`):
  - `marketing.mentions.none`: "No mentions in the last 7 days"
  - `marketing.mentions.focused`: "Showing {{client}} only"

- [ ] **Step 1: Write the failing tests** (pattern: `tests/dom/china-panel-refetch.test.mts`, using `vi.hoisted` + `vi.mock` for `@/services/marketing/roster`, `@/services/marketing/focus` and `@/services/marketing/api`, plus `initTestI18n()`. The real `empty-state.ts` is used.)

```ts
it('empty roster → renderNoClientsState() output, no RPC call', async () => { /* status 'ready', getClients → [] ; text matches marketing.empty.noClients; expect(search).not.toHaveBeenCalled() */ });
it('roster status loading / error / forbidden', async () => { /* 'loading' → loading shown, no RPC; 'error' → sourceUnavailable; 'forbidden' → no RPC, no client names rendered; status change to 'ready' → refresh */ });
it('first refresh runs on construction without a focus event', async () => { /* search called once after construction */ });
it('groups mentions under client headings, newest first, links open in new tab with rel=noopener', async () => { /* 2 clients, 3 mentions → 2 .marketing-mentions-group, anchors target=_blank */ });
it('focus filters to one client and only queries that client', async () => { /* getFocusedClientId → 'c2'; search called with queries all clientId c2; one group */ });
it('focus change triggers a refresh', async () => { /* invoke captured onFocusChange cb → search called again */ });
it('RPC rejection → renderSourceUnavailable(), nothing thrown, setLocalMentions not called', async () => { /* search rejects */ });
it('degraded with zero mentions → source unavailable, not "No mentions"', async () => { /* { mentions: [], degraded: true } */ });
it('degraded with some mentions → list plus source-unavailable notice', async () => { /* ... */ });
it('zero mentions, not degraded → "No mentions in the last 7 days"', async () => { /* ... */ });
it('publishes coordinate-resolved mentions to the store', async () => { /* setLocalMentions receives lat 30.27 for a 0,0 mention */ });
it('client with bad coordinates still lists its mentions', async () => { /* location lat NaN → mention rendered; stored mention stays 0,0 */ });
it('publishedAt 0 renders no relative time', async () => { /* ... */ });
it('renders titles as text, not HTML', async () => { /* title '<img src=x onerror=1>' → no img element */ });
it('destroy clears the poll interval and unsubscribes', async () => { /* vi.useFakeTimers; after destroy, advance 15 min → no new call */ });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-local-mentions-panel.test.mts`
Expected: FAIL. The placeholder renders `marketing.panel.comingSoon`.

- [ ] **Step 3: Implement the panel**

- **Roster status:** `refresh()` first checks `getRosterStatus()`: `'loading'` → loading, `'error'` → `renderSourceUnavailable()`, `'forbidden'` → empty content and no RPC (W9 owns the request-access screen), `'ready'` with no active clients → `renderNoClientsState()`.
- **Data:** otherwise it reads the active clients (filtered to the focused client when one is set) and calls `fetchClientMentions`. It maps the results through `resolveMentionCoords`, calls `setLocalMentions`, and renders with `h()` + `setContentNodes`. It uses no HTML strings, so it satisfies `npm run lint:safe-html`.
- **Degraded:** with `degraded` and no mentions, render `renderSourceUnavailable()`; with `degraded` and mentions, render the list followed by `renderSourceUnavailable()`.
- **Groups:** one group per client, in roster order. Each group holds at most 8 items and the panel at most 60. Each item is a title link, then the source and a relative time (omitted when `publishedAt` is `0`).
- **Count:** call `setCount(total)`.
- **Loading:** show `showLoading()` only when nothing has rendered yet.
- **Polling:** every 15 minutes with `setInterval`. Also re-run on `subscribeClients`, `onRosterStatusChange` and `onFocusChange`, and once from the constructor.
- **Teardown:** `destroy()` clears the interval and all three subscriptions, then calls `super.destroy()`.
- **Strings:** add the two en.json keys, then run `npm run sync:locales` (and `npm run locales:zh-tw` if zh-TW is flagged).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-local-mentions-panel.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/marketing/LocalMentionsPanel.ts src/locales/ tests/dom/marketing-local-mentions-panel.test.mts
git commit -m "feat(marketing): Local Mentions panel grouped by client and filtered by focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `mentions-layer.ts` map dots

**Files:**
- Modify: `src/components/marketing/map/mentions-layer.ts` (replace the W0 `return null` stub)
- Test: `tests/marketing-mentions-layer.test.mts`

**Interfaces:**
- Consumes: `MarketingLayerContext` from `./types` with `mentions: Mention[]` (W0, Resolution 9), `Mention` from `@/services/marketing/api`, `ScatterplotLayer` from `@deck.gl/layers`, and the same `Layer` import `DeckGLMap.ts:8` uses.
- Produces:
  - `buildLocalMentionsLayer(ctx: MarketingLayerContext): Layer | null`. It returns null when `!ctx.visibleLayerIds.has('localMentions')` or no point remains.
  - `aggregateMentionPoints(mentions: Mention[], focusedClientId: string | null): Array<{ clientId: string; lat: number; lon: number; count: number; latestTitle: string }>`
    - It keeps only mentions with finite coordinates that are not `0,0` (Resolution 3).
    - When a client is focused, it keeps only that client.
    - It groups by `clientId|lat|lon`; `latestTitle` is the title with the largest `publishedAt`.
  - `mentionTooltip(info: { object?: unknown }): { text: string } | null`. Plain text `"<count> mention(s)\n<latestTitle>"`, never HTML. It is attached as the layer's `getTooltip` (Resolution 9).
  - Layer settings:
    - layer id `'marketing-local-mentions'`, `pickable: true`
    - `getRadius = 4000 + 1500 * min(count, 10)` metres
    - fill colour amber `[245, 158, 11, 200]`

- [ ] **Step 1: Write the failing tests**

```ts
it('returns null when the layer is hidden or there are no mention points', () => { /* visibleLayerIds empty → null; only 0,0 mentions → null; mentions [] → null */ });
it('aggregates by client location and drops 0,0/NaN coords', () => {
  assert.deepEqual(aggregateMentionPoints([men('c1',30,-97,'older',1), men('c1',30,-97,'newest',2), men('c2',0,0), men('c3',NaN,1)], null),
    [{ clientId: 'c1', lat: 30, lon: -97, count: 2, latestTitle: 'newest' }]);
});
it('mentionTooltip returns plain text and null without an object', () => { /* title '<b>x</b>' appears verbatim in text; {} → null */ });
it('empty clients and empty mentions do not throw', () => { /* ... */ });
it('focus keeps only the focused client', () => { /* ... */ });
it('builds a ScatterplotLayer with id marketing-local-mentions', () => {
  const layer = buildLocalMentionsLayer(ctxWith({ mentions: [men('c1',30,-97)] }));
  assert.equal(layer?.id, 'marketing-local-mentions');
  assert.equal((layer?.props.data as unknown[]).length, 1);
  assert.equal(typeof (layer?.props as { getTooltip?: unknown }).getTooltip, 'function');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/marketing-mentions-layer.test.mts`
Expected: FAIL. The stub returns null and `aggregateMentionPoints` and `mentionTooltip` are not exported.

- [ ] **Step 3: Implement the three functions with the values in Interfaces**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/marketing-mentions-layer.test.mts`
Expected: PASS.

- [ ] **Step 5: Run the browser gates one at a time**

Run: `npm run typecheck`, then `npm run lint:boundaries`, then `npm run lint`, then `git diff --check`.
Expected: each exits 0.

- [ ] **Step 6: Run the privacy check**

Run: `npm run build:marketing && grep -rl "Fixture " dist/ ; echo "exit=$?"`
Expected: no files listed, and the `grep` exit code is 1.

Then run `grep -rn "console\.\(log\|warn\|error\)" server/worldmonitor/marketing/v1/search-local-mentions.ts`.
Expected: only the single `degraded` line from Task 2.

- [ ] **Step 7: Commit**

```bash
git add src/components/marketing/map/mentions-layer.ts tests/marketing-mentions-layer.test.mts
git commit -m "feat(marketing): local mentions map layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Deliver**

Open the PR to the fork's `main` following AGENTS.md. Run `npm run dev:marketing` with the fixture clients and capture panel screenshots: grouped, focused, empty roster and source unavailable. Also capture the map dots, at desktop and mobile widths. Attach them with `gh pr edit <n> --attach`.

---

## Contract Issues (resolved)

1. GDELT GEO unavailable → index "Known source limits": mention pins use the client location.
2. `Mention.lat/lon` cannot be absent → Resolution 3: `0,0` means "no location"; the browser fills from the client location (`resolveMentionCoords`).
3. `SearchLocalMentions` must be POST → Resolution 5: POST, private no-store tier under `isMarketingDeploy()`, no logging of names or terms. `markNoCacheResponse` stays as a backstop.
4. No `degraded` field → Resolution 4: `bool degraded` on the response; Tasks 2–4 set and consume it.
5. `api.ts` wrapper signature unpinned; `published_at` type → Resolution 8 (request object in, generated response out, via `premiumFetch`) and Resolution 3 (`int64` epoch ms).
6. Who fills `MarketingLayerContext.signals` → Resolution 9: the map reads `ctx.mentions: Mention[]` via `setMarketingLayerContext`; `signals` stays for W8; W6 provides its own tooltip. The `MarketingSignal` store is dropped. The remaining gap is new issue A below.
7. No shared marketing User-Agent → Resolution 6: `marketingUserAgent()` from `_user-agent.ts` (W0); the local `UA` constant is deleted.

## Contract Issues (new, unresolved)

A. **Nobody owns pushing mentions into the map context.** Resolution 9 gives W0's `MapContainer.setMarketingLayerContext(patch)` and `ctx.mentions`, but W6 owns no `src/app/` file and the panel has no map handle. W6 publishes through `onLocalMentionsChange` in `src/services/marketing/mentions.ts`. An app-layer owner (W0's wiring, or W3's `src/app/marketing-focus.ts`) needs to add `onLocalMentionsChange(m => map.setMarketingLayerContext({ mentions: m }))`. W4's `weatherAlerts` has the same gap.
B. **Google News RSS terms.** This was prior issue 8 and is still unresolved. The feed's `<copyright>` says it is "solely for... personal, non-commercial use". The spec lists it as a free source, but an agency's internal use may conflict with those terms. This needs an owner decision before production.
