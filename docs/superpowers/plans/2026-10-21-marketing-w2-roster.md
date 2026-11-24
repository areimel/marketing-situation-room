# Marketing W2: Workspace, Members and Client Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agency a private, sign-in-gated client roster in Convex, with an email allowlist that admins manage, and a Client Roster panel for adding, editing, geocoding and archiving clients.

**Architecture:**
- Convex holds the data. `convex/marketing/members.ts` covers the allowlist, with admin-only writes. `convex/marketing/clients.ts` covers the roster, which any member can edit. `convex/marketing/geocode.ts` is an action that calls the US Census geocoder for members.
- One shared validator in `shared/marketing/client-input.ts` is used by both the browser form and the Convex mutations. Convex is the authority.
- The browser reaches Convex through the existing `getConvexClient()` / `getConvexApi()` singleton (`src/services/convex-client.ts`). The live query uses `ConvexClient.onUpdate`, the same pattern as `src/services/followed-countries.ts`.

**Tech Stack:** Convex 1.32 + convex-test 0.0.43 (vitest, edge-runtime), TypeScript, vanilla DOM through `h()` (`src/utils/dom-utils.ts`), i18next, node:test via tsx, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md`. The binding shared contracts are in `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

Every rule under "Global Constraints" in `2026-10-21-marketing-00-index.md` applies, verbatim. These additions are specific to W2:
- **The roster never leaves Convex for non-members.** Every public function in `convex/marketing/members.ts`, `clients.ts` and `geocode.ts` either resolves membership first or returns `null`. No exception to this exists, including in dev.
- **Writes:**
  - Any member may edit the roster. The spec says "no per-client permissions".
  - Member writes are admin-only.
  - The bootstrap admin (Convex env `MARKETING_BOOTSTRAP_ADMIN_EMAIL`) can never be removed.
- **Membership** matches `identity.email` lowercased and trimmed, and only when `identity.emailVerified === true` (index Resolution 15; same rule as `convex/notificationChannels.ts:549`). W0's `convex/marketing/access.ts` implements this; W2 consumes `requireMarketingMember`, `findMarketingMemberByEmail(ctx, email)` and `getMyMembership(ctx)` and never re-implements the lookup.
- **Client ids** are the Convex document id string, matching `/^[A-Za-z0-9_-]{1,64}$/` (Resolution 12). Archived (`active === false`) clients are never delivered by `getClients`/`subscribeClients`.
- **Errors** are thrown as `ConvexError` with object data (Resolution 15):
  - `{ code: 'MARKETING_FORBIDDEN' }`
  - `{ code: 'MARKETING_INVALID', field: string, reason: string }`
  - The browser reads `err.data`, never the message string (see the note in `src/services/followed-countries.ts:34`).
- **No `innerHTML`.** `npm run lint:safe-html` has an empty baseline. Build DOM with `h()` and `this.setContentNodes(...)`.
- **Convex file names have exactly one dot.** Test helpers use two dots (`x.helpers.ts`), and test files go under `convex/__tests__/` (`tests/convex-entrypoint-hygiene.test.mjs`). Convex modules must not use `import.meta`.
- **Exact copy:** the empty state is W0's `renderNoClientsState()` (`src/components/marketing/empty-state.ts`, key `marketing.empty.noClients` = `Add your first client`). Upstream failures use W0's `renderSourceUnavailable()`. Category labels use W0's `marketing.category.<id>` keys. W2 adds none of these (Resolution 18).
- **Locales** (Resolution 1): add English keys to `en.json`, then `npm run sync:locales`; if zh-TW is flagged, `npm run locales:zh-tw`. On a rebase conflict in locale JSON, take the base version and re-run `sync:locales`.
- **`convex/_generated/`** is generated output (Resolution 17): regenerate with `npx convex codegen` after each rebase; never hand-merge it.

## Review Focus

