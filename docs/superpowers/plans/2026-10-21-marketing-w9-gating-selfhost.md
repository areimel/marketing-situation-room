# W9 Deploy Flag, Gating & Self-Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `MARKETING_DEPLOY=1` / `VITE_MARKETING_DEPLOY=1` turn a deploy into a members-only, single-variant `marketing` room. Members get Pro features without a subscription, and the room runs from `docker compose up` with a notification relay. With both flags unset, nothing changes.

**Architecture:**
- **Flag readers.** Two readers (`isMarketingDeploy()` on the server, `MARKETING_DEPLOY` in the browser) gate every behaviour in this plan.
- **Gateway.** A new server resolver, `resolveMarketingMember()`, verifies the Clerk bearer and asks Convex, through the public membership query W0 exposes over `getMyMembership(ctx)` in `convex/marketing/access.ts` (Resolution 15; see Contract Issue N1), whether the caller is a member. The gateway uses the answer in two ways:
  - It **requires** membership on `MarketingService` RPCs. A valid `WORLDMONITOR_VALID_KEYS` service key also passes, so the W8 relay can call them (Resolution 21).
  - It lets a member **bypass** the Pro gates. The verified-member flag joins the existing `internalMcpVerified` short-circuits, so the bypass reuses that pattern.
- **Convex.** The existing `assertProEntitlement` checks get the same member bypass.
- **Browser.** Variant detection is forced to `marketing`, and an access gate in `App.init()` stops boot until the visitor is a member. Non-members see a sign-in screen or a request-access screen.
- **Self-hosting.** A `notification-relay` compose service and `docs/marketing-setup.md` complete the self-hosted stack.

**Tech Stack:**
- TypeScript: browser, Edge gateway and Convex.
- Auth and data: jose for Clerk JWT verification, and `convex/browser` `ConvexHttpClient`.
- Tests: node:test via tsx, vitest (DOM and convex-test).
- Deploy: Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md` (Decided → Marketing-only deployment, Access; W9). Shared contracts are in `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

- Every task inherits **Global Constraints** and **Shared Contracts** from `2026-10-21-marketing-00-index.md`.
- **Flag off:** behaviour must be byte-for-byte unchanged when `MARKETING_DEPLOY`/`VITE_MARKETING_DEPLOY` are unset. Every task carries a flag-off test.
- **Flag values:** a flag is truthy only for the values `'1'` and `'true'`. Any other value, including `''`, counts as off.
- **Reading the flag:**
  - Server code reads it only through `isMarketingDeploy()` (`shared/marketing/deploy-flag.ts`).
  - Browser code reads it only through `MARKETING_DEPLOY` (`src/config/marketing.ts`).
- **Pro bypass scope:** the bypass applies only to a **verified Clerk session (`emailVerified === true`) whose email is a marketing member**. It never applies to anonymous `wms_` sessions, enterprise keys or `wm_` user keys. `api/_api-key.js` must not widen any credential.
- **Member-RPC service key (Resolution 21):** an enterprise key from `WORLDMONITOR_VALID_KEYS` satisfies the *member requirement* on `MarketingService` RPCs only. It grants no Pro bypass anywhere else.
- **Consumed from W0, not rebuilt here:**
  - `isMarketingDeploy()`, which already reads the env for real (Resolution 11).
  - `scripts/lib/marketing-deploy-flag.cjs` and its sync test (Resolution 11).
  - `requireMarketingMember`, `findMarketingMemberByEmail` and `getMyMembership` in `convex/marketing/access.ts` (Resolution 15).
  - The private, no-store `RPC_CACHE_TIER` entries for `MarketingService` (Resolution 5).
  - `api.ts` routing through `premiumFetch` (Resolution 8).
- **Errors:** Convex membership errors are `ConvexError({ code: 'MARKETING_FORBIDDEN' })`. Match on `data.code`, never on the message (Resolution 15).
- **Privacy:** gateway and resolver logs never include client names, query terms or request bodies (Resolution 5).
- **Locales:** after editing `en.json`, run `npm run sync:locales`. If zh-TW is flagged, also run `npm run locales:zh-tw`. On a rebase conflict, take base and re-run (Resolution 1).
- **No public host mapping:** don't touch the `index.html` prepaint or `middleware.ts` `VARIANT_HOST_MAP` (Resolution 2). The flag forces the variant in `variant.ts` instead.
- **`convex/_generated/`:** never edit it by hand. Regenerate it with `npx convex codegen` after each rebase (Resolution 17).
- **Ownership:** do not edit `scripts/notification-relay.cjs`, because the relay Pro filter, the evaluator and the shared-channel send belong to W8 (Resolution 21).
- **Ownership:** do not edit `convex/marketing/{access,members,clients,alerts}.ts` (W0/W2/W8), `src/services/marketing/{roster,focus,api,dev-fixtures}.ts` (W0/W2/W3), `shared/marketing/deploy-flag.ts` (W0), or any panel file.
- **Branch base:** branch from W0's merge commit. Before opening the PR, rebase on W2 so the build uses W2's `requireMarketingMember`.

## Review Focus

1. **A signed-in non-member calls a `MarketingService` RPC directly** (curl with a valid Clerk JWT). Expected: 403 `MARKETING_FORBIDDEN`, `Cache-Control: no-store`, and no handler invocation (Task 4).
2. **The flag is set but Clerk or Convex is unreachable or misconfigured** (JWKS down, `CLERK_JWT_ISSUER_DOMAIN` unset, Convex 5xx). Expected: RPCs return a retryable 503, never 200 and never a 401 that loops the session interceptor. The browser shows "sign-in unavailable", with a retry button, instead of a blank page (Tasks 3, 4, 6).
3. **The flag is off and a request carries a Bearer on a premium path.** Expected: today's exact status and headers, and no Convex membership lookup is made (Task 4).
4. **A member signs out while the room is open.** Expected: the page reloads into the sign-in screen, and no roster stays rendered (Task 6).
5. **Email case and whitespace** (`Alice@Agency.com ` in the Clerk claim vs `alice@agency.com` in `marketingMembers`). Expected: the email counts as a member everywhere: gateway, Convex bypass and browser gate (Tasks 2, 3). An unverified email (`emailVerified !== true`) is never a member (Resolution 15).
6. **The relay calls a `MarketingService` RPC with a `WORLDMONITOR_VALID_KEYS` key and no Bearer.** Expected: 200. The same key on a premium non-marketing path keeps today's behaviour (Task 4).

