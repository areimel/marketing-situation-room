# W5 Marketing Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve US public holidays and about 60 curated marketing observances through the `ListCalendarEvents` RPC. Show them in `MarketingCalendarPanel` for the next 30 or 60 days, filtered to the focused client's category or to the categories of all clients.

**Architecture:**
- Date-rule resolution (fixed date, nth/last weekday plus an offset, Easter plus an offset) is pure code in `shared/marketing/calendar-rules.ts`. The handler uses it, the panel uses it, and W8's "holiday within N days" rule can import it.
- The handler fetches Nager.Date per year through `cachedFetchJson`, keyed by year. It merges those holidays with observances expanded from `shared/marketing/observances.json`, then filters by the date range and categories.
- The panel requests a 60-day window once, for every category in the roster. The 30/60 toggle and the focused-client filter are both applied in the browser, so neither one triggers another RPC call.

**Tech Stack:** TypeScript, sebuf-generated `MarketingService` types, `cachedFetchJson` (Upstash Redis), `Panel` + `safeHtml`, node:test via tsx, vitest DOM.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md` (Signals table, "Weather and local events" row; W5). The binding contracts are in `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

- Every item in the index's "Global Constraints" applies here: additive, free sources, US-first, User-Agent, `cachedFetchJson`, repo boundaries, `marketing.*` i18n, Node 24, and the commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Source: `https://date.nager.at/api/v3/PublicHolidays/{year}/US`. It is free and needs no key. Each entry has the fields `date, localName, name, countryCode, fixed, global, counties, launchYear, types`.
- User-Agent on the Nager fetch: `marketingUserAgent()` from `server/worldmonitor/marketing/v1/_user-agent.ts` (W0, Resolution 6). W5 defines no UA constant of its own. The helper throws in production when `MARKETING_CONTACT_EMAIL` is unset; the fetcher calls it inside its try, so a missing env var degrades to observances only instead of failing the RPC.
- Cache key `marketing:calendar:nager:v1:US:{year}`, TTL `604800` (7 days), negative TTL `300`. Only the year varies what is fetched. The range and category filters run after the cache read.
- Contract: `ListCalendarEventsRequest { fromDate, toDate, categories }` → `ListCalendarEventsResponse { events: CalendarEvent[]; degraded: boolean }` (Resolution 4: `degraded` is true when any Nager year failed), where `CalendarEvent { id, date, name, kind: 'holiday'|'observance', categories }`. The types come from `src/generated/server/worldmonitor/marketing/v1/service_server` (server) and `src/generated/client/worldmonitor/marketing/v1/service_client` (browser). Never hand-edit them.
- `CalendarEvent.date` and the request dates stay `YYYY-MM-DD` strings, as the proto defines them. They are calendar days, not timestamps, so Resolution 3's `int64` epoch-ms rule does not apply to them.
- **Category semantics:** an empty request `categories` means all categories (Resolution 14). An event whose `categories: []` is empty applies to every category; all Nager holidays are emitted with `[]`. Both cases go through `matchesCategories`.
- Privacy (Resolution 5): the handler logs only years and status codes, never request categories alongside anything client-identifying. W0 owns the private no-store cache tier for this RPC; W5 does not touch `RPC_CACHE_TIER`.
- W5 edits only these existing files: `server/worldmonitor/marketing/v1/list-calendar-events.ts`, `src/components/marketing/MarketingCalendarPanel.ts`, the `marketing.calendar.*` subtree of `src/locales/en.json`, and the other `src/locales/*.json` files only as written by `npm run sync:locales` (Resolution 1). Every other file in this plan is new.
- W5 consumes these W0 items and creates no duplicates: `marketingUserAgent()` (Res. 6), `listCalendarEvents` in `src/services/marketing/api.ts` via `premiumFetch` (Res. 8), `renderNoClientsState()` / `renderSourceUnavailable()` in `src/components/marketing/empty-state.ts` and the keys `marketing.empty.noClients`, `marketing.common.sourceUnavailable`, `marketing.category.<id>` (Res. 18), and `getRosterStatus()` / `onRosterStatusChange(cb)` in `roster.ts` (Res. 18).
- Edge handler: no `node:*` imports. Use plain JSON imports with no `with { type: 'json' }` attribute, because the Vercel esbuild bundler rejects it (see the comment at `server/worldmonitor/resilience/v1/_rankable-universe.ts:28`). Call `globalThis.fetch(...)`.

## Review Focus

