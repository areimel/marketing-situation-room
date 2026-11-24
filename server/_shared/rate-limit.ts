import { SUB_REQUEST_MARKER_HEADER } from './sub-request-admission';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getClientIp, hasUnprovenCloudflareClientIp, UNKNOWN_CLIENT_IP } from './client-ip';
// @ts-expect-error — JS module, no declaration file
import { captureSilentError } from '../../api/_sentry-edge.js';
// @ts-expect-error — JS module, no declaration file
import { durationToSeconds, limitWithFallback, resetRateLimitFallbackForTest } from '../../api/_rate-limit-fallback.js';

// Client-IP derivation lives in the dependency-free client-ip.ts (#5231) so
// seeder-reachable modules (usage.ts) can use it without pulling this file's
// @upstash imports into Railway containers. Re-exported here because this was
// the helpers' original home and existing callers import them from this
// module (getClientIp: api/ask.ts, api/a2a.ts, api/mcp-proxy.ts;
// UNKNOWN_CLIENT_IP: turnstile.ts; plus the rate-limit test suites).
export { getClientIp, hasCloudflareTransitProof, hasUnprovenCloudflareClientIp, UNKNOWN_CLIENT_IP } from './client-ip';

// @upstash/redis defaults to 5 retries with exponential backoff (~4.3s total)
// before surfacing an unreachable-Redis error. The node test runner sets
// NODE_TEST_CONTEXT in the child that executes each file; in that context the
// fail-open / fail-closed rate-limit tests point UPSTASH_REDIS_REST_URL at a
// fake host and would otherwise burn that full backoff on every limiter call.
// Skip retries under the test runner only — production (env unset) keeps the
// resilient default untouched. Mirrors the retry:false already shipped on the
// MCP limiter to unblock the suite (PR #3963).
const REDIS_TEST_RETRY_OPTS: { retry?: false } = process.env.NODE_TEST_CONTEXT ? { retry: false } : {};
// @upstash/ratelimit v2 returns an allow-shaped result with reason="timeout"
// when this deadline wins the Redis race. Endpoint policies inspect that
// reason below and fail closed; keeping the SDK timeout enabled bounds the
// outage latency instead of waiting for the platform function timeout.
const ENDPOINT_RATE_LIMIT_TIMEOUT_MS = process.env.NODE_TEST_CONTEXT ? 250 : 5_000;
// Abort the underlying Upstash fetch just before the SDK's availability-first
// race expires. Without this, the SDK returns its timeout result but leaves the
// Redis request alive in the isolate for an unbounded transport stall.
const ENDPOINT_REDIS_ABORT_TIMEOUT_MS = process.env.NODE_TEST_CONTEXT ? 20 : 4_500;
// The two deadlines are a PAIR, and the NODE_TEST_CONTEXT pair is deliberately
// not the production ratio scaled down. Production's ordering is safe because
// its 500ms gap dwarfs the few milliseconds the Upstash client needs to build a
// request and call the `signal` factory in getEndpointRatelimit() -- the abort
// timer does not start until then, while the SDK's decision timer starts at
// limit(). Under the node test runner that arming cost is 8-71ms (tsx compile
// plus per-test module re-import dominate it), so the original 25/20 pair left
// as little as 1.1ms of headroom and inverted under `--test-concurrency=16`:
// the decision resolved first and the transport was still pending when the
// assertion read it. The gap therefore has to exceed the arming cost rather
// than mirror the production ratio -- a short abort so the suite still fails
// fast, with the decision deadline well behind it. Pinned by
// tests/rate-limit.test.mts.
export const __ENDPOINT_LIMITER_DEADLINES_FOR_TEST = Object.freeze({
  decisionMs: ENDPOINT_RATE_LIMIT_TIMEOUT_MS,
  abortMs: ENDPOINT_REDIS_ABORT_TIMEOUT_MS,
});

let ratelimit: Ratelimit | null = null;
const GLOBAL_RATE_LIMIT = 600;
const GLOBAL_RATE_WINDOW: Duration = '60 s';
const GLOBAL_RATE_WINDOW_SECONDS = durationToSeconds(GLOBAL_RATE_WINDOW);

