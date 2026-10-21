# Marketing Variant — Plan Index & Shared Contracts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each workstream plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `marketing` site variant described in the spec. W0 lays the scaffold, then W1–W9 fill it in parallel.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md`

**Execution order:**
- W0 merges first.
- W1–W9 each branch from W0's merge commit, each in its own git worktree (`superpowers:using-git-worktrees`), and each ships as its own PR to the fork's `main`.
- W8 consumes W2's Convex functions, and W9 consumes W2's `requireMarketingMember`. Both can build against the stubs W0 provides. Rebase on W2 before opening the PR.

| Plan | Workstream | Owns |
|---|---|---|
| `2026-10-21-marketing-w0-foundation.md` | Variant registration + scaffold | Everything in "W0 scaffold" below |
| `2026-10-21-marketing-w1-feeds-brief.md` | Trade feeds + AI brief | `MARKETING_FEEDS`, server `_feeds.ts` entry, prompt branches |
| `2026-10-21-marketing-w2-roster.md` | Workspace, members, roster | `convex/marketing/{members,clients}.ts`, `ClientRosterPanel`, roster service real impl, geocoding |
| `2026-10-21-marketing-w3-map-focus.md` | Client map layer + focus mode | `clients-layer.ts`, focus service impl, URL `client=` |
| `2026-10-21-marketing-w4-weather.md` | NWS alerts | `list-weather-alerts.ts` handler, `nws-layer.ts`, `WeatherAlertsPanel` |
| `2026-10-21-marketing-w5-calendar.md` | Holidays + observances | `list-calendar-events.ts` handler, `shared/marketing/observances.json`, `MarketingCalendarPanel` |
| `2026-10-21-marketing-w6-mentions.md` | Local mentions | `search-local-mentions.ts` handler, `mentions-layer.ts`, `LocalMentionsPanel` |
| `2026-10-21-marketing-w7-trends.md` | Demand trends | `get-demand-trends.ts` handler, `DemandTrendsPanel` |
| `2026-10-21-marketing-w8-alerts.md` | Client alerts | `convex/marketing/alerts.ts`, evaluator, relay shared-channel send, `MarketingAlertsPanel` |
| `2026-10-21-marketing-w9-gating-selfhost.md` | Deploy flag, gating, docker, docs | `MARKETING_DEPLOY` plumbing, sign-in gate, request-access screen, compose `notification-relay`, `docs/marketing-setup.md` |

## Global Constraints (every task inherits these)
- **Additive:** behaviour must be byte-for-byte unchanged when `VITE_VARIANT !== 'marketing'` and `MARKETING_DEPLOY` is unset. Upstream merges must stay clean.
- **Client data never reaches the build bundle or a public endpoint.** Dev fixtures load only behind `import.meta.env.DEV`, through a dynamic import.
- **Data sources:** free sources only and US-first. Server fetches send `User-Agent: MarketingSituationRoom/1.0 (+contact via MARKETING_CONTACT_EMAIL)`, which is required by NWS. Use `cachedFetchJson()` (`server/_shared/redis.ts`), and every request-varying parameter goes into the cache key.
- **Repo boundaries (AGENTS.md):**
  - Browser import direction is `types -> config -> services -> components -> app -> App.ts`.
  - Never hand-edit `src/generated/`.
  - Edge code uses no `node:http`/`node:https`/`node:zlib`.
  - New RSS domains go in `shared/rss-allowed-domains.json`.
- **i18n:** English strings go in `src/locales/en.json` under the `marketing.*` key. Other locales fall back.
- **Shared code:** don't duplicate logic that `shared/` must hold for both browser and server.
- **Dev setup:** Node 24. Run `npm run --silent agent:preflight -- --mode repair` before implementing.
- **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Shared Contracts (W0 creates them; later workstreams consume them and never rename them)

### Variant & env
- Variant id `'marketing'` in `SITE_VARIANTS` (`src/config/variant.ts`).
- Dev and build scripts are `dev:marketing` and `build:marketing`, which set `VITE_VARIANT=marketing`.
- Server flag `MARKETING_DEPLOY=1` and client flag `VITE_MARKETING_DEPLOY=1`, both read only through the following (W0 creates them as `false`-default readers; W9 adds the behaviour):
  - `shared/marketing/deploy-flag.ts`: `isMarketingDeploy(env?: Record<string,string|undefined>): boolean`
  - `src/config/marketing.ts`: `MARKETING_DEPLOY: boolean`