1. **Nager down or slow** (non-200, timeout, or invalid JSON): the response still contains the curated observances with `degraded: true`, a `[marketing-calendar] degraded` warning is logged, nothing throws, and the panel shows the observances plus a "source unavailable" notice. Pinned in Task 3, `nager failure degrades to observances only`, and in Task 5, `degraded response shows notice and keeps observances`.
2. **A window that crosses the year boundary** (for example 2026-12-15 → 2027-01-15): both years are fetched and cached under separate keys, and events from both years appear. Pinned in Task 1, `expandObservances spans two years`, and in Task 3, `cross-year window fetches both years once`.
3. **Empty roster:** the panel shows the shared `renderNoClientsState()` ("Add your first client") and makes no RPC call; while `getRosterStatus()` is `'loading'` it makes no RPC call either. Pinned in Task 5, `empty roster shows add-first-client and skips RPC` and `roster loading defers the RPC`.
4. **DST or local timezone** in the "in N days" count: the count must not slip by a day in `America/New_York` around 2026-11-01. Pinned in Task 4, `daysAway is stable across fall-back DST`.
5. **The focused client id is not in the roster or is inactive**, because it is stale from the URL or the client was deleted: the panel falls back to the categories of all active clients instead of showing nothing (Resolutions 12 and 13 also clear such focus in `focus.ts`; the panel does not rely on that). Pinned in Task 4, `unknown focused id falls back to all categories` and `inactive focused client falls back`.

---

### Task 0: Preflight

- [ ] **Step 1:** In the W5 worktree, which branches from W0's merge commit, run `git status --short --branch` and `npm run --silent agent:preflight -- --mode repair`. Expected: no blockers. If there are blockers, follow each one's `nextAction`.
- [ ] **Step 2:** Confirm the W0 scaffold exists:
  - `ls server/worldmonitor/marketing/v1/list-calendar-events.ts server/worldmonitor/marketing/v1/_user-agent.ts src/components/marketing/MarketingCalendarPanel.ts src/components/marketing/empty-state.ts shared/marketing/types.ts src/services/marketing/api.ts`
  - `grep -n "ListCalendarEvents\|degraded" src/generated/server/worldmonitor/marketing/v1/service_server.ts`
  - `grep -n "export function listCalendarEvents" src/services/marketing/api.ts` and `grep -n "getRosterStatus\|onRosterStatusChange" src/services/marketing/roster.ts`

  Expected: every file exists, the generated `ListCalendarEventsResponse` has `degraded`, and the W0 wrapper and roster-status exports are present. If any is missing, stop: it is a W0 gap, not W5 work.

### Task 1: Shared date rules

**Files:**
- Create: `shared/marketing/calendar-rules.ts`
- Test: `tests/marketing-calendar-rules.test.mts`

**Interfaces:**
- Consumes: `MarketingCategory`, `MARKETING_CATEGORIES` from `shared/marketing/types.ts`.
- Produces:
  - `type ObservanceRule = { type: 'fixed'; month: number; day: number } | { type: 'nth-weekday'; month: number; weekday: 0|1|2|3|4|5|6; n: 1|2|3|4|5|-1; offsetDays?: number } | { type: 'easter'; offsetDays?: number }`. Months are 1–12, weekday 0 is Sunday, and `n: -1` means the last such weekday.
  - `interface ObservanceDefinition { id: string; name: string; categories: MarketingCategory[]; rule: ObservanceRule }`
  - `interface CalendarEventRecord { id: string; date: string; name: string; kind: 'holiday' | 'observance'; categories: string[] }`. This is structurally identical to the generated `CalendarEvent`.
  - `isYmd(s: string): boolean`. It accepts only a real calendar date (`2026-02-30` → false).
  - `addDaysYmd(ymd: string, days: number): string` and `diffDaysYmd(from: string, to: string): number`. Both use UTC arithmetic only.
  - `resolveRuleDate(rule: ObservanceRule, year: number): string` (YYYY-MM-DD). An offset may cross a month or year boundary.
  - `yearsInRange(fromYmd: string, toYmd: string): number[]`
  - `expandObservances(defs: ObservanceDefinition[], fromYmd: string, toYmd: string): CalendarEventRecord[]`. Ids are `observance:{def.id}:{year}`, `kind: 'observance'`, and the range is inclusive.
  - `matchesCategories(event: { categories: string[] }, wanted: readonly string[]): boolean`. It returns true when `wanted` is empty, when `event.categories` is empty, or when the two intersect.

