# W8 Client Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-client alert rules fire, once each, into one shared agency channel (Slack webhook or email list) and the Alerts panel. Weather and mentions go out in real time; calendar and trend hits go into an 08:00 daily digest.

**Architecture:** Convex holds the channel config, the rules and the event log. `marketingAlertEvents.by_dedup` is the source of truth for idempotency. The evaluator runs inside the `notification-relay` process, only when `MARKETING_DEPLOY=1`. On each tick it:
1. reads rules and clients from Convex through new `/relay/marketing-*` HTTP routes,
2. calls the app's `MarketingService` RPCs over the compose network,
3. records candidates through `recordAlertEvent`,
4. LPUSHes only the newly inserted ones onto `wm:events:queue`.

`processEvent` sends `marketing_alert` and `marketing_digest` events to a dedicated sender before rule matching, so they never reach the per-user rule set or the PRO filter. `MarketingAlertsPanel` reads the event log live through the Convex client.

**Tech Stack:** Convex (queries, mutations, actions, httpAction, convex-test), Node 24 CJS relay (`scripts/notification-relay.cjs`), Upstash REST (`redis-rest` in compose), Web Crypto AES-256-GCM envelopes (format matches `scripts/lib/crypto.cjs`), Resend, Slack incoming webhooks, the `Panel` and `h()` DOM helpers, node:test + vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md` (section "Alerts"). Binding contracts: `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

### Where the evaluator runs (decision)

**Decision:** in the relay container, not a Convex cron in `convex/crons.ts`. The reasons:
- **Convex cloud can't reach the queue.** The queue lives in the self-hosted compose Redis (`UPSTASH_REDIS_REST_URL: http://redis-rest:80`, `docker-compose.yml:24`). Every existing publisher is a process that can reach that Redis: `ais-relay.cjs:888`, `seed-aviation.mjs:402`, `api/notify.ts:304`. The one Convex publisher, `convex/notificationChannels.ts:133`, assumes a public Upstash, and a self-hosted deploy doesn't have one.
- **The signal RPCs are internal too.** They are served by the self-hosted app (`worldmonitor:8080`) and sit behind W9's member gate. A Convex action would need the app exposed publicly, plus a service credential.
- **The relay already has everything the evaluator needs:** `CONVEX_SITE_URL` with `CONVEX_NOTIFICATION_RELAY_SECRET` (the `authorizeTenantRelay(..., ["delivery"])` pattern, `convex/http.ts:104`), the Upstash REST helpers (`upstashRest`, `upstashDedupSetNx`, `notification-relay.cjs:81,94`), the senders, and a long-lived loop (`subscribe()`, `:1764`).
- **Durability is kept.** The evaluator still publishes through `wm:events:queue`, so a delivery survives a relay restart.

## Global Constraints

- Every constraint in the index's "Global Constraints" applies.
- Only these files are W8's to create or replace:
  - `convex/marketing/alerts.ts`
  - `convex/marketing/envelope.ts`
  - `shared/marketing/alert-rules.ts`
  - `scripts/lib/marketing-alert-match.cjs`
  - `scripts/lib/marketing-alert-evaluator.cjs`
  - `src/services/marketing/alerts.ts`
  - `src/components/marketing/MarketingAlertsPanel.ts`
  - `scripts/marketing-test-alert.mjs` (Resolution 22)
  - the new tests
- Unowned shared files get additive edits only:
  - `convex/http.ts`
  - `scripts/notification-relay.cjs`
  - `api/notify.ts`
  - `convex/__tests__/tenant-relay-authority.test.ts`
  - `tests/notify-internal-events.test.mts`
  - `src/locales/en.json` (`marketing.alerts.*` only), plus the other locale files only as rewritten by `npm run sync:locales` (Resolution 1)
  - `package.json` (one `marketing:test-alert` script entry)
- Do not edit:
  - `convex/schema.ts` (W0)
  - `convex/marketing/{access,members,clients}.ts` (W0/W2)
  - `shared/marketing/{types,geo,deploy-flag}.ts` (W0)
  - `scripts/lib/marketing-deploy-flag.cjs` (W0, Resolution 11)
  - `src/components/marketing/empty-state.ts` (W0, Resolution 18)
  - `src/services/marketing/{roster,focus,api}.ts` (W0/W2/W3)
  - `convex/_generated/` (regenerate with `npx convex codegen` after each rebase; never hand-merge, Resolution 17)
  - any handler under `server/worldmonitor/marketing/v1/`
  - the relay Dockerfile or compose (W9)
- With `MARKETING_DEPLOY` unset:
  - the relay's behaviour for every existing event type is unchanged,
  - the new Convex routes return 404,
  - the evaluator never starts.
- Thresholds are conservative. The rule defaults are:
  - weather `minSeverity: 'warning'` (the mapped `WeatherAlert.severity`, Resolution 4)
  - mention `includeCompetitors: true`, plus a 24h recency window that never reaches back before the rule's `createdAt`
  - calendar `leadDays: 7`
  - trend `minRisePct: 50`
- Privacy (Resolution 5): relay and evaluator logs never contain client names, keywords, competitors or mention terms. They log only RPC names, counts and dedup-key hashes. Client names appear only in the delivered Slack/email text.
- Timestamps from `MarketingService` are `int64` epoch ms (Resolution 3). In proto3 JSON an `int64` may arrive as a string, so every matcher reads them through `Number()` and skips non-finite values.
- A response with `degraded: true` (Resolution 4) still has its items matched, and the RPC name is added to `TickSummary.errors` as `<name>:degraded`.
- At most `5` realtime alerts per client per tick. Overflow is recorded but not queued.
- The digest goes out at `MARKETING_DIGEST_HOUR` (default `8`) in `MARKETING_DIGEST_TZ` (default `America/New_York`), at most once per local date.
- New relay env vars (W9 documents them):
  - `MARKETING_DEPLOY`
  - `MARKETING_API_BASE` (default `http://worldmonitor:8080`)
  - `MARKETING_EVALUATOR_KEY`, which must also appear in the app's `WORLDMONITOR_VALID_KEYS`
  - `MARKETING_DIGEST_TZ`
  - `MARKETING_DIGEST_HOUR`
- New Convex env vars:
  - `NOTIFICATION_ENCRYPTION_KEY`: base64 of 32 bytes. Same value as the relay's `NOTIFICATION_ENCRYPTION_KEY` or `ENCRYPTION_KEY_V1`.
  - `MARKETING_DEPLOY`
- Test commands (AGENTS.md table):
  - `node --import tsx --test tests/<file>` runs a `test:data` suite (CI `unit-shards`).
  - `npx vitest run --config vitest.config.mts convex/__tests__/<file>` runs a `test:convex` suite.
  - `npx vitest run --config vitest.dom.config.mts tests/dom/<file>` runs a `test:dom` suite.

## Review Focus

1. **The same NWS alert or article on repeated polls, two relay replicas, or one queue message delivered twice:** exactly one Slack/email message. The `recordAlertEvent` dedup and the relay-side SETNX pin this (Tasks 3 and 7).
2. **A mention rule enabled for a client with a large back-catalogue of news:** the first tick does not flood the channel. Anything older than 24h or than `rule.createdAt` is ignored, and each client is capped at 5 per tick (Task 5 and Task 6).
3. **A browser user POSTs `eventType: 'marketing_alert'` to `/api/notify`:** rejected as reserved. The relay also drops any marketing event that carries a `userId` (Task 7).
4. **The Slack webhook returns 404/410, decrypt fails, or no channel is configured:** the event stays `delivered: false`, the panel shows "Not delivered", and the relay never calls `/relay/deactivate` with a fake userId (Task 7, Task 8).
5. **An NWS alert with `polygon_geojson` empty or malformed, or a client location with NaN coordinates:** no alert and no throw. The rest of the tick continues (Task 5).
6. **Logs leak no client data** (Resolution 5): an evaluator tick with a failing RPC logs no client name or term (Task 6).