### Domain types: `shared/marketing/types.ts`
```ts
export const MARKETING_CATEGORIES = ['hvac','roofing','plumbing','electrical','landscaping','pest-control','dental','medical','legal','restaurant','retail','auto','real-estate','fitness','other'] as const;
export type MarketingCategory = typeof MARKETING_CATEGORIES[number];
export interface MarketingClientLocation { id: string; label: string; address: string; city: string; stateCode: string; lat: number; lon: number; serviceRadiusMiles: number; }
export interface MarketingClient { id: string; name: string; category: MarketingCategory; locations: MarketingClientLocation[]; competitors: string[]; keywords: string[]; accountManagerEmail: string | null; active: boolean; }
export type MarketingSignalKind = 'weather' | 'mention' | 'calendar' | 'trend';
export interface MarketingSignal { id: string; kind: MarketingSignalKind; clientId: string | null; title: string; detail: string; url: string | null; severity: 'info' | 'watch' | 'warning'; occurredAt: string; lat: number | null; lon: number | null; }
```
- `shared/marketing/geo.ts`: `milesBetween(aLat, aLon, bLat, bLon): number` and `pointInServiceArea(loc: MarketingClientLocation, lat: number, lon: number): boolean`.

### Browser services: `src/services/marketing/`
- `roster.ts`:
  - `getClients(): Promise<MarketingClient[]>`
  - `subscribeClients(cb: (clients: MarketingClient[]) => void): () => void`
  - W0 implements these from dev fixtures; W2 replaces the body with Convex.
- `dev-fixtures.ts`: exports `DEV_CLIENTS: MarketingClient[]`, five fake US clients whose names are all prefixed `Fixture `. Only `roster.ts` imports it, dynamically, behind `import.meta.env.DEV`.
- `focus.ts`:
  - `getFocusedClientId(): string | null`
  - `setFocusedClientId(id: string | null): void`
  - `onFocusChange(cb: (id: string | null) => void): () => void`
  - W0 implements these in memory; W3 adds URL sync and map zoom.
- `api.ts`: typed wrappers over the generated `MarketingService` client, one per RPC below.

### RPC domain: `proto/worldmonitor/marketing/v1/` → `MarketingService`
W0 writes every proto, runs `make install && make generate`, mounts `api/marketing/v1/[rpc].ts`, and adds stub handlers that return empty lists. Each later workstream edits **only its own handler file** under `server/worldmonitor/marketing/v1/`.

| RPC | Request | Response | Handler file (owner) |
|---|---|---|---|
| `ListWeatherAlerts` | `state_codes: repeated string` | `alerts: repeated WeatherAlert{id, event, severity, headline, area_desc, onset, expires, polygon_geojson}` | `list-weather-alerts.ts` (W4) |
| `ListCalendarEvents` | `from_date, to_date: string (YYYY-MM-DD)`, `categories: repeated string` | `events: repeated CalendarEvent{id, date, name, kind ('holiday'\|'observance'), categories}` | `list-calendar-events.ts` (W5) |
| `SearchLocalMentions` | `queries: repeated MentionQuery{client_id, terms, city, state_code}` (max 20) | `mentions: repeated Mention{id, client_id, title, source, url, published_at, lat, lon}` | `search-local-mentions.ts` (W6) |
| `GetDemandTrends` | `categories: repeated string`, `state_codes: repeated string` | `trends: repeated DemandTrend{category, points: repeated {date, value}}`, `trending_now: repeated TrendingTerm{term, geo, traffic}` | `get-demand-trends.ts` (W7) |

- **Access:** under `isMarketingDeploy()`, every `MarketingService` RPC requires a signed-in member. W9 wires this check in the gateway.
- **Privacy:** none of these RPCs takes or returns the full roster, only the terms the browser sends.