- [ ] **Step 1: Write the failing tests.** Use `describe('marketing calendar rules')` with `node:assert/strict`. The test names and their assertions:
  - `fixed rule`: `resolveRuleDate({type:'fixed',month:3,day:6}, 2026) === '2026-03-06'`.
  - `nth-weekday`, which covers Thanksgiving, Mother's Day, Father's Day and the Super Bowl. With `{month:11,weekday:4,n:4}`, 2026 → `'2026-11-26'` and 2027 → `'2027-11-25'`. `{month:5,weekday:0,n:2}` 2026 → `'2026-05-10'`. `{month:6,weekday:0,n:3}` 2026 → `'2026-06-21'`. `{month:2,weekday:0,n:2}` 2026 → `'2026-02-08'`.
  - `offset days derive the retail weekend`: offsets from the 4th Thursday of November in 2026. `+1` → `'2026-11-27'` (Black Friday). `+2` → `'2026-11-28'` (Small Business Saturday). `+4` → `'2026-11-30'` (Cyber Monday). `+5` → `'2026-12-01'` (Giving Tuesday, which crosses into December).
  - `last weekday`: `{month:4,weekday:5,n:-1}` 2026 → `'2026-04-24'` (Arbor Day).
  - `DST markers`: `{month:3,weekday:0,n:2}` 2026 → `'2026-03-08'`, and `{month:11,weekday:0,n:1}` 2026 → `'2026-11-01'`.
  - `easter`: `{type:'easter'}` gives 2025 → `'2025-04-20'`, 2026 → `'2026-04-05'` and 2027 → `'2027-03-28'`. `{type:'easter',offsetDays:-2}` 2026 → `'2026-04-03'`, which is Good Friday and matches Nager.
  - `isYmd rejects impossible dates`: `isYmd('2026-02-30') === false`, `isYmd('2026-2-3') === false`, `isYmd('2028-02-29') === true`.
  - `expandObservances spans two years`: use the defs New Year's Eve (fixed 12/31) and a fixed 1/2 entry, with the range `2026-12-15`→`2027-01-15`. The ids are `['observance:nye:2026','observance:fitness:2027']`, the dates are sorted ascending, and both range ends are inclusive.
  - `matchesCategories`: `[]` wanted → true. Event `[]` with wanted `['dental']` → true. `['hvac']` vs `['dental']` → false. `['hvac','roofing']` vs `['roofing']` → true.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `node --import tsx --test tests/marketing-calendar-rules.test.mts`
  Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement `shared/marketing/calendar-rules.ts`.** Do all date work with `Date.UTC` and `getUTCDay`, never with local-time `Date` methods. Easter uses the Anonymous Gregorian (Meeus/Jones/Butcher) algorithm. For `n: -1`, start from the last day of the month and walk backward. The module must stay free of DOM and `node:` imports, because the browser, the edge runtime and Convex may all import it.

- [ ] **Step 4: Run the tests and confirm they pass.**
  Run: `node --import tsx --test tests/marketing-calendar-rules.test.mts`
  Expected: PASS, every test.

- [ ] **Step 5: Commit.**
  ```bash
  git add shared/marketing/calendar-rules.ts tests/marketing-calendar-rules.test.mts
  git commit -m "feat(marketing): shared observance date rules"
  ```

### Task 2: Curated observances data

**Files:**
- Create: `shared/marketing/observances.json`. It is an array of `ObservanceDefinition`.
- Create: `shared/marketing/observances.ts`. It holds `import data from './observances.json'` (a plain import) and `export const OBSERVANCES: ObservanceDefinition[]`.
- Test: `tests/marketing-observances-data.test.mts`

**Interfaces:**
- Consumes: `ObservanceDefinition` and `resolveRuleDate` from Task 1, and `MARKETING_CATEGORIES`.
- Produces: `OBSERVANCES: ObservanceDefinition[]`, which Task 3 imports.

**Content.** Author exactly these entries. The rule shorthand reads as follows: `M/D` means fixed. `nth Wkd Mon ±k` means nth-weekday plus an offset. `Easter ±k` means the easter rule.