---

### Task 1: Browser flag reader and member-RPC path predicate

`isMarketingDeploy()` is W0's real env reader from day one (Resolution 11), so this task consumes it and does not edit `shared/marketing/deploy-flag.ts`.

**Files:**
- Modify: `src/config/marketing.ts`. W0 created `MARKETING_DEPLOY` as a `false` stub; the index's Shared Contracts give W9 the behaviour. If W0's merged version already reads the env, keep it and add only `shouldShowVariantSwitcher`.
- Modify: `src/shared/premium-paths.ts`. Append the new exports **after** the `PREMIUM_RPC_PATHS` Set literal (end of file, after line 131). Do not edit the Set itself, because `readPremiumRpcPaths()` in `scripts/lib/openapi-codegen.mjs:443` regex-parses that block.
- Test: `tests/marketing-deploy-flag.test.mts`

**Interfaces:**
- Consumes: `isMarketingDeploy(env?)` from `shared/marketing/deploy-flag.ts` (W0). The test pins that it is true only for `'1'`/`'true'` after trimming, which guards Global Constraint "Flag values".
- Produces:
  - `MARKETING_DEPLOY: boolean`, true when `import.meta.env.VITE_MARKETING_DEPLOY` is `'1'` or `'true'`. Wrap the read in try/catch so that tsx/node imports read `false`.
  - `shouldShowVariantSwitcher(): boolean`, which returns `!MARKETING_DEPLOY`.
  - `MARKETING_MEMBER_RPC_PREFIX = '/api/marketing/v1/'`
  - `isMarketingMemberRpcPath(pathname: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { isMarketingDeploy } from '../shared/marketing/deploy-flag.ts';
import { isMarketingMemberRpcPath, PREMIUM_RPC_PATHS } from '../src/shared/premium-paths.ts';
import { readPremiumRpcPaths } from '../scripts/lib/openapi-codegen.mjs';
it('W0 flag reader is off unless exactly 1/true (consumed contract)');
it('member path predicate', () => {
  assert.equal(isMarketingMemberRpcPath('/api/marketing/v1/list-weather-alerts'), true);
  assert.equal(isMarketingMemberRpcPath('/api/marketingx/v1/a'), false);
  assert.equal(isMarketingMemberRpcPath('/api/market/v1/analyze-stock'), false);
});
it('marketing paths are not premium and codegen parse is unchanged', () => {
  assert.equal([...PREMIUM_RPC_PATHS].some(p => p.startsWith('/api/marketing/')), false);
  assert.deepEqual(readPremiumRpcPaths().sort(), [...PREMIUM_RPC_PATHS].sort());
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --import tsx --test tests/marketing-deploy-flag.test.mts`
Expected: FAIL, because `isMarketingMemberRpcPath` is not exported. The flag-reader test already passes against W0.

- [ ] **Step 3: Implement the exports listed under Produces**

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --import tsx --test tests/marketing-deploy-flag.test.mts && node --import tsx --test tests/premium-paths-guard.test.mts`
Expected: PASS for both. The browser `MARKETING_DEPLOY` reader is covered by Task 5's DOM tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/marketing.ts src/shared/premium-paths.ts tests/marketing-deploy-flag.test.mts
git commit -m "feat(marketing): browser MARKETING_DEPLOY reader and member RPC predicate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Convex member Pro bypass in `assertProEntitlement`

W9 adds no `gate.ts` (Resolution 15). Membership lookups go through W0's `convex/marketing/access.ts`.

**Files:**
- Create: `convex/lib/marketingProBypass.ts` (helper only; it exports no Convex functions)
- Modify: `convex/alertRules.ts:37-56` (`assertProEntitlement`)
- Modify: `convex/notificationChannels.ts:68-79` (`assertProEntitlement`; leave `hasProEntitlement` at ~line 55 untouched)
- Regenerate: `convex/_generated/` with `npx convex codegen` (Resolution 17). Never edit it by hand.
- Test: `convex/__tests__/marketingGate.test.ts`

**Interfaces:**
- Consumes, from `convex/marketing/access.ts` (W0):
  - `requireMarketingMember(ctx)`, which throws `ConvexError({ code: 'MARKETING_FORBIDDEN' })`.
  - `findMarketingMemberByEmail(ctx, email)`, which does the trim/lowercase, the `by_email` lookup and the bootstrap-admin check.
  - `getMyMembership(ctx)`, which doesn't throw and returns `null` for a non-member, signed-out or unverified caller.
  - The public membership query W0 exposes over `getMyMembership` (Contract Issue N1). W9 refers to it through one constant, `MARKETING_MEMBERSHIP_QUERY` in `server/_shared/marketing-member.ts` (Task 3), and through `api.marketing.access.<name>` in the browser (Task 6).
  - `isMarketingDeploy(process.env)` (W0).
  - Table `users` with index `by_userId` (`convex/schema.ts:961`).
- Produces: `hasMarketingProBypass(ctx: QueryCtx | MutationCtx, userId: string): Promise<boolean>`.
  - It returns false when the flag is off.
  - If the `ctx.auth` identity has `subject === userId`, it returns `(await getMyMembership(ctx)) !== null`. That path enforces `emailVerified === true`.
  - Otherwise (an internal, identity-less caller), it reads `users.by_userId` → `email` and returns `(await findMarketingMemberByEmail(ctx, email)) !== null`. See Contract Issue N2.
  - It contains no email normalization or table lookup of its own.

- [ ] **Step 1: Write the failing tests** (convex-test, `const modules = import.meta.glob("../**/*.ts")`, same setup as `convex/__tests__/alertRules.test.ts`)

```ts
test('flag ON + member (identity email " Alice@Agency.com ", emailVerified true): setAlertRules succeeds without an entitlements row');
test('flag ON + member with emailVerified false: setAlertRules throws PRO_REQUIRED');
test('flag ON + non-member: setAlertRules throws PRO_REQUIRED');
test('flag ON + bootstrap admin (MARKETING_BOOTSTRAP_ADMIN_EMAIL) with no member row: succeeds');
test('flag OFF + member: setAlertRules throws PRO_REQUIRED (unchanged)');
test('flag ON + member via users table: setNotificationConfigForUser (internal, no identity) succeeds');
test('flag ON + member: notificationChannels createPairingToken succeeds without entitlement');
```

Restore `process.env.MARKETING_DEPLOY` and `MARKETING_BOOTSTRAP_ADMIN_EMAIL` in `afterEach`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --config vitest.config.mts convex/__tests__/marketingGate.test.ts`
Expected: FAIL. The flag-ON member cases throw `PRO_REQUIRED`.

