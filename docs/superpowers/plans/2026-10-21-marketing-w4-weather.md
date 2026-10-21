# Marketing W4: NWS Weather Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `ListWeatherAlerts` RPC returns active NWS alerts for the requested US states. The map draws them as severity-coloured polygons, and the Weather Alerts panel lists only the alerts that touch a client's service area.

**Architecture:**
- **Handler:** a request-time handler fetches `api.weather.gov/alerts/active?area=<codes>` through `cachedFetchJson` with a 5-minute TTL and normalises the GeoJSON features. Many NWS alerts are zone-based and arrive with `geometry: null`. For those alerts at `watch` severity or higher, the handler fills the geometry from the alert's `affectedZones`, and each zone shape is cached for 24 hours. An alert whose zone lookups all fail is dropped (index "Known source limits"). The response carries `degraded: true` when NWS itself failed (Resolution 4).
- **Shared matcher:** `shared/marketing/weather-match.ts` holds severity mapping, geometry parsing and alert-to-client matching. The geometric test itself is W0's `polygonTouchesServiceArea` (Resolution 10); W4 does not re-implement it. W8's evaluator can reuse the matcher for the "NWS warning intersects service area" rule.
- **Browser store:** a small store in `src/services/marketing/` holds the latest response. The panel drives polling; the store pushes each snapshot to the map through W0's `MapContainer.setMarketingLayerContext({ weatherAlerts })` (Resolution 9). `nws-layer.ts` reads `ctx.weatherAlerts` only, and the panel reads the store.

**Tech Stack:**
- TypeScript, with sebuf-generated `MarketingService` types (made by W0).
- `cachedFetchJson` and `fetchJson` from `server/_shared/`.
- deck.gl `GeoJsonLayer` from `@deck.gl/layers`.
- `Panel` with the `h()` DOM helpers.
- Tests: node:test via tsx, and vitest with happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md` (Signals table, "Weather and local events" row; W4 in the execution plan). Binding contracts: `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

The constraints in the index's "Global Constraints" section all apply here. The ones this plan relies on most:
- **No change outside the variant:** nothing changes when `VITE_VARIANT !== 'marketing'`. Every file here is new, or is a W4-owned file that W0 created as a placeholder.
- **User-Agent:** every server fetch sends `marketingUserAgent()` from W0's `server/worldmonitor/marketing/v1/_user-agent.ts` (Resolution 6). NWS rejects requests without one. Tests set `MARKETING_CONTACT_EMAIL` (and leave `NODE_ENV` non-production) so it does not throw.
- **Caching:** use `cachedFetchJson(key, ttlSeconds, fetcher, negativeTtlSeconds, opts)` from `server/_shared/redis.ts:922`. The cache key includes the sorted, de-duplicated state codes.
- **Edge-safe code:** handler code avoids `node:http`, `node:https` and `node:zlib`. It calls the global `fetch` through `fetchJson` (`server/_shared/fetch-json.ts`), whose `headers` option overrides the default Chrome UA.
- **No hand edits to `src/generated/`.** Use the generated names W0 produces (Resolutions 3–4): `MarketingServiceHandler`, `ListWeatherAlertsRequest { stateCodes: string[] }`, `ListWeatherAlertsResponse { alerts: WeatherAlert[]; degraded: boolean }`, and `WeatherAlert { id, event, severity, headline, areaDesc, onset: number, expires: number, polygonGeojson, zoneCodes: string[], stateCodes: string[] }`, all from `src/generated/server/worldmonitor/marketing/v1/service_server.ts`. `onset`/`expires` are int64 epoch ms (`0` = unknown); this plan assumes W0 used `INT64_ENCODING_NUMBER` as other domains do, so they are `number` in TS.
- **Privacy and caching:** W0 sets the private no-store cache tier for every `MarketingService` RPC (Resolution 5). The handler logs counts only, never state lists alongside client data, client names or terms.
- **Browser import direction:** `types -> config -> services -> components`. `shared/` can be imported from both sides.
- **Strings:** English strings live under `marketing.weather.*` in `src/locales/en.json`; after editing, run `npm run sync:locales` (and `npm run locales:zh-tw` if flagged). On a locale rebase conflict, take base and re-run `sync:locales` (Resolution 1). The shared empty/unavailable copy comes from W0's `empty-state.ts` (Resolution 18).
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Before implementing**, run `npm run --silent agent:preflight -- --mode repair` in the W4 worktree, which branches from W0's merge commit.

**Values pinned by this plan:**
- **Severity mapping:**
  - NWS `Extreme` and `Severe` map to `'warning'`.
  - `Moderate` maps to `'watch'`.
  - `Minor`, `Unknown` and a missing value map to `'info'`.
  - `WeatherAlert.severity` carries the mapped value (Resolution 4).
- **Handler cache:** alerts TTL is 300 s and negative TTL is 60 s. Zone shapes have a TTL of 86400 s.
- **Cache keys:**
  - `marketing:nws-alerts:v1:<CODES joined by ','>`
  - `marketing:nws-zone:v1:<ZONE_ID>`