---

### Task 1: Shared alert rule model

**Files:**
- Create: `shared/marketing/alert-rules.ts`
- Test: `tests/marketing-alert-rules.test.mts`

**Interfaces:**
- Consumes: `MarketingSignalKind` and `MarketingSignal['severity']` from `shared/marketing/types.ts`. Client ids follow Resolution 12 (`/^[A-Za-z0-9_-]{1,64}$/`).
- Produces:
  ```ts
  export type WeatherRuleParams = { minSeverity: 'watch' | 'warning' }; // mapped WeatherAlert.severity (Resolution 4); 'info' alerts never fire
  export type MentionRuleParams = { includeCompetitors: boolean };
  export type CalendarRuleParams = { leadDays: number };   // integer 1..30
  export type TrendRuleParams = { minRisePct: number };    // integer 10..500
  export type RuleParamsByKind = { weather: WeatherRuleParams; mention: MentionRuleParams; calendar: CalendarRuleParams; trend: TrendRuleParams };
  export const RULE_DEFAULTS: RuleParamsByKind;            // values from Global Constraints
  export const REALTIME_KINDS: readonly MarketingSignalKind[]; // ['weather','mention']
  export const DIGEST_KINDS: readonly MarketingSignalKind[];   // ['calendar','trend']
  export function normalizeRuleParams<K extends MarketingSignalKind>(kind: K, raw: unknown): RuleParamsByKind[K]; // unknown keys dropped, out-of-range clamped, wrong types -> default
  export function buildDedupKey(kind: MarketingSignalKind, clientId: string, itemId: string): string; // `${kind}:${clientId}:${itemId}`, itemId trimmed, max 200 chars total
  export interface ClientAlertRule { id: string; clientId: string; kind: MarketingSignalKind; enabled: boolean; params: RuleParamsByKind[MarketingSignalKind]; createdAt: number }
  export interface MarketingAlertEvent { id: string; dedupKey: string; clientId: string; kind: MarketingSignalKind; title: string; url: string | null; severity: 'info'|'watch'|'warning'; firedAt: number; delivered: boolean }
  export interface AlertChannelSummary { kind: 'slack' | 'email'; updatedAt: number }
  export const CLIENT_ID_RE: RegExp;                       // /^[A-Za-z0-9_-]{1,64}$/ (Resolution 12)
  export const MARKETING_ALERT_EVENT_TYPE = 'marketing_alert';
  export const MARKETING_DIGEST_EVENT_TYPE = 'marketing_digest';
  ```

- [ ] **Step 1: Write the failing test** `tests/marketing-alert-rules.test.mts`

```ts
it('fills defaults', () => assert.deepEqual(normalizeRuleParams('weather', {}), { minSeverity: 'warning' }));
it('rejects NWS-native severity to default', () => assert.equal(normalizeRuleParams('weather', { minSeverity: 'Severe' }).minSeverity, 'warning'));
it('client id format', () => { assert.ok(CLIENT_ID_RE.test('k17abc_-9')); assert.ok(!CLIENT_ID_RE.test('a/b')); assert.ok(!CLIENT_ID_RE.test('x'.repeat(65))); });
it('clamps leadDays', () => { assert.equal(normalizeRuleParams('calendar', { leadDays: 400 }).leadDays, 30); assert.equal(normalizeRuleParams('calendar', { leadDays: 0 }).leadDays, 1); });
it('rejects bad types to default', () => assert.equal(normalizeRuleParams('trend', { minRisePct: '90' }).minRisePct, 50));
it('drops unknown keys', () => assert.deepEqual(normalizeRuleParams('mention', { includeCompetitors: false, x: 1 }), { includeCompetitors: false }));
it('dedup key shape', () => assert.equal(buildDedupKey('weather', 'c1', ' urn:oid:2.49 '), 'weather:c1:urn:oid:2.49'));
it('dedup key capped', () => assert.ok(buildDedupKey('mention', 'c1', 'x'.repeat(500)).length <= 200));
it('kinds partition', () => assert.deepEqual([...REALTIME_KINDS, ...DIGEST_KINDS].sort(), ['calendar','mention','trend','weather']));
```