| id | name | rule | categories |
|---|---|---|---|
| fitness-resolution-season | New Year Fitness Resolution Season | 1/2 | fitness |
| heart-month | American Heart Month | 2/1 | medical, fitness |
| childrens-dental-health-month | National Children's Dental Health Month | 2/1 | dental |
| super-bowl-sunday | Super Bowl Sunday | 2nd Sun Feb | restaurant, retail |
| national-pizza-day | National Pizza Day | 2/9 | restaurant |
| valentines-day | Valentine's Day | 2/14 | restaurant, retail |
| spring-home-selling-season | Spring Home-Selling Season Kickoff | 3/1 | real-estate |
| national-dentists-day | National Dentist's Day | 3/6 | dental |
| dst-spring-forward | Daylight Saving Time Begins | 2nd Sun Mar | electrical, hvac |
| world-plumbing-day | World Plumbing Day | 3/11 | plumbing |
| hvac-spring-tuneup | AC Tune-Up Season Kickoff | 3/15 | hvac |
| fix-a-leak-week | EPA Fix a Leak Week | 3rd Mon Mar | plumbing |
| st-patricks-day | St. Patrick's Day | 3/17 | restaurant, retail |
| spring-pest-season | Spring Pest Season Kickoff | 3/20 | pest-control |
| world-water-day | World Water Day | 3/22 | plumbing, landscaping |
| national-doctors-day | National Doctors' Day | 3/30 | medical |
| car-care-month-spring | National Car Care Month (Spring) | 4/1 | auto |
| lawn-garden-month | National Lawn and Garden Month | 4/1 | landscaping |
| pest-management-month | National Pest Management Month | 4/1 | pest-control |
| spring-roof-inspection | Spring Roof Inspection Season | 4/1 | roofing |
| easter-sunday | Easter Sunday | Easter +0 | restaurant, retail |
| tax-day | Tax Day | 4/15 | legal, other |
| earth-day | Earth Day | 4/22 | landscaping, retail |
| arbor-day | National Arbor Day | last Fri Apr | landscaping |
| electrical-safety-month | National Electrical Safety Month | 5/1 | electrical |
| law-day | Law Day | 5/1 | legal |
| fitness-sports-month | National Physical Fitness and Sports Month | 5/1 | fitness |
| moving-season | Peak Moving Season Begins | 5/1 | real-estate |
| cinco-de-mayo | Cinco de Mayo | 5/5 | restaurant |
| national-nurses-day | National Nurses Day | 5/6 | medical |
| mothers-day | Mother's Day | 2nd Sun May | restaurant, retail |
| national-hamburger-day | National Hamburger Day | 5/28 | restaurant |
| hurricane-season-start | Atlantic Hurricane Season Begins | 6/1 | roofing, hvac, landscaping |
| homeownership-month | National Homeownership Month | 6/1 | real-estate |
| global-running-day | Global Running Day | 1st Wed Jun | fitness |
| national-donut-day | National Donut Day | 1st Fri Jun | restaurant |
| fathers-day | Father's Day | 3rd Sun Jun | retail, restaurant, auto |
| national-hvac-tech-day | National HVAC Tech Day | 6/22 | hvac |
| hvac-cooling-peak | Peak Cooling Season | 7/1 | hvac, electrical |
| national-fried-chicken-day | National Fried Chicken Day | 7/6 | restaurant |
| national-ice-cream-day | National Ice Cream Day | 3rd Sun Jul | restaurant |
| back-to-school-season | Back-to-School Shopping Season | 8/1 | retail |
| wellness-month | National Wellness Month | 8/1 | fitness, medical |
| fall-aeration-season | Fall Lawn Aeration Season | 9/1 | landscaping |
| hvac-fall-tuneup | Furnace Tune-Up Season Kickoff | 9/15 | hvac |
| national-coffee-day | National Coffee Day | 9/29 | restaurant |
| dental-hygiene-month | National Dental Hygiene Month | 10/1 | dental |
| breast-cancer-awareness-month | Breast Cancer Awareness Month | 10/1 | medical |
| car-care-month-fall | Fall Car Care Month | 10/1 | auto |
| pre-winter-roof-check | Pre-Winter Roof Check Season | 10/1 | roofing |
| national-taco-day | National Taco Day | 10/4 | restaurant |
| fire-prevention-day | Fire Prevention Day | 10/9 | electrical, hvac |
| halloween | Halloween | 10/31 | retail, restaurant |
| dst-fall-back | Daylight Saving Time Ends | 1st Sun Nov | electrical, hvac |
| open-enrollment-start | Health Insurance Open Enrollment Begins | 11/1 | medical |
| world-toilet-day | World Toilet Day | 11/19 | plumbing |
| blackout-wednesday | Thanksgiving Eve | 4th Thu Nov −1 | restaurant |
| black-friday | Black Friday | 4th Thu Nov +1 | retail, auto, fitness |
| small-business-saturday | Small Business Saturday | 4th Thu Nov +2 | retail, restaurant, other |
| cyber-monday | Cyber Monday | 4th Thu Nov +4 | retail |
| giving-tuesday | GivingTuesday | 4th Thu Nov +5 | other |
| hurricane-season-end | Atlantic Hurricane Season Ends | 11/30 | roofing |
| christmas-eve | Christmas Eve | 12/24 | retail, restaurant |
| new-years-eve | New Year's Eve | 12/31 | restaurant, retail |

- [ ] **Step 1: Write the failing tests.**
  - `has at least 60 observances with unique kebab-case ids`: assert `OBSERVANCES.length >= 60`, assert `new Set(ids).size === ids.length`, and match every id against `/^[a-z0-9]+(-[a-z0-9]+)*$/`.
  - `every category is a MarketingCategory and none is empty`: every def has `categories.length >= 1` and every category is in `MARKETING_CATEGORIES`.
  - `every rule resolves to a valid date in its month for 2026–2030`: for each def and each year, `isYmd(resolveRuleDate(def.rule, y))` holds. For a rule with no offset, the month of the result equals `rule.month`.
  - `pinned dates`: `small-business-saturday` 2026 → `'2026-11-28'`, `national-dentists-day` 2026 → `'2026-03-06'`, `black-friday` 2027 → `'2027-11-26'`, `hvac-fall-tuneup` 2026 → `'2026-09-15'`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `node --import tsx --test tests/marketing-observances-data.test.mts`
  Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Write `observances.json` from the table above and add `observances.ts`.** `observances.ts` narrows the JSON with a type assertion to `ObservanceDefinition[]`. The test is the validator, so add no runtime validation.