- **Upstream URL:** `https://api.weather.gov/alerts/active?area=<CODES>&status=actual&message_type=alert,update`, with header `Accept: application/geo+json`. This was probed live on 2026-10-21: it returns 200 with `features[]`, and an invalid area returns 400 with `parameterErrors`.
- **Limits:**
  - At most 25 state codes per request. Allowed codes are the 50 states plus DC, PR, VI, GU, AS and MP.
  - At most 40 distinct zone fetches per request, 6 at a time.
  - The fetch timeout is 8 s for each alerts or zone call, and the outer `timeoutMs` is 20 000.
- **Zone and state codes:** `zoneCodes` are the distinct zone ids parsed from `affectedZones` (allowlisted URLs only), in feature order. `stateCodes` are the distinct first-two-letter prefixes of `zoneCodes`, intersected with the request's sanitised codes and sorted.
- **Timestamps:** `onset = Date.parse(onset ?? effective)`, `expires = Date.parse(ends ?? expires)`; unparseable gives `0`.
- **Zone URL allowlist:** `^https://api\.weather\.gov/zones/(forecast|county|fire)/[A-Z]{2}[CZ]\d{3}$`.
- **Browser polling:** every 300 000 ms while the panel is mounted.
- **Layer colours (RGBA fill / line):**
  - `warning`: `[220,38,38,90]` / `[220,38,38,220]`
  - `watch`: `[245,158,11,70]` / `[245,158,11,220]`
  - `info`: `[59,130,246,40]` / `[59,130,246,180]`

## Review Focus