- [ ] **Step 3: Implement `hasMarketingProBypass`.** Then make the first line of both `assertProEntitlement` functions `if (await hasMarketingProBypass(ctx, userId)) return;`. Run `npx convex codegen`.

- [ ] **Step 4: Run the new tests and the existing gate suites, and confirm they pass**

Run: `npx vitest run --config vitest.config.mts convex/__tests__/marketingGate.test.ts convex/__tests__/alertRules.test.ts convex/__tests__/notificationChannels.test.ts`
Expected: all PASS. The unchanged suites prove flag-off behaviour. If `notificationChannels.test.ts` does not exist, run `ls convex/__tests__ | grep -i channel` and use the suite it finds.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/marketingProBypass.ts convex/alertRules.ts convex/notificationChannels.ts convex/_generated convex/__tests__/marketingGate.test.ts
git commit -m "feat(marketing): member Pro bypass in Convex assertProEntitlement under MARKETING_DEPLOY

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server member resolver

**Files:**
- Create: `server/_shared/marketing-member.ts`
- Test: `tests/marketing-member-resolver.test.mts`

**Interfaces:**
- Consumes:
  - `validateBearerToken(token)` (`server/auth-session.ts:249`). It returns `{valid, userId, reason?: 'invalid'|'unverifiable'}`.
  - W0's public membership query over `getMyMembership(ctx)` (Resolution 15). It returns `null` or `{ email; role }`, and `null` covers non-member and unverified email. Its string name lives in one constant (Contract Issue N1).
- Produces:
  - `export const MARKETING_MEMBERSHIP_QUERY: string`, the Convex function name. Every server caller uses it, and `typecheck:api`'s `audit-convex-string-calls` sees it.
  - `export type MarketingMemberResolution`, one of:
    - `{ kind: 'member'; userId: string; email: string; role: 'admin'|'member' }`
    - `{ kind: 'signed-out' }`, when there is no Bearer or the token is confirmed invalid.
    - `{ kind: 'not-member'; userId: string }`, when the query returns `null`.
    - `{ kind: 'unavailable' }`, when JWKS or the issuer is unverifiable, `CONVEX_URL` is unset, or Convex throws or times out.
  - `resolveMarketingMember(request: Request): Promise<MarketingMemberResolution>`
  - `__setMarketingMemberDepsForTests(deps: { validateBearerToken?; queryMembership?: (token: string) => Promise<unknown> } | null): void`
  - `__resetMarketingMemberCacheForTests(): void`
- **Approach:**
  - Query Convex with a `ConvexHttpClient(process.env.CONVEX_URL)` and `setAuth(token)`, the same pattern as `api/user-prefs.ts:211-220`, with `fetch` given an `AbortSignal.timeout(3_000)`.
  - Cache `member` and `not-member` answers in memory for 60 s, keyed by `sha256(token)`, with at most 500 entries. Never cache `unavailable`.
  - Coalesce concurrent lookups for the same key into one in-flight promise, as `getEntitlements` does.

- [ ] **Step 1: Write the failing tests**