### Convex: all tables added by W0 to `convex/schema.ts`
- **W2 (members, clients):**
  - `marketingMembers {email (lowercased), role: 'admin'|'member', addedBy, addedAt}`, index `by_email`.
  - `marketingClients {…MarketingClient fields minus id, updatedAt, updatedBy}`.
- **W8 (alerts):**
  - `marketingAlertChannel {kind: 'slack'|'email', target (encrypted envelope for slack webhook / email list), updatedAt}` (singleton).
  - `clientAlertRules {clientId, kind: MarketingSignalKind, enabled, params: any, createdAt}`, index `by_client`.
  - `marketingAlertEvents {dedupKey, clientId, kind, title, url, severity, firedAt, delivered: boolean}`, index `by_dedup`.
- **Access helper** `convex/marketing/access.ts`: `requireMarketingMember(ctx): Promise<{email: string; role: 'admin'|'member'}>`.
  - It throws `MARKETING_FORBIDDEN`.
  - The bootstrap admin comes from Convex env `MARKETING_BOOTSTRAP_ADMIN_EMAIL`.
  - W0 implements it; W2 extends it.

### Panels: wired once by W0 in `src/app/panel-layout.ts` `createPanels()` via `this.importPanel(...)`, marketing variant only
- **Placeholder stage:** W0 creates each component as a minimal placeholder (`extends Panel`, renders `marketing.panel.comingSoon`). The owning workstream replaces only that file. All files live under `src/components/marketing/`.

| Panel id | Component | Owner |
|---|---|---|
| `client-roster` | `ClientRosterPanel.ts` | W2 |
| `marketing-alerts` | `MarketingAlertsPanel.ts` | W8 |
| `weather-alerts` | `WeatherAlertsPanel.ts` | W4 |
| `marketing-calendar` | `MarketingCalendarPanel.ts` | W5 |
| `local-mentions` | `LocalMentionsPanel.ts` | W6 |
| `demand-trends` | `DemandTrendsPanel.ts` | W7 |

- **Reused panels:** the AI brief reuses `insights`. News categories (W1) render as NewsPanels: `platform-updates`, `local-seo`, `marketing-industry`.
- **Layout order** in `MARKETING_PANELS`:
  1. `map`
  2. `insights`
  3. `marketing-alerts`
  4. `local-mentions`
  5. `marketing-calendar`
  6. `demand-trends`
  7. `platform-updates`
  8. `weather-alerts`
  9. `client-roster`
  10. `local-seo`
  11. `marketing-industry`

### Map layers: W0 registers ids in `map-layer-definitions.ts`, and DeckGLMap calls `buildMarketingLayers(ctx)` from `src/components/marketing/map/index.ts`
- **Ids and builder files:**
  - `marketingClients` → `clients-layer.ts` (W3)
  - `nwsAlerts` → `nws-layer.ts` (W4)
  - `localMentions` → `mentions-layer.ts` (W6)
- Each builder file exports `build<Name>Layer(ctx: MarketingLayerContext): Layer | null`. W0 creates them as `return null` stubs.
- `MarketingLayerContext = { clients: MarketingClient[]; focusedClientId: string | null; signals: MarketingSignal[]; visibleLayerIds: Set<string> }`.
- **Hidden:** every geopolitics, military and market layer is off in `MARKETING_MAP_LAYERS`.

### Mission presets (W0)
- `marketing-overview`: all clients, the default.
- `marketing-client-focus`.
- `marketing-storm-watch`: weather-first.
- All three have `variants: ['marketing']` in `src/services/mission-presets.ts`.

## Review Focus (cross-cutting; each owning plan adds the pinning test)
1. **Empty roster:** every panel shows a "Add your first client" empty state, not a spinner or error (W2, plus each panel owner).
2. **Client with no location or bad coordinates:** it's skipped on the map and in geo filters without throwing (W3, W4, W6).
3. **Upstream source down or slow** (NWS, Google News, Nager, Wikipedia): the handler returns an empty list with a `degraded` log, the panel shows "source unavailable", and other panels are unaffected (W4–W7).
4. **Signed-out or non-member** under `MARKETING_DEPLOY`: RPCs return 401/403, Convex throws `MARKETING_FORBIDDEN`, and the UI shows the request-access screen with no roster data in the response (W9, W2).
5. **The same NWS alert or article seen on repeated polls:** it alerts exactly once, through the dedup key (W8).

