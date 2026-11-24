import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getClientIp, hasUnprovenCloudflareClientIp } from './client-ip';
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
export { getClientIp, hasCloudflareTransitProof, hasUnprovenCloudflareClientIp } from './client-ip';

// @upstash/redis defaults to 5 retries with exponential backoff (~4.3s total)
// before surfacing an unreachable-Redis error. The node test runner sets
// NODE_TEST_CONTEXT in the child that executes each file; in that context the
// fail-open / fail-closed rate-limit tests point UPSTASH_REDIS_REST_URL at a
// fake host and would otherwise burn that full backoff on every limiter call.
// Skip retries under the test runner only — production (env unset) keeps the
// resilient default untouched. Mirrors the retry:false already shipped on the
// MCP limiter to unblock the suite (PR #3963).
const REDIS_TEST_RETRY_OPTS: { retry?: false } = process.env.NODE_TEST_CONTEXT ? { retry: false } : {};
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