```ts
it('no Authorization → signed-out, no Convex call');
it('invalid token → signed-out');
it('unverifiable token → unavailable');
it('member → member with lowercased email; second call within 60s makes no Convex call');
it('query returns null (non-member or unverified email) → not-member');
it('Convex throws / CONVEX_URL unset → unavailable, and the next call retries');
it('Convex ConvexError({code:"MARKETING_FORBIDDEN"}) → not-member (defensive; matched on data.code)');
it('no log line contains the token, the email or any request body');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/marketing-member-resolver.test.mts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `resolveMarketingMember` as described in Interfaces**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/marketing-member-resolver.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_shared/marketing-member.ts tests/marketing-member-resolver.test.mts
git commit -m "feat(marketing): server-side Clerk+Convex marketing member resolver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Gateway membership requirement and Pro bypass

**Files:**
- Modify: `server/gateway.ts`, at four anchors:
  - **(a)** Insert a new block after the internal-MCP verify block, which ends at `internalMcpVerified = true;` (~line 1443), and before `const isPublicNoAuthRpc` (~line 1459).
  - **(b)** Add `&& !marketingMemberVerified` to `isTierGated` (~line 1477) and to `needsLegacyProBearerGate` (~line 1487).
  - **(c)** Initialise `let sessionUserId` (~line 1500) to `marketingMember?.userId ?? null`. Add `marketingMemberVerified` to the `keyCheck` short-circuit condition (~line 1528), next to `internalMcpVerified`.
  - **(d)** Add `!marketingMemberVerified &&` to the entitlement-check guard (~line 1908, next to `!internalMcpVerified`).
- Modify: `server/_shared/premium-check.ts`, in the Bearer branch of `resolvePremiumCallerIdentity` (~line 350, after the `session.role === 'pro'` arm). When `isMarketingDeploy()` is true and `resolveMarketingMember(request)` returns `member`, return `{ isPremium: true, userId, kind: 'bearer', quotaExempt: false, directLlmDailyLimit: DIRECT_LLM_UNVERIFIED_DAILY_QUOTA_LIMIT }`.
- Not modified: `api/_api-key.js`. Verified members skip `validateApiKey` through the anchor (c) short-circuit, so no credential kind is widened. Test 7 below pins this. The relay service-key check reuses `validateApiKey`'s existing `kind: 'enterprise'` result and adds no second key parser (Resolution 21).
- Not modified: `RPC_CACHE_TIER`. W0 already gives every `MarketingService` RPC a private, no-store tier under the flag (Resolution 5); test 3 pins it.
- Test: `tests/gateway-marketing-deploy.test.mts`. Use the JWKS and `SignJWT` harness from `tests/gateway-pro-fresh-cache.test.mts:80-115` and the Redis pipeline mock from `tests/gateway-docker-country-brief.test.mts`. Stub Convex through `__setMarketingMemberDepsForTests`.

**Interfaces:**
- Consumes: `isMarketingDeploy()` (W0), `isMarketingMemberRpcPath()` (Task 1), `resolveMarketingMember()` (Task 3), and `validateApiKey` (`api/_api-key.js`) for the enterprise-key result.
- **Block (a) behaviour,** which runs only when `isMarketingDeploy() && !internalMcpVerified`:
  - **Path is a member RPC and the request carries a key that `validateApiKey` classifies as `kind: 'enterprise'`** (`WORLDMONITOR_VALID_KEYS`; Resolution 21): set `marketingServiceKeyVerified = true` and skip the member requirement. Do **not** set `marketingMemberVerified`, so the later `keyCheck`, rate-limit and Pro logic run exactly as today.
  - **Otherwise, path is a member RPC** (`isMarketingMemberRpcPath(pathname)`):
    - `signed-out` → `emitRequest(401,'auth_401')`, then `createGatewayAuthErrorResponse(401, 'Sign in required', corsHeaders)`.
    - `not-member` → `emitRequest(403,'tier_403')`, then a `markAuthErrorNoStore`'d 403 with body `{ error: 'MARKETING_FORBIDDEN' }`.
    - `unavailable` → `emitRequest(503,'billing_verification_503')`, then `sessionVerificationUnavailableResponse(corsHeaders)`. This is the retryable 503 of Resolution 23.
  - No log line in block (a) includes the pathname's request body, the token or the email (Resolution 5).
  - **Path is premium or tier-gated and the request has `Authorization: Bearer`:** resolve membership, and on `member` set the bypass. Any other result falls through to today's logic unchanged.
  - **On `member`:** set `marketingMember` and `marketingMemberVerified = true`, set `usage.sessionUserId`, and set `request = withAuthenticatedUserId(request, userId)`. Later, set `rateLimitPrincipalUserId = userId`.

- [ ] **Step 1: Write the failing tests**

```ts
// flag ON (MARKETING_DEPLOY=1), route '/api/marketing/v1/list-weather-alerts' with a stub handler that counts calls
it('1 signed-out → 401, handler not called');
it('2 non-member JWT → 403 {error:"MARKETING_FORBIDDEN"}, Cache-Control no-store, handler not called');
it('3 member JWT (no wms_ key) → 200, response Cache-Control contains "private" and "no-store" (W0 tier)');
it('4 Convex unavailable → 503 retryable, handler not called');
it('5 member JWT on /api/market/v1/analyze-stock (PREMIUM, free plan, no entitlement) → 200');
it('6 non-member free JWT on analyze-stock → 403 "Pro subscription required" (unchanged)');
it('6a WORLDMONITOR_VALID_KEYS key, no Bearer, on list-weather-alerts → 200, membership resolver never invoked');
it('6b unknown key, no Bearer, on list-weather-alerts → 401');
it('6c WORLDMONITOR_VALID_KEYS key on analyze-stock → same status and headers as with the flag OFF (no Pro bypass)');
it('6d unverified-email JWT (resolver → not-member) on list-weather-alerts → 403 MARKETING_FORBIDDEN');
// flag OFF
it('7 validateApiKey returns identical results with MARKETING_DEPLOY set vs unset for wms_/enterprise/no-key requests');
it('8 flag OFF: free JWT on analyze-stock → 403 and membership resolver never invoked');
it('9 flag OFF: /api/marketing/v1/list-weather-alerts with wms_ session → 200 (no member requirement)');
it('10 resolvePremiumCallerIdentity: member JWT is premium only when flag ON');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/gateway-marketing-deploy.test.mts`
Expected: FAIL. Tests 1, 2, 4, 5, 6a, 6b and 6d fail; tests 3, 6, 6c and 7–9 may already pass.

- [ ] **Step 3: Implement anchors (a)–(d) and the `premium-check.ts` arm**

- [ ] **Step 4: Run the new tests and the gateway regression suites, and confirm they pass**

Run: `node --import tsx --test tests/gateway-marketing-deploy.test.mts tests/gateway-docker-country-brief.test.mts tests/gateway-pro-fresh-cache.test.mts tests/gateway-internal-mcp.test.mjs tests/premium-stock-gateway.test.mts tests/premium-bearer-free-identity.test.mts tests/premium-check-verification-unavailable.test.mts`
Expected: PASS. Then run `npm run typecheck:api`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/gateway.ts server/_shared/premium-check.ts tests/gateway-marketing-deploy.test.mts
git commit -m "feat(marketing): gateway requires members for MarketingService and bypasses Pro gates for members

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Browser single-variant serving and Bearer attach

**Files:**
- Modify: `src/config/variant.ts:31`. In the `SITE_VARIANT` IIFE, make the first statement `if (MARKETING_DEPLOY) return 'marketing';`, imported from `./marketing`. This runs before the Tauri, hostname and localStorage branches. `main.ts:604-605` already applies `dataset.variant` and the favicons from `SITE_VARIANT`, so leave the `index.html` prepaint alone (its CSP hash is pinned by `tests/variant-inline-bootstrap.test.mjs`).
- Modify: `src/app/panel-layout.ts:1069`. Wrap the `<div class="variant-switcher">…</div>` template in `${shouldShowVariantSwitcher() ? `…` : ''}`. `event-handlers.ts:814/1939` already handle a missing `.variant-option`.
- Modify: `src/services/premium-fetch.ts:177-182` (`isPremiumRpcTarget`). Return true also when `MARKETING_DEPLOY && isMarketingMemberRpcPath(path)`. W0's `api.ts` already routes every wrapper through `premiumFetch` (Resolution 8), so this is the only change needed for the Bearer to reach member-gated RPCs.
- Not modified: `index.html` prepaint and `middleware.ts` `VARIANT_HOST_MAP` (Resolution 2).
- Test: `tests/dom/marketing-deploy-browser.test.mts`

**Interfaces:**
- Consumes: `MARKETING_DEPLOY`, `shouldShowVariantSwitcher()` and `isMarketingMemberRpcPath()` (Task 1), and `_setTestProviders` (`premium-fetch.ts:53`).

- [ ] **Step 1: Write the failing tests** (in each test: `vi.stubEnv('VITE_MARKETING_DEPLOY', '1' | '')`, then `vi.resetModules()`, then dynamic `import()`)

```ts
it('flag ON: SITE_VARIANT is marketing on host room.agency.example and with localStorage variant=tech');
it('flag OFF: SITE_VARIANT is full on room.agency.example (unchanged)');
it('flag ON: shouldShowVariantSwitcher() === false; OFF: true');
it('flag ON: premiumFetch("/api/marketing/v1/list-weather-alerts") sends Authorization: Bearer <test token>');
it('flag OFF: premiumFetch on the same path sends no Authorization header');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-deploy-browser.test.mts`
Expected: FAIL, because the variant is `full` under the flag.

- [ ] **Step 3: Implement the three edits**

- [ ] **Step 4: Run the tests and checks, and confirm they pass**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-deploy-browser.test.mts && node --import tsx --test tests/premium-fetch.test.mts tests/desktop-one-binary-model.test.mjs tests/variant-inline-bootstrap.test.mjs && npm run typecheck && npm run lint:boundaries`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/config/variant.ts src/app/panel-layout.ts src/services/premium-fetch.ts tests/dom/marketing-deploy-browser.test.mts
git commit -m "feat(marketing): force marketing variant, hide switcher, attach Clerk bearer under VITE_MARKETING_DEPLOY

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browser sign-in gate and request-access screen