function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  ratelimit = new Ratelimit({
    redis: new Redis({ url, token, ...REDIS_TEST_RETRY_OPTS }),
    limiter: Ratelimit.slidingWindow(GLOBAL_RATE_LIMIT, GLOBAL_RATE_WINDOW),
    prefix: 'rl',
    analytics: false,
  });
  return ratelimit;
}

// Structured one-line log so api/server log aggregation can grep for the
// "rate-limit available" gap independently of Sentry. Keep the prefix
// stable — operators and the api/_rate-limit.js mirror both emit it.
// Decide the Sentry level for a degraded-rate-limit capture. Upstash runtime
// transients — the Lua limiter script timing out under fan-out load
// (`ERR Error running script: execution timed out`), a dropped command, or a
// network/timeout blip — are absorbed by the fail-open / `failClosed`-503 path,
// so the user is unaffected. Capture those at `warning` so a sustained Redis
// outage still escalates by volume without a transient script-timeout drowning
// genuine error-level signal in the dashboard (WORLDMONITOR-RX; mirrors the
// SERVICE_UNAVAILABLE `level: 'warning'` precedent in api/user-prefs.ts). A
// `missing-config` stage is a real deploy misconfiguration and any novel error
// is unclassified — both stay at `error` so on-call still sees them.
//
// `aborted due to timeout` / `TimeoutError` is our OWN deadline reporting in:
// getEndpointRatelimit arms `AbortSignal.timeout(ENDPOINT_REDIS_ABORT_TIMEOUT_MS)`
// on the Upstash client, so a stalled transport rejects with a DOMException
// phrased "The operation was aborted due to timeout" — no `timed out`, no
// `network`, so the pre-existing alternation scored it `error`. That split the
// one condition in two: the SDK-race arm throws `Upstash endpoint rate-limit
// decision timed out` (already `warning`) while the abort arm paged
// (WORLDMONITOR-VM). Both are absorbed by the same fail-closed 503.
// Mirrored verbatim in api/_rate-limit.js.
//
// Exported purely as a test seam: the classification is only observable through
// a Sentry capture otherwise, and a source-regex assertion would false-pass on
// the mirror drifting. tests/rate-limit.test.mts calls both copies directly.
export function rateLimitErrorLevel(stage: string, msg: string): 'warning' | 'error' {
  if (stage.includes('missing-config')) return 'error';
  if (/Error running script|execution timed out|Command failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|network|timed out|aborted due to timeout|TimeoutError|socket hang up|Redis unavailable|Redis unreachable/i.test(msg)) {
    return 'warning';
  }
  return 'error';
}

const RATE_LIMIT_SENTRY_DEDUP_MS = 60_000;
const lastRateLimitSentryCaptureAt = new Map<string, number>();

// Failure-mode suffixes worth their own Sentry issue. These are a closed set —
// unlike a route or scope, they describe HOW the limiter failed, not who called
// it, so they never grow with traffic.
const RATE_LIMIT_FINGERPRINT_SUFFIXES = new Set(['missing-config', 'timeout', 'edge-proof']);

/**
 * Collapse a limiter stage to the low-cardinality token Sentry should GROUP on.
 *
 * Stage strings deliberately embed the caller so the `stage` tag can answer
 * "which routes are affected": `checkEndpointRateLimit:/api/market/v1/list-market-quotes`,
 * `checkScopedRateLimit:/api/skills/fetch-agentskills`. That is right for a tag
 * and wrong for a fingerprint — Sentry groups by fingerprint, so the raw stage
 * mints one issue PER ROUTE for a single Redis slowdown. With 213 gateway
 * routes behind checkEndpointRateLimit, one incident can open 213 issues; the
 * triage sweep on 2026-08-11 found seven live issues and two ignored ones for
 * this single condition, three of them created within two minutes of each other.
 *
 * Group on the stage's head, keeping only a closed set of failure-mode suffixes.
 * The full stage stays a tag, so per-route breakdown is preserved inside the one
 * issue. Exported as a pure function so the mapping is unit-testable rather than
 * asserted through a Sentry capture. (#6454)
 */