## Contract Resolutions (binding; these override any plan text that disagrees)
These settle the "Contract Issues" the workstream plans raised. **W0 builds every item marked (W0)** before W1–W9 start.

### Locales and public hosts
1. **Locales:**
   - Each workstream adds English strings to `en.json`, then runs `npm run sync:locales`, which writes English fallbacks to the other locales (no API key needed).
   - If zh-TW is flagged, also run `npm run locales:zh-tw`.
   - Real translation is deferred.
   - When locale JSON files conflict during a rebase, take the base version and re-run `sync:locales`.
2. **No public host mapping:** don't add `marketing` to the `index.html` prepaint script or to `middleware.ts` `VARIANT_HOST_MAP`. A marketing build (`VITE_VARIANT=marketing`) always boots as `marketing`. This is W0's plan as written.

### Proto (W0)
3. **Time and location fields:**
   - Every timestamp is `int64` epoch ms.
   - `Mention.lat/lon` of `0,0` means "no location". The browser then uses the client location's coordinates.
4. **Added fields:**
   - Every `MarketingService` response gets `bool degraded = N`, set when an upstream source failed.
   - `WeatherAlert` adds `repeated string zone_codes`, `repeated string state_codes`, and `severity` holding the mapped value (`info`|`watch`|`warning`).
   - `DemandTrend` points are a `TrendPoint{int64 date, double value}` message.
   - `TrendingTerm.traffic` is a `string`.
5. **`SearchLocalMentions` is POST and never cached publicly**, because the queries contain client names.
   - Every `MarketingService` RPC gets a private, no-store cache tier in `RPC_CACHE_TIER` when `isMarketingDeploy()` is on.
   - Server code must never log client names or query terms.

### Shared server and browser helpers (W0)
6. **User-Agent:** `server/worldmonitor/marketing/v1/_user-agent.ts` exports `marketingUserAgent(): string` → `MarketingSituationRoom/1.0 (+mailto:${MARKETING_CONTACT_EMAIL})`. It throws in production if the env var is unset.
   - W4, W6 and W7 use it.
   - W1 keeps the existing digest fetcher's User-Agent.
7. **Private helper files:** an owner may add `_*.ts` files next to its own handler.
8. **API wrappers:** `src/services/marketing/api.ts` exports `listWeatherAlerts`, `listCalendarEvents`, `searchLocalMentions` and `getDemandTrends`.
   - Each takes the request object and resolves to the generated response type.
   - They go through `premiumFetch`, so the Clerk token is attached.
9. **Map data plumbing:**
   - W0 adds `MapContainer.setMarketingLayerContext(patch: Partial<MarketingLayerContext>)`, which merges the patch and triggers a rebuild.
   - `MarketingLayerContext` gains `weatherAlerts: WeatherAlert[]` and `mentions: Mention[]`.
   - `signals` stays for W8.
   - A builder may return a `CompositeLayer`.
   - Each layer owner provides its own tooltip through deck.gl `getTooltip` on its layer.
10. **Geo helpers:** `shared/marketing/geo.ts` also exports `polygonTouchesServiceArea(loc, geojson: string): boolean`.
11. **Deploy flag:**
    - `isMarketingDeploy()` reads the env for real from day one, so it isn't a stub.
    - `scripts/lib/marketing-deploy-flag.cjs` is a JS copy for the relay, with a test that keeps it in sync with the shared version.
    - W9 adds the *behaviour* behind the flag.

### Roster, focus and membership
12. **Client ids:** the Convex document id string, matching `/^[A-Za-z0-9_-]{1,64}$/`. Fixture ids use the same format.
    - Inactive clients are hidden from the map and picker. If the focused client is inactive, focus clears.