- [ ] **Step 4: Run the tests and confirm they pass.** Use the same command. Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add shared/marketing/observances.json shared/marketing/observances.ts tests/marketing-observances-data.test.mts
  git commit -m "feat(marketing): curated US marketing observances"
  ```

### Task 3: `ListCalendarEvents` handler

**Files:**
- Modify: `server/worldmonitor/marketing/v1/list-calendar-events.ts`. Replace W0's stub body and keep the exported handler name that W0's `handler.ts` imports.
- Test: `tests/marketing-calendar-handler.test.mts`

**Interfaces:**
- Consumes:
  - Everything Task 1 produces.
  - `OBSERVANCES` from Task 2.
  - `cachedFetchJson` from `server/_shared/redis.ts`.
  - `marketingUserAgent` from `server/worldmonitor/marketing/v1/_user-agent.ts` (W0).
  - `createRedisFetch` from `tests/helpers/fake-upstash-redis.mts` (tests only).
  - The generated `ServerContext`, `ListCalendarEventsRequest`, `ListCalendarEventsResponse` and `CalendarEvent`.
- Produces:
  - `listCalendarEvents(ctx: ServerContext, req: ListCalendarEventsRequest): Promise<ListCalendarEventsResponse>`. This keeps the W0 stub's export name, so if W0 named it differently, keep W0's name.
  - `normalizeCalendarRange(req: { fromDate: string; toDate: string }, todayYmd: string): { fromDate: string; toDate: string } | null`
    - An invalid or empty `fromDate` becomes `todayYmd`.
    - An invalid or empty `toDate` becomes `fromDate + 60`.
    - It returns `null` when `toDate < fromDate`.
    - It clamps `toDate` to `fromDate + 366`.
  - `nagerToEvents(raw: unknown): CalendarEventRecord[]`
    - It keeps only entries with `global === true`, a valid `date` and a non-empty string `name`.
    - It dedupes by `date|name`, because Nager lists Columbus Day twice.
    - The output is `kind: 'holiday'`, `categories: []` and `id: holiday:{date}:{slug(name)}`.
    - Input that is not an array yields `[]`.
  - The response is `{ events, degraded }`; `degraded` is true when at least one requested Nager year came back `null`.
  - `buildCalendarEvents(input: { holidays: CalendarEventRecord[]; observances: ObservanceDefinition[]; fromDate: string; toDate: string; categories: string[] }): CalendarEvent[]`
    - It sorts by date, then puts holidays before observances, then sorts by name.
    - It ignores request categories that are not in `MARKETING_CATEGORIES`.

- [ ] **Step 1: Write the failing tests.** Copy the `setup(t)` pattern from `tests/imagery-query-cache.test.mts`. Set the env vars `UPSTASH_REDIS_REST_URL=https://redis.test`, `UPSTASH_REDIS_REST_TOKEN`, `VERCEL_ENV=production` and `MARKETING_CONTACT_EMAIL=test@example.com` (required by `marketingUserAgent()` in production). Route `https://redis.test/` to `createRedisFetch({}).fetchImpl`, and route `https://date.nager.at/api/v3/PublicHolidays/{y}/US` to a fixture. The fixture is the 2026 entries recorded in Global Constraints: Thanksgiving `2026-11-26` global, Columbus Day `2026-10-12` twice (one global, one with counties) and Lincoln's Birthday `2026-02-12` non-global.
  - `nagerToEvents keeps global holidays and dedupes`: there is exactly one `Columbus Day` row, there is no `Lincoln's Birthday`, and `categories` deep-equals `[]`.
  - `normalizeCalendarRange`: `({fromDate:'',toDate:''}, '2026-10-21')` → `{fromDate:'2026-10-21', toDate:'2026-12-20'}`. A reversed range → `null`. `toDate` 900 days out is clamped to `'2027-10-22'` when from is `2026-10-21`.
  - `filters by range and category, keeping universal holidays`: request `{fromDate:'2026-11-20', toDate:'2026-12-02', categories:['retail']}`. The names include `Thanksgiving Day`, `Black Friday`, `Small Business Saturday` and `Cyber Monday`. They exclude `Thanksgiving Eve` (restaurant only) and `GivingTuesday` (other only). Every event's `date` lies within the range.
  - `empty categories returns everything in range`: `categories: []` includes `Thanksgiving Eve`.
  - `cache hit avoids a second Nager fetch`: call twice for 2026, and the count of Nager URLs is 1.
  - `cross-year window fetches both years once`: range `2026-12-15`→`2027-01-15`. The Nager URLs are exactly `.../2026/US` and `.../2027/US`, and the results include `observance:new-years-eve:2026` and `observance:fitness-resolution-season:2027`.
  - `healthy fetch is not degraded`: a normal 2026 request returns `degraded: false`.
  - `nager failure degrades to observances only`: Nager returns 503 (and in a second case, rejects with `AbortError`). The result is non-empty, has `degraded: true`, has no `kind:'holiday'` rows, and still contains `observance:black-friday:2026`. Use `t.mock.method(console, 'warn')` to check that one call's first argument contains `[marketing-calendar] degraded`.
  - `sends the marketing User-Agent`: the Nager request's `User-Agent` header equals `marketingUserAgent()`.
  - `missing contact email degrades instead of throwing`: with `MARKETING_CONTACT_EMAIL` deleted, the result has `degraded: true`, still contains observances, and Nager is never called.
  - `reversed range returns no events`: the result is `{ events: [], degraded: false }`, and Nager is never called.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `node --import tsx --test tests/marketing-calendar-handler.test.mts`
  Expected: FAIL. The new exports are missing, and W0's stub returns `events: []`.