1. **Empty roster.** A signed-in member with zero clients sees "Add your first client" and an Add button, not a spinner or an error. This is pinned in Task 6.
2. **A non-member, a signed-out user, or a member removed mid-session** gets `MARKETING_FORBIDDEN` from every query and mutation. The panel shows the forbidden state with no client name in the DOM, and the live subscription drops data when membership is revoked. This is pinned in Tasks 2, 3, 5 and 6.
3. **Geocoder fails.** This covers no match, Census down or slow, and a non-US address. The form shows a message, keeps the manual lat/lon fields editable, and still saves. A client with zero locations saves and lists with a "No location" badge. This is pinned in Tasks 4 and 7.
4. **Bad coordinates or radius.** This covers `NaN`, `lat` 91, `lon` -181, and radius 0 or 1000. The shared validator rejects them on both sides with a field path (`locations.0.lat`), and the form highlights that field. This is pinned in Tasks 1 and 3.
5. **Email casing, verification and lockout.**
   - An admin adds ` Alice@Agency.COM `, and the Clerk identity `alice@agency.com` (verified) gets in.
   - An unverified identity with the same email does not get in.
   - An admin cannot remove themselves or the bootstrap admin.
   - This is pinned in Task 2.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `shared/marketing/client-input.ts` | Create | Limits, input types, `normalizeClientInput`, `parseTermList`, `normalizeMarketingEmail` (same trim+lowercase rule as W0's `access.ts`) |
| `shared/marketing/geocode.ts` | Create | `GeocodeResult` type, `CENSUS_ONELINE_URL`, `parseCensusOnelineResponse` |
| `convex/marketing/access.ts` | Modify (W0 file; the index says "W2 extends it") | Add only `requireMarketingAdmin` and `isBootstrapAdminEmail`. W0's `requireMarketingMember`, `findMarketingMemberByEmail`, `getMyMembership(ctx)` are consumed unchanged |
| `convex/marketing/members.ts` | Create | `getMyMembership`, `listMembers`, `addMember`, `removeMember` |
| `convex/marketing/clients.ts` | Create | `listClients`, `createClient`, `updateClient`, `archiveClient`, `restoreClient` |
| `convex/marketing/geocode.ts` | Create | `geocodeAddress` action |
| `convex/_generated/api.d.ts` | Regenerate (`npx convex codegen`) | Registers the three new modules |
| `src/services/marketing/roster.ts` | Replace body (W0 file, W2 owns the real implementation) | Convex-backed roster, real `getRosterStatus`/`onRosterStatusChange` (W0 signatures), `getRosterDetail`, writes, fixture fallback |
| `src/services/marketing/members.ts` | Create | Browser wrappers for the member functions |
| `src/services/marketing/geocode.ts` | Create | `geocodeAddress(address)` browser wrapper |
| `src/components/marketing/ClientRosterPanel.ts` | Replace placeholder | Panel states, client list, and switching between list, form and team views |
| `src/components/marketing/client-roster-form.ts` | Create | `buildClientForm(...)` DOM builder and value reader |
| `src/components/marketing/client-roster-team.ts` | Create | `buildTeamSection(...)`, admin-only |
| `src/locales/en.json` (+ `npm run sync:locales` output) | Modify | `marketing.roster.*`, `marketing.team.*` only (`marketing.empty.*`, `marketing.common.*`, `marketing.category.*` are W0's) |
| `src/components/marketing/empty-state.ts` | Consume (W0) | `renderNoClientsState()`, `renderSourceUnavailable()` |

Tests:
- `tests/marketing-client-input.test.mts`
- `tests/marketing-geocode-parse.test.mts`
- `tests/marketing-roster-service.test.mts`
- `convex/__tests__/marketingMembers.test.ts`
- `convex/__tests__/marketingClients.test.ts`
- `convex/__tests__/marketingGeocode.test.ts`
- `tests/dom/client-roster-panel.test.mts`

### Geocoding decision: a Convex action, not the browser and not a new API route
- **The browser can't call Census directly.** A probe on 2026-10-21 of `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?...&format=json`, sent with `Origin: https://example.com`, returned `200` with `Vary: Origin` but **no `Access-Control-Allow-Origin`**, so a browser `fetch` fails CORS.
- **Why not a Vercel/edge route:**
  - It would need either a proto RPC (`proto/` belongs to W0) or an `api/api-route-exceptions.json` entry, plus its own membership check.
  - A route would also be one more public surface that sees client addresses.
- **Why a Convex action:**
  - It already carries the Clerk identity, so it can reuse membership through `ctx.runQuery(api.marketing.members.getMyMembership, {})`.
  - It needs no new route, and it works the same under self-hosted docker.
- **Calls:** the action is called only on an explicit "Look up" click, never on keystroke. Results aren't cached, because each address is entered once.

---

### Task 0: Preflight

- [ ] **Step 1:** Branch from W0's merge commit in a fresh worktree (`superpowers:using-git-worktrees`), then run `npm run --silent agent:preflight -- --mode repair`.
  - Expected: readiness OK. Resolve each blocker's `nextAction` before continuing.
- [ ] **Step 2:** Confirm the W0 scaffold exists:
  - `ls convex/marketing/access.ts shared/marketing/types.ts src/services/marketing/roster.ts src/components/marketing/ClientRosterPanel.ts src/components/marketing/empty-state.ts`
  - `grep -n "marketingMembers\|marketingClients" convex/schema.ts`
  - `grep -n "export .*\(requireMarketingMember\|findMarketingMemberByEmail\|getMyMembership\)" convex/marketing/access.ts`
  - `grep -n "export .*\(getRosterStatus\|onRosterStatusChange\)" src/services/marketing/roster.ts`
  - `grep -n "renderNoClientsState\|renderSourceUnavailable" src/components/marketing/empty-state.ts` and `grep -n '"noClients"\|"sourceUnavailable"\|"category"' src/locales/en.json`
  - Expected: all present. If not, stop and report that W0 has not merged (Resolutions 15, 18).

### Task 1: Shared client-input validator

**Files:**
- Create: `shared/marketing/client-input.ts`
- Test: `tests/marketing-client-input.test.mts`

**Interfaces:**
- Consumes: `MARKETING_CATEGORIES`, `MarketingCategory`, `MarketingClient` from `shared/marketing/types.ts`.
- Produces:
```ts
export const CLIENT_INPUT_LIMITS: { nameMax: 120; labelMax: 80; addressMax: 200; cityMax: 80; termMax: 80; termsMax: 20; locationsMax: 25; radiusMinMiles: 1; radiusMaxMiles: 250 };
export interface MarketingClientLocationInput { id?: string; label: string; address: string; city: string; stateCode: string; lat: number; lon: number; serviceRadiusMiles: number; }
export interface MarketingClientInput { name: string; category: MarketingCategory; locations: MarketingClientLocationInput[]; competitors: string[]; keywords: string[]; accountManagerEmail: string | null; }
export type ClientInputReason = 'required' | 'too_long' | 'too_many' | 'out_of_range' | 'invalid';
export type ClientInputResult = { ok: true; value: MarketingClientInput } | { ok: false; field: string; reason: ClientInputReason };
export function normalizeClientInput(input: MarketingClientInput): ClientInputResult;
export function parseTermList(raw: string): string[];
export function normalizeMarketingEmail(raw: string): string | null;
```

- [ ] **Step 1: Write the failing tests** in `tests/marketing-client-input.test.mts`.
  - Use `node:test`, and import from `../shared/marketing/client-input.ts`.
  - Start from a valid base input: name `'Acme HVAC'`, category `'hvac'`, and one location `{label:'Main', address:'1 Main St', city:'Austin', stateCode:'tx', lat:30.27, lon:-97.74, serviceRadiusMiles:15}`.
  - Cases:
    - `normalizes a valid client`:
      - `ok === true`
      - `value.name === 'Acme HVAC'` after trimming `'  Acme HVAC '`
      - `value.locations[0].stateCode === 'TX'`
      - `value.accountManagerEmail === 'am@agency.com'` from `' AM@Agency.com '`
    - `allows zero locations`: `ok === true` with `locations: []`.
    - `rejects empty name` → `{ok:false, field:'name', reason:'required'}`.
    - `rejects name over 120 chars` → `reason:'too_long'`.
    - `rejects unknown category` (`'astrology' as any`) → `field:'category', reason:'invalid'`.
    - `rejects non-finite or out-of-range coordinates`. Each of these gives `field:'locations.0.lat'` or `'locations.0.lon'`, with `reason:'out_of_range'`:
      - `lat: NaN`
      - `lat: 91`
      - `lon: -181`
      - `lon: Infinity`
    - `rejects radius outside 1..250`. Both `0` and `1000` give `field:'locations.0.serviceRadiusMiles'`.
    - `rejects bad state code`. `'Texas'` gives `field:'locations.0.stateCode', reason:'invalid'`.
    - `rejects more than 25 locations` → `field:'locations', reason:'too_many'`.
    - `dedupes and trims terms`. `competitors: [' Cool Co ', 'cool co', '', 'Heat Inc']` becomes `['Cool Co', 'Heat Inc']`.
    - `rejects more than 20 keywords` → `field:'keywords', reason:'too_many'`.
    - `rejects malformed account manager email` → `field:'accountManagerEmail', reason:'invalid'`.
    - `parseTermList`: `'a, b\nc,, A'` becomes `['a','b','c']`.
    - `normalizeMarketingEmail`: `' Alice@Agency.COM '` becomes `'alice@agency.com'`, while `'not-an-email'` and `''` become `null`.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-client-input.test.mts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `shared/marketing/client-input.ts`.**
  - Validate in field order (name, category, accountManagerEmail, competitors, keywords, locations) and return the first failure.
  - Keep the term dedupe case-insensitive, keeping the first spelling.
  - The email shape is `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` after trim and lowercase.
  - Use no imports beyond `./types`, because both Convex and the browser bundle it.
- [ ] **Step 4: Run the test and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add shared/marketing/client-input.ts tests/marketing-client-input.test.mts && git commit -m "feat(marketing): shared client input validator"`. Include the Co-Authored-By trailer.

### Task 2: Access extension and member functions

**Files:**
- Modify: `convex/marketing/access.ts` (add only; leave W0's `requireMarketingMember`, `findMarketingMemberByEmail`, `getMyMembership` unchanged)
- Create: `convex/marketing/members.ts`
- Regenerate: `convex/_generated/api.d.ts`
- Test: `convex/__tests__/marketingMembers.test.ts`

**Interfaces:**
- Consumes:
  - W0 `access.ts` (Resolution 15): `requireMarketingMember(ctx)`, `findMarketingMemberByEmail(ctx, email)`, `getMyMembership(ctx)` (non-throwing, `null` for signed-out/unverified/non-member).
  - `normalizeMarketingEmail` (Task 1), the `marketingMembers` table with index `by_email` (W0 schema), and `MARKETING_BOOTSTRAP_ADMIN_EMAIL`.
- Produces:
```ts
// access.ts (W2 additions only)
export type MarketingRole = 'admin' | 'member';            // only if W0 does not already export it
export function isBootstrapAdminEmail(email: string): boolean; // normalized compare against MARKETING_BOOTSTRAP_ADMIN_EMAIL
export async function requireMarketingAdmin(ctx: QueryCtx | MutationCtx): Promise<{ email: string; role: 'admin' }>; // wraps requireMarketingMember; non-admin -> MARKETING_FORBIDDEN
export interface MarketingMembership { email: string; role: MarketingRole; isBootstrapAdmin: boolean }
// members.ts (public; getMyMembership wraps access.getMyMembership(ctx), imported under an alias)
export const getMyMembership: query({}) => MarketingMembership | null;   // never throws
export const listMembers: query({}) => Array<{ email: string; role: MarketingRole; addedBy: string; addedAt: number; isBootstrapAdmin: boolean }>; // member-only, sorted by email
export const addMember: mutation({ email: string; role: MarketingRole }) => { ok: true; created: boolean };  // admin-only, upsert by email
export const removeMember: mutation({ email: string }) => { ok: true; removed: boolean };                  // admin-only
```

- [ ] **Step 1: Write the failing tests** in `convex/__tests__/marketingMembers.test.ts`.
  - Follow the pattern of `convex/__tests__/alertRules.test.ts`: `convexTest(schema, modules)` with `const modules = import.meta.glob("../**/*.ts")`.
  - `beforeEach` sets `process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL = "boss@agency.com"`, and `afterEach` deletes it.
  - These tests also pin W0's lookup rules through the public query (regression coverage, not a re-implementation).
  - Identities:
    - `ADMIN = {subject:'u-admin', tokenIdentifier:'clerk|u-admin', email:'boss@agency.com', emailVerified:true}`
    - `ALICE`, the same shape with `email:'alice@agency.com'`
    - `ALICE_UNVERIFIED`, which is `ALICE` with `emailVerified:false`
  - Tests:
    - `bootstrap admin is an admin with an empty table`: `getMyMembership` as ADMIN returns `{email:'boss@agency.com', role:'admin', isBootstrapAdmin:true}`.
    - `getMyMembership returns null for signed-out and non-members`: this covers no identity and ALICE before she is added.
    - `admin adds a member with messy casing`:
      - `addMember({email:' Alice@Agency.COM ', role:'member'})` → `{ok:true, created:true}`.
      - Then `getMyMembership` as ALICE → `role:'member'`.
      - The table row has `email === 'alice@agency.com'` and `addedBy === 'boss@agency.com'`.
    - `unverified email is not a member`: ALICE_UNVERIFIED → `getMyMembership` is `null`, and `listMembers` rejects `/MARKETING_FORBIDDEN/`.
    - `re-adding upserts the role`: adding ALICE as `'admin'` → `created:false`, and her role is now `'admin'`.
    - `member cannot add or remove`: as ALICE (member), `addMember` and `removeMember` reject `/MARKETING_FORBIDDEN/`.
    - `listMembers includes the bootstrap admin once`: the bootstrap admin is synthesized with `addedBy:'env'` when there's no row, and appears once when a row exists.
    - `admin cannot remove the bootstrap admin or themselves`: both reject `/MARKETING_INVALID/`.
    - `removed member loses access immediately`: after `removeMember({email:'alice@agency.com'})`, ALICE's `getMyMembership` is `null`.
    - `invalid email rejected`: `addMember({email:'nope', role:'member'})` rejects `/MARKETING_INVALID/`.
    - `addMember storage matches W0 lookup`: after adding `' Alice@Agency.COM '`, `t.run(ctx => findMarketingMemberByEmail(ctx, 'alice@agency.com'))` returns the row (pins that `normalizeMarketingEmail` and W0's normalization agree).
    - `errors carry object data`: the caught `ConvexError.data` deep-equals `{code:'MARKETING_FORBIDDEN'}` for a member calling `addMember`.
- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run --config vitest.config.mts convex/__tests__/marketingMembers.test.ts`. Expected: FAIL, because `api.marketing.members` is undefined.
- [ ] **Step 3: Implement the access additions and `members.ts`.**
  - Membership resolution (identity, `emailVerified`, bootstrap admin, `by_email` lookup) is W0's `getMyMembership(ctx)`; W2 does not duplicate it. `members.getMyMembership` adds `isBootstrapAdmin` via `isBootstrapAdminEmail`.
  - `requireMarketingAdmin` throws `new ConvexError({ code: 'MARKETING_FORBIDDEN' })`, the same shape as W0's `requireMarketingMember`.
  - Writes throw `ConvexError({code:'MARKETING_INVALID', field:'email', reason})`, where `reason` is `'invalid' | 'protected'`.
  - Add no `internal*` functions. That keeps `scripts/data/sentry-convex-internal-probe-filters.txt` unchanged.
- [ ] **Step 4: Register the module** by running `npx convex codegen` (Resolution 17). Do the same after Tasks 3 and 4 and after every rebase; on a conflict in `convex/_generated/`, take the base version and re-run codegen, never hand-merge.
  - If codegen cannot run for lack of a deployment, stop and report it as a blocker rather than hand-editing.
- [ ] **Step 5: Run the test and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 6: Run the checks.**
  - `npx tsc --noEmit -p convex/tsconfig.json`
  - `node --import tsx --test tests/convex-entrypoint-hygiene.test.mjs`
  - `node scripts/sync-sentry-convex-probe-filters.mjs --check`
  - Expected: all clean.
- [ ] **Step 7: Commit** `convex/marketing/access.ts convex/marketing/members.ts convex/_generated/ convex/__tests__/marketingMembers.test.ts` with the message `feat(marketing): member allowlist with admin-only writes`.

### Task 3: Client roster functions

**Files:**
- Create: `convex/marketing/clients.ts`
- Regenerate: `convex/_generated/api.d.ts`
- Test: `convex/__tests__/marketingClients.test.ts`

**Interfaces:**
- Consumes: `requireMarketingMember` (Task 2), `normalizeClientInput` / `MarketingClientInput` (Task 1), `MarketingClient` (index), and the `marketingClients` table.
- Produces:
```ts
export const listClients: query({ includeArchived?: boolean }) => MarketingClient[];   // member-only; sorted by name (case-insensitive); archived excluded by default; capped at 1000
export const createClient: mutation({ client: MarketingClientInput }) => { id: string };
export const updateClient: mutation({ id: Id<'marketingClients'>; client: MarketingClientInput }) => { ok: true };
export const archiveClient: mutation({ id: Id<'marketingClients'> }) => { ok: true };   // sets active=false
export const restoreClient: mutation({ id: Id<'marketingClients'> }) => { ok: true };   // sets active=true
```
- The Convex arg validator for `client` mirrors `MarketingClientInput`:
  - `category` is a `v.union` of `v.literal` over `MARKETING_CATEGORIES`.
  - `accountManagerEmail` is `v.union(v.string(), v.null())`.
  - `locations[].id` is `v.optional(v.string())`.

- [ ] **Step 1: Write the failing tests** in `convex/__tests__/marketingClients.test.ts`.
  - Use the same env and identities as Task 2, adding ALICE as a member through `t.run(ctx => ctx.db.insert('marketingMembers', …))`.
  - Tests:
    - `signed-out and non-member are forbidden`: with no identity and with `OUTSIDER` (verified, not added), each of `listClients`, `createClient`, `updateClient` and `archiveClient` rejects `/MARKETING_FORBIDDEN/`.
    - `member creates and lists a client`:
      - `createClient` as ALICE returns `{id}`, and `id` matches `/^[A-Za-z0-9_-]{1,64}$/` (Resolution 12).
      - `listClients` returns one client with `id === id`, `active === true`, and normalized fields (`stateCode 'TX'`).
      - Every location has a non-empty `id`, generated with `crypto.randomUUID()` when it's missing.
      - The row has `updatedBy === 'alice@agency.com'` and a numeric `updatedAt`.
    - `client with zero locations is allowed`.
    - `invalid input rejected with field`: `lat: 91` rejects, and the caught `ConvexError` `data` deep-equals `{code:'MARKETING_INVALID', field:'locations.0.lat', reason:'out_of_range'}`.
    - `update preserves existing location ids`: update with the same location `id` and a new radius → the `id` is unchanged and the radius is updated.
    - `archive hides from default list; includeArchived shows it`. Then `restoreClient` makes it visible again.
    - `update of a missing id rejects` → `/MARKETING_INVALID/`, with `field:'id'`.
    - `list is sorted case-insensitively`: `'beta'` and `'Alpha'` come back as `['Alpha','beta']`.
    - `removed member is forbidden on next call`: delete ALICE's row, then `listClients` rejects `/MARKETING_FORBIDDEN/`.
- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run --config vitest.config.mts convex/__tests__/marketingClients.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `clients.ts`.**
  - Each handler calls `requireMarketingMember(ctx)` first.
  - Writes run `normalizeClientInput` and, on failure, throw `ConvexError({code:'MARKETING_INVALID', field, reason})`.
  - The mapper `toMarketingClient(doc)` sets `id: doc._id` and drops `_id`, `_creationTime`, `updatedAt` and `updatedBy`.
  - Register the module with `npx convex codegen`, as in Task 2, Step 4.
- [ ] **Step 4: Run the test and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(marketing): convex client roster CRUD`.

### Task 4: Census geocoder action

**Files:**
- Create: `shared/marketing/geocode.ts`
- Create: `convex/marketing/geocode.ts`
- Regenerate: `convex/_generated/api.d.ts`
- Test: `tests/marketing-geocode-parse.test.mts`, `convex/__tests__/marketingGeocode.test.ts`

**Interfaces:**
- Consumes: `api.marketing.members.getMyMembership` (Task 2).
- Produces:
```ts
// shared/marketing/geocode.ts
export const CENSUS_ONELINE_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
export type GeocodeResult =
  | { status: 'ok'; lat: number; lon: number; matchedAddress: string; city: string; stateCode: string }
  | { status: 'no_match' }
  | { status: 'unavailable' };
export function buildCensusOnelineUrl(address: string): string; // ?address=<enc>&benchmark=Public_AR_Current&format=json
export function parseCensusOnelineResponse(json: unknown): GeocodeResult; // first addressMatches[] entry; never throws
// convex/marketing/geocode.ts
export const geocodeAddress: action({ address: string }) => GeocodeResult; // throws MARKETING_FORBIDDEN for non-members
```

- [ ] **Step 1: Write the failing parse tests** in `tests/marketing-geocode-parse.test.mts`.
  - The fixture is the real response captured 2026-10-21 for `1600 Pennsylvania Ave NW, Washington, DC 20500`. It has `addressMatches[0].coordinates {x:-77.035189204737, y:38.898702605245}`, `addressComponents {city:'WASHINGTON', state:'DC'}` and `matchedAddress '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500'`. Parsing it gives:
    - `status:'ok'`
    - `lat` 38.898702605245 and `lon` -77.035189204737. `y` is lat and `x` is lon.
    - `city:'Washington'` (title case)
    - `stateCode:'DC'`
  - `{result:{addressMatches:[]}}` gives `no_match`.
  - `null`, `{}`, and a match whose `x` is a string give `no_match`, without throwing.
  - `buildCensusOnelineUrl('1 Main St, Austin, TX')` contains `address=1%20Main%20St%2C%20Austin%2C%20TX`, `benchmark=Public_AR_Current` and `format=json`.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-geocode-parse.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement `shared/marketing/geocode.ts`.** Use no imports.
- [ ] **Step 4: Write the failing action tests** in `convex/__tests__/marketingGeocode.test.ts`.
  - Use `vi.stubGlobal("fetch", …)`, the same pattern as `convex/__tests__/accountDeletionRetries.test.ts:50`.
  - Tests:
    - `non-member is forbidden and fetch is never called`.
    - `member gets ok result`: the stub returns the Step 1 fixture. Assert:
      - The request URL starts with `CENSUS_ONELINE_URL`.
      - The `User-Agent` header equals `MarketingSituationRoom/1.0 (+mailto:ops@agency.com)` when `MARKETING_CONTACT_EMAIL=ops@agency.com` (Resolution 6 format), and is `MarketingSituationRoom/1.0` when unset.
      - The result has `status:'ok'`.
    - `upstream 500 → unavailable`.
    - `fetch rejects (timeout) → unavailable`.
    - `blank or over-200-char address → MARKETING_INVALID` without calling fetch.
- [ ] **Step 5: Implement the `geocodeAddress` action.**
  - Gate on `ctx.runQuery(api.marketing.members.getMyMembership, {})`.
  - Build the `User-Agent` in the same format as W0's `marketingUserAgent()` (Resolution 6): `MarketingSituationRoom/1.0 (+mailto:${MARKETING_CONTACT_EMAIL})` from the Convex env var, or `MarketingSituationRoom/1.0` when unset. A small local `geocodeUserAgent()` in this file; Convex does not import `server/worldmonitor/` (see Contract Issues, new item A).
  - Time out after 8 s through `AbortController` + `setTimeout`.
  - On a non-OK status or a thrown error, return `{status:'unavailable'}` and `console.warn('[marketing/geocode] degraded', status)`. Never log the address.
  - Register the module with `npx convex codegen`.
- [ ] **Step 6: Run both tests and confirm they pass.**
  - `node --import tsx --test tests/marketing-geocode-parse.test.mts`
  - `npx vitest run --config vitest.config.mts convex/__tests__/marketingGeocode.test.ts`
  - Expected: PASS.
- [ ] **Step 7: Commit** with the message `feat(marketing): census geocoder action for members`.

### Task 5: Browser roster, members and geocode services

**Files:**
- Replace body: `src/services/marketing/roster.ts`
- Create: `src/services/marketing/members.ts`, `src/services/marketing/geocode.ts`
- Test: `tests/marketing-roster-service.test.mts`

**Interfaces:**
- Consumes:
  - `getConvexClient`, `getConvexApi`, `waitForConvexAuth` from `src/services/convex-client.ts`
  - `getCurrentClerkUser` from `src/services/clerk.ts`
  - `api.marketing.{clients,members,geocode}.*` (Tasks 2–4)
  - `DEV_CLIENTS` (W0)
- Produces (the index's `getClients`, `subscribeClients`, `getRosterStatus` and `onRosterStatusChange` keep their exact W0 signatures, Resolution 18):
```ts
// roster.ts
export type RosterStatus = 'loading' | 'ready' | 'forbidden' | 'error';          // index contract (W0)
export function getClients(): Promise<MarketingClient[]>;                       // index contract; active clients only
export function subscribeClients(cb: (clients: MarketingClient[]) => void): () => void; // index contract; active clients only
export function getRosterStatus(): RosterStatus;                                // index contract; W2 makes it real
export function onRosterStatusChange(cb: (s: RosterStatus) => void): () => void; // index contract
// W2 extension for the roster panel's copy; other panels need only getRosterStatus
export interface RosterDetail { source: 'convex' | 'fixtures' | 'none'; reason: 'signed-out' | 'not-member' | 'no-convex' | 'network' | null }
export function getRosterDetail(): RosterDetail;
export function createClient(input: MarketingClientInput): Promise<string>;
export function updateClient(id: string, input: MarketingClientInput): Promise<void>;
export function archiveClient(id: string): Promise<void>;
export class RosterWriteError extends Error { code: 'MARKETING_FORBIDDEN' | 'MARKETING_INVALID' | 'UNAVAILABLE'; field?: string; reason?: string }
export function extractMarketingErrorData(err: unknown): { code: string; field?: string; reason?: string } | null; // reads err.data as string | {code} | {kind}
export function __setRosterDepsForTests(deps: Partial<RosterDeps> | null): void;  // getClient, getApi, waitForAuth, loadFixtures
// members.ts
export type { MarketingRole, MarketingMembership } from '../../../convex/marketing/access'; // type-only re-export
export interface MarketingMemberRow { email: string; role: MarketingRole; addedBy: string; addedAt: number; isBootstrapAdmin: boolean }
export function getMyMembership(): Promise<MarketingMembership | null>;
export function listMembers(): Promise<MarketingMemberRow[]>;
export function addMember(email: string, role: MarketingRole): Promise<void>;     // throws RosterWriteError
export function removeMember(email: string): Promise<void>;
// geocode.ts
export function geocodeAddress(address: string): Promise<GeocodeResult>;          // 'unavailable' when no Convex client
```

- [ ] **Step 1: Write the failing tests** in `tests/marketing-roster-service.test.mts`.
  - Use node:test and inject a fake `ConvexClientLike`, the same seam style as `tests/followed-countries-service.test.mjs`.
  - The fake `onUpdate(ref, args, onResult, onError)` records calls and returns an unsubscribe spy.
  - Cases:
    - `no convex client and fixtures loader → status 'ready', detail.source 'fixtures', fixtures delivered`. Inject `loadFixtures: async () => [fixture]`.
    - `fixtures with an inactive client → that client is not delivered` (Resolution 12).
    - `no convex client, no fixtures → status 'error', detail.reason 'no-convex', []`.
    - `auth not ready → status 'forbidden', detail.reason 'signed-out', [] delivered, onUpdate never called`.
    - `onUpdate result → status 'ready' and clients delivered to every subscriber; one onUpdate for many subscribers`.
    - `onError with data {code:'MARKETING_FORBIDDEN'} → status 'forbidden', detail.reason 'not-member', subscribers receive []`. This pins that revoked access clears stale roster data.
    - `onError with any other error → status 'error', detail.reason 'network', subscribers receive []`.
    - `onRosterStatusChange does not fire on subscribe and fires once per distinct change`.
    - `last unsubscribe tears down the Convex watch`.
    - `createClient maps MARKETING_INVALID data to RosterWriteError with field`.
    - `extractMarketingErrorData handles 'MARKETING_FORBIDDEN' string data, {code}, {kind}, and non-errors → null`.
    - `fixtures mode writes apply in memory and notify subscribers`.
- [ ] **Step 2: Run the test and confirm it fails.** Run `node --import tsx --test tests/marketing-roster-service.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement the three services.**
  - Keep one shared watch with a fan-out to subscribers.
  - The default `loadFixtures` must keep W0's exact guard, `if (import.meta.env.DEV) { const m = await import('./dev-fixtures'); ... }`. Vite folds `import.meta.env.DEV` to `false` and drops the chunk. Tests always inject `loadFixtures`, so tsx never evaluates `import.meta.env`.
  - The fixture path runs only when `getConvexClient()` returns `null`.
  - The default `waitForAuth` is `waitForConvexAuth`.
  - Re-subscribe when Clerk auth changes, the same way `followed-countries.ts` listens.
- [ ] **Step 4: Run the test and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Run the checks.** Run `npm run typecheck` and then `npm run lint:boundaries`. Expected: clean.
- [ ] **Step 6: Commit** with the message `feat(marketing): convex-backed roster service`.

### Task 6: ClientRosterPanel states and list

**Files:**
- Replace: `src/components/marketing/ClientRosterPanel.ts`
- Modify: `src/locales/en.json` (`marketing.roster.*` only), then `npm run sync:locales`
- Test: `tests/dom/client-roster-panel.test.mts`

**Interfaces:**
- Consumes: the roster service (Task 5), `renderNoClientsState()` and `renderSourceUnavailable()` from W0's `src/components/marketing/empty-state.ts`, and W0's `marketing.category.<id>` keys. `members.getMyMembership` is used to show the Team button.
- Produces: `export class ClientRosterPanel extends Panel`, with a zero-argument constructor (`super({ id: 'client-roster', title: t('marketing.roster.title'), showCount: true })`), to match W0's `importPanel(..., (P) => new P())` wiring. Its `destroy()` unsubscribes both service listeners.
- State mapping (status + `getRosterDetail()`):
  - `loading` → `showLoading()`
  - `ready` with zero clients → `renderNoClientsState()` plus the `[data-action="add-client"]` button
  - `ready` with `source 'fixtures'` → list plus the Dev fixtures badge
  - `forbidden` → `signedOut` copy for reason `signed-out`, else `forbidden` copy
  - `error` → `unavailable` copy for reason `no-convex`, else `renderSourceUnavailable()`
- Exact English copy (W2 keys; "Add your first client" comes from W0's `marketing.empty.noClients`):
  - `marketing.roster.emptyHint`: "Clients you add here drive the map, alerts and every panel."
  - `marketing.roster.forbidden`: "You don't have access to this workspace."
  - `marketing.roster.unavailable`: "Roster unavailable. Convex is not configured."
  - `marketing.roster.signedOut`: "Sign in to see the client roster."
  - `marketing.roster.fixtures`: "Dev fixtures"
  - `marketing.roster.noLocation`: "No location"

- [ ] **Step 1: Write the failing DOM tests.**
  - Mock `@/services/marketing/roster` and `@/services/marketing/members` with `vi.mock`.
  - Initialise i18n with `initTestI18n` from `tests/dom/helpers/i18n.mts`. The pattern is in `tests/dom/service-status-empty.test.mts`.
  - Tests:
    - `empty ready roster shows Add your first client, not a spinner`:
      - Status is `'ready'` and the clients list is `[]`.
      - The text contains `tt('marketing.empty.noClients')` (rendered by W0's `renderNoClientsState`).
      - `.panel-loading` is `null`.
      - The button `[data-action="add-client"]` exists.
    - `lists clients sorted with location counts; zero-location client shows No location badge`.
    - `forbidden status shows forbidden copy and no client names`:
      - Clients are first delivered with `'Fixture Acme'`, then the status flips to `'forbidden'` with `[]`.
      - `document.body.textContent` does not contain `'Fixture Acme'`.
    - `forbidden/signed-out and error/no-convex show their copy; error/network shows tt('marketing.common.sourceUnavailable')`.
    - `ready with source 'fixtures' shows the Dev fixtures badge`.
    - `category labels come from marketing.category.<id>`.
    - `destroy unsubscribes` (the unsubscribe spies are each called once).
- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run --config vitest.dom.config.mts tests/dom/client-roster-panel.test.mts`. Expected: FAIL, because the placeholder renders `comingSoon`.
- [ ] **Step 3: Implement the panel.**
  - `loading` shows `showLoading()`, and every other status renders through `setContentNodes(h(...))`.
  - Clicks are handled by one delegated `click` listener on `this.content`, which reads `data-action` and `data-client-id`.
  - `setCount(activeClients.length)`.
  - Add the en keys, run `npm run sync:locales`, then `npm run locales:zh-tw:check`; if it flags zh-TW, run `npm run locales:zh-tw` (Resolution 1).
- [ ] **Step 4: Run the tests and confirm they pass.**
  - The same DOM command
  - `node --import tsx --test tests/locale-completeness.test.mjs`
  - Expected: PASS.
- [ ] **Step 5: Commit** `src/components/marketing/ClientRosterPanel.ts src/locales/ tests/dom/client-roster-panel.test.mts` with the message `feat(marketing): client roster panel list and empty state`.

### Task 7: Add/edit form with geocode lookup and archive

**Files:**
- Create: `src/components/marketing/client-roster-form.ts`
- Modify: `src/components/marketing/ClientRosterPanel.ts`, `src/locales/en.json` (+ sync)
- Test: `tests/dom/client-roster-panel.test.mts` (extend)

**Interfaces:**
- Consumes: `createClient`, `updateClient`, `archiveClient`, `RosterWriteError` (Task 5), `geocodeAddress` (Task 5), and `normalizeClientInput`, `parseTermList`, `CLIENT_INPUT_LIMITS` (Task 1).
- Produces:
```ts
export interface ClientFormHandle { element: HTMLElement; read(): MarketingClientInput; showFieldError(field: string, message: string): void; setBusy(busy: boolean): void }
export function buildClientForm(initial: MarketingClient | null, onLookup: (locationIndex: number) => void): ClientFormHandle;
```
- Each form control carries a `data-field` attribute equal to the validator field path: `name`, `category`, `accountManagerEmail`, `competitors`, `keywords`, `locations.N.label|address|city|stateCode|lat|lon|serviceRadiusMiles`.
- The form uses a `<select>` built from `MARKETING_CATEGORIES`, with labels from W0's `marketing.category.<id>` keys. Competitors and keywords are textareas parsed with `parseTermList`. The Look up button is `[data-action="lookup"][data-index=N]`.

- [ ] **Step 1: Extend the DOM tests.**
  - `add client submits normalized input`:
    - Click `add-client` and fill in `name`, `category=roofing`, `competitors="A, b ,a"`, and one location.
    - Click `[data-action="save"]`.
    - `createClient` is called with `competitors: ['A','b']`.
    - The view returns to the list.
  - `client-side validation blocks save and marks field`:
    - Set `locations.0.lat = 95`, then save.
    - `createClient` isn't called.
    - `[data-field="locations.0.lat"]` has `aria-invalid="true"`.
  - `server MARKETING_INVALID keeps form values and marks field`: `createClient` rejects `new RosterWriteError({code:'MARKETING_INVALID', field:'name', reason:'too_long'})`.
  - `lookup fills coordinates, city and state`: the `geocodeAddress` mock returns an ok result, and the lat, lon, city and stateCode inputs are filled.
  - `lookup no_match / unavailable shows message and leaves manual fields editable`:
    - The text contains `tt('marketing.roster.geocodeNoMatch')` (or `geocodeUnavailable`).
    - The lat input is not disabled.
    - Saving with manually typed coordinates still calls `createClient`.
  - `save with zero locations is allowed`.
  - `edit pre-fills and calls updateClient(id, input)`.
  - `archive asks for confirmation and calls archiveClient`: with `vi.spyOn(window, 'confirm').mockReturnValue(true)`, archive is called. With `false`, it is not.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run --config vitest.dom.config.mts tests/dom/client-roster-panel.test.mts`. Expected: the new tests fail.
- [ ] **Step 3: Implement `buildClientForm` and the panel wiring.**
  - Save runs `normalizeClientInput` before calling the service.
  - Disable Save while it's busy.
  - Lookup joins `address, city, stateCode`.
  - New location ids come from `crypto.randomUUID()` in the form only when they're missing. Otherwise the server assigns them.
  - Add the keys for the form labels and these strings, then sync the locales:
    - `marketing.roster.geocodeNoMatch`: "Address not found. Enter latitude and longitude manually."
    - `marketing.roster.geocodeUnavailable`: "Geocoder unavailable. Enter latitude and longitude manually."
    - `marketing.roster.archiveConfirm`: "Archive {{name}}? It will stop appearing on the map and in alerts."
- [ ] **Step 4: Run the checks.** Run the DOM tests, then `npm run typecheck`, then `npm run lint`. Expected: PASS and clean, including safe-html.
- [ ] **Step 5: Commit** with the message `feat(marketing): roster add/edit form with census lookup`.

### Task 8: Admin team section

**Files:**
- Create: `src/components/marketing/client-roster-team.ts`
- Modify: `src/components/marketing/ClientRosterPanel.ts`, `src/locales/en.json` (`marketing.team.*`, + sync)
- Test: `tests/dom/client-roster-panel.test.mts` (extend)

**Interfaces:**
- Consumes: `getMyMembership`, `listMembers`, `addMember`, `removeMember` (Task 5).
- Produces: `export function buildTeamSection(rows: MarketingMemberRow[], me: MarketingMembership, handlers: { onAdd(email: string, role: MarketingRole): void; onRemove(email: string): void }): HTMLElement`

- [ ] **Step 1: Extend the DOM tests.**
  - `Team button only for admins`: with `getMyMembership` returning a member, `[data-action="team"]` is absent. With an admin, it is present.
  - `admin adds member`: fill `[data-field="member-email"]` and pick role `member` → `addMember('x@agency.com','member')`, and the list refreshes.
  - `bootstrap admin and self rows have no remove button`.
  - `remove calls removeMember after confirm`.
  - `addMember MARKETING_INVALID shows inline error`.
- [ ] **Step 2: Run the tests and confirm they fail.** Same DOM command. Expected: FAIL.
- [ ] **Step 3: Implement `buildTeamSection` and the panel's `team` view.** The `team` view lists members by email and role, with the badge `marketing.team.bootstrap` ("Workspace owner").
- [ ] **Step 4: Run the checks.** Run the DOM tests, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(marketing): admin team management in roster panel`.

### Task 9: Full verification, privacy check and PR

- [ ] **Step 1:** Run each of these one at a time and record the results:
  - `npx vitest run --config vitest.config.mts convex/__tests__/marketingMembers.test.ts convex/__tests__/marketingClients.test.ts convex/__tests__/marketingGeocode.test.ts`
  - `npm run test:convex`
  - `npm run typecheck`
  - `npm run typecheck:api`
  - `npx tsc --noEmit -p convex/tsconfig.json`
  - `npm run typecheck:dom-tests`
  - `npm run lint`
  - `npm run lint:boundaries`
  - `npm run test:dom`
  - `npm run test:data`
  - `git diff --check`
  - Expected: all green. Report any failure verbatim.
- [ ] **Step 2: Privacy.** Run `npm run build:marketing && grep -rl "Fixture " dist/ ; echo exit=$?`.
  - Expected: no files, and `exit=1`.
  - Also confirm that no other variant changed: `npm run build` succeeds, and `git diff --stat main -- src/config/variants` is empty.
- [ ] **Step 3: Live check (`verify-worldmonitor` skill).**
  - Run `npm run dev:marketing` without `VITE_CONVEX_URL`, then capture the roster panel showing:
    - fixtures
    - the add form
    - a geocode no-match message
    - the empty state, using an empty fixture override in the browser console
  - Capture desktop and mobile widths.
  - If a dev Convex deployment is available, also capture a real create → list round trip. Otherwise record this as unverified.
- [ ] **Step 4: Open the PR to the fork's `main`, following [PR delivery](../../../CONTRIBUTING.md#pull-request-process).**
  - Rebase on the latest base first; then re-run `npx convex codegen` and `npm run sync:locales` (Resolutions 1, 17) and re-run the Step 1 checks if either changed files.
  - Attach the screenshots with `gh pr edit <n> --attach '/abs/path.png#...'`.
  - In the body, list what is verified and what is not. The not-yet-verified items are: live Census and Convex in production, and `MARKETING_DEPLOY` gating, which is W9.
  - End the body with the attribution line.

---

## Contract Issues (resolved)

1. `MARKETING_FORBIDDEN` error shape -> Resolution 15 (`ConvexError({ code: 'MARKETING_FORBIDDEN' })`).
2. Email-verification rule -> Resolution 15 (trim + lowercase, `emailVerified === true`, implemented in W0's `access.ts`; W2 consumes `getMyMembership(ctx)` / `findMarketingMemberByEmail` and drops its planned `resolveMarketingMember`).
3. Locale fallback vs completeness test -> Resolution 1 (`sync:locales`, `locales:zh-tw` if flagged, take base and re-sync on conflict).
4. `convex/_generated/api.d.ts` ownership -> Resolution 17 (regenerate with `npx convex codegen`; no hand edits).
5. Shared empty-state helper and key -> Resolution 18 (W0's `renderNoClientsState()`, `marketing.empty.noClients`; W2 drops `marketing.roster.empty`).
6. Category display labels -> Resolution 18 (W0's `marketing.category.<id>`; W2 no longer adds them).
7. User-Agent contact -> Resolution 6 (format adopted; see new item A for Convex).
8. Members-management UI owner -> Resolution 19 (Team view in `ClientRosterPanel`); helper files beside the owner's file per Resolution 7.
9. Roster status exports -> Resolution 18 (W0's `'loading'|'ready'|'forbidden'|'error'` type kept; W2 adds `getRosterDetail()` for its own panel copy only).

New, unresolved:

A. **Convex geocode User-Agent.** Resolution 6's `marketingUserAgent()` lives in `server/worldmonitor/marketing/v1/` and throws in production when `MARKETING_CONTACT_EMAIL` is unset; Convex has its own env and no shared "production" signal. W2 builds the same string locally in `convex/marketing/geocode.ts` and falls back to `MarketingSituationRoom/1.0` without throwing. Confirm, or move the formatter into `shared/marketing/` so both import it.