- [ ] **Step 2: Run** `node --import tsx --test tests/marketing-alert-rules.test.mts`. Expected: FAIL with a module-not-found error.
- [ ] **Step 3: Implement** `shared/marketing/alert-rules.ts` with the signatures above. Pure TS, no imports beyond `./types`, so Convex, the browser and the server can all import it.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add shared/marketing/alert-rules.ts tests/marketing-alert-rules.test.mts
git commit -m "feat(marketing): add shared alert rule model and dedup key"
```

---

### Task 2: Encrypted shared-channel config (admin-only)

**Files:**
- Create: `convex/marketing/envelope.ts`
- Create: `convex/marketing/alerts.ts` (channel section)
- Test: `tests/marketing-alert-envelope.test.mts`
- Test: `convex/__tests__/marketingAlertChannel.test.ts`

**Interfaces:**
- Consumes:
  - `requireMarketingMember(ctx)` from `convex/marketing/access.ts` (W0). It throws `ConvexError({ code: 'MARKETING_FORBIDDEN' })` and requires `emailVerified === true` (Resolution 15). All W8 errors use the same `ConvexError({ code })` shape.
  - the `marketingAlertChannel` table.
  - `AlertChannelSummary` (Task 1).
- Produces:
  - `encryptEnvelope(plaintext: string, rawKeyB64: string): Promise<string>` in `envelope.ts`. Web Crypto AES-GCM; the output is `v1:<base64(iv12||tag16||ciphertext)>`, which `scripts/lib/crypto.cjs` `decrypt()` reads (same layout as `encryptSlackWebhook`, `api/notification-channels.ts:93`).
  - `validateChannelTarget(kind: 'slack'|'email', target: string): string` in `alerts.ts`. It returns the normalized plaintext and otherwise throws `ConvexError({code:'INVALID_CHANNEL'})`.
    - Slack must match `/^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+$/`, the same regex as `SLACK_RE` at `notification-relay.cjs:586`.
    - Email is a comma or newline separated list of 1–10 addresses. It is trimmed, lowercased, deduped and joined with `,`.
  - `setAlertChannel = action({ kind, target })`. It validates, encrypts with `process.env.NOTIFICATION_ENCRYPTION_KEY` (missing key → `ConvexError({code:'ENCRYPTION_NOT_CONFIGURED'})`), then calls `internal.marketing.alerts._storeAlertChannel`.
  - `_storeAlertChannel = internalMutation({ kind, target })`. It calls `requireMarketingMember`; a role other than `'admin'` gets `MARKETING_FORBIDDEN`. It upserts the singleton row with `updatedAt: Date.now()`. The identity propagates from the action.
  - `clearAlertChannel = mutation({})`. Admin only. Deletes the singleton.
  - `getAlertSettingsView = query({})`. Returns `{ channel: AlertChannelSummary | null; canEditChannel: boolean }`. It never returns `target`.
  - `_getAlertChannelForRelay = internalQuery({})`. Returns `{ kind, target } | null` (the envelope).

- [ ] **Step 1: Write the failing tests**

`tests/marketing-alert-envelope.test.mts`:

```ts
// key = randomBytes(32).toString('base64'); process.env.NOTIFICATION_ENCRYPTION_KEY = key
it('round-trips through relay decrypt', async () => {
  const env = await encryptEnvelope('https://hooks.slack.com/services/T0/B0/abc', key);
  assert.match(env, /^v1:/);
  assert.equal(require('../scripts/lib/crypto.cjs').decrypt(env), 'https://hooks.slack.com/services/T0/B0/abc');
});
it('uses a fresh IV each call', async () => assert.notEqual(await encryptEnvelope('x', key), await encryptEnvelope('x', key)));
it('rejects a non-32-byte key', async () => await assert.rejects(encryptEnvelope('x', Buffer.alloc(16).toString('base64'))));
```

`convex/__tests__/marketingAlertChannel.test.ts`: seed `marketingMembers` with admin `a@agency.test` and member `m@agency.test`, call `vi.stubEnv('NOTIFICATION_ENCRYPTION_KEY', key)`, and use `t.withIdentity({ subject, email, emailVerified: true })`. Error assertions check `ConvexError.data.code`, not only the message.

```ts
test('admin sets slack; view hides target', async () => {
  await asAdmin.action(api.marketing.alerts.setAlertChannel, { kind: 'slack', target: SLACK_URL });
  const view = await asAdmin.query(api.marketing.alerts.getAlertSettingsView, {});
  expect(view).toEqual({ channel: { kind: 'slack', updatedAt: expect.any(Number) }, canEditChannel: true });
  expect(JSON.stringify(view)).not.toContain('hooks.slack.com');
  const stored = await t.query(internal.marketing.alerts._getAlertChannelForRelay, {});
  expect(stored!.target).toMatch(/^v1:/);
});
test('member cannot set channel', () => expect(asMember.action(api.marketing.alerts.setAlertChannel, { kind: 'slack', target: SLACK_URL })).rejects.toThrow(/MARKETING_FORBIDDEN/));
test('member view canEditChannel false', async () => expect((await asMember.query(api.marketing.alerts.getAlertSettingsView, {})).canEditChannel).toBe(false));
test('non-member rejected', () => expect(asStranger.query(api.marketing.alerts.getAlertSettingsView, {})).rejects.toThrow(/MARKETING_FORBIDDEN/));
test('invalid slack url', () => expect(asAdmin.action(api.marketing.alerts.setAlertChannel, { kind: 'slack', target: 'https://evil.test/x' })).rejects.toThrow(/INVALID_CHANNEL/));
test('email list normalized', () => expect(validateChannelTarget('email', ' A@x.test, a@x.test\nb@y.test ')).toBe('a@x.test,b@y.test'));
test('11 emails rejected', () => expect(() => validateChannelTarget('email', Array.from({length:11},(_,i)=>`u${i}@x.test`).join(','))).toThrow(/INVALID_CHANNEL/));
test('second set replaces singleton', async () => { /* set slack then email -> exactly one row, kind 'email' */ });
```

- [ ] **Step 2: Run each suite and confirm it fails.**
  - Run: `node --import tsx --test tests/marketing-alert-envelope.test.mts`
  - Run: `npx vitest run --config vitest.config.mts convex/__tests__/marketingAlertChannel.test.ts`
  - Expected: FAIL (missing modules).
- [ ] **Step 3: Implement `envelope.ts` and the channel section of `alerts.ts`.** Use the signatures above. `envelope.ts` must not use `"use node"`; it relies on `crypto.subtle`, which Convex's default runtime provides.
- [ ] **Step 4: Run both commands again.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add convex/marketing/envelope.ts convex/marketing/alerts.ts tests/marketing-alert-envelope.test.mts convex/__tests__/marketingAlertChannel.test.ts
git commit -m "feat(marketing): admin-only encrypted shared alert channel"
```

---

### Task 3: Rules CRUD, idempotent event log, recent events

**Files:**
- Modify: `convex/marketing/alerts.ts` (rules and events sections)
- Test: `convex/__tests__/marketingAlerts.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `normalizeRuleParams`, `ClientAlertRule`, `MarketingAlertEvent`.
  - the tables `clientAlertRules`, `marketingAlertEvents`, `marketingClients`.
  - `requireMarketingMember`.
- Produces (all public functions call `requireMarketingMember` first):
  - `listRules = query({ clientId: v.optional(v.string()) }) -> ClientAlertRule[]`. Filters with `by_client` when `clientId` is given.
  - `upsertRule = mutation({ clientId: v.string(), kind, enabled: v.boolean(), params: v.any() }) -> string` (rule id). `clientId` is the `marketingClients` document id string (Resolution 12).
    - There is one rule per `(clientId, kind)`.
    - `params` are stored as `normalizeRuleParams(kind, params)`.
    - `createdAt` is kept when updating.
    - A `clientId` that fails `CLIENT_ID_RE`, or that `ctx.db.normalizeId('marketingClients', …)` can't resolve to a row, throws `ConvexError({code:'UNKNOWN_CLIENT'})`.
  - `deleteRule = mutation({ ruleId: v.id('clientAlertRules') }) -> null`.
  - `recordAlertEvent = internalMutation({ dedupKey, clientId, kind, title, url: v.union(v.string(), v.null()), severity, firedAt }) -> { status: 'new' | 'duplicate'; eventId: string }`.
    - It looks up `by_dedup` and inserts with `delivered: false` only when no row exists.
    - `title` is truncated to 300 chars.
  - `markEventsDelivered = internalMutation({ dedupKeys: v.array(v.string()) }) -> { updated: number }`. Takes at most 100 keys.
  - `listRecentEvents = query({ clientId: v.optional(v.string()), limit: v.optional(v.number()) }) -> MarketingAlertEvent[]`.
    - Ordered by `firedAt` descending.
    - `limit` defaults to 50 and is clamped to 1..200.
    - With `clientId`, it reads the W0 index `by_client_firedAt` (Resolution 16) with `.order('desc').take(limit)`. Without it, it uses `.order('desc')` on the creation index, sorts by `firedAt` and takes `limit`.
  - `_getEvaluatorInput = internalQuery({}) -> { clients: Array<Pick<MarketingClient,'id'|'name'|'category'|'locations'|'competitors'|'keywords'>>; rules: ClientAlertRule[] }`.
    - Only `active` clients with at least one `enabled` rule (inactive clients are hidden everywhere, Resolution 12).
    - Rules whose client is missing or inactive are omitted.

- [ ] **Step 1: Write the failing test** `convex/__tests__/marketingAlerts.test.ts`

```ts
test('recordAlertEvent is idempotent on dedupKey', async () => {
  const ev = { dedupKey: 'weather:c1:urn:1', clientId: c1, kind: 'weather', title: 'Tornado Warning', url: null, severity: 'warning', firedAt: 1 };
  expect((await t.mutation(internal.marketing.alerts.recordAlertEvent, ev)).status).toBe('new');
  expect((await t.mutation(internal.marketing.alerts.recordAlertEvent, { ...ev, firedAt: 2, title: 'changed' })).status).toBe('duplicate');
  const rows = await t.run(ctx => ctx.db.query('marketingAlertEvents').collect());
  expect(rows).toHaveLength(1); expect(rows[0].title).toBe('Tornado Warning'); expect(rows[0].delivered).toBe(false);
});
test('concurrent records yield one new', async () => {
  const r = await Promise.all([1,2,3].map(() => t.mutation(internal.marketing.alerts.recordAlertEvent, ev)));
  expect(r.filter(x => x.status === 'new')).toHaveLength(1);
});
test('same item, different clients are distinct', /* weather:c1:urn:1 and weather:c2:urn:1 both 'new' */);
test('markEventsDelivered flips flag', /* updated === 1; unknown keys ignored */);
test('upsertRule normalizes and keeps one per kind', async () => {
  await asMember.mutation(api.marketing.alerts.upsertRule, { clientId: c1, kind: 'calendar', enabled: true, params: { leadDays: 99 } });
  await asMember.mutation(api.marketing.alerts.upsertRule, { clientId: c1, kind: 'calendar', enabled: false, params: {} });
  const rules = await asMember.query(api.marketing.alerts.listRules, { clientId: c1 });
  expect(rules).toHaveLength(1); expect(rules[0]).toMatchObject({ enabled: false, params: { leadDays: 7 } });
});
test('upsertRule unknown client', () => expect(asMember.mutation(api.marketing.alerts.upsertRule, { clientId: 'nope', kind: 'weather', enabled: true, params: {} })).rejects.toThrow(/UNKNOWN_CLIENT/));
test('upsertRule malformed client id', /* 'a/b' -> UNKNOWN_CLIENT, no db read */);
test('listRecentEvents newest first, filter, clamp', /* 3 events firedAt 1,3,2 -> [3,2,1]; clientId filter uses by_client_firedAt; limit 0 -> 1 row */);
test('unverified email gets MARKETING_FORBIDDEN', /* withIdentity emailVerified:false on a seeded member */);
test('non-member gets MARKETING_FORBIDDEN on every public fn', /* listRules, upsertRule, deleteRule, listRecentEvents */);
test('_getEvaluatorInput excludes inactive clients and disabled rules', /* ... */);
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.mts convex/__tests__/marketingAlerts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the rules and events sections** with the signatures above.
- [ ] **Step 4: Run the same command, then** `npx convex codegen` (Resolution 17) and `npm run typecheck:api`. Expected: PASS. The `audit-convex-string-calls` step stays clean.
- [ ] **Step 5: Commit**