**Files:**
- Create: `src/services/marketing/access.ts`
- Create: `src/components/marketing/MarketingAccessGate.ts`
- Modify: `src/App.ts`, after `await initAuthState();` (~line 2606). Add `if (MARKETING_DEPLOY) { await awaitMarketingAccess(this.ctx.container); installMarketingSignOutReload(); }`. This runs before Phase 1, `panelLayout.init()` (~line 2883), so no panel or roster mounts for a non-member.
- Modify: `src/locales/en.json`. Add these keys under `marketing.access`: `signInTitle`, `signInBody`, `signInButton`, `requestTitle`, `requestBody` (with `{{email}}`), `signOut`, `unavailableTitle`, `unavailableBody`, `retry`, `notConfigured`, `unverifiedEmail`.
- Modify: `src/locales/*.json` (other locales), only through `npm run sync:locales`, plus `npm run locales:zh-tw` if zh-TW is flagged (Resolution 1).
- Test: `tests/dom/marketing-access-gate.test.mts`

**Interfaces:**
- Consumes:
  - From `src/services/clerk.ts`: `initClerk()`, `isClerkAuthEnabled()`, `getCurrentClerkUser()`, `subscribeClerk()`, `openSignIn()` and `signOut()`.
  - From `src/services/convex-client.ts`: `getConvexClient()`, `getConvexApi()` and `waitForConvexAuth()`.
  - From `src/services/auth-state.ts`: `subscribeAuthState()`.
  - W0's public membership query over `getMyMembership(ctx)` in `convex/marketing/access.ts` (Resolution 15; name per Contract Issue N1), which returns `null` or `{ email; role }`.
  - The mapping: no Clerk user → `signed-out`; query `null` → `not-member` with the Clerk user's primary email; an object → `member`.
- Produces:
  - `src/services/marketing/access.ts`:
    - `export type MarketingAccessState`, one of:
      - `{ status: 'signed-out' }`
      - `{ status: 'member'; email: string; role: 'admin'|'member' }`
      - `{ status: 'not-member'; email: string | null }`
      - `{ status: 'unavailable'; reason: 'clerk-not-configured' | 'convex-unavailable' }`
    - `resolveMarketingAccess(): Promise<MarketingAccessState>`
    - `awaitMarketingAccess(host: HTMLElement): Promise<Extract<MarketingAccessState, {status:'member'}>>`. It renders the gate. On each Clerk change or retry it re-resolves, and it resolves once the state is `member`, after clearing `host`.
    - `installMarketingSignOutReload(): () => void`. It calls `location.reload()` when the auth user goes from non-null to null.
    - `__setMarketingAccessDepsForTests(deps | null): void`
  - `src/components/marketing/MarketingAccessGate.ts`: `renderMarketingAccessGate(host: HTMLElement, state: Exclude<MarketingAccessState, {status:'member'}>, actions: { onSignIn(): void; onSignOut(): void; onRetry(): void }): void`.
    - Render with `setTrustedHtml`/`trustedHtml` (`src/utils/dom-utils.ts`), and pass the email through `escapeHtml` (`src/utils/sanitize.ts`).
    - Wire the buttons by event delegation on `[data-action]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('signed-out → sign-in screen; button calls openSignIn');
it('not-member → request-access screen showing escaped email "<b>x@y.com" and a sign-out button; no .panel elements exist');
it('Clerk key missing → unavailable screen with marketing.access.notConfigured text');
it('Clerk user with unverified email, query returns null → request-access screen with marketing.access.unverifiedEmail hint');
it('Convex query throws → unavailable screen; Retry re-resolves to member and awaitMarketingAccess resolves, host emptied');
it('signed-out → member after a Clerk change emits → promise resolves');
it('installMarketingSignOutReload: user→null triggers reload exactly once; null→user does not');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-access-gate.test.mts`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement the service, the component, the `App.ts` hook and the locale keys.** Then run `npm run sync:locales`.