1. **Zone-based alert with `geometry: null`:** this is the common case. All 10 TX/CA alerts in a live probe on 2026-10-21 had no geometry. The alert must still reach the map and panel through zone-geometry fill. If every zone fetch fails, the alert is dropped from the response without throwing (index "Known source limits"). *Pinned in Task 3.*
2. **NWS down, slow, 403/500 (for example a missing UA), or returning non-GeoJSON:** the handler returns `{ alerts: [], degraded: true }` and logs `[marketing/nws] degraded`. The panel shows `renderSourceUnavailable()` when `degraded` is true or the RPC call rejects. Other panels are unaffected. *Pinned in Task 2 (handler) and Task 6 (panel).*
3. **Client location with a missing or invalid `stateCode` or non-finite lat/lon:** the store leaves it out of the RPC's state codes, and the matcher and layer skip it without throwing. *Pinned in Tasks 1, 4 and 5.*
4. **Requests that differ only in case or order (`["tx","OK"]` vs `["OK","TX"]`) or contain junk (`"ZZ"`, `""`, `"Texas"`):** these produce one cache key and one valid upstream URL. Junk is dropped, and an empty request skips the upstream call. *Pinned in Task 2.*
5. **Empty roster, or a focused client with no matching alerts:** the panel shows W0's `renderNoClientsState()`, or a "no alerts in service areas" message. It never shows a spinner or an error. *Pinned in Task 6.*

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `shared/marketing/weather-match.ts` | Create | Severity mapping, `polygonGeojson` parsing, location usability, and alert-to-client matching (geometry via W0's `polygonTouchesServiceArea`), shared by browser and server |
| `server/worldmonitor/marketing/v1/list-weather-alerts.ts` | Replace W0 stub | Input sanitising, cache key, NWS fetch and normalise, degraded handling |
| `server/worldmonitor/marketing/v1/_nws-zones.ts` | Create (Resolution 7) | Zone-id parsing, zone cache key, zone-geometry fill |
| `tests/fixtures/marketing/nws-alerts-active.json` | Create | Trimmed real-shape NWS FeatureCollection |
| `tests/fixtures/marketing/nws-zone-TXZ102.json` | Create | Trimmed real-shape NWS zone Feature |
| `src/services/marketing/weather-alerts.ts` | Create | Browser store: derive state codes, call the RPC wrapper, hold the snapshot, notify subscribers and the map sink |
| `src/components/marketing/map/nws-layer.ts` | Replace W0 stub | `buildNwsAlertsLayer(ctx)` returning a `GeoJsonLayer` |
| `src/components/marketing/WeatherAlertsPanel.ts` | Replace W0 placeholder | Lists the alerts that intersect client service areas, respecting focus |
| `src/locales/en.json` + other locales | Modify (`marketing.weather` subtree; others via `npm run sync:locales`) | Panel copy |
| `tests/marketing-weather-match.test.mts` | Create | Matcher unit tests |
| `tests/marketing-weather-alerts-handler.test.mts` | Create | Fixture-based handler tests |
| `tests/marketing-nws-layer.test.mts` | Create | Layer builder tests |
| `tests/dom/marketing-weather-alerts.test.mts` | Create | Store and panel DOM tests |

---

### Task 1: Shared severity mapping and alert-to-client matching

**Files:**
- Create: `shared/marketing/weather-match.ts`
- Test: `tests/marketing-weather-match.test.mts`

**Interfaces:**
- Consumes:
  - `MarketingClient`, `MarketingClientLocation` and `MarketingSignal` from `shared/marketing/types.ts`.
  - `polygonTouchesServiceArea(loc, geojson: string): boolean` from `shared/marketing/geo.ts` (W0, Resolution 10). W0 owns its geometric tests; W4 does not add a second intersection implementation.
- Produces:
  - `type AlertSeverity = MarketingSignal['severity']`
  - `mapNwsSeverity(raw: string | null | undefined): AlertSeverity`
  - `type AlertGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon`
  - `parseAlertGeometry(polygonGeojson: string): AlertGeometry | null`. It returns null for `''`, invalid JSON, other geometry types, or rings with non-finite coordinates.
  - `isUsableLocation(loc: MarketingClientLocation): boolean`. It is true when lat and lon are finite and in range, the radius is greater than 0, and `stateCode` matches `/^[A-Z]{2}$/`.
  - `interface WeatherAlertLike { id: string; severity: string; polygonGeojson: string }`
  - `interface AlertClientMatch<A> { alert: A; clientIds: string[]; locationLabels: string[] }`
  - `matchAlertsToClients<A extends WeatherAlertLike>(alerts: A[], clients: MarketingClient[]): AlertClientMatch<A>[]`. It skips inactive clients (Resolution 12), unusable locations and alerts whose `parseAlertGeometry` is null, and calls `polygonTouchesServiceArea(loc, alert.polygonGeojson)`. Results are sorted with warning first, then watch, then info, then by `id`.
  - `const SEVERITY_ORDER: Record<AlertSeverity, number>`, with `warning: 0`, `watch: 1` and `info: 2`.

- [ ] **Step 1: Write the failing tests** in `tests/marketing-weather-match.test.mts`.
  - Fixtures: a square polygon spanning lon -97.6 to -97.4 and lat 30.2 to 30.4, and a location helper `loc({lat, lon, radius})`.
  - `mapNwsSeverity`:
    - `'Extreme'` and `'Severe'` give `'warning'`.
    - `'Moderate'` gives `'watch'`.
    - `'Minor'`, `'Unknown'`, `undefined` and `'garbage'` give `'info'`.
  - `parseAlertGeometry`:
    - `''`, `'not json'` and a Point all give `null`.
    - A Polygon and a MultiPolygon round-trip.
    - A ring that contains `[NaN, 1]` gives `null`.
  - `isUsableLocation`:
    - `false` for `lat: NaN`, `lon: 200`, `serviceRadiusMiles: 0` and `stateCode: ''`.
    - `true` for a valid fixture location.
  - `matchAlertsToClients`:
    - A location inside the square (30.3, -97.5, radius 1) matches; one 50 miles away with radius 10 does not (smoke check that W0's helper is wired, not a re-test of it).
    - A client with one bad and one good location matches through the good one and doesn't throw.
    - Inactive clients are ignored.
    - An alert with `polygonGeojson: ''` never matches.
    - Results come out ordered warning, watch, info.
    - `clientIds` contains no duplicates when two locations of the same client both match.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/marketing-weather-match.test.mts`
Expected: FAIL with `Cannot find module '../shared/marketing/weather-match.ts'`.

- [ ] **Step 3: Implement `shared/marketing/weather-match.ts`** with the exports above. Intersection delegates to `polygonTouchesServiceArea`. No new dependency.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/marketing-weather-match.test.mts`
Expected: PASS, with every test green.

- [ ] **Step 5: Commit**

```bash
git add shared/marketing/weather-match.ts tests/marketing-weather-match.test.mts
git commit -m "feat(marketing): add NWS severity mapping and alert-to-client matching"
```

---

### Task 2: `ListWeatherAlerts` handler: sanitise, cache, fetch, normalise, degrade

**Files:**
- Modify: `server/worldmonitor/marketing/v1/list-weather-alerts.ts` (replace the W0 stub body; keep the export name W0 used, which `handler.ts` imports)
- Create: `tests/fixtures/marketing/nws-alerts-active.json`
- Test: `tests/marketing-weather-alerts-handler.test.mts`

**Interfaces:**
- Consumes:
  - `mapNwsSeverity` (Task 1).
  - `cachedFetchJson` from `server/_shared/redis.ts`.
  - `fetchJson` from `server/_shared/fetch-json.ts`.
  - `marketingUserAgent()` from `./_user-agent.ts` (W0, Resolution 6).
  - The generated types listed in Global Constraints.
- Produces:
  - `export const listWeatherAlerts: MarketingServiceHandler['listWeatherAlerts']`
  - `export function sanitizeStateCodes(codes: string[]): string[]`. It trims, uppercases, filters to the allowed set, de-duplicates, sorts and caps at 25.
  - `export function weatherAlertsCacheKey(codes: string[]): string`. It takes already-sanitised codes.
  - `export function buildNwsAlertsUrl(codes: string[]): string`
  - `export function normalizeNwsFeature(f: unknown, requestedCodes: string[]): { alert: WeatherAlert; zoneUrls: string[] } | null`. It returns null for a missing `id` or `properties`, or for `messageType === 'Cancel'`. It fills `zoneCodes`, `stateCodes`, epoch-ms `onset`/`expires` and the mapped `severity` per the pinned values.
  - No local User-Agent helper (the earlier `MARKETING_USER_AGENT` is deleted in favour of Resolution 6).

**Fixture:** `nws-alerts-active.json` is a `FeatureCollection` shaped like the live response (`features[].{id, geometry, properties.{id, event, severity, headline, areaDesc, onset, effective, expires, ends, messageType, affectedZones}}`). It contains four features:
1. A `Tornado Warning`, severity `Extreme`, with Polygon geometry around Austin TX.
2. A `Flood Watch`, severity `Severe`, with `geometry: null` and `affectedZones` `[".../zones/forecast/TXZ102", ".../zones/forecast/TXZ103"]`.
3. An `Air Quality Alert`, severity `Unknown`, with `geometry: null`.
4. A feature with `messageType: 'Cancel'`.

- [ ] **Step 1: Write the failing tests.**
  - **Setup:** set `process.env.MARKETING_CONTACT_EMAIL = 'ops@example.com'`. Stub `globalThis.fetch` and record the URL and headers of each call. Restore both in `after`. Make sure `UPSTASH_REDIS_REST_URL` is unset so `cachedFetchJson` calls the fetcher directly, as in `tests/search-flight-prices-fail-closed.test.mts`. Pass `ctx = { request: new Request('https://example.com/'), pathParams: {}, headers: {} }`.
  - **`sanitizeStateCodes`:** `[' tx','OK','ok','ZZ','','Texas']` gives `['OK','TX']`. 30 valid codes are capped at 25.
  - **`weatherAlertsCacheKey`:** `sanitizeStateCodes(['tx','OK'])` and `sanitizeStateCodes(['ok','TX'])` both give `'marketing:nws-alerts:v1:OK,TX'`.
  - **`buildNwsAlertsUrl(['OK','TX'])`:** gives `https://api.weather.gov/alerts/active?area=OK,TX&status=actual&message_type=alert,update`.
  - **Empty request:** `listWeatherAlerts(ctx, { stateCodes: [] })` gives `{ alerts: [], degraded: false }` and the fetch stub is called 0 times.
  - **Happy path** (the stub serves the fixture for `/alerts/active` and 404 for `/zones/`). Assert the following:
    - The request header `User-Agent` equals `marketingUserAgent()` and contains `ops@example.com`.
    - The response has `degraded: false`.
    - The Cancel feature is excluded.
    - The tornado alert has `severity === 'warning'`, its `polygonGeojson` parses to `{type:'Polygon'}`, `areaDesc` passes through, and `onset`/`expires` equal `Date.parse` of the fixture ISO strings.
    - The air-quality alert (`info`, null geometry, no fill attempted) is excluded.
    - `onset` falls back to `effective` when `onset` is null, and `expires` prefers `ends` over `expires`; an unparseable time gives `0`.
    - `normalizeNwsFeature(floodWatch, ['OK','TX'])` gives `zoneCodes: ['TXZ102','TXZ103']` and `stateCodes: ['TX']`; with requested `['OK']`, `stateCodes` is `[]`.
  - **Degraded:** the stub returns 500, then throws, then returns 200 with `'<html>'`. Each case gives `{ alerts: [], degraded: true }`, and `console.warn` is called with a first argument containing `'[marketing/nws] degraded'`. Spy on `console.warn` with `mock.method`, and assert no logged argument contains a state code list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/marketing-weather-alerts-handler.test.mts`
Expected: FAIL, because `sanitizeStateCodes` is not exported (the stub returns an empty list).

- [ ] **Step 3: Implement the exports in `list-weather-alerts.ts`.**
  - The fetcher calls `fetchJson(buildNwsAlertsUrl(codes), { timeoutMs: 8000, headers: { 'User-Agent': marketingUserAgent(), Accept: 'application/geo+json' }, provider: 'nws', operation: 'alerts-active' })`.
  - It returns `null` when the body has no `features` array. Otherwise it returns `{ alerts, degraded: false }`. In this task, null-geometry alerts are dropped; Task 3 replaces that with zone fill.
  - The handler calls `cachedFetchJson(key, 300, fetcher, 60, { timeoutMs: 20000 })`. On `null`, or when it throws, the handler logs `console.warn('[marketing/nws] degraded', { states: codes.length })` and returns `{ alerts: [], degraded: true }`.
  - Never log the state list together with client data. Only the count is logged.
  - `polygonGeojson` is `JSON.stringify(geometry)` for Polygon or MultiPolygon, and `''` otherwise.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/marketing-weather-alerts-handler.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/worldmonitor/marketing/v1/list-weather-alerts.ts tests/fixtures/marketing/nws-alerts-active.json tests/marketing-weather-alerts-handler.test.mts
git commit -m "feat(marketing): fetch NWS active alerts with cached, degraded-safe handler"
```

---

### Task 3: Zone-geometry fill for null-geometry alerts

**Files:**
- Create: `server/worldmonitor/marketing/v1/_nws-zones.ts` (private helper, Resolution 7)
- Modify: `server/worldmonitor/marketing/v1/list-weather-alerts.ts` (call the fill)
- Create: `tests/fixtures/marketing/nws-zone-TXZ102.json` (a Feature with Polygon geometry, trimmed from a live `GET /zones/forecast/TXZ102`)
- Test: `tests/marketing-weather-alerts-handler.test.mts` (add a `describe('zone fill')` block)

**Interfaces:**
- Consumes: `cachedFetchJson`, `fetchJson`, `marketingUserAgent()`, the `normalizeNwsFeature` output shape from Task 2, plus `parseAlertGeometry` from Task 1 in tests.
- Produces (all from `_nws-zones.ts`):
  - `export function zoneIdFromUrl(url: string): string | null`. It applies the zone URL allowlist regex and returns, for example, `'TXZ102'`.
  - `export function zoneCacheKey(zoneId: string): string`
  - `export async function fillZoneGeometry(alerts: Array<{ alert: WeatherAlert; zoneUrls: string[] }>): Promise<WeatherAlert[]>`. Alerts that already have geometry pass through; filled alerts get a `MultiPolygon`; an alert whose zone lookups all fail (or were all beyond the cap) is omitted; null-geometry `info` alerts are omitted without a lookup.

- [ ] **Step 1: Write the failing tests.**
  - **`zoneIdFromUrl`:**
    - `'https://api.weather.gov/zones/forecast/TXZ102'` gives `'TXZ102'`.
    - `'https://evil.example/zones/forecast/TXZ102'` gives `null`.
    - `'https://api.weather.gov/zones/forecast/../x'` gives `null`.
  - **Handler with the fixture,** where the zone stub serves `nws-zone-TXZ102.json` for TXZ102 and 404 for TXZ103:
    - The Flood Watch's `polygonGeojson` parses to a `MultiPolygon` with exactly 1 polygon, and its `zoneCodes` still list both zones.
    - The air-quality (`info`) alert triggers no zone fetch and is absent.
    - Every zone request carries the marketing User-Agent.
  - **Every zone fails:** the Flood Watch is omitted from `alerts`, `degraded` stays `false`, the tornado alert is still returned, and nothing throws.
  - **Cap:** a synthetic feature with 60 distinct valid zone URLs triggers at most 40 zone fetches.
  - **Cache key:** `zoneCacheKey('TXZ102')` gives `'marketing:nws-zone:v1:TXZ102'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/marketing-weather-alerts-handler.test.mts`
Expected: FAIL in the `zone fill` block, because `zoneIdFromUrl` is not exported.

- [ ] **Step 3: Implement `zoneIdFromUrl`, `zoneCacheKey` and `fillZoneGeometry`.**
  - Fill only alerts with `polygonGeojson === ''` and severity `watch` or `warning`.
  - Collect the distinct zone ids in feature order and cap them at 40.
  - Fetch in batches of 6 with `Promise.allSettled`. Each fetch is `cachedFetchJson(zoneCacheKey(id), 86400, () => fetchJson(zoneUrl, sameHeaders), 600)`.
  - Combine the Polygon or MultiPolygon parts that resolve into one `MultiPolygon`.
  - Call it from the alerts fetcher, so the 300 s alerts cache covers the fill work.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/marketing-weather-alerts-handler.test.mts`
Expected: PASS, for both Task 2 and Task 3 blocks.

- [ ] **Step 5: Type-check the API side**

Run: `npm run typecheck:api`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/worldmonitor/marketing/v1/_nws-zones.ts server/worldmonitor/marketing/v1/list-weather-alerts.ts tests/fixtures/marketing/nws-zone-TXZ102.json tests/marketing-weather-alerts-handler.test.mts
git commit -m "feat(marketing): fill zone-based NWS alert geometry from affected zones"
```

---

### Task 4: Browser weather-alerts store

**Files:**
- Create: `src/services/marketing/weather-alerts.ts`
- Test: `tests/dom/marketing-weather-alerts.test.mts` (a `describe('weather-alerts store')` block; vitest, because `src/services/marketing/api.ts` pulls in the browser module graph)

**Interfaces:**
- Consumes:
  - `listWeatherAlerts(req: ListWeatherAlertsRequest): Promise<ListWeatherAlertsResponse>` from `src/services/marketing/api.ts` (W0, Resolution 8; goes through `premiumFetch`).
  - `isUsableLocation` (Task 1).
  - `MarketingClient`.
- Produces:
  - `type WeatherAlertsStatus = 'idle' | 'ok' | 'unavailable'`
  - `interface WeatherAlertsSnapshot { status: WeatherAlertsStatus; alerts: WeatherAlert[]; fetchedAt: number | null }`. `status` is `'unavailable'` when the wrapper rejects or resolves with `degraded: true`.
  - `stateCodesForClients(clients: MarketingClient[]): string[]`. It uses only active clients and usable locations, de-duplicates and sorts.
  - `refreshWeatherAlerts(clients: MarketingClient[]): Promise<WeatherAlertsSnapshot>`
  - `getWeatherAlertsSnapshot(): WeatherAlertsSnapshot`
  - `subscribeWeatherAlerts(cb: (s: WeatherAlertsSnapshot) => void): () => void`
  - `WEATHER_ALERTS_POLL_MS = 300_000`
  - `type MarketingLayerSink = { setMarketingLayerContext(patch: { weatherAlerts: WeatherAlert[] }): void }` (structural, so `services` doesn't import `components`)
  - `bindWeatherAlertsToMap(sink: MarketingLayerSink): () => void`. It pushes the current alerts immediately and on each snapshot change (Resolution 9). See the new Contract Issue for its call site.

- [ ] **Step 1: Write the failing tests.** Mock `@/services/marketing/api` with `vi.hoisted` and `vi.mock`, following the pattern in `tests/dom/china-panel-refetch.test.mts`.
  - **`stateCodesForClients`:** a client with locations in `tx` (valid lat/lon), `TX`, `OK` and one with `lat: NaN` gives `['OK','TX']`. An inactive client contributes nothing.
  - **No usable locations:** `refreshWeatherAlerts([])` doesn't call the wrapper and gives `{status:'ok', alerts:[]}`.
  - **Wrapper resolves:** it is called with `{ stateCodes: [...] }`, and subscribers receive `status:'ok'` with the alerts.
  - **Wrapper resolves with `degraded: true`:** the status is `'unavailable'` and the previous alerts are kept.
  - **Wrapper rejects:** the status is `'unavailable'`, the previous alerts are kept, and nothing is thrown out of `refreshWeatherAlerts`.
  - **Map sink:** `bindWeatherAlertsToMap(fakeSink)` calls `setMarketingLayerContext({ weatherAlerts })` once on bind and again after a refresh; its unbind stops further calls.
  - **Unsubscribe:** after unsubscribing, the callback is not called again.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-weather-alerts.test.mts`
Expected: FAIL, because the module can't be resolved.

- [ ] **Step 3: Implement `src/services/marketing/weather-alerts.ts`.** Use module-level state and a `Set` of subscribers, with no timers. The panel owns polling.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-weather-alerts.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/marketing/weather-alerts.ts tests/dom/marketing-weather-alerts.test.mts
git commit -m "feat(marketing): add browser store for NWS weather alerts"
```

---

### Task 5: `nws-layer.ts` GeoJsonLayer

**Files:**
- Modify: `src/components/marketing/map/nws-layer.ts` (replace the W0 `return null` stub)
- Test: `tests/marketing-nws-layer.test.mts` (node:test. Importing the real `@deck.gl/layers` works under tsx; see `tests/deckgl-facility-highlight-triggers.test.mjs`.)

**Interfaces:**
- Consumes:
  - `MarketingLayerContext` from W0's `src/components/marketing/map/index.ts`, including `weatherAlerts: WeatherAlert[]` (Resolution 9). The layer reads alerts from `ctx` only, not from the store.
  - `parseAlertGeometry`, `mapNwsSeverity` and `matchAlertsToClients` (Task 1).
- Produces:
  - `buildNwsAlertsLayer(ctx: MarketingLayerContext): Layer | null`. The function name follows the index pattern `build<Name>Layer`; keep W0's exported name if it differs.
  - `nwsAlertTooltip(info: PickingInfo): { html: string } | null`. It escapes upstream text and returns null for picks from other layers; the layer owns its tooltip (Resolution 9).
  - `nwsAlertsFeatureCollection(alerts: WeatherAlert[], ctx: MarketingLayerContext): GeoJSON.FeatureCollection`
  - `nwsSeverityColors(sev: AlertSeverity): { fill: [number,number,number,number]; line: [number,number,number,number] }`
  - Layer id `'marketing-nws-alerts'`, `pickable: true`, and feature `properties` of `{ id, event, severity, headline, areaDesc, expires }`.

- [ ] **Step 1: Write the failing tests.** The pure helpers take alerts as an argument, so the tests don't need the store.
  - `nwsSeverityColors` returns the pinned RGBA values for `warning`, `watch` and `info`.
  - `nwsAlertsFeatureCollection` drops alerts whose `polygonGeojson` is `''` or invalid. It keeps a Polygon alert and a MultiPolygon alert, with the right properties.
  - **Focus:** with `ctx.focusedClientId = 'c1'`, only alerts that intersect c1's usable locations remain. A focused client with bad coordinates yields 0 features and doesn't throw.
  - `buildNwsAlertsLayer` returns `null` when `!ctx.visibleLayerIds.has('nwsAlerts')`, and also when `ctx.weatherAlerts` has no drawable alerts.
  - When it does return a layer, `layer.id === 'marketing-nws-alerts'`.
  - Inactive clients' locations never cause a focus match (Resolution 12).
  - `nwsAlertTooltip` returns the event, headline and expiry for a pick on `marketing-nws-alerts`, escapes `<script>` in `headline`, and returns null for another layer id.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/marketing-nws-layer.test.mts`
Expected: FAIL, because `nwsSeverityColors` is not exported.

- [ ] **Step 3: Implement the layer.**
  - The layer is `new GeoJsonLayer({ id, data, filled: true, stroked: true, getFillColor, getLineColor, lineWidthMinPixels: 1, getLineWidth: 2, pickable: true })`.
  - Colours come from `nwsSeverityColors(f.properties.severity)`, and `severity` is re-mapped through `mapNwsSeverity`. Raw NWS strings therefore still colour correctly if W0 or W8 later choose to send them.
  - Set `updateTriggers` on both colour accessors to `ctx.weatherAlerts` (identity changes on each push).
  - Follow the `createConflictZonesLayer` pattern in `src/components/DeckGLMap.ts:2994`.
  - Redraw is driven by W0's `setMarketingLayerContext` rebuild; this file holds no subscriptions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/marketing-nws-layer.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/marketing/map/nws-layer.ts tests/marketing-nws-layer.test.mts
git commit -m "feat(marketing): draw NWS alert polygons coloured by severity"
```

---

### Task 6: `WeatherAlertsPanel`

**Files:**
- Modify: `src/components/marketing/WeatherAlertsPanel.ts` (replace the W0 placeholder; keep its class name, panel id `weather-alerts` and constructor signature)
- Modify: `src/locales/en.json` (add the `marketing.weather` subtree only)
- Test: `tests/dom/marketing-weather-alerts.test.mts` (add a `describe('WeatherAlertsPanel')` block)

**Interfaces:**
- Consumes:
  - `subscribeClients`, `getRosterStatus` and `onRosterStatusChange` from `@/services/marketing/roster` (Resolution 18).
  - `renderNoClientsState()` and `renderSourceUnavailable()` from `@/components/marketing/empty-state` (W0, Resolution 18).
  - `getFocusedClientId` and `onFocusChange` from `@/services/marketing/focus`.
  - `refreshWeatherAlerts`, `subscribeWeatherAlerts`, `getWeatherAlertsSnapshot` and `WEATHER_ALERTS_POLL_MS` (Task 4).
  - `matchAlertsToClients` (Task 1).
  - `Panel.setContentNodes`, `setCount` and `destroy` (`src/components/Panel.ts:1469`, `:1396`, `:1669`), plus `h` from `src/utils/dom-utils.ts`.
- Produces: `export class WeatherAlertsPanel extends Panel`, with the constructor `constructor()` calling `super({ id: 'weather-alerts', title: t('marketing.weather.title'), showCount: true })`. Match W0's placeholder if its options differ.

**Copy** (`src/locales/en.json`, under `marketing.weather`):
- `title`: "Weather Alerts"
- `noLocations`: "No client locations have coordinates yet."
- `none`: "No active NWS alerts in your clients' service areas."
- `expires`: "Expires {{time}}" (`time` formatted from epoch ms; omitted when `expires === 0`)
- `clients`: "Affects: {{names}}"

The empty-roster and source-unavailable copy are W0's shared keys (`marketing.empty.noClients`, `marketing.common.sourceUnavailable`); the earlier `emptyRoster`/`unavailable` keys are dropped.

- [ ] **Step 1: Write the failing tests.**
  - **Setup:**
    - Mock `@/services/marketing/roster`. `subscribeClients` captures the callback, so a test can push clients.
    - Mock `@/services/marketing/focus` (in-memory) and `@/services/marketing/api`.
    - Use `initTestI18n` from `tests/dom/helpers/i18n.mts`.
    - Use fake timers, advancing past the 150 ms content debounce.
  - **Empty roster:** with roster status `'ready'`, pushing `[]` renders `renderNoClientsState()` output (`marketing.empty.noClients` text), with no `.panel-loading` or error chip.
  - **Roster error:** roster status `'error'` renders `renderSourceUnavailable()` and makes no wrapper call.
  - **Bad location only:** a client whose only location has `lat: NaN` renders `noLocations`.
  - **Matching alerts:**
    - Use two `DEV_CLIENTS`-style fixtures, and alerts where one intersects client A, one intersects nobody, and one has `polygonGeojson: ''`.
    - Exactly one row renders.
    - It shows the event name, a severity chip with class `sev-warning`, and "Affects: Fixture A".
    - `setCount(1)` is reflected in the header count.
  - **Focus:** with focus on client B (no matches), the panel renders `none`. Clearing focus restores the row. Focus on an inactive client is treated as cleared (Resolutions 12–13).
  - **Wrapper rejects, or resolves `degraded: true`:** the panel renders `renderSourceUnavailable()` (`marketing.common.sourceUnavailable`), not `showError`'s red chip. A later successful poll (advance by `WEATHER_ALERTS_POLL_MS`) renders rows again.
  - **Teardown:** after `destroy()`, advancing the timers triggers no further wrapper calls.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-weather-alerts.test.mts`
Expected: FAIL in the `WeatherAlertsPanel` block, because the placeholder renders `marketing.panel.comingSoon`.

- [ ] **Step 3: Implement the panel and add the copy.**
  - **Data flow:**
    - The clients subscription calls `refreshWeatherAlerts(clients)` when the derived state codes change.
    - A `setInterval(WEATHER_ALERTS_POLL_MS)` re-runs the refresh.
    - Store and focus subscriptions re-render.
  - **Render:** `matchAlertsToClients` gives the rows. Filter them to the focused client when one is set. Build them with `h()` only, never raw HTML strings, because alert text comes from upstream.
  - **Teardown:** `destroy()` clears the interval and every unsubscribe handle (clients, roster status, store, focus), then calls `super.destroy()`.

- [ ] **Step 4: Run the tests to verify they pass, then sync locales**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-weather-alerts.test.mts`
Expected: PASS, for both the store and panel blocks.

Run: `npm run sync:locales` (then `npm run locales:zh-tw` if it flags zh-TW).
Expected: other locale files gain English fallbacks for `marketing.weather.*` only.

- [ ] **Step 5: Run the browser checks, one at a time**

Run: `npm run typecheck`, then `npm run lint:boundaries`, then `npm run lint`.
Expected: each exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/marketing/WeatherAlertsPanel.ts src/locales/ tests/dom/marketing-weather-alerts.test.mts
git commit -m "feat(marketing): list NWS alerts intersecting client service areas"
```

---

### Task 7: End-to-end verification and PR

**Files:** no new code. A fix-up commit is allowed only if a check below fails on W4-owned files.

- [ ] **Step 1: Re-run all W4 suites**

Run:
```bash
node --import tsx --test tests/marketing-weather-match.test.mts tests/marketing-weather-alerts-handler.test.mts tests/marketing-nws-layer.test.mts
npx vitest run --config vitest.dom.config.mts tests/dom/marketing-weather-alerts.test.mts
```
Expected: all PASS.

- [ ] **Step 2: Run the repo checks sequentially**

Run, in this order: `npm run typecheck:api`, `node --import tsx --test tests/edge-functions.test.mjs`, `node --import tsx --test tests/route-cache-tier.test.mjs`, then `git diff --check`.
Expected: all exit 0. The private no-store cache-tier entry for `/api/marketing/v1/list-weather-alerts` is W0's (Resolution 5); if it is missing, report it to W0 rather than editing `server/gateway.ts`.

- [ ] **Step 3: Live smoke in the dev server**

Run `npm run dev:marketing` with `MARKETING_CONTACT_EMAIL` set (required by `marketingUserAgent()`), then open the app.
- Expected network result: `/api/marketing/v1/list-weather-alerts` returns 200 for the fixture clients' states.
- Expected on the map: when `nwsAlerts` is on, polygons are drawn. If there are no live alerts near the fixtures, that is a valid empty state; record it.
- Expected in the panel: it lists only intersecting alerts.

Then block `api.weather.gov`, for example with a bad DNS entry in a scratch environment (don't commit anything). Confirm the response has `degraded: true`, the panel shows "source unavailable", and other panels still render.

Note which parts were verified live and which only by fixtures.

- [ ] **Step 4: Capture screenshots.** Use test data. Take desktop and mobile views of the panel with rows, the empty roster state and the unavailable state, plus the map with polygons. Label each with the tested commit SHA.

- [ ] **Step 5: Open the PR to the fork's `main`, attach the screenshots, and verify that they appear.** Rebase on W0's merge commit first.

```bash
gh pr create --base main --title "feat(marketing): NWS weather alerts (W4)" --body "<summary, checks run, live vs fixture evidence>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr edit <number> --attach '/abs/path/weather-panel-desktop.png#Weather Alerts panel with matching alert (desktop)' --attach '/abs/path/weather-panel-mobile.png#Weather Alerts panel (mobile)' --attach '/abs/path/weather-map.png#NWS polygons on marketing map' --attach '/abs/path/weather-unavailable.png#Source unavailable state'
```

---

## Contract Issues (resolved)

1. No shared User-Agent constant -> **Resolution 6** (`marketingUserAgent()` in `_user-agent.ts`; local `MARKETING_USER_AGENT` deleted).
2. No `degraded` flag on the response -> **Resolution 4** (`bool degraded`; panel shows source unavailable on `degraded` or rejection).
3. `MarketingLayerContext` lacks alert polygons, redraw trigger and tooltip owner -> **Resolution 9** (`ctx.weatherAlerts`, `setMarketingLayerContext`, layer-owned tooltip).
4. Meaning of `WeatherAlert.severity` -> **Resolution 4** (mapped `info`|`watch`|`warning`).
5. `api.ts` wrapper names and shapes -> **Resolution 8** (`listWeatherAlerts(req) -> ListWeatherAlertsResponse`).
6. No shared "Add your first client" key -> **Resolution 18** (`renderNoClientsState()`, `marketing.empty.noClients`).
7. No state or zone field on `WeatherAlert` -> **Resolution 4** (`zone_codes`, `state_codes`) plus "Known source limits" (drop the alert when every zone lookup fails).
8. Intersection test duplicated in W4 -> **Resolution 10** (W4 consumes `polygonTouchesServiceArea`).

**New, unresolved:**

9. **Call site for `bindWeatherAlertsToMap`.** Resolution 9 gives W0's `MapContainer.setMarketingLayerContext`, but every place that holds both the map instance and the marketing panels (`src/app/panel-layout.ts`, the DeckGLMap wiring) is W0-owned, and `services` may not import `components`. W4 needs either a W0 line such as `bindWeatherAlertsToMap(this.map)` in the marketing branch of the app layer, or permission to add that one line itself.
10. **Tooltip dispatch.** deck.gl `getTooltip` is a Deck-level prop, not a layer prop. W4 exports `nwsAlertTooltip(info)`, but W0's DeckGLMap must route marketing-layer picks to each owner's tooltip function (for example a `getMarketingTooltip(info)` in `map/index.ts` that tries each builder's tooltip export). The index should name that hook.
11. **int64 encoding.** This plan assumes W0 annotates `onset`/`expires` with `INT64_ENCODING_NUMBER` (TS `number`), as `prediction` and `aviation` do. If W0 emitted `string`, the normaliser and panel formatting need a one-line conversion.