- [ ] **Step 3: Implement the handler.**
  - Run `fetchNagerYear(year): Promise<{ holidays: CalendarEventRecord[] } | null>` inside `cachedFetchJson(\`marketing:calendar:nager:v1:US:${year}\`, 604800, fetcher, 300)`.
  - The fetcher calls `globalThis.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': marketingUserAgent() }, signal: AbortSignal.timeout(8000) })` inside its own try. It returns `null` on a non-OK status or any thrown error, including a throw from `marketingUserAgent()`.
  - The handler runs the years in parallel with `Promise.all`. A year that comes back `null` gets one `console.warn('[marketing-calendar] degraded: nager unavailable', { year })`, contributes no holidays, and sets `degraded: true`.
  - Wrap the whole handler in try/catch, and on error return `{ events: [], degraded: true }`.
  - `todayYmd` is `new Date().toISOString().slice(0, 10)`. The server runs in UTC, and the browser always sends explicit dates.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - `node --import tsx --test tests/marketing-calendar-handler.test.mts tests/marketing-calendar-rules.test.mts tests/marketing-observances-data.test.mts`. Expected: PASS.
  - `npm run typecheck:api`. Expected: exit 0.
  - `node --import tsx --test tests/edge-functions.test.mjs`. Expected: PASS, which confirms no forbidden imports and that the bundle builds.

- [ ] **Step 5: Commit.**
  ```bash
  git add server/worldmonitor/marketing/v1/list-calendar-events.ts tests/marketing-calendar-handler.test.mts
  git commit -m "feat(marketing): ListCalendarEvents merges Nager holidays and observances"
  ```

### Task 4: Panel row selection (pure)

**Files:**
- Create: `src/components/marketing/calendar-rows.ts`. It must not import i18n or the DOM, so it stays runnable under tsx.
- Test: `tests/marketing-calendar-rows.test.mts`

**Interfaces:**
- Consumes: `MarketingClient` and `MarketingCategory` from `shared/marketing/types.ts`, plus `matchesCategories` and `diffDaysYmd` from Task 1.
- Produces:
  - `type CalendarWindowDays = 30 | 60`
  - `interface CalendarRow { id: string; date: string; name: string; kind: 'holiday' | 'observance'; categories: string[]; daysAway: number }`
  - `resolvePanelCategories(clients: MarketingClient[], focusedClientId: string | null): MarketingCategory[]`. If the focused id matches an active client (Resolution 12: inactive clients never count), the result is `[thatClient.category]`. Otherwise it is the sorted, unique categories of the active clients.
  - `rosterCategories(clients: MarketingClient[]): MarketingCategory[]`. This is the same as the unfocused branch, and the panel passes it as the RPC `categories`.
  - `selectCalendarRows(events: CalendarEventRecord[], opts: { todayYmd: string; windowDays: CalendarWindowDays; categories: readonly string[] }): CalendarRow[]`. It keeps `0 <= daysAway <= windowDays` and events where `matchesCategories` holds, and it sorts by date.

- [ ] **Step 1: Write the failing tests.** The fixture clients are `Fixture Cool Air` (id `cool-air`, hvac, active), `Fixture Smile` (id `smile`, dental, active) and `Fixture Old` (id `old-roof`, roofing, `active:false`). The ids match Resolution 12's `/^[A-Za-z0-9_-]{1,64}$/`.
  - `focused client narrows to its category`: `resolvePanelCategories(clients, 'cool-air')` deep-equals `['hvac']`.
  - `unknown focused id falls back to all categories`: `resolvePanelCategories(clients, 'deleted-id')` deep-equals `['dental','hvac']`, which excludes the inactive roofing client.
  - `inactive focused client falls back`: `resolvePanelCategories(clients, 'old-roof')` deep-equals `['dental','hvac']`.
  - `window filter`: with today `2026-10-21`, events on `2026-11-19` (29 days away) and `2026-12-15` (55 days away). Window 30 keeps the first only, and window 60 keeps both. An event dated `2026-10-20` (in the past) is dropped.
  - `universal holidays survive a category filter`: a holiday with `categories: []` is kept when the categories are `['dental']`.
  - `daysAway is stable across fall-back DST`: set `process.env.TZ='America/New_York'` and restore it afterwards, as `tests/calendar-handler-ranges.test.mts` does. Today is `2026-10-31` and the event is `2026-11-02`, so `daysAway === 2`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `node --import tsx --test tests/marketing-calendar-rows.test.mts`
  Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement `calendar-rows.ts`.** `daysAway` is `diffDaysYmd(todayYmd, event.date)`, so it works on YMD strings only. The caller supplies `todayYmd` from `localYmd(new Date())`.