- [ ] **Step 4: Run the tests and checks, and confirm they pass**

Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-access-gate.test.mts && npm run typecheck && npm run lint && npm run lint:boundaries && npm run typecheck:api`
Expected: PASS and exit 0. `typecheck:api` runs `audit-convex-string-calls`.

- [ ] **Step 5: Capture screenshots for the PR** of the sign-in, request-access and unavailable screens on desktop and mobile. Run `VITE_MARKETING_DEPLOY=1 npm run dev:marketing` and follow the verify-worldmonitor skill. Save them to the scratchpad.

- [ ] **Step 6: Commit**

```bash
git add src/services/marketing/access.ts src/components/marketing/MarketingAccessGate.ts src/App.ts src/locales tests/dom/marketing-access-gate.test.mts
git commit -m "feat(marketing): sign-in gate and request-access screen under VITE_MARKETING_DEPLOY

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Fixture seed for non-dev deploys

Production builds exclude `DEV_CLIENTS` by contract, so a fresh self-hosted room would come up blank. The spec lists that as an anti-goal, and this task covers it.

**Files:**
- Create: `convex/marketing/devSeed.ts`
- Regenerate: `convex/_generated/` with `npx convex codegen` (Resolution 17). Never edit it by hand.
- Test: `convex/__tests__/marketingDevSeed.test.ts`

**Interfaces:**
- Consumes: `DEV_CLIENTS: MarketingClient[]` from `src/services/marketing/dev-fixtures.ts`, whose ids follow Resolution 12's format (the seed ignores them and lets Convex assign document ids). Convex imports it by relative path, which bundles it server-side only and never reaches the browser bundle. Also consumes the `marketingClients` table.
- Produces: `internal.marketing.devSeed.seedFixtureClients`, an `internalMutation` with args `{}` that returns `{ inserted: number; skipped: number }`.
  - It throws `ConvexError('FIXTURE_SEED_DISABLED')` unless the Convex env has `MARKETING_ALLOW_FIXTURE_SEED === '1'`.
  - It skips any client whose `name` already exists, so repeat runs are idempotent.
  - It stamps `updatedBy: 'fixture-seed'`.
  - CLI: `npx convex run marketing/devSeed:seedFixtureClients`.

- [ ] **Step 1: Write the failing tests**