```bash
git add convex/marketing/alerts.ts convex/__tests__/marketingAlerts.test.ts
git commit -m "feat(marketing): client alert rules and idempotent alert event log"
```

---

### Task 4: Relay-facing Convex HTTP routes

**Files:**
- Modify: `convex/http.ts`. Add the routes after the `/relay/enabled-rules` route (around line 1093).
- Modify: `convex/__tests__/tenant-relay-authority.test.ts` (`routes` table at line 17, and `beforeEach` at line 32).
- Test: `convex/__tests__/marketingAlertsRelay.test.ts`

**Interfaces:**
- Consumes:
  - `authorizeTenantRelay(request, ["delivery"])` and `parseJsonObjectBody` from `convex/http.ts:104,127`.
  - `isMarketingDeploy(process.env)` from `shared/marketing/deploy-flag.ts`. W0 implements the real env parse (Resolution 11), so the 404-when-off tests run before W9 merges.
  - Task 2 `_getAlertChannelForRelay`.
  - Task 3 `_getEvaluatorInput`, `recordAlertEvent`, `markEventsDelivered`.
- Produces routes. The order of checks is always: auth (401), then flag (404 `{error:'NOT_FOUND'}`), then input validation (400).

  | Route | Body / returns |
  |---|---|
  | `GET /relay/marketing-evaluator-input` | Returns the `_getEvaluatorInput` result. |
  | `GET /relay/marketing-channel` | Returns `{ kind, target } \| null`. |
  | `POST /relay/marketing-record-events` | Body `{ events: RecordEventArgs[] }`, 1–100 events. Returns `{ results: Array<{ dedupKey, status }> }`. Calls `recordAlertEvent` once per event, so each event is its own transaction. |
  | `POST /relay/marketing-mark-delivered` | Body `{ dedupKeys: string[] }`. Returns `{ updated }`. |

- [ ] **Step 1: Write the failing tests**

In `tenant-relay-authority.test.ts`:
- Add `vi.stubEnv('MARKETING_DEPLOY', '1')` in `beforeEach`.
- Append these rows:

```ts
['marketing-evaluator-input', 'GET', ['delivery']],
['marketing-channel', 'GET', ['delivery']],
['marketing-record-events', 'POST', ['delivery']],
['marketing-mark-delivered', 'POST', ['delivery']],
```

(An authorized GET returns 200 and an authorized POST with `{}` returns 400, as the matrix already asserts.)

`marketingAlertsRelay.test.ts`:

```ts
test('404 when MARKETING_DEPLOY unset, even with valid secret', async () => { vi.stubEnv('MARKETING_DEPLOY', ''); expect((await t.fetch('/relay/marketing-channel', auth('GET'))).status).toBe(404); });
test('record-events returns new then duplicate', /* POST same event twice -> statuses ['new'] then ['duplicate'] */);
test('record-events rejects >100 or malformed event with 400', /* missing dedupKey, bad kind, clientId failing CLIENT_ID_RE */);
test('mark-delivered flips delivered', /* ... */);
```

- [ ] **Step 2: Run each suite and confirm it fails.**
  - Run: `npx vitest run --config vitest.config.mts convex/__tests__/tenant-relay-authority.test.ts`
  - Run: `npx vitest run --config vitest.config.mts convex/__tests__/marketingAlertsRelay.test.ts`
  - Expected: FAIL (404 or 401 on the new paths).
- [ ] **Step 3: Add the four `http.route` entries** using the existing `httpAction` pattern from `/relay/channels` (`convex/http.ts:704`). Call the functions with typed `internal.marketing.alerts.*` references, not `(internal as any)`.
- [ ] **Step 4: Run both suites again, plus the full** `convex/__tests__/http.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add convex/http.ts convex/__tests__/tenant-relay-authority.test.ts convex/__tests__/marketingAlertsRelay.test.ts
git commit -m "feat(marketing): delivery-secret relay routes for marketing alerts"
```

---

### Task 5: Signal matching library (CJS, relay-side)

**Files:**
- Create: `scripts/lib/marketing-alert-match.cjs`
- Test: `tests/marketing-alert-match.test.mjs`