- [ ] **Step 4: Run the tests and confirm they pass.** Use the same command. Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/marketing/calendar-rows.ts tests/marketing-calendar-rows.test.mts
  git commit -m "feat(marketing): calendar row selection for the panel"
  ```

### Task 5: `MarketingCalendarPanel`

**Files:**
- Modify: `src/components/marketing/MarketingCalendarPanel.ts`. Replace W0's placeholder, keep the class name, and keep the `id: 'marketing-calendar'`.
- Modify: `src/locales/en.json`. Add only the `marketing.calendar` subtree.
- Modify (generated): `src/locales/*.json` English fallbacks, written by `npm run sync:locales` (and `npm run locales:zh-tw` if zh-TW is flagged). Resolution 1.
- Test: `tests/dom/marketing-calendar-panel.test.mts`

**Interfaces:**
- Consumes:
  - Everything Task 4 produces.
  - `getClients`, `subscribeClients`, `getRosterStatus(): 'loading'|'ready'|'forbidden'|'error'` and `onRosterStatusChange(cb): () => void` from `@/services/marketing/roster` (Res. 18).
  - `getFocusedClientId` and `onFocusChange` from `@/services/marketing/focus`. `onFocusChange` does not fire on subscribe (Res. 13), so the constructor reads `getFocusedClientId()` once.
  - `listCalendarEvents(req: ListCalendarEventsRequest): Promise<ListCalendarEventsResponse>` from `@/services/marketing/api` (W0, Res. 8; it goes through `premiumFetch`).
  - `renderNoClientsState()` and `renderSourceUnavailable()` from `@/components/marketing/empty-state` (W0, Res. 18).
  - `localYmd` and `addLocalDays` from `@/utils/local-date`.
  - `safeHtml` and `joinSafeHtml` from `@/utils/sanitize`.
  - `t` from `@/services/i18n`.
- Produces:
  - `class MarketingCalendarPanel extends Panel` with `constructor()`.
  - `public fetchData(): Promise<void>`
  - `public setWindow(days: CalendarWindowDays): void`
  - `public destroy(): void`. It unsubscribes the roster, roster-status and focus listeners, then calls `super.destroy()`.

**Behaviour:**
- The constructor reads `getFocusedClientId()`, subscribes to the roster, roster status and focus changes, then calls `runWhenConnected(() => void this.fetchData())`.
- `fetchData` requests `{ fromDate: today, toDate: today+60, categories: rosterCategories(clients) }` once and caches the events and `degraded` in memory. Roster changes trigger a refetch. Focus changes and the window toggle only re-render.
- Roster status gates the RPC: `'loading'` shows the panel's loading state and makes no call; `'forbidden'` or `'error'` renders `renderSourceUnavailable()` with no call; `'ready'` with no active clients renders `renderNoClientsState()` with no call. A transition to `'ready'` triggers `fetchData`.
- On an RPC error, the panel renders `renderSourceUnavailable()` with a retry that calls `fetchData()`.
- When the response has `degraded: true`, the panel renders the rows it has (observances) plus `renderSourceUnavailable()` as an inline notice above them.
- When no rows match, it renders `marketing.calendar.noEvents`.
- The header carries a 30/60 toggle: `<button data-window="30|60" aria-pressed>`. The click handler is delegated on `this.content`.
- Each row shows the date, the name, a kind badge (holiday or observance), the category chips labelled with `t('marketing.category.<id>')` (Res. 18), and "in N days" (`marketing.calendar.inDays`, with `{{count}}`) or `marketing.calendar.today`.
- `setCount(rows.length)`.
- Render with `setSafeContent(safeHtml\`...\`)`. Never use string concatenation or `innerHTML`.

**en.json keys** (under `marketing.calendar`):
- `title`: "Marketing Calendar"
- `noEvents`: "No holidays or observances in this window"
- `window30`: "30 days"
- `window60`: "60 days"
- `inDays`: "in {{count}} days"
- `today`: "Today"
- `holiday`: "Holiday"
- `observance`: "Observance"

The empty-roster and source-unavailable strings come from W0's shared keys (`marketing.empty.noClients`, `marketing.common.sourceUnavailable`); W5 adds no copies of them.

- [ ] **Step 1: Write the failing tests.** Follow the pattern in `tests/dom/china-panel-refetch.test.mts`: `vi.hoisted` mocks, `vi.mock('@/services/marketing/roster' | '/focus' | '/api')`, `initTestI18n` from `./helpers/i18n.mts`, fake timers advanced 150 ms past the `setSafeContent` debounce, and the system time set to `2026-10-21T12:00:00Z`.
  - `empty roster shows add-first-client and skips RPC`: the text contains the `marketing.empty.noClients` string, and `listCalendarEvents` is called 0 times.
  - `roster loading defers the RPC`: with `getRosterStatus()` mocked to `'loading'`, the RPC is called 0 times; emitting `'ready'` through the `onRosterStatusChange` mock triggers exactly one call.
  - `initial focus is read without an event`: with `getFocusedClientId()` returning `cool-air` at construction and no focus event emitted, the dental-only row is absent.
  - `requests 60 days for all roster categories`: called once with `{fromDate:'2026-10-21', toDate:'2026-12-20', categories:['dental','hvac']}`.
  - `focus change filters without refetching`: emit focus `cool-air`. The dental-only row disappears, the universal holiday stays, and the RPC call count stays at 1.
  - `30/60 toggle`: click `[data-window="30"]`. A row 55 days out is hidden, and the RPC call count stays at 1.
  - `rpc failure shows source unavailable`: the mock rejects, and the text contains the `marketing.common.sourceUnavailable` string.
  - `degraded response shows notice and keeps observances`: the mock resolves `{ events: [<observance row>], degraded: true }`. The text contains the `marketing.common.sourceUnavailable` string and the observance name.
  - `category chips use shared labels`: an hvac row's chip text equals `t('marketing.category.hvac')`.
  - `escapes event names`: an event named `<img src=x onerror=1>` renders as text, so `querySelector('img')` is null.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-calendar-panel.test.mts`
  Expected: FAIL, because the placeholder renders "coming soon".

- [ ] **Step 3: Implement the panel and add the en.json keys.** Then run `npm run sync:locales` (and `npm run locales:zh-tw` if it flags zh-TW). On a rebase conflict in a locale file, take the base version and re-run `sync:locales`.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run the same vitest command. Expected: PASS.
  - Then run `npm run typecheck`, `npm run lint:boundaries` and `npm run lint`, one at a time. Expected: each exits 0.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/marketing/MarketingCalendarPanel.ts src/locales/ tests/dom/marketing-calendar-panel.test.mts
  git commit -m "feat(marketing): MarketingCalendarPanel with 30/60-day window and client filter"
  ```

### Task 6: Verify and deliver

- [ ] **Step 1: Manual check.** Run `npm run dev:marketing` and open the app. With fixture clients, the Marketing Calendar panel lists Black Friday and Small Business Saturday within 60 days of 2026-10-21. Focusing a dental fixture client hides retail-only rows. Toggling to 30 days hides events more than 30 days out. Follow `.agents/skills/verify-worldmonitor/SKILL.md`.
- [ ] **Step 2: Capture screenshots.** Take desktop and mobile screenshots of three states: all clients, a focused client, and the 30-day window. Label each with the tested commit.
- [ ] **Step 3: Run the suite and the diff checks.**
  - `npm run test:data`. Expected: no new failures.
  - `git diff --check`. Expected: empty.
  - `grep -r "Fixture " dist/ || true`, after `npm run build:marketing`. Expected: no matches.
- [ ] **Step 4: Open the PR to the fork's `main`, if delivery is authorized.**
  - Follow CONTRIBUTING.md#pull-request-process, and rebase on the current `main` first.
  - Attach the screenshots with `gh pr edit <n> --attach '/abs/path.png#Marketing calendar — all clients'`, repeating `--attach` for each image.
  - End the PR body with the attribution line from the session.

## Contract Issues (resolved)

1. No `degraded` flag -> **Resolution 4.** The response carries `degraded`; the handler sets it when Nager fails, and the panel shows `renderSourceUnavailable()` above the observances (Tasks 3 and 5).
2. No shared User-Agent helper -> **Resolution 6.** W5 consumes `marketingUserAgent()`; the inline constant is removed (Task 3).
3. Wrapper name not pinned -> **Resolution 8.** `listCalendarEvents` in `src/services/marketing/api.ts`, through `premiumFetch` (Task 5).
4. Empty `categories` undefined -> **Resolution 14** for the request. The event-side rule (empty event `categories` applies to all) stays W5's semantics, implemented once in `matchesCategories` (Task 1).
5. No shared empty-state key, `en.json` conflicts -> **Resolutions 18 and 1.** W5 uses `renderNoClientsState()`, `renderSourceUnavailable()` and the shared keys, drops `marketing.calendar.emptyRoster` and `.sourceUnavailable`, and runs `sync:locales` (Task 5).
6. No load trigger -> **not covered by the resolutions; still unresolved.** The panel keeps loading itself through `runWhenConnected` and does not touch `src/app/data-loader.ts`.

**New unresolved issues:**
- A. The return type of `renderNoClientsState()` / `renderSourceUnavailable()` is not pinned, and neither is whether `renderSourceUnavailable` takes a retry callback. This plan assumes both return the `safeHtml` result type so they compose inside `setSafeContent`, and wires retry through the panel's own delegated click handler.
- B. W8's "holiday within N days" rule should import `matchesCategories` and `expandObservances` from `shared/marketing/calendar-rules.ts` and `OBSERVANCES` from `shared/marketing/observances.ts`. No resolution records this, so W8 could duplicate the logic.