```ts
test('env unset → throws FIXTURE_SEED_DISABLED, no rows');
test('env=1 → inserts DEV_CLIENTS.length rows, all names start with "Fixture "');
test('second run → inserted 0, skipped DEV_CLIENTS.length');
test('inserted ids match /^[A-Za-z0-9_-]{1,64}$/ (Resolution 12)');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --config vitest.config.mts convex/__tests__/marketingDevSeed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `seedFixtureClients`**

- [ ] **Step 4: Run the tests and confirm they pass**

Run the Step 2 command again, plus `node --import tsx --test tests/convex-entrypoint-hygiene.test.mjs`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/marketing/devSeed.ts convex/_generated convex/__tests__/marketingDevSeed.test.ts
git commit -m "feat(marketing): env-gated Convex fixture-client seed for self-hosted rooms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docker notification relay and marketing compose wiring

**Files:**
- Create: `Dockerfile.notification-relay`. Model it on `Dockerfile.relay`, using the same pinned `node:24-alpine@sha256:ebfe2f90…` base:
  - `COPY scripts/package.json scripts/package-lock.json ./scripts/`, then `RUN npm ci --prefix scripts --omit=dev --omit=optional --ignore-scripts`.
  - Copy `scripts/notification-relay.cjs`. Copy `scripts/lib/`, `scripts/shared/` and `shared/` as whole directories. That covers `scripts/lib/marketing-*` (W0's `marketing-deploy-flag.cjs` and W8's evaluator; Resolution 21) and any imports W8 adds.
  - `CMD ["node","scripts/notification-relay.cjs"]`, with no `EXPOSE`/`HEALTHCHECK`, because the relay is a queue consumer and opens no server.
- Modify: `docker-compose.yml`:
  - **New service `notification-relay`** (`build.dockerfile: Dockerfile.notification-relay`, `restart: unless-stopped`, `depends_on: redis-rest`). Its environment:
    - Redis: `UPSTASH_REDIS_REST_URL: "http://redis-rest:80"` and `UPSTASH_REDIS_REST_TOKEN: "${REDIS_TOKEN:?…}"` (same message as the existing services).
    - Convex: `CONVEX_URL`, `CONVEX_SITE_URL` and `CONVEX_NOTIFICATION_RELAY_SECRET`.
    - Resend: `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.
    - Encryption: `ENCRYPTION_KEY_V1`.
    - Marketing: `MARKETING_DEPLOY` and `MARKETING_CONTACT_EMAIL`.
    - Service key: the relay's key for calling `MarketingService`, named as W8's relay reads it (Contract Issue N3). Its value must be in the app's `WORLDMONITOR_VALID_KEYS`.
    - LLM (optional): `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` and `GROQ_API_KEY`.
    - Every value except the Redis ones is written as `"${VAR:-}"`.
  - **Service `worldmonitor`:**
    - Add `build.args`: `VITE_VARIANT: "${VITE_VARIANT:-full}"`, plus `VITE_MARKETING_DEPLOY`, `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_CONVEX_URL`, each as `"${…:-}"`.
    - Add environment `"${VAR:-}"` entries: `MARKETING_DEPLOY`, `MARKETING_CONTACT_EMAIL`, `WORLDMONITOR_VALID_KEYS` (only if the service doesn't already pass it), `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SITE_URL`, `CONVEX_URL`, `CONVEX_SITE_URL`, `ENCRYPTION_KEY_V1`.
    - Keep `UPSTASH_REDIS_REST_URL: "http://redis-rest:80"` as it is.
  - **Header comment:** add "+ notification relay".
- Modify: `Dockerfile`, before `RUN npx tsc && npx vite build` (~line 50). Declare `ARG VITE_VARIANT`, `ARG VITE_MARKETING_DEPLOY`, `ARG VITE_CLERK_PUBLISHABLE_KEY` and `ARG VITE_CONVEX_URL`, all without defaults. Empty values read as off: `variant.ts` uses `||`, `convex-client.ts:155` and `isClerkAuthEnabled()` treat falsy as unset, and Task 1 treats `''` as off.
- Test: `tests/docker-marketing-selfhost.test.mts`, using the `yaml` parse and `serviceBlock` helpers from `tests/docker-compose-no-default-secrets.test.mts`, and `collectRelativeImports`/`parseDockerfileCopy`/`resolveNodeRelative` from `tests/_lib/import-graph-walk.mjs`.

- [ ] **Step 1: Write the failing tests**

```ts
it('notification-relay service exists, builds Dockerfile.notification-relay, depends on redis-rest');
it('worldmonitor and notification-relay both use http://redis-rest:80 and the REDIS_TOKEN :? guard');
it('no marketing env var has a literal default (every one is ${VAR:-})');
it('VITE_VARIANT build arg defaults to full; other VITE_* args default empty');
it('Dockerfile.notification-relay copies notification-relay.cjs and the transitive closure of its relative requires is covered by COPY files/directories');
it('Dockerfile.notification-relay CMD runs scripts/notification-relay.cjs');
it('Dockerfile.notification-relay COPY covers scripts/lib/marketing-deploy-flag.cjs and every scripts/lib/marketing-* file');
it('worldmonitor service passes WORLDMONITOR_VALID_KEYS and MARKETING_CONTACT_EMAIL');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/docker-marketing-selfhost.test.mts`
Expected: FAIL, because the service and Dockerfile are missing.

- [ ] **Step 3: Implement the compose, Dockerfile and `Dockerfile.notification-relay` edits**

- [ ] **Step 4: Run the tests and checks, and confirm they pass**

Run: `node --import tsx --test tests/docker-marketing-selfhost.test.mts tests/docker-compose-no-default-secrets.test.mts tests/dockerfile-relay-imports.test.mjs tests/docker-sidecar-auth-config.test.mjs`
Expected: PASS.

Then run `REDIS_TOKEN=x REDIS_PASSWORD=x WM_SESSION_SECRET=$(openssl rand -hex 32) RELAY_SHARED_SECRET=x docker compose config -q` (only if docker is available). Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile Dockerfile.notification-relay docker-compose.yml tests/docker-marketing-selfhost.test.mts
git commit -m "feat(marketing): notification-relay compose service and marketing build/env wiring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `docs/marketing-setup.md`, env example, and final verification

**Files:**
- Create: `docs/marketing-setup.md`
- Create: `.env.marketing.example`. It lists every variable from Task 8 with an empty value, plus `REDIS_TOKEN`, `REDIS_PASSWORD`, `WM_SESSION_SECRET` and `RELAY_SHARED_SECRET`, each with a comment saying `openssl rand -hex 32`. It also carries the Convex-env block from §3 below as comments.
- Test: the existing guards `scripts/check-vite-env-secrets.mjs` and `npm run lint:md`.

**Required doc sections** (exact headings):
1. `## What you get`: the stack (app, redis, redis-rest, ais-relay, notification-relay) and what the two flags do.
2. `## Clerk`:
   - Create the application and enable email sign-in.
   - Create a JWT template named exactly `convex`, with `aud: convex` and `email`, `email_verified` and `plan` claims. The gateway and Convex both read `email`, and membership requires `email_verified` to be true (Resolution 15).
   - Copy the publishable key into `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_PUBLISHABLE_KEY`, the issuer into `CLERK_JWT_ISSUER_DOMAIN`, and the secret key into `CLERK_SECRET_KEY`.
   - Add the room's origin as an allowed origin, and set `SITE_URL` to it. `isAllowedClerkAuthorizedParty` rejects a foreign `azp` claim.
3. `## Convex`:
   - Run `npx convex deploy`.
   - Set the Convex env with `npx convex env set`: `CLERK_JWT_ISSUER_DOMAIN`, `MARKETING_DEPLOY=1`, `MARKETING_BOOTSTRAP_ADMIN_EMAIL`, `CONVEX_NOTIFICATION_RELAY_SECRET`, and optionally `MARKETING_ALLOW_FIXTURE_SEED=1`.
   - Copy `CONVEX_URL`/`VITE_CONVEX_URL` (`.convex.cloud`) and `CONVEX_SITE_URL` (`.convex.site`).
4. `## Resend`: verify the sender domain, then set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.
5. `## Slack webhook`: create an incoming webhook. The admin pastes it in the Alerts channel settings (W8). Generate `ENCRYPTION_KEY_V1` with `openssl rand -base64 32` and set the same value on the app and the relay.
6. `## Environment variables`: a table with columns var / where (build arg, app, relay, Convex) / required / example. It is generated from `.env.marketing.example`. `MARKETING_CONTACT_EMAIL` is marked required: the server throws in production without it (Resolution 6). `WORLDMONITOR_VALID_KEYS` and the relay's key are documented as a matching pair (Resolution 21).
7. `## Run locally (dev machine)`:
   - Run `cp .env.marketing.example .env`, then `docker compose up -d --build`, and open `http://localhost:3000`.
   - For UI work without Docker, use `VITE_MARKETING_DEPLOY=1 npm run dev:marketing`. DEV fixtures (`Fixture …` clients) load automatically.
8. `## Run on the server`:
   - Use the same compose file with `WM_PORT`, a TLS reverse proxy in front, and `WM_TRUSTED_PROXY_CIDRS`.
   - Update with `git pull && docker compose up -d --build`.
9. `## First sign-in and members`:
   - The bootstrap admin (`MARKETING_BOOTSTRAP_ADMIN_EMAIL`) signs in with a verified email, and an unknown or unverified user sees the request-access screen.
   - The admin adds members in the Team view inside the Roster panel (W2; Resolution 19).
   - Membership changes reach the gateway within 60 s.
10. `## Fixtures and seed data`:
    - In dev, fixtures load automatically.
    - On the server, seed with `npx convex env set MARKETING_ALLOW_FIXTURE_SEED 1 && npx convex run marketing/devSeed:seedFixtureClients`, then unset the variable.
11. `## Verify`:
    - Running `curl -i http://localhost:3000/api/marketing/v1/list-weather-alerts` while signed out gives 401.
    - `docker compose ps` shows the relay running.
    - Send a test alert with `npm run marketing:test-alert` (W8; Resolution 22).
12. `## Turning it off`: with both flags unset, the image behaves exactly like upstream WorldMonitor.

- [ ] **Step 1: Write the doc and the env example** with the sections above. The doc may contain no "TBD" and no client data.

- [ ] **Step 2: Run the doc checks**

Run: `node scripts/check-vite-env-secrets.mjs && npx markdownlint-cli2 docs/marketing-setup.md && git diff --check`
Expected: exit 0. If the Vite guard flags `VITE_CLERK_PUBLISHABLE_KEY`, check its allowlist in `scripts/check-vite-env-secrets.mjs` and report the result, rather than renaming the variable.

- [ ] **Step 3: Run the full verification, one command at a time**

Run, in order: `npm run typecheck`, `npm run typecheck:api`, `npm run lint`, `npm run lint:boundaries`, `npm run test:convex`, `npm run test:dom`, `npm run test:data`.
Expected: each exits 0. Report any pre-existing failure separately, with evidence that it also fails on W0's base commit.

- [ ] **Step 4: Privacy check**

Run: `VITE_VARIANT=marketing VITE_MARKETING_DEPLOY=1 npx vite build && ! grep -rl "Fixture " dist/assets`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add docs/marketing-setup.md .env.marketing.example
git commit -m "docs(marketing): self-hosted setup guide and env example

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Deliver.**
  - Rebase on W2.
  - Run `npm run --silent agent:preflight -- --mode repair`.
  - Open the PR to the fork's `main`.
  - Attach the Task 6 screenshots with `gh pr edit <n> --attach '…#…'`.
  - End the PR body with the attribution line from the system prompt.

---

## Contract Issues (resolved)

1. Membership-lookup contract and `gate.ts` -> **Resolution 15.** W0's `access.ts` exports `getMyMembership(ctx)` and `findMarketingMemberByEmail`. W9 dropped `convex/marketing/gate.ts` and `MarketingMembership`.
2. Shape of `MARKETING_FORBIDDEN` -> **Resolution 15:** `ConvexError({ code: 'MARKETING_FORBIDDEN' })`, matched on `data.code`.
3. Email normalization and lookup helper -> **Resolution 15.** Trim and lowercase, `emailVerified === true`, and `findMarketingMemberByEmail` (W0). `marketingProBypass.ts` no longer duplicates the lookup.
4. `api.ts` must use `premiumFetch` -> **Resolution 8.**
5. `convex/_generated/api.d.ts` conflicts -> **Resolution 17.** Regenerate with `npx convex codegen` and never hand-edit; Tasks 2 and 7 updated.
6. Named test-alert command -> **Resolution 22:** `npm run marketing:test-alert`; the setup doc's §Verify uses it.
7. 503 in addition to 401/403 -> **Resolution 23.**

Also applied: Resolution 11 (the server flag reader is W0's, and Task 1 no longer edits it), 21 (service key on member RPCs, relay Dockerfile copies `scripts/lib/marketing-*`), 5 (private no-store tier is W0's; no logging of client terms), 1 (locale sync), 2 (no host mapping) and 12 (seed ids).

### New unresolved issues

- **N1. No public Convex query is named for `getMyMembership`.** Resolution 15 defines `getMyMembership(ctx)` as a helper, but the gateway (via `ConvexHttpClient`) and the browser gate need a registered public query with a string name. W9 may not add `gate.ts` or edit `access.ts`. Proposal: W0 adds `export const myMembership = query({ args: {}, handler: getMyMembership })` to `convex/marketing/access.ts` (`'marketing/access:myMembership'`). W9 keeps the name in one constant, `MARKETING_MEMBERSHIP_QUERY`, so a rename is a one-line change.
- **N2. Identity-less Pro bypass skips `emailVerified`.** Internal callers like `setNotificationConfigForUser` have no identity, so `hasMarketingProBypass` falls back to `users.by_userId` email plus `findMarketingMemberByEmail`, which can't check verification. This is acceptable only if `users.email` is written solely from verified Clerk sessions. W0/W2 should confirm, or W0 should store `emailVerified` on `users`.
- **N3. Relay service-key env name.** Resolution 21 says the gateway accepts a `WORLDMONITOR_VALID_KEYS` key from the relay, but no index entry names the env var the relay sends it from. W8 should name it. W9's compose test then asserts it.