export function rateLimitFingerprintStage(stage: string): string {
  const parts = String(stage ?? '').split(':');
  const head = parts[0] || 'rate-limit';
  const last = (parts.length > 1 ? parts[parts.length - 1] : '') ?? '';
  return RATE_LIMIT_FINGERPRINT_SUFFIXES.has(last) ? `${head}:${last}` : head;
}

export function reportRateLimitDegraded(
  stage: string,
  err: unknown,
  surface: 'api' | 'server' = 'server',
): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[rate-limit] redis-error stage=${stage} msg=${msg}`);
  // Keep every occurrence in provider logs, but emit at most one Sentry event
  // per limiter stage per minute from this isolate. A Redis outage otherwise
  // turns every fail-closed request into another identical ingestion event.
  // Dedup stays keyed on the FULL stage (not the fingerprint) so an incident
  // still reports one event per affected route — that is what makes the
  // per-route `stage` tag breakdown inside the grouped issue meaningful.
  const now = Date.now();
  const lastCaptureAt = lastRateLimitSentryCaptureAt.get(stage);
  if (lastCaptureAt !== undefined && now - lastCaptureAt < RATE_LIMIT_SENTRY_DEDUP_MS) return;
  lastRateLimitSentryCaptureAt.set(stage, now);
  captureSilentError(err, {
    tags: { surface, component: 'rate-limit', stage },
    fingerprint: ['rate-limit', 'redis-error', rateLimitFingerprintStage(stage)],
    level: rateLimitErrorLevel(stage, msg),
  });
}

const scopedMissingConfigStages = new Set<string>();

function logScopedRateLimitMissingConfig(scope: string): void {
  const stage = `checkScopedRateLimit:${scope}:missing-config`;
  if (scopedMissingConfigStages.has(stage)) return;
  scopedMissingConfigStages.add(stage);
  reportRateLimitDegraded(stage, new Error('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing'));
}

// One-per-isolate latch for edge-proof rejections. Spoofed cf-connecting-ip
// headers are caller-controlled on a direct origin hit; reporting every 403
// would create an amplification path (mirrors api/mcp/auth.ts). (#8402)
const EDGE_PROOF_RATE_LIMIT_LATCH = Symbol.for('worldmonitor.rate-limit.edge-proof-reported.v1');

function reportEdgeProofRequiredOnce(stage: string, err: Error): void {
  const existing = Reflect.get(globalThis, EDGE_PROOF_RATE_LIMIT_LATCH) as
    | { reported: boolean }
    | undefined;
  const latch = existing ?? { reported: false };
  if (!existing) Reflect.set(globalThis, EDGE_PROOF_RATE_LIMIT_LATCH, latch);
  if (latch.reported) return;
  latch.reported = true;
  reportRateLimitDegraded(stage, err);
}

export function resetEdgeProofRateLimitReportedForTest(): void {
  const latch = Reflect.get(globalThis, EDGE_PROOF_RATE_LIMIT_LATCH) as
    | { reported: boolean }
    | undefined;
  if (latch) latch.reported = false;
}

// Marker header set on every degraded (fail-closed) response so observability
// can correlate "rate-limit unavailable" windows with downstream behaviour
// without parsing the JSON body. Mirrored in api/_rate-limit.js.
export const RATE_LIMIT_DEGRADED_HEADERS = {
  'X-RateLimit-Mode': 'degraded',
  // Short Retry-After encourages clients to retry once the limiter is back,
  // rather than treating the 503 as a hard outage.
  'Retry-After': '5',
} as const;

function tooManyRequestsResponse(limit: number, reset: number, corsHeaders: Record<string, string>, windowSeconds: number): Response {
  // `reset` is a Unix epoch in MILLISECONDS (Upstash). IETF RateLimit fields
  // carry a delta-seconds reset (`t` / RateLimit-Reset), NOT an epoch — derive
  // it here. Legacy X-RateLimit-Reset stays epoch-ms for back-compat.
  const resetSeconds = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      // IETF RateLimit fields (draft-ietf-httpapi-ratelimit-headers). The
      // combined RateLimit member references the "default" policy advertised on
      // every API response via vercel.json so agents can self-throttle. Mirrors
      // api/_rate-limit.js.
      'RateLimit-Policy': `"default";q=${limit};w=${windowSeconds}`,
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(resetSeconds),
      RateLimit: `"default";r=0;t=${resetSeconds}`,
      // Legacy X-RateLimit-* retained for back-compat (Reset is epoch-ms).
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(reset),
      'Retry-After': String(resetSeconds),
      ...corsHeaders,
    },
  });
}

function rateLimitDegradedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'Rate-limit service temporarily unavailable' }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...RATE_LIMIT_DEGRADED_HEADERS,
      ...corsHeaders,
    },
  });
}

// 403 for IP-scoped budgets when cf-connecting-ip arrives without a valid
// x-wm-edge-proof. Distinct from the Redis-degraded 503: the limiter is fine,
// the Cloudflare transit proof is not. (#8402)
function edgeProofRequiredResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'Cloudflare edge proof required' }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      'X-RateLimit-Mode': 'edge-proof',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

/** Reject unproven Cloudflare IPs before an IP-scoped budget or Redis fallback. */
export function checkIpScopedEdgeProof(request: Request, corsHeaders: Record<string, string>): Response | null {
  if (!hasUnprovenCloudflareClientIp(request)) return null;
  reportEdgeProofRequiredOnce(
    'ip-scoped:edge-proof',
    new Error('Cloudflare client IP arrived without a valid x-wm-edge-proof'),
  );
  return edgeProofRequiredResponse(corsHeaders);
}

export interface RateLimitOptions {
  /**
   * When true and Redis is unavailable, return a 503 (with the
   * `X-RateLimit-Mode: degraded` marker) instead of allowing the request
   * through. Pass `true` for endpoints where the rate-limit IS the abuse
   * defence (LLM, checkout, lead capture). Default `false` keeps the
   * availability-first posture for general traffic so a Redis blip doesn't
   * black-hole the whole site. (#3531)
   */
  failClosed?: boolean;
  /**
   * Optional trusted server-derived user ID for policies that should isolate
   * authenticated principals sharing one public IP. Callers must never pass a
   * raw client-controlled header here. The limiter owns the namespace prefix
   * so user IDs cannot collide with anonymous IP buckets.
   */
  principalUserId?: string;
  /**
   * Which credential the caller presented. A user's API key and their browser
   * session resolve to the SAME Clerk user id, so without this they share one
   * per-minute bucket and programmatic traffic starves the interactive session
   * behind the same account (WORLDMONITOR-12A: a scraper on an api_starter key
   * spent 598 of 600, leaving that customer's own dashboard 2 successes and 22
   * × 429). Defaults to `session`, which keeps the established `user:` key so
   * in-flight buckets are not reset.
   *
   * This separates namespaces; it does not exempt anyone. Each scope is still
   * capped at the same per-minute limit, so the aggregate a single account can
   * spend across both credentials doubles by design — programmatic use is
   * metered by the plan's own `apiRateLimit` + daily allowance, which is the
   * meter that should bound it.
   */
  principalScope?: PrincipalRateLimitScope;
}

export type PrincipalRateLimitScope = 'session' | 'api_key';

export type EndpointRateLimitOptions = RateLimitOptions;

/**
 * Header the gateway stamps with the rate-limit principal it RESOLVED for a
 * request (`<scope>:<userId>`), so a handler that re-dispatches sub-requests
 * can charge the caller's own budget without re-deriving identity itself.
 *
 * A handler cannot do that derivation safely: the credential headers it can
 * see are raw and unvalidated, so a `wm_` prefix proves nothing about which
 * bucket the gateway actually charged. Only the gateway knows, and it only
 * knows after auth resolution completes.
 *
 * This is a gateway-internal trusted marker, exactly like
 * TRUSTED_USER_ID_HEADER: the gateway is the only layer permitted to set it,
 * and it strips inbound client copies at handler entry.
 */
export const TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER = 'x-wm-rl-principal';

/** Opaque single-use admission, authenticated by consumeSubRequestAdmission. */
export { SUB_REQUEST_MARKER_HEADER } from './sub-request-admission';

export function formatTrustedRateLimitPrincipal(
  principalUserId: string,
  scope: PrincipalRateLimitScope,
): string {
  return `${scope}:${principalUserId}`;
}

/**
 * Reads the gateway-stamped principal back into limiter options. Returns `{}`
 * for anything unrecognised so the limiter falls back to the caller's IP —
 * the same default the gateway itself uses when no principal was resolved.
 */
export function readTrustedRateLimitPrincipal(headers: Headers): RateLimitOptions {
  const raw = headers.get(TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER);
  if (!raw) return {};
  const separator = raw.indexOf(':');
  if (separator < 1) return {};
  const scope = raw.slice(0, separator);
  const principalUserId = raw.slice(separator + 1);
  if (!principalUserId) return {};
  if (scope !== 'session' && scope !== 'api_key') return {};
  return { principalUserId, principalScope: scope };
}

/**
 * RFC 1918 172.16/12 second octets (16-31), as exact dotted prefixes. Kept
 * explicit rather than a single `'172.2'` prefix: `startsWith('172.2')` also
 * matches public space (`172.2.0.1`, `172.200.x.x`) and would misclassify
 * legitimate callers as unattributed.
 */
const SUB_REQUEST_UNATTRIBUTED_172_16_12_PREFIXES = Object.freeze([
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
]);

/**
 * Egress-IP prefixes that prove a request was built by OUR OWN edge rather
 * than by an external caller. `getClientIp` resolves server-initiated fetches
 * to the platform's egress — the same value repeated for every caller — so the
 * dispatch path treats a caller identity starting with one of these as
 * unattributed instead of handing it the shared egress bucket.
 *
 * The `10/8`, `192.168/16`, and `169.254/16` ranges cover Vercel's internal /
 * NAT egress (link-local + RFC 1918). The 172.16/12 range is spelled out
 * octet-by-octet above.
 *
 * NOTE: a routable PUBLIC egress IP is intentionally NOT matched here. This
 * helper resolves the INBOUND caller's identity (see
 * `resolveServerSubRequestCharge`); a public IP on the inbound request names
 * a real external caller and must stay attributed. Detecting the egress side
 * (a public IP shared by every caller) is the job of the sub-request marker
 * below, not of this prefix list.
 */
const SUB_REQUEST_UNATTRIBUTED_IP_PREFIXES = Object.freeze([
  '10.',
  ...SUB_REQUEST_UNATTRIBUTED_172_16_12_PREFIXES,
  '192.168.',
  '169.254.',
]);

/**
 * True when `identity` cannot name an external caller: the unknown sentinel
 * or an RFC 1918 / link-local egress range. Matching is exact on the sentinel
 * (case-insensitive, trimmed — mirroring `getClientIp`'s own normalisation)
 * and prefix-based on the dotted ranges above. Kept as a pure predicate so
 * the dispatch-layer test pins the shape without Redis.
 */
export function isUnattributedSubRequestIdentity(identity: string): boolean {
  const normalized = identity.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === UNKNOWN_CLIENT_IP) return true;
  return SUB_REQUEST_UNATTRIBUTED_IP_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export interface ServerSubRequestCharge {
  /** Limiter options the caller must spend from — never the egress bucket. */
  opts: EndpointRateLimitOptions;
  /**
   * True when the inbound request carries no initiating principal of its own
   * (no stamped principal, no usable client IP). The sub-request must be
   * refused rather than keyed to whatever IP the platform egress resolves to.
   */
  unattributed: boolean;
}

/**
 * Resolves the rate-limit identity a server-initiated sub-request must be
 * charged to, from the INBOUND caller request — the shared dispatch path for
 * every fan-out feature (batch today, any future fan-out tomorrow).
 *
 * A same-origin `fetch` re-derives `getClientIp` from the platform's egress,
 * so charging inside the sub-request hands every caller one shared bucket and
 * never touches the caller's own. Charge BEFORE dispatch instead, from the
 * inbound identity this returns:
 *   1. the gateway-stamped principal when present (the only trustworthy
 *      source — raw credential headers are unvalidated at the handler), or
 *   2. the inbound caller's IP, or
 *   3. `unattributed: true` when neither exists — the caller MUST refuse the
 *      sub-request rather than fall back to the egress IP.
 *
 * INBOUND ONLY: pass the caller's original request, never the re-dispatched
 * sub-request. A public egress IP on the inbound side names a real external
 * caller and stays attributed; the sub-request side is recognised by the
 * `SUB_REQUEST_MARKER_HEADER` admission verified by the gateway, not by this helper.
 *
 * The fallback is observable: refusal paths report through
 * `reportRateLimitDegraded` with the fixed stage
 * `chargeServerSubRequestOperation:unattributed-sub-request` (pathname travels
 * in the error message, not the stage, so Sentry grouping and the per-minute
 * dedup map stay low-cardinality), so the next fan-out that forgets to stamp
 * the principal surfaces in production logs/Sentry instead of silently
 * sharing an egress bucket. Prefer `chargeServerSubRequestOperation` below
 * over calling this directly: it takes the resolved `ServerSubRequestCharge`
 * as ONE object, so a new fan-out endpoint cannot resolve the identity and
 * then forget to honour `unattributed`. (#8399)
 */
export function resolveServerSubRequestCharge(inbound: Request): ServerSubRequestCharge {
  // Reject marked callers conservatively, whether the marker is genuine or
  // forged. Only consumeSubRequestAdmission can authenticate an inner call.
  if (inbound.headers.has(SUB_REQUEST_MARKER_HEADER)) {
    return { opts: {}, unattributed: true };
  }
  const stamped = readTrustedRateLimitPrincipal(inbound.headers);
  if (stamped.principalUserId) {
    return { opts: stamped as EndpointRateLimitOptions, unattributed: false };
  }
  const callerIp = getClientIp(inbound);
  if (callerIp && !isUnattributedSubRequestIdentity(callerIp)) {
    return { opts: {}, unattributed: false };
  }
  return { opts: {}, unattributed: true };
}

/**
 * Refusal body for an unattributed sub-request. Carries a distinct `reason`
 * (`unattributed-sub-request`) so it is greppable in logs and distinguishable
 * from a genuine 429/503 the caller would have received directly.
 */
export interface ServerSubRequestRefusal {
  status: 429;
  body: { error: string; reason: 'unattributed-sub-request' };
}

/**
 * Charges one server-initiated sub-operation against the CALLER's own budget
 * BEFORE it is dispatched. This is `chargeCaller` generalised out of the
 * batch handler so the next fan-out feature inherits it instead of
 * remembering to add it.
 *
 * Takes the `ServerSubRequestCharge` resolved by
 * `resolveServerSubRequestCharge` as ONE object — callers cannot resolve the
 * identity and then forget to honour `unattributed`, which the previous
 * split `(opts, unattributed)` signature allowed by omission.
 *
 * Returns `null` when the operation is admitted (the caller must dispatch
 * it), otherwise a refusal the caller must return WITHOUT dispatching:
 *   - an unattributed sub-request (no stamped principal AND no usable caller
 *     IP, or a request that already carries the sub-request marker) is
 *     refused with 429 `unattributed-sub-request` — fail closed rather than
 *     keying on the egress IP;
 *   - an endpoint-policy path charges `checkEndpointRateLimit` (fail-closed
 *     default preserved), everything else the global `checkRateLimit`,
 *     mirroring the gateway's two-phase order — a limiter refusal becomes the
 *     status/body the caller would have received directly.
 *
 * Account burst/daily and enterprise-key meters remain enforced by the inner
 * gateway; this pre-charge covers endpoint/global limits only.
 */
export async function chargeServerSubRequestOperation(
  inbound: Request,
  pathname: string,
  charge: ServerSubRequestCharge,
): Promise<{ status: number; body: unknown } | null> {
  if (charge.unattributed) {
    // Fixed stage: `pathname` is attacker-controlled (any documented-RPC
    // shape passes validation), so it travels in the message — embedding it
    // in the stage would mint one Sentry dedup entry per distinct path and
    // defeat the low-cardinality grouping documented above.
    reportRateLimitDegraded(
      'chargeServerSubRequestOperation:unattributed-sub-request',
      new Error(`Server-initiated sub-request for ${pathname} without a stamped principal or caller IP — refused instead of keying on egress IP`),
    );
    const refusal: ServerSubRequestRefusal = {
      status: 429,
      body: { error: 'Too many requests', reason: 'unattributed-sub-request' },
    };
    return refusal;
  }
  const refusal = await checkRateLimit(inbound, {}, charge.opts);
  if (!refusal) return null;

  let body: unknown;
  try {
    body = await refusal.json();
  } catch {
    body = {};
  }
  return { status: refusal.status, body };
}

function getPrincipalRateLimitIdentifier(
  principalUserId?: string,
  scope: PrincipalRateLimitScope = 'session',
): string | null {
  if (!principalUserId) return null;
  return scope === 'api_key' ? `apikey-user:${principalUserId}` : `user:${principalUserId}`;
}

export async function checkRateLimit(request: Request, corsHeaders: Record<string, string>, opts: RateLimitOptions = {}): Promise<Response | null> {
  const proofDenied = !opts.principalUserId && checkIpScopedEdgeProof(request, corsHeaders);
  if (proofDenied) return proofDenied;
  const rl = getRatelimit();
  if (!rl) {
    if (opts.failClosed) {
      reportRateLimitDegraded('checkRateLimit:missing-config', new Error('Upstash Redis is not configured'));
      return rateLimitDegradedResponse(corsHeaders);
    }
    return null;
  }

  // Preserve the long-standing raw-IP key for anonymous traffic so an
  // in-flight 60-second bucket does not reset during rollout. Trusted
  // principals use a separate namespace.
  const identifier =
    getPrincipalRateLimitIdentifier(opts.principalUserId, opts.principalScope) ??
    getClientIp(request);

  try {
    const { success, limit, reset } = await limitWithFallback(
      rl,
      identifier,
      `rl:fw:${identifier}`,
      GLOBAL_RATE_LIMIT,
      GLOBAL_RATE_WINDOW_SECONDS,
    );

    if (!success) {
      return tooManyRequestsResponse(limit, reset, corsHeaders, GLOBAL_RATE_WINDOW_SECONDS);
    }

    return null;
  } catch (err) {
    reportRateLimitDegraded('checkRateLimit', err);
    if (opts.failClosed) return rateLimitDegradedResponse(corsHeaders);
    return null;
  }
}

const scopedLimiters = new Map<string, Ratelimit>();

function getScopedRatelimit(scope: string, limit: number, window: Duration): Ratelimit | null {
  const cacheKey = `${scope}|${limit}|${window}`;
  const cached = scopedLimiters.get(cacheKey);
  if (cached) return cached;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const rl = new Ratelimit({
    redis: new Redis({ url, token, ...REDIS_TEST_RETRY_OPTS }),
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: 'rl:scope',
    analytics: false,
  });
  scopedLimiters.set(cacheKey, rl);
  return rl;
}

export interface ScopedRateLimitResult {
  allowed: boolean;
  limit: number;
  reset: number;
  /**
   * True when Redis was unreachable and the helper fell back to the
   * fail-open default. Callers that need fail-closed semantics should
   * gate on this — e.g. lead-capture handlers can refuse the write to
   * preserve the 3/hr budget across a Redis blip. (#3531)
   */
  degraded: boolean;
}

/**
 * Returns whether the request is under the scoped budget. `scope` is an
 * opaque namespace (e.g. `${pathname}#desktop`); `identifier` is usually the
 * client IP but can be any stable caller identifier. Fail-open on Redis errors
 * to stay consistent with checkRateLimit / checkEndpointRateLimit semantics,
 * but the `degraded` flag lets callers escalate to fail-closed locally
 * (#3531). The Redis error itself is logged once per call so silent bypass
 * windows are visible in logs / Sentry.
 */
export async function checkScopedRateLimit(scope: string, limit: number, window: Duration, identifier: string): Promise<ScopedRateLimitResult> {
  const rl = getScopedRatelimit(scope, limit, window);
  if (!rl) {
    logScopedRateLimitMissingConfig(scope);
    return { allowed: true, limit, reset: 0, degraded: true };
  }
  try {
    const result = await limitWithFallback(rl, `${scope}:${identifier}`, `rl:scope:fw:${scope}:${identifier}`, limit, durationToSeconds(window));
    // @upstash/ratelimit v2 races the Redis call against its own internal
    // timeout and RESOLVES `{ success: true, reason: 'timeout' }` instead of
    // rejecting, so this outcome never reaches the catch below. Left unhandled
    // it is indistinguishable from a genuine allow — no log, no Sentry,
    // `degraded: false` — and the limit silently disappears under exactly the
    // slow-Redis conditions the limit exists for. Report it as degraded so
    // callers gating on `degraded` can escalate and the bypass window is
    // visible in logs. Mirrors checkEndpointRateLimit's handling above.
    if (result.reason === 'timeout') {
      reportRateLimitDegraded(`checkScopedRateLimit:${scope}`, new Error('Upstash scoped rate-limit decision timed out'));
      return { allowed: true, limit, reset: 0, degraded: true };
    }
    return {
      allowed: result.success,
      limit: result.limit,
      reset: result.reset,
      degraded: false,
    };
  } catch (err) {
    reportRateLimitDegraded(`checkScopedRateLimit:${scope}`, err);
    return { allowed: true, limit, reset: 0, degraded: true };
  }
}

/**
 * Builds the standard 429 for an availability-first in-handler `checkScopedRateLimit`
 * caller (a top-level edge function that enforces its own budget, e.g.
 * api/skills/fetch-agentskills.ts). Hand-rolling the response drops the IETF
 * RateLimit-* fields that api/_cors.js exposes cross-origin specifically so
 * agents can self-throttle, which is how the same 429 condition ends up with
 * two different header shapes across sibling routes. Takes the Duration rather
 * than seconds so callers do not have to reach for durationToSeconds. (#6412 review)
 */
export function scopedTooManyRequestsResponse(
  result: ScopedRateLimitResult,
  window: Duration,
  corsHeaders: Record<string, string>,
): Response {
  return tooManyRequestsResponse(result.limit, result.reset, corsHeaders, durationToSeconds(window));
}

/**
 * Applies a distinct, fail-closed per-IP scoped guard and converts its result
 * into the gateway's standard 429/503 response contract. Use this ahead of
 * expensive identity-attribution lookups that cannot yet use the endpoint's
 * final principal-scoped bucket.
 */
export async function checkFailClosedScopedIpRateLimit(
  request: Request,
  scope: string,
  limit: number,
  window: Duration,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const proofDenied = checkIpScopedEdgeProof(request, corsHeaders);
  if (proofDenied) return proofDenied;
  const result = await checkScopedRateLimit(scope, limit, window, getClientIp(request));
  if (result.degraded) return rateLimitDegradedResponse(corsHeaders);
  if (!result.allowed) {
    return tooManyRequestsResponse(result.limit, result.reset, corsHeaders, durationToSeconds(window));
  }
  return null;
}

export function __resetRateLimitForTest(): void {
  ratelimit = null;
  scopedLimiters.clear();
  scopedMissingConfigStages.clear();
  lastRateLimitSentryCaptureAt.clear();
  resetRateLimitFallbackForTest();
}