13. **Focus events:** `onFocusChange` doesn't fire on subscribe. Setting the same id does nothing, and an unknown id clears focus.
14. **Empty categories:** an empty `categories` request means all categories.
15. **Convex errors and membership:**
    - Errors are `ConvexError({ code: 'MARKETING_FORBIDDEN' })`.
    - Member emails are trimmed and lowercased, and membership requires `emailVerified === true`.
    - `access.ts` (W0) exports `requireMarketingMember`, `findMarketingMemberByEmail(ctx, email)` and `getMyMembership(ctx)`. The last one doesn't throw and returns `null`.
    - W9 doesn't add `gate.ts`.
16. **Schema:** `marketingAlertEvents` gets an index `by_client_firedAt` (W0).
17. **`convex/_generated/`:** this is generated output. After each rebase, regenerate it with `npx convex codegen`; never merge it by hand.
18. **Shared UI (W0):**
    - `src/components/marketing/empty-state.ts` exports `renderNoClientsState()` and `renderSourceUnavailable()`.
    - The i18n keys are `marketing.empty.noClients`, `marketing.common.sourceUnavailable` and `marketing.category.<id>`.
    - `roster.ts` also exports `getRosterStatus(): 'loading'|'ready'|'forbidden'|'error'` and `onRosterStatusChange(cb)`. W0 always returns `'ready'` from fixtures; W2 makes it real.
19. **Team view:** the members-management UI lives inside `ClientRosterPanel` (W2).

### Ownership
20. **W1 also owns:**
    - `VALID_VARIANTS` in `list-feed-digest.ts`
    - `NEWS_VARIANTS` in `public-rpc-cache.ts`
    - the news proto comment and the `make generate` rerun
    - `shared/publisher-families.js`
    - the brief heading in `InsightsPanel.ts`
21. **Relay:**
    - Only W8 edits the relay's Pro filter and adds the evaluator.
    - W9's gateway check accepts a `WORLDMONITOR_VALID_KEYS` service key so the relay can call `MarketingService`.
    - W9's `Dockerfile.notification-relay` copies `scripts/lib/marketing-*`.
22. **Test alert:** W8 provides `npm run marketing:test-alert`, which W9's setup doc references.
23. **Gateway:** W9 returns a retryable 503 when Clerk or Convex can't be verified.

### Known source limits
- GDELT GEO returned 404 on 2026-10-21, so mention pins use the client location.
- NWS alerts often arrive without a geometry. W4 fills the shape from the alert's zones and skips the alert if every zone lookup fails.
- Search Engine Land and MarTech come through Google News `site:` searches.

### Round-2 resolutions
24. **Locale freshness:** W0 finds the command that refreshes `scripts/locale-baselines/app.json` (or whatever `tests/app-locale-freshness.test.mjs` uses as its baseline), documents it in its locale task, and every workstream runs it after `sync:locales`.
25. **Tooltips:** W0's DeckGLMap tooltip handler checks for layer ids that start with `marketing-` and forwards those to `info.layer.props.getTooltip(info)`. All marketing layer ids use the `marketing-` prefix.
26. **Map bridge (W0):**
    - `src/services/marketing/map-bridge.ts` exports `publishLayerContext(patch: Partial<MarketingLayerContext>)` and `onLayerContext(cb)`.
    - App wires `onLayerContext` to `MapContainer.setMarketingLayerContext`.
    - W4 and W6 call `publishLayerContext` from their services, which keeps the import direction legal.
27. **Proto int64:** int64 fields use `INT64_ENCODING_NUMBER`, following existing protos.
28. **Panel refresh:**
    - Marketing panels fetch on construction, every 15 minutes after that, and whenever `onFocusChange` or `subscribeClients` fires.
    - The empty-state helpers return an HTML string. Retry uses `data-action="marketing-retry"`.
29. **Public membership query:** `access.ts` (W0) also exports a public query, `myMembership`, that wraps `getMyMembership`.
    - Internal Convex callers with no user identity are trusted. They are only reachable through internal functions.
30. **Relay service key:** the relay sends `MARKETING_RELAY_SERVICE_KEY`. That value must also be listed in `WORLDMONITOR_VALID_KEYS`.
31. **Geocoding User-Agent:** W2's Convex geocode action copies the User-Agent format, with a fallback when no contact email is set. That's acceptable.
32. **Provenance:** marketing feeds show "unknown" provenance badges. This is accepted for now.