**Interfaces:**
- Consumes: the RPC response shapes from the index table as amended by Resolutions 3–4 (snake_case JSON, as the generated server emits; `int64` epoch ms timestamps; `WeatherAlert.severity` already mapped to `info|watch|warning`; `zone_codes`/`state_codes`; `TrendPoint{date, value}`; `degraded`). This module never calls the network. The deploy flag is NOT reimplemented here: the relay requires W0's `scripts/lib/marketing-deploy-flag.cjs` (Resolution 11), whose parity test W0 owns.
- Produces:
  - `milesBetween(aLat, aLon, bLat, bLon): number`. A CJS mirror of `shared/marketing/geo.ts` (the relay can't import TS); a parity test pins it.
  - `polygonTouchesServiceArea(loc, polygonGeojson: string): boolean`. A CJS mirror of W0's shared `polygonTouchesServiceArea(loc, geojson)` (Resolution 10), same argument order; a parity test over the same fixtures pins it, including empty/malformed/NaN inputs returning `false`.
  - `SEVERITY_RANK = { info: 0, watch: 1, warning: 2 }`.
  - `matchWeather(alerts, clients, rulesByClient) -> Candidate[]`.
    - An alert matches when its mapped severity rank is at least the rule's `minSeverity` and its polygon touches any of the client's active locations.
    - An alert with an empty `polygon_geojson` is skipped (W4 fills geometry from zones and drops alerts whose zone lookups all fail, per Known source limits).
    - `itemId = alert.id`. Severity is the alert's mapped severity.
  - `buildMentionQueries(clients, rulesByClient) -> MentionQuery[]`.
    - One query per client: `terms = [name, ...keywords, ...(includeCompetitors ? competitors : [])]`, deduped and capped at 10.
    - `city` and `state_code` come from the first location.
    - Clients without locations are skipped.
  - `matchMentions(mentions, rulesByClient, nowMs) -> Candidate[]`.
    - Keeps a mention only when `Number(published_at)` (epoch ms) is within 24h of `nowMs` and at or after `rule.createdAt`.
    - Location: `lat/lon` of `0,0` means "no location" (Resolution 3); the candidate is not geo-filtered.
    - `itemId` is the sha256 hex (first 32 chars) of the URL with query and hash stripped and the host lowercased, or of `mention.id` when there is no URL.
    - Severity is `'info'`.
  - `matchCalendar(events, clients, rulesByClient, todayIso) -> Candidate[]`.
    - Keeps an event when `kind === 'holiday'`, or when its categories include the client's category (an event with empty `categories` applies to all, Resolution 14), and its date falls within `[today, today + leadDays]`.
    - `itemId = event.id`. Severity is `'info'`.
  - `matchTrend(trends, clients, rulesByClient) -> Candidate[]`.
    - Compares the mean of the last 7 points with the mean of the 28 points before them. It fires when `(recent / prior - 1) * 100 >= minRisePct` and `prior > 0`.
    - `itemId = ${category}:${isoMondayOfLastPoint}`, the Monday computed in UTC from the last `TrendPoint.date` (epoch ms). Severity is `'watch'`.
  - `capPerClient(candidates, max = 5) -> { queued: Candidate[]; overflow: Candidate[] }`.
  - `type Candidate = { dedupKey, clientId, clientName, kind, title, url, severity, detail }`. `dedupKey` uses the same format as `buildDedupKey` in Task 1; a parity test pins it.

- [ ] **Step 1: Write the failing test** `tests/marketing-alert-match.test.mjs`

```js
it('milesBetween parity with shared geo', async () => { const geo = await import('../shared/marketing/geo.ts'); for (const p of SAMPLE_PAIRS) assert.ok(Math.abs(m.milesBetween(...p) - geo.milesBetween(...p)) < 1e-6); });
it('polygonTouchesServiceArea parity with shared geo', /* for each POLY_FIXTURE x LOC_FIXTURE: m.polygonTouchesServiceArea(loc, g) === geo.polygonTouchesServiceArea(loc, g) */);
it('dedupKey parity with buildDedupKey', /* matchWeather output dedupKey === buildDedupKey('weather', c.id, alert.id) */);
it('centre inside polygon matches', () => assert.equal(m.polygonTouchesServiceArea(DALLAS_LOC_R10, SQUARE_AROUND_DALLAS), true));
it('polygon 8mi away, radius 10 matches; radius 5 does not', /* ... */);
it('null / "" / "{bad" / NaN coords -> false, no throw', /* ... */);
it('watch alert ignored under default warning rule; info never fires', /* ... */);
it('alert with empty polygon_geojson skipped', /* ... */);
it('int64 timestamps as strings are parsed; non-numeric dropped', /* published_at '1729500000000' kept, 'x' dropped */);
it('MultiPolygon supported', /* ... */);
it('mention older than 24h or before rule.createdAt is dropped', /* ... */);
it('same article with different utm query -> same dedupKey', /* ... */);
it('client with no locations -> no mention query, no weather match', /* ... */);
it('calendar: holiday in window kept; observance for other category dropped; empty categories kept; day leadDays+1 dropped', /* ... */);
it('trend: +60% fires at 50, +40% does not, prior 0 skipped, <35 points skipped', /* ... */);
it('capPerClient keeps 5 newest per client', /* ... */);
```

- [ ] **Step 2: Run** `node --import tsx --test tests/marketing-alert-match.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `scripts/lib/marketing-alert-match.cjs`. Use only Node builtins (`node:crypto`), so the relay image needs no new dependency.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/lib/marketing-alert-match.cjs tests/marketing-alert-match.test.mjs
git commit -m "feat(marketing): relay-side alert matching for weather, mentions, calendar, trends"
```

---

### Task 6: Evaluator loop (realtime ticks + daily digest)

**Files:**
- Create: `scripts/lib/marketing-alert-evaluator.cjs`
- Test: `tests/marketing-alert-evaluator.test.mjs`

**Interfaces:**
- Consumes:
  - Task 5's matchers.
  - Task 4's routes.
  - the `MarketingService` HTTP paths. W9's gateway accepts the `WORLDMONITOR_VALID_KEYS` service key for them (Resolution 21).
  - Local time comes from a local `localClock(nowMs, tz) -> { hour: number; date: 'YYYY-MM-DD' }` using `Intl.DateTimeFormat`, not `scripts/lib/quiet-hours.cjs`, so the relay image only needs the `scripts/lib/marketing-*` files W9 copies (Resolution 21).
- Produces:
  - `MARKETING_RPC_PATHS = { listWeatherAlerts: '/api/marketing/v1/list-weather-alerts', listCalendarEvents: '/api/marketing/v1/list-calendar-events', searchLocalMentions: '/api/marketing/v1/search-local-mentions', getDemandTrends: '/api/marketing/v1/get-demand-trends' }`, each with the HTTP method the generated client uses. `searchLocalMentions` is `POST` (Resolution 5).
  - `createConvexMarketingDeps({ siteUrl, secret, fetchImpl }) -> { fetchInput(): Promise<Input>; recordEvents(c: Candidate[]): Promise<Map<string,'new'|'duplicate'>>; fetchChannel(): Promise<{kind,target}|null>; markDelivered(keys: string[]): Promise<void> }`.
    - Sends `Authorization: Bearer <secret>` and `User-Agent: worldmonitor-relay/1.0`.
    - Uses a 10s `AbortSignal.timeout`.
  - `createMarketingRpcCaller({ baseUrl, apiKey, fetchImpl }) -> (name, request) => Promise<object>`.
    - Sends the `X-WorldMonitor-Key` header.
    - A non-2xx response (including W9's retryable 503, Resolution 23), a timeout or bad JSON throws. The caller treats a throw as "skip this kind this tick".
    - Error messages contain only the RPC name and HTTP status, never the request body (Resolution 5).
  - `createMarketingEvaluator(deps: { convex, rpc, lpush(key, msg): Promise<boolean>, setNx(key, ttlSec): Promise<boolean>, now(): number, tz: string, digestHour: number, weatherEveryMs = 300_000, mentionsEveryMs = 900_000 }) -> { tick(): Promise<TickSummary> }`.
    - `TickSummary = { ran: MarketingSignalKind[]; recorded: number; queued: number; overflow: number; digest: 'sent'|'empty'|'skipped'; errors: string[] }`.
  - The queue message shapes, pushed to `wm:events:queue`:
    ```ts
    { eventType: 'marketing_alert', variant: 'marketing', severity: 'high', payload: { dedupKey, clientId, clientName, kind, title, url, detail, signalSeverity } }
    { eventType: 'marketing_digest', variant: 'marketing', severity: 'high', payload: { date: 'YYYY-MM-DD', items: Array<{ dedupKey, clientName, kind, title, url }> } }
    ```
  - `startMarketingEvaluator(deps, intervalMs = 60_000) -> () => void`. Uses `setInterval`. Overlapping ticks are skipped through an in-flight flag. Errors are logged with the prefix `[relay][marketing]`.
- Tick algorithm (not determined by signatures):
  1. Fetch the input. If it has no rules, return early.
  2. If weather is due: deduplicate all active client locations' `stateCode`s, call one `listWeatherAlerts`, then run `matchWeather`.
  3. If mentions are due: build the queries, chunk them by 20, call `searchLocalMentions` per chunk, then run `matchMentions`.
  4. Run `capPerClient` on the realtime candidates, then record queued plus overflow candidates through `recordEvents`. LPUSH a `marketing_alert` only for queued candidates whose status is `'new'`.
  5. Compute the digest window: `localHour >= digestHour` and the local date has not been claimed. Claim it with `setNx('marketing:digest:<date>', 172800)`. If the claim fails, report `digest: 'skipped'`.
     - When the claim succeeds, call `listCalendarEvents` and `getDemandTrends` for the union of the clients' categories that have an enabled calendar or trend rule (never an empty list, since empty means all, Resolution 14), record those candidates, and if any are `'new'`, LPUSH one `marketing_digest` (`'sent'`).
     - Otherwise report `'empty'`.
  6. A failing RPC adds its name to `errors`; a `degraded: true` response adds `<name>:degraded` but its items are still matched. The other kinds still run.

- [ ] **Step 1: Write the failing test** `tests/marketing-alert-evaluator.test.mjs`. It uses in-memory fakes, and `recordEvents` dedups through a `Set`.

```js
it('RPC paths exist in generated client', () => { const src = readFileSync('src/generated/client/worldmonitor/marketing/v1/service_client.ts', 'utf8'); for (const p of Object.values(MARKETING_RPC_PATHS)) assert.ok(src.includes(`"${p.path ?? p}"`)); });
it('same NWS alert on two ticks queues once', async () => { await ev.tick(); clock += 300_000; await ev.tick(); assert.equal(pushed.filter(m => m.eventType === 'marketing_alert').length, 1); });
it('weather not re-polled before 5 min', /* rpc call count */);
it('weather RPC failure still runs mentions; errors lists it', /* ... */);
it('overflow beyond 5 recorded but not queued', /* recorded 7, queued 5, overflow 2 */);
it('digest: 07:59 local -> skipped-not-due; 08:00 -> one marketing_digest; second tick same day -> no second', /* tz America/New_York */);
it('digest with no new items pushes nothing (empty)', /* ... */);
it('no rules -> no RPC calls', /* ... */);
it('rpc caller sends X-WorldMonitor-Key and throws on 403 and 503', /* ... */);
it('searchLocalMentions is sent as POST', /* ... */);
it('degraded weather response still matches and lists listWeatherAlerts:degraded', /* ... */);
it('logs and errors contain no client name or term', /* capture console; fixture names absent */);
it('localClock handles DST in America/New_York', /* 2026-03-08 and 2026-11-01 */);
```

- [ ] **Step 2: Run** `node --import tsx --test tests/marketing-alert-evaluator.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `scripts/lib/marketing-alert-evaluator.cjs` with the interfaces and algorithm above.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/lib/marketing-alert-evaluator.cjs tests/marketing-alert-evaluator.test.mjs
git commit -m "feat(marketing): alert evaluator with realtime ticks and daily digest"
```

---

### Task 7: Relay shared-channel delivery under `MARKETING_DEPLOY`

**Files:**
- Modify: `scripts/notification-relay.cjs`
  - config block, lines 39–56
  - `sendSlack`, 589–628 (the deactivate call is at 623)
  - `sendEmail`, 729
  - `processEvent` head, 1541–1544. The marketing branch goes before `fetchEnabledRules`, and therefore before the PRO filter at 1618–1624.
  - the `require.main` block, 1806
  - `module.exports`, 1818
- Modify: `api/notify.ts:38` (`INTERNAL_EVENT_TYPES`)
- Modify: `tests/notify-internal-events.test.mts`
- Test: `tests/notification-relay-marketing.test.mjs`

**Interfaces:**
- Consumes:
  - Task 4's routes, through `createConvexMarketingDeps`.
  - `isMarketingDeploy(env)` from W0's `scripts/lib/marketing-deploy-flag.cjs` (Resolution 11).
  - Task 6's `startMarketingEvaluator` and `createMarketingRpcCaller`.
  - the existing `decrypt`, `buildSlackMessagePayload`, `escapeSlackText`, `sanitizeNotificationTitle`, `sanitizeNotificationLinkUrl`, `upstashDedupSetNx` and `upstashRest`.
- Produces:
  - `const MARKETING_DEPLOY = isMarketingDeploy(process.env)` (required from `./lib/marketing-deploy-flag.cjs`).
  - Ownership: W8 is the only workstream editing the relay's Pro filter path (Resolution 21). It does so by routing marketing events before rule matching; line 1618–1624 itself is unchanged.
  - `sendSlack(userId, webhookEnvelope, text, opts = {})`. On 404/410 it calls `opts.onGone ?? (() => deactivateChannel(userId, 'slack'))`, so existing callers behave the same.
  - `sendEmail(email: string | string[], subject, text)`. An array is passed straight to Resend's `to`.
  - `formatMarketingAlertText(event): string`. Example: `[Weather] Fixture Acme Roofing\nTornado Warning\n<url>`. The kind label is one of Weather, Mention, Holiday/Event, Demand trend.
  - `formatMarketingDigestText(event): string`. Starts with `Marketing digest — YYYY-MM-DD`, then one line per item, grouped by client.
  - `formatMarketingSubject(event)`. Either `[Marketing] <kind>: <clientName>` or `[Marketing] Daily digest YYYY-MM-DD`.
  - `processMarketingEvent(event): Promise<{ delivered: boolean; reason?: 'flag_off'|'user_submitted'|'duplicate'|'no_channel'|'decrypt_failed'|'send_failed' }>`. Steps, in order:
    1. Drop if `!MARKETING_DEPLOY`.
    2. Drop if `event.userId` is present.
    3. Run `upstashDedupSetNx('wm:notif:dedup:marketing:' + sha256Hex(dedupKey or 'digest:'+date))` and drop on `'duplicate'`.
    4. Fetch the channel.
    5. Slack: `sendSlack('marketing-shared', target, text, { onGone: () => console.warn('[relay][marketing] shared Slack webhook gone; reconfigure in Alerts panel') })`.
    6. Email: `decrypt(target).split(',')` gives the list, then `sendEmail(list, subject, text)`.
    7. On success, `markDelivered([...dedupKeys])`.
  - `processEvent`: the first lines become `if (event.eventType === 'marketing_alert' || event.eventType === 'marketing_digest') { await processMarketingEvent(event); return; }`.
  - Startup: in the `require.main` block, `if (MARKETING_DEPLOY && process.env.MARKETING_EVALUATOR_KEY)`, call `startMarketingEvaluator(...)`. The real deps are:
    - `lpush`: `upstashRest('LPUSH', EVENT_QUEUE_KEY, msg)`
    - `setNx`: `upstashRest('SET', key, '1', 'NX', 'EX', ttl)`
  - If the flag is on but the key is unset, log `[relay][marketing] evaluator disabled: MARKETING_EVALUATOR_KEY unset`.
  - `api/notify.ts`: `INTERNAL_EVENT_TYPES` gains `'marketing_alert'` and `'marketing_digest'`.
  - Exports `processMarketingEvent`, `formatMarketingAlertText`, `formatMarketingDigestText`.

- [ ] **Step 1: Write the failing tests**

`tests/notification-relay-marketing.test.mjs` uses the harness from `tests/notification-relay-welcome-identity.test.mjs`: set env, `delete require.cache`, patch `Module._load` for `resend`, and stub `globalThis.fetch`. Set `ENCRYPTION_KEY_V1` and build the envelope with `scripts/lib/crypto.cjs` `encrypt`.

```js
it('flag off: marketing_alert is dropped, no Convex/Slack fetch', async () => { /* MARKETING_DEPLOY unset */ assert.equal((await processMarketingEvent(ev)).reason, 'flag_off'); assert.equal(fetchCalls.length, 0); });
it('flag on: slack delivered via shared channel and marked delivered', /* fetch sequence: Upstash SET NX -> /relay/marketing-channel -> hooks.slack.com POST -> /relay/marketing-mark-delivered */);
it('processEvent routes marketing_alert before enabled-rules and entitlement', /* no request to /relay/enabled-rules or /relay/entitlement */);
it('event with userId is dropped (user_submitted)', /* ... */);
it('relay-side duplicate (SET NX returns null) sends nothing', /* ... */);
it('email channel sends one Resend call with to: [a,b]', /* ... */);
it('Slack 410 does not call /relay/deactivate; delivered stays false', /* ... */);
it('no channel configured -> no_channel, no mark-delivered', /* ... */);
it('digest text groups by client and lists every item', /* formatMarketingDigestText */);
it('non-marketing rss_alert path unchanged with flag on', /* still calls /relay/enabled-rules */);
```

`tests/notify-internal-events.test.mts` gets one more assertion:

```ts
assert.equal(isInternalNotifyEventType('marketing_alert'), true);
assert.equal(isInternalNotifyEventType('marketing_digest'), true);
```

- [ ] **Step 2: Run both suites and confirm they fail.**
  - Run: `node --import tsx --test tests/notification-relay-marketing.test.mjs`
  - Run: `node --import tsx --test tests/notify-internal-events.test.mts`
  - Expected: FAIL.
- [ ] **Step 3: Make the relay and `api/notify.ts` edits** listed under Interfaces. Change nothing else in `processEvent`.
- [ ] **Step 4: Run both suites again, then the existing relay suites** to prove other event types are unchanged:
  - Run: `node --import tsx --test tests/notification-relay-*.test.mjs tests/notify-internal-events.test.mts tests/weather-alert-notify-fanout.test.mjs`
  - Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/notification-relay.cjs api/notify.ts tests/notification-relay-marketing.test.mjs tests/notify-internal-events.test.mts
git commit -m "feat(marketing): relay delivers marketing alerts to shared channel under MARKETING_DEPLOY"
```

---

### Task 8: Alerts service and `MarketingAlertsPanel`

**Files:**
- Create: `src/services/marketing/alerts.ts`
- Replace: `src/components/marketing/MarketingAlertsPanel.ts` (W0 placeholder)
- Modify: `src/locales/en.json` (add the `marketing.alerts.*` keys)
- Test: `tests/dom/marketing-alerts-panel.test.mts`

**Interfaces:**
- Consumes:
  - `getConvexClient()` from `src/services/convex-client.ts:180`.
  - `api.marketing.alerts.*` (Tasks 2–3), through a dynamic `import('../../../convex/_generated/api')`, the same as `convex-client.ts:528`.
  - `getClients`, `subscribeClients`, `getRosterStatus` and `onRosterStatusChange` from `roster.ts` (Resolution 18).
  - `getFocusedClientId` and `onFocusChange` from `focus.ts`. `onFocusChange` does not fire on subscribe (Resolution 13), so the panel reads `getFocusedClientId()` once at construction.
  - `renderNoClientsState()` and `renderSourceUnavailable()` from `src/components/marketing/empty-state.ts` (W0, Resolution 18).
  - Task 1 types and `RULE_DEFAULTS`.
  - `h()` from `src/utils/dom-utils.ts`, `sanitizeUrl` from `src/utils/sanitize.ts`, and `Panel.setContentNodes`.
- Produces from `src/services/marketing/alerts.ts`:
  - `subscribeRecentEvents(cb: (s: { status: 'ready'; events: MarketingAlertEvent[] } | { status: 'unavailable' }) => void): Promise<() => void>`. Uses `client.onUpdate(listRecentEvents, { limit: 100 })`. A null client emits `unavailable`.
  - `getAlertSettings(): Promise<{ channel: AlertChannelSummary | null; canEditChannel: boolean } | null>`
  - `saveAlertChannel(kind: 'slack'|'email', target: string): Promise<void>`
  - `listClientRules(clientId: string): Promise<ClientAlertRule[]>`
  - `saveClientRule(clientId: string, kind: MarketingSignalKind, enabled: boolean, params: object): Promise<void>`
- Panel behaviour (`id: 'marketing-alerts'`, title `t('marketing.alerts.title')`, `showCount: true`). The render order decides which state wins:
  1. `unavailable`: show `marketing.alerts.unavailable`.
  2. Roster status `forbidden` or `error`: show `renderSourceUnavailable()`; `loading`: the panel's existing loading state.
  3. Empty roster (`ready` with no active clients): show `renderNoClientsState()`.
  4. No events: show `marketing.alerts.noEvents`.
  5. Otherwise, a feed row per event:
     - a kind chip, the client name (from the roster; `marketing.alerts.unknownClient` if missing or inactive), the title, a link only when `sanitizeUrl(url)` is non-empty, and a relative time,
     - a muted `marketing.alerts.notDelivered` tag when `!delivered`.
  - When a client is focused, the feed shows only that client's events. If the focused client is inactive, `focus.ts` clears focus (Resolution 12); the panel just follows `onFocusChange`.
  - Map signals: `MarketingLayerContext.signals` is reserved for W8 (Resolution 9), but no W0–W9 layer builder renders it, so this panel does not call `setMarketingLayerContext`.
  - `setCount(events in the last 24h)`.
- The gear button opens the settings view:
  - **Channel form:** shown only when `canEditChannel`. Non-admins see `marketing.alerts.channelReadOnly` with the kind and the updated date. Errors render inline with their code.
  - **Rules editor:** shown when a client is focused; otherwise `marketing.alerts.selectClient`. It has four rows (weather, mention, calendar, trend), each with an enabled checkbox and a param input pre-filled from `RULE_DEFAULTS`.
  - **Render safety:** all DOM goes through `h()` and `setContentNodes`, with no HTML strings (`lint:safe-html`).
- en.json keys and copy, under `marketing.alerts`:

  | Key | English copy |
  |---|---|
  | `title` | Alerts |
  | `unavailable` | Alerts need Convex. See docs/marketing-setup.md. |
  | `noEvents` | No alerts yet. Rules fire on new storms, mentions, holidays and trends. |
  | `notDelivered` | Not delivered |
  | `unknownClient` | Removed client |
  | `settings` | Alert settings |
  | `channelReadOnly` | Shared channel: {{kind}} (updated {{date}}) |
  | `channelNone` | No shared channel configured |
  | `selectClient` | Select a client to edit its rules |
  | `save` | Save |
  | `kind.weather` | Weather |
  | `kind.mention` | Mention |
  | `kind.calendar` | Holiday/Event |
  | `kind.trend` | Demand trend |

  (The empty-roster and source-unavailable copy come from W0's `marketing.empty.noClients` and `marketing.common.sourceUnavailable`; no `marketing.alerts.emptyRoster` key.)

- [ ] **Step 1: Write the failing test** `tests/dom/marketing-alerts-panel.test.mts`. Use `vi.mock` for `@/services/marketing/alerts`, `@/services/marketing/roster` and `@/services/marketing/focus`, following the pattern in `tests/dom/fx-panel-data.test.mts`.

```ts
it('unavailable state explains setup', /* emit {status:'unavailable'} -> text contains 'docs/marketing-setup.md' */);
it('empty roster renders renderNoClientsState()', /* getClients -> [], status ready */);
it('roster forbidden/error renders renderSourceUnavailable()', /* getRosterStatus -> 'forbidden' */);
it('initial focus read without onFocusChange firing', /* getFocusedClientId -> 'c1' at construction -> only c1 rows */);
it('renders events newest first with Not delivered tag', /* ... */);
it('focus filters to one client and back', /* onFocusChange cb('c1') -> only c1 rows; cb(null) -> all */);
it('javascript: url renders no link', /* url 'javascript:alert(1)' -> no <a> */);
it('member sees read-only channel, admin sees form', /* canEditChannel false/true */);
it('rule save calls saveClientRule with normalized defaults', /* toggle weather -> saveClientRule('c1','weather',true,{minSeverity:'warning'}) */);
it('event title with <img onerror> renders as text', /* no img element */);
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-alerts-panel.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement the service, the panel and the en.json keys** as specified above, then run `npm run sync:locales` (and `npm run locales:zh-tw` if zh-TW is flagged) per Resolution 1.
- [ ] **Step 4: Run the same command, then the checks below one at a time.** Expected: all PASS.
  - Run: `npm run typecheck`
  - Run: `npm run lint:boundaries`
  - Run: `npm run lint`
- [ ] **Step 5: Commit**

```bash
git add src/services/marketing/alerts.ts src/components/marketing/MarketingAlertsPanel.ts src/locales/ tests/dom/marketing-alerts-panel.test.mts
git commit -m "feat(marketing): alerts service and MarketingAlertsPanel"
```

---

### Task 9: `npm run marketing:test-alert` (Resolution 22)

**Files:**
- Create: `scripts/marketing-test-alert.mjs`
- Modify: `package.json` (add `"marketing:test-alert": "node scripts/marketing-test-alert.mjs"`)
- Test: `tests/marketing-test-alert.test.mjs`

**Interfaces:**
- Consumes: `loadEnvFile()` from `scripts/_seed-utils.mjs` (credentials only through it, per AGENTS.md); Task 6 `createConvexMarketingDeps`; W0's `marketing-deploy-flag.cjs`; `buildDedupKey` format.
- Produces:
  - `runTestAlert(deps: { convex, lpush, now(): number }) -> Promise<{ dedupKey: string; status: 'new'|'duplicate'; queued: boolean }>`. It records one `kind: 'weather'`, `clientId: 'test'`, title `Marketing alert test`, `dedupKey = 'weather:test:test-<nowMs>'` through `recordEvents`, then LPUSHes a `marketing_alert` with `clientName: 'Test'` onto `wm:events:queue`, so the delivery shows in the panel and the shared channel.
  - CLI: exits 1 with a clear message when `MARKETING_DEPLOY` is off or `CONVEX_SITE_URL`, `CONVEX_NOTIFICATION_RELAY_SECRET` or `UPSTASH_REDIS_REST_URL` is unset. Prints only the dedup key and status.
- W9's `docs/marketing-setup.md` references this command; W8 does not edit that doc.

- [ ] **Step 1: Write the failing test** `tests/marketing-test-alert.test.mjs` with fakes: records one event then pushes one `marketing_alert` whose payload passes `processMarketingEvent`'s shape checks; flag off -> throws before any fetch; missing env -> lists the missing names.
- [ ] **Step 2: Run** `node --import tsx --test tests/marketing-test-alert.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the script and the `package.json` entry.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/marketing-test-alert.mjs package.json tests/marketing-test-alert.test.mjs
git commit -m "feat(marketing): add marketing:test-alert command"
```

---

### Task 10: End-to-end verification and PR delivery

**Files:** none new. This task verifies only.

**Interfaces:**
- Consumes: everything above, plus W9's compose `notification-relay` service, if it has merged.
- Produces: a PR to the fork's `main` with screenshots.

- [ ] **Step 1: Rebase on W2's merge** (`requireMarketingMember` real impl), as the index requires. Regenerate `convex/_generated/` with `npx convex codegen` (Resolution 17); for locale conflicts take the base version and re-run `npm run sync:locales` (Resolution 1). Then run `npm run --silent agent:preflight -- --mode repair`. Expected: readiness ok, or blockers resolved per `nextAction`.
- [ ] **Step 2: Run the heavy suites one at a time.** Expected: all PASS.
  - Run: `npm run test:convex`
  - Run: `npm run test:data`
  - Run: `npm run test:dom`
  - Run: `npm run typecheck:api`
  - Run: `git diff --check`
- [ ] **Step 3: Do a local smoke test of the realtime path.**
  - With `MARKETING_DEPLOY=1` in Convex and the relay, configure a test Slack webhook in the panel as admin.
  - Enable a weather rule on a `Fixture ` client.
  - Run `npm run marketing:test-alert` (Task 9).
  - Expected:
    - exactly one Slack message,
    - the panel row flips to delivered,
    - re-LPUSHing the same queue message produces no second message.
  - Record which parts were exercised (relay, Convex, panel) and which were not (live NWS, until W4's handler and W9's evaluator key are wired).
- [ ] **Step 4: Capture screenshots of the panel** in these states at desktop and mobile widths, labelled with the tested commit, using test data only:
  - feed
  - empty roster
  - unavailable
  - admin settings
  - member settings
- [ ] **Step 5: Open the PR, then attach the screenshots.**
  - Push the branch and open the PR (description ends with the Claude Code attribution line).
  - Run: `gh pr edit <n> --attach '/abs/path.png#…'` for each image.
  - Verify the images render in the PR description.

## Contract Issues (resolved)

1. `isMarketingDeploy` semantics and CJS mirror -> Resolution 11. W0 ships the real reader and `scripts/lib/marketing-deploy-flag.cjs` with its parity test; W8's `isMarketingDeployEnv` is deleted.
2. Evaluator service credential and relay image/env -> Resolution 21 (gateway accepts `WORLDMONITOR_VALID_KEYS`; Dockerfile copies `scripts/lib/marketing-*`). W8 dropped its `quiet-hours.cjs` dependency so the glob suffices. Env documentation stays with W9.
3. Relay PRO filter ownership -> Resolution 21 (W8 only).
4. Missing `marketingAlertEvents` index -> Resolution 16 (`by_client_firedAt`, W0).
5. `WeatherAlert` lacks zone codes -> Resolution 4 (`zone_codes`, `state_codes`, mapped severity) plus Known source limits (W4 fills geometry from zones). Weather rules now use the mapped `watch|warning` scale.
6. `clientId` type -> Resolution 12 (Convex document id string).
7. Shared geometry -> Resolution 10 (`polygonTouchesServiceArea(loc, geojson)` in shared geo). W8 keeps a CJS mirror for the relay, pinned by a parity test.

New unresolved issues: none.
