import { consumeSubRequestAdmission } from './_shared/sub-request-admission';
import { hasCurrentEntitlementCoverage } from './_shared/entitlement-coverage';
/**
 * Shared gateway logic for per-domain Vercel edge functions.
 *
 * Each domain edge function calls `createDomainGateway(routes)` to get a
 * request handler that applies CORS, API-key validation, rate limiting,
 * POST-to-GET compat, error boundary, and cache-tier headers.
 *
 * Splitting domains into separate edge functions means Vercel bundles only the
 * code for one domain per function, cutting cold-start cost by ~20×.
 */

import { createRouter, toHeadResponse, type RouteDescriptor } from './router';
import { getCorsHeaders, getOriginDeniedCorsHeaders, isDisallowedOrigin } from './cors';
// @ts-expect-error — JS module, no declaration file
import { USER_API_KEY_GATEWAY_VALIDATION_ERROR, getHeaderApiKey, validateApiKey } from '../api/_api-key.js';
// @ts-expect-error — JS module, no declaration file
import { captureSilentError } from '../api/_sentry-edge.js';
import { mapErrorToResponse } from './error-mapper';
import {
  checkRateLimit,
  checkFailClosedScopedIpRateLimit,
  formatTrustedRateLimitPrincipal,
  RATE_LIMIT_DEGRADED_HEADERS,
  TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER,
} from './_shared/rate-limit';
import {
  drainResponseHeaders,
  drainRetryableResponse,
  drainSuccessStatusOverride,
} from './_shared/response-headers';
import {
  appendDeprecationPolicyLink,
  appendDeprecationPolicyLinkToRecord,
  DEPRECATION_POLICY_LINK,
} from './_shared/deprecation-policy';
import { projectJsonResponse } from './_shared/response-projection';
import {
  getBillingVerificationDenial,
  getEntitlements,
  type CachedEntitlements,
} from './_shared/entitlement-check';
import { checkProMcpAccess } from './_shared/pro-mcp-gate';
import {
  INTERNAL_MCP_SIG_HEADER,
  INTERNAL_MCP_USER_ID_HEADER,
  INTERNAL_MCP_NONCE_HEADER,
  INTERNAL_MCP_VERIFIED_HEADER,
  TRUSTED_USER_ID_HEADER,
  INTERNAL_MCP_REPLAY_CACHE_TTL_SECONDS,
  getInternalMcpVerifiedNonce,
  sha256Hex,
  verifyInternalMcpRequestDetailed,
  type InternalMcpVerifyFailure,
} from './_shared/mcp-internal-hmac';
import { buildUsageIdentity, hashKeySync, type UsageIdentityInput } from './_shared/usage-identity';
import { runRedisPipeline } from './_shared/redis';
import {
  beginIdempotency,
  peekIdempotency,
  IDEMPOTENCY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  type IdempotencyOutcome,
} from './_shared/idempotency';
import {
  checkBurst,
  reserveDailyMeter,
  rateLimitHeaders,
  ENTERPRISE_API_RATE_LIMIT,
} from './_shared/api-key-rate-limit';
import {
  deliverUsageEvents,
  buildRequestEvent,
  deriveRequestId,
  deriveExecutionRegion,
  deriveCountry,
  deriveIpCity,
  deriveIpRegion,
  deriveReqBytes,
  deriveSentryTraceId,
  deriveOriginKind,
  deriveUaHash,
  deriveIp,
  deriveUserAgent,
  deriveReferer,
  deriveAcceptLanguage,
  deriveHost,
  maybeAttachDevHealthHeader,
  runWithUsageScope,
  type CacheTier as UsageCacheTier,
  type RequestReason,
} from './_shared/usage';
import type { ServerOptions } from '../src/generated/server/worldmonitor/marketing/v1/service_server';
import { validateGeneratedRequest } from './request-validator';

export const serverOptions: ServerOptions = {
  onError: mapErrorToResponse,
  validateRequest: validateGeneratedRequest,
};

/**
 * Internal-MCP request body size cap (256 KB). Internal-MCP fetches
 * carry small JSON-RPC params; this ceiling prevents the gateway from
 * buffering arbitrarily large bodies on the strip / HMAC-verify paths.
 *
 * Applied at:
 *   - The trust-marker strip block (any Pro-marked inbound request)
 *   - The HMAC-verify block (signed internal-MCP requests)
 *
 * Both Content-Length AND post-buffer byte count are checked because
 * Content-Length can be absent / wrong for chunked or streamed bodies.
 *
 * F8 (U7+U8 review pass).
 */
const MAX_INTERNAL_MCP_BODY = 256 * 1024;

type InternalMcpReplayClaim = 'fresh' | 'replay' | 'unavailable';

/**
 * The ONE response every internal-MCP signature rejection returns.
 *
 * Routed through a single constructor on purpose: the security property is
 * that a caller cannot tell a stale timestamp from a forged signature from a
 * spent nonce, and that property is only as strong as the guarantee that no
 * branch builds its own subtly different reply. Add a new rejection mode and
 * it returns this too — status, body and headers, identical.
 */
function internalMcpSignatureDenial(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: 'invalid_internal_mcp_signature' }),
    { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

/**
 * Server-side telemetry label for a verification failure. This is the half of
 * the rejection that IS allowed to differ — it goes to wm_api_usage, never to
 * the caller.
 */
function internalMcpReasonFor(failure: InternalMcpVerifyFailure): RequestReason {
  switch (failure) {
    // Cannot normally happen here: the handler returns 500 CONFIGURATION
    // before reaching the verifier when the secret is absent. Mapped to the
    // existing config reason so a deploy incident never lands in an auth
    // dashboard.
    case 'no_secret': return 'hmac_secret_unconfigured';
    case 'no_user_id': return 'internal_mcp_no_user';
    case 'missing_signature':
    case 'malformed_signature': return 'internal_mcp_malformed_sig';
    case 'invalid_nonce': return 'internal_mcp_bad_nonce';
    case 'timestamp_window': return 'internal_mcp_ts_window';
    case 'malformed_request': return 'internal_mcp_bad_request';
    case 'signature_mismatch': return 'internal_mcp_sig_mismatch';
  }
}

function getRateLimitTelemetryReason(
  response: Response,
  rejectedReason: RequestReason,
): RequestReason {
  return response.status === 503 &&
    response.headers.get('X-RateLimit-Mode') === 'degraded'
    ? 'rate_limit_degraded'
    : rejectedReason;
}

async function claimInternalMcpReplayNonce(userId: string, nonce: string): Promise<InternalMcpReplayClaim> {
  const digest = await sha256Hex(`${userId}:${nonce}`);
  const key = `internal-mcp-replay:v1:${digest}`;
  const result = await runRedisPipeline([
    ['SET', key, '1', 'EX', INTERNAL_MCP_REPLAY_CACHE_TTL_SECONDS, 'NX'],
  ]);
  if (result.length === 0) return 'unavailable';
  const claim = result[0] as { result?: unknown; error?: unknown } | undefined;
  if (claim?.error) return 'unavailable';
  return claim?.result === 'OK' ? 'fresh' : 'replay';
}

/**
 * Creates a Vercel Edge handler for a single domain's routes.
 *
 * Applies the full gateway pipeline: origin check → CORS → OPTIONS preflight →
 * API key → rate limit → route match (with POST→GET compat) → execute → cache headers.
 */
export type GatewayCtx = { waitUntil: (p: Promise<unknown>) => void };

const POST_TO_GET_MAX_BODY_BYTES = 1_048_576;
const POST_TO_GET_MAX_ARRAY_VALUES_PER_KEY = 200;

function isPostToGetCompatibleBodySize(headers: Headers): boolean {
  const rawContentLength = headers.get('Content-Length');
  if (rawContentLength === null || !/^\d+$/.test(rawContentLength)) return false;

  const contentLength = Number(rawContentLength);
  return Number.isSafeInteger(contentLength) && contentLength < POST_TO_GET_MAX_BODY_BYTES;
}

type PostToGetScalar = string | number | boolean;

function isPostToGetScalar(value: unknown): value is PostToGetScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isPostToGetPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type PostToGetCompatField =
  | { kind: 'scalar'; name: string; value: string }
  | { kind: 'array'; name: string; values: string[] };

type PostToGetCompatParse =
  | { status: 'ok'; fields: PostToGetCompatField[] }
  | { status: 'too_large' }
  | { status: 'malformed_json' }
  | { status: 'unsupported_body' }
  | { status: 'unsupported_value'; parameter: string }
  | { status: 'oversized_array'; parameter: string };

/**
 * Decode a legacy POST body into GET query fields.
 *
 * Empty / whitespace-only bodies stay on the silent GET fallback for stale
 * clients that POST with no payload. Any other body is all-or-nothing: a
 * JSON object of scalars and scalar arrays becomes query parameters; mixed
 * or nested values, non-object JSON, and malformed JSON return 400 without
 * applying a partial translation. Compatibility-body errors are only
 * returned when a GET handler exists for the path; unknown routes still
 * 404/405. Body-read failures return 400. The 1 MB byte cap and
 * 200-values-per-key cap from #3550 still bound expansion cost.
 */
function parsePostToGetCompatBody(bodyText: string): PostToGetCompatParse {
  if (new TextEncoder().encode(bodyText).byteLength >= POST_TO_GET_MAX_BODY_BYTES) {
    return { status: 'too_large' };
  }
  if (bodyText.trim().length === 0) {
    return { status: 'ok', fields: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { status: 'malformed_json' };
  }

  if (!isPostToGetPlainObject(parsed)) {
    return { status: 'unsupported_body' };
  }

  const fields: PostToGetCompatField[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      if (value.length > POST_TO_GET_MAX_ARRAY_VALUES_PER_KEY) {
        return { status: 'oversized_array', parameter: name };
      }
      const values: string[] = [];
      for (const item of value) {
        if (!isPostToGetScalar(item)) {
          return { status: 'unsupported_value', parameter: name };
        }
        values.push(String(item));
      }
      fields.push({ kind: 'array', name, values });
      continue;
    }
    if (isPostToGetScalar(value)) {
      fields.push({ kind: 'scalar', name, value: String(value) });
      continue;
    }
    return { status: 'unsupported_value', parameter: name };
  }
  return { status: 'ok', fields };
}

function applyPostToGetCompatFields(searchParams: URLSearchParams, fields: PostToGetCompatField[]): void {
  for (const field of fields) {
    if (field.kind === 'scalar') {
      searchParams.set(field.name, field.value);
      continue;
    }
    for (const value of field.values) {
      searchParams.append(field.name, value);
    }
  }
}

function postToGetCompatErrorBody(parsed: Exclude<PostToGetCompatParse, { status: 'ok' }>): Record<string, unknown> {
  if (parsed.status === 'too_large') return { error: 'malformed_request' };
  if (parsed.status === 'malformed_json') return { error: 'Invalid JSON body for POST compatibility' };
  if (parsed.status === 'unsupported_body') return { error: 'Unsupported POST compatibility body' };
  if (parsed.status === 'oversized_array') {
    return {
      error: 'Too many values for POST compatibility parameter',
      parameter: parsed.parameter,
      maxValues: POST_TO_GET_MAX_ARRAY_VALUES_PER_KEY,
    };
  }
  return {
    error: 'Unsupported value for POST compatibility parameter',
    parameter: parsed.parameter,
  };
}

// the ONLY layer permitted to set them, and each must reflect an
// authenticated principal. Inbound client copies are stripped at handler
// entry (see stripClientTrustedHeaders); the authenticated user id is re-
// injected after Clerk / wm_ user-key / legacy bearer auth via
// withAuthenticatedUserId, and the rate-limit principal is stamped once all
// auth has resolved (see withTrustedRateLimitPrincipal).
//
// The sub-request header remains untrusted until its one-use Redis admission
// is consumed. Presence alone never bypasses a gateway limit.
function cloneRequestWithHeaders(request: Request, headers: Headers): Request {
  return new Request(request, { headers });
}

function stripClientTrustedHeaders(request: Request): Request {
  if (
    !request.headers.has(TRUSTED_USER_ID_HEADER) &&
    !request.headers.has(TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER)
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete(TRUSTED_USER_ID_HEADER);
  headers.delete(TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER);
  return cloneRequestWithHeaders(request, headers);
}

function withAuthenticatedUserId(request: Request, userId: string): Request {
  const headers = new Headers(request.headers);
  headers.set(TRUSTED_USER_ID_HEADER, userId);
  return cloneRequestWithHeaders(request, headers);
}

// Stamped after auth resolution with the principal the gateway itself charged,
// so a handler that re-dispatches sub-requests (the batch fan-out) charges the
// same bucket a direct call would instead of guessing from raw credentials.
function withTrustedRateLimitPrincipal(
  request: Request,
  userId: string,
  scope: 'session' | 'api_key',
): Request {
  const headers = new Headers(request.headers);
  headers.set(
    TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER,
    formatTrustedRateLimitPrincipal(userId, scope),
  );
  return cloneRequestWithHeaders(request, headers);
}

function normalizeAuthError(error: string | undefined): string {
  if (!error || error === USER_API_KEY_GATEWAY_VALIDATION_ERROR) return 'Invalid API key';
  return error;
}

function createGatewayAuthErrorResponse(
  status: 401 | 403,
  error: string | undefined,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: normalizeAuthError(error) }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
      Link: DEPRECATION_POLICY_LINK,
    },
  });
}

function assertProMcpGatewayHmacConfig(): void {
  const proGrantSecret = process.env.MCP_PRO_GRANT_HMAC_SECRET?.trim() ?? '';
  const internalSecret = process.env.MCP_INTERNAL_HMAC_SECRET?.trim() ?? '';
  if (proGrantSecret && !internalSecret) {
    throw new Error('MCP_INTERNAL_HMAC_SECRET must be configured when MCP_PRO_GRANT_HMAC_SECRET is set');
  }
}

export function createDomainGateway(
  routes: RouteDescriptor[],
): (req: Request, ctx?: GatewayCtx) => Promise<Response> {
  assertProMcpGatewayHmacConfig();
  const router = createRouter(routes);

  async function dispatch(originalRequest: Request, ctx?: GatewayCtx): Promise<Response> {
    let request = stripClientTrustedHeaders(originalRequest);
    const rawPathname = new URL(request.url).pathname;
    const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, '') : rawPathname;
    const t0 = Date.now();

    const usage: UsageIdentityInput = {
      sessionUserId: null,
      isUserApiKey: false,
      enterpriseApiKey: null,
      widgetKey: null,
      clerkOrgId: null,
      userApiKeyCustomerRef: null,
      tier: null,
      planKey: null,
    };
    function recordUsageEntitlement(ent: CachedEntitlements | null): void {
      if (!ent) return;
      // The synthesized verification marker is not an answer about this
      // caller's plan — it is free-SHAPED so the gates deny, nothing more.
      // Copying its tier-0/'free' fields into usage telemetry would durably
      // label unverifiable paying callers as free in Axiom, and it would do so
      // precisely during the outage window this data exists to diagnose. Leave
      // both fields null, which is what an unanswered lookup used to record
      // back when this state arrived as a null (#5619 follow-up).
      if (ent.verificationUnavailable) return;
      usage.tier = typeof ent.features.tier === 'number' ? ent.features.tier : 0;
      usage.planKey = ent.planKey;
    }
    // Domain segment for telemetry. Path layouts:
    //   /api/<domain>/v1/<rpc>          → parts[2] = domain
    //   /api/v2/<domain>/<rpc>          → parts[2] = "v2", parts[3] = domain
    const _parts = pathname.split('/');
    const domain = (/^v\d+$/.test(_parts[2] ?? '') ? _parts[3] : _parts[2]) ?? '';
    const reqBytes = deriveReqBytes(request);

    // #3199: in shadow mode a per-account limit that WOULD have triggered is
    // recorded on the single terminal success emit (never a second event) so the
    // volume signal Phase-2 pricing reuses isn't double-counted. Overrides only
    // a successful terminal reason (status < 400); a real 4xx/5xx outcome wins.
    let pendingShadowReason: RequestReason | null = null;
    // Shared emit+return for the three billing-verification denial sites below
    // (internal-MCP re-check, wm_ key, legacy bearer).
    function denyForBillingVerification(
      ent: CachedEntitlements | null | undefined,
      cors: Record<string, string>,
      capabilityCovered = false,
    ): Response | null {
      if (capabilityCovered) return null;
      const billingDenial = getBillingVerificationDenial(ent, cors);
      if (!billingDenial) return null;
      emitRequest(
        billingDenial.status,
        billingDenial.status === 503 ? 'billing_verification_503' : 'tier_403',
        null,
      );
      return billingDenial;
    }
    function emitRequest(status: number, reason: RequestReason, cacheTier: UsageCacheTier | null, resBytes = 0): void {
      if (!ctx?.waitUntil) return;
      const effectiveReason: RequestReason =
        pendingShadowReason && status < 400 ? pendingShadowReason : reason;
      const identity = buildUsageIdentity(usage);
      // Single ctx.waitUntil() registered synchronously in the request phase.
      // The IIFE awaits ua_hash (SHA-256) then awaits delivery directly via
      // deliverUsageEvents — no nested waitUntil call, which Edge runtimes
      // (Cloudflare/Vercel) may drop after the response phase ends.
      ctx.waitUntil((async () => {
        const uaHash = await deriveUaHash(originalRequest);
        await deliverUsageEvents([
          buildRequestEvent({
            requestId: deriveRequestId(originalRequest),
            domain,
            route: pathname,
            method: originalRequest.method,
            status,
            durationMs: Date.now() - t0,
            reqBytes,
            resBytes,
            customerId: identity.customer_id,
            principalId: identity.principal_id,
            authKind: identity.auth_kind,
            tier: identity.tier,
            planKey: identity.plan_key,
            country: deriveCountry(originalRequest),
            ipCity: deriveIpCity(originalRequest),
            ipRegion: deriveIpRegion(originalRequest),
            executionRegion: deriveExecutionRegion(originalRequest),
            executionPlane: 'vercel-edge',
            originKind: deriveOriginKind(originalRequest),
            cacheTier,
            ip: deriveIp(originalRequest),
            userAgent: deriveUserAgent(originalRequest),
            uaHash,
            referer: deriveReferer(originalRequest),
            acceptLanguage: deriveAcceptLanguage(originalRequest),
            host: deriveHost(originalRequest),
            sentryTraceId: deriveSentryTraceId(originalRequest),
            reason: effectiveReason,
          }),
        ]);
      })());
    }

    // Fail closed on CORS-header generation errors. Previous behaviour fell
    // back to a wildcard ACAO, which converted the allowlist into wildcard
    // CORS on the error path. Now we omit CORS headers and surface a 500
    // so the browser blocks any cross-origin read. See issue #3705.
    let corsHeaders: Record<string, string>;
    try {
      corsHeaders = isDisallowedOrigin(request)
        ? getOriginDeniedCorsHeaders(request)
        : getCorsHeaders(request);
    } catch (err) {
      // Pass the Sentry delivery promise through ctx.waitUntil so the
      // Vercel Edge isolate survives long enough to actually flush the
      // event. (captureSilentError uses keepalive:true as a transport
      // fallback when ctx is absent, but the explicit waitUntil is the
      // documented best practice.)
      const captured = captureSilentError(err, {
        tags: { route: 'gateway', step: 'cors_headers' },
      });
      ctx?.waitUntil(captured);
      emitRequest(500, 'cors_error', null);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          // Prevent CDN/edge from caching the 500 — a transient CORS
          // failure must not be pinned for downstream callers.
          'Cache-Control': 'no-store',
        },
      });
    }

    // RFC 9745 policy discovery on every CORS-bearing response, including
    // 401/403/404/405 early returns. Idempotent if a handler already set
    // rel="deprecation". Absolute URL: api.worldmonitor.app would 404 a
    // root-relative /api-versioning.md.
    appendDeprecationPolicyLinkToRecord(corsHeaders);

    // OPTIONS preflight must succeed even for origins we refuse on the actual
    // request — otherwise the browser never sends POST/GET and origin_403 is
    // an opaque network error (#6411).
    if (request.method === 'OPTIONS') {
      emitRequest(204, 'preflight', null);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Origin check — refuse with readable CORS so the browser can surface the
    // 403 instead of an opaque network error (#6411).
    if (isDisallowedOrigin(request)) {
      emitRequest(403, 'origin_403', null);
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // ----------------------------------------------------------------------
    // Defense-in-depth: strip client-controlled copies of the trusted
    // internal-MCP markers BEFORE any other logic runs. The gateway is the
    // ONLY layer permitted to set `x-wm-mcp-internal-verified` /
    // `x-user-id` / the rate-limit principal stamp. Without the strip step,
    // an attacker who sends `x-wm-mcp-internal-verified: 1` from outside
    // could spoof premium context to any handler that reads these markers
    // via `isCallerPremium`, and a forged principal stamp would let any
    // caller name the bucket their fan-out is charged to. The strip MUST run
    // regardless of whether the X-WM-MCP-Internal header is present, so that
    // the legacy `validateApiKey` path also receives a sanitised request.
    //
    // Sub-request admission is verified separately before rate limiting.
    //
    // Mutation invariant: every subsequent request reconstruction in this
    // function must build from the (already-stripped) `request`, not from
    // `originalRequest`.
    // ----------------------------------------------------------------------
    {
      const inboundHeaders = request.headers;
      if (
        inboundHeaders.has(INTERNAL_MCP_VERIFIED_HEADER) ||
        inboundHeaders.has(TRUSTED_USER_ID_HEADER) ||
        inboundHeaders.has(TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER)
      ) {
        const stripped = new Headers(inboundHeaders);
        stripped.delete(INTERNAL_MCP_VERIFIED_HEADER);
        stripped.delete(TRUSTED_USER_ID_HEADER);
        stripped.delete(TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER);
        // For GET/HEAD: no body to forward. For other methods: buffer the
        // body bytes and pass them to the new Request — `body: request.body`
        // (a ReadableStream) requires `duplex: 'half'` in Node's undici
        // Request constructor, and the cleaner cross-runtime approach is
        // to forward bytes. Internal-MCP payloads are small JSON RPC params.
        //
        // F8: cap the buffered body at MAX_INTERNAL_MCP_BODY (256 KB).
        // Internal-MCP and gateway-bypass-strip paths only carry small
        // JSON-RPC params; 256 KB is a safe ceiling that prevents an
        // attacker from forcing the gateway to allocate megabytes of
        // memory just by setting Content-Length on a forged request.
        const reInit: RequestInit = { method: request.method, headers: stripped };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const contentLen = parseInt(request.headers.get('Content-Length') ?? '0', 10);
          if (Number.isFinite(contentLen) && contentLen > MAX_INTERNAL_MCP_BODY) {
            // F14: distinct reason label for body-size rejections so
            // telemetry separates this class from auth-401s.
            emitRequest(413, 'malformed_request', null);
            return new Response(JSON.stringify({ error: 'payload_too_large' }), {
              status: 413,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          try {
            const bytes = await request.clone().arrayBuffer();
            // Defense-in-depth: also reject if the actual buffered byte
            // count exceeds the cap (Content-Length can be absent or
            // wrong on chunked / streamed bodies).
            if (bytes.byteLength > MAX_INTERNAL_MCP_BODY) {
              emitRequest(413, 'malformed_request', null);
              return new Response(JSON.stringify({ error: 'payload_too_large' }), {
                status: 413,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
              });
            }
            reInit.body = bytes;
          } catch {
            // If we can't buffer the body, we can't safely forward the
            // request without trust-markers stripped. 400 the caller.
            // F14: use a distinct telemetry reason — "auth_401" was
            // misleading (this is a body-buffer failure, not an auth
            // outcome).
            emitRequest(400, 'malformed_request', null);
            return new Response(JSON.stringify({ error: 'malformed_request' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
        }
        request = new Request(request.url, reInit);
      }
    }

    // ----------------------------------------------------------------------
    // Internal-MCP HMAC pre-check — runs BEFORE `validateApiKey` so that a
    // verified Pro tool fetch never needs an `X-WorldMonitor-Key`. If
    // `X-WM-MCP-Internal` is present, treat as a deliberate signed request:
    //   - verify ⇒ entitlement re-check ⇒ rebuild Request with trusted markers
    //   - verify FAILS ⇒ 401 immediately (do NOT fall through; present-but-
    //     invalid is a forge attempt, falling through to validateApiKey
    //     would let an attacker chain the legacy auth path).
    // If the header is absent, fall through to the existing validateApiKey
    // path with the (header-stripped) request — Starter+ wm_ keys remain
    // unchanged.
    //
    // When this flag is true, downstream auth gates (validateApiKey, the
    // PREMIUM_RPC_PATHS bearer gate, IP rate limiting) are skipped. The MCP
    // edge already enforced 50/day + 60/min/userId; the gateway-level
    // entitlement check for ENDPOINT_ENTITLEMENTS is also skipped here
    // because we re-checked tier ≥ 1 + mcpAccess === true above.
    // ----------------------------------------------------------------------
    let internalMcpVerified = false;
    if (request.headers.has(INTERNAL_MCP_SIG_HEADER)) {
      const hmacSecret = process.env.MCP_INTERNAL_HMAC_SECRET ?? '';
      if (!hmacSecret) {
        // Server misconfiguration on the HMAC-attempt path. Surface as 500
        // CONFIGURATION so operators see it; legacy wm_ key path is
        // unaffected because we only enter this branch when the caller
        // explicitly tried to use the internal-MCP route.
        // Telemetry must not use auth_401 here: that reason is for caller
        // authentication failure, and a missing HMAC secret is a deploy
        // configuration incident (#7277).
        emitRequest(500, 'hmac_secret_unconfigured', null);
        return new Response(
          JSON.stringify({ error: 'CONFIGURATION', detail: 'MCP_INTERNAL_HMAC_SECRET not configured' }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }
      // Read the body bytes ONCE upfront. We need them in three places:
      //   1. Inside verifyInternalMcpRequest for the bodyHash compare
      //   2. To rebuild a fresh Request with trusted markers (Node's undici
      //      Request constructor refuses a ReadableStream body without
      //      `duplex: 'half'`; passing bytes sidesteps that)
      //   3. To make the body re-readable by the downstream handler — once
      //      a stream is locked, subsequent reads throw.
      // Reading then passing buffered bytes is safe for internal-MCP
      // payloads (small JSON RPC params); not appropriate for streamed
      // uploads, which this path doesn't carry.
      let bodyBytes: ArrayBuffer | null = null;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        // F8: cap inbound body BEFORE buffering. Internal-MCP signed
        // requests carry small JSON-RPC params; 256 KB is a safe ceiling.
        const contentLen = parseInt(request.headers.get('Content-Length') ?? '0', 10);
        if (Number.isFinite(contentLen) && contentLen > MAX_INTERNAL_MCP_BODY) {
          emitRequest(413, 'malformed_request', null);
          return new Response(JSON.stringify({ error: 'payload_too_large' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        try {
          bodyBytes = await request.clone().arrayBuffer();
        } catch {
          emitRequest(401, 'internal_mcp_bad_request', null);
          return internalMcpSignatureDenial(corsHeaders);
        }
        if (bodyBytes.byteLength > MAX_INTERNAL_MCP_BODY) {
          emitRequest(413, 'malformed_request', null);
          return new Response(JSON.stringify({ error: 'payload_too_large' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        // Reconstruct request from buffered bytes so verify can clone freely
        // and the downstream handler can read the body normally.
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyBytes,
        });
      }
      // X-WM-MCP-User-Id missing, malformed signature header, timestamp out of
      // window, and a failed HMAC compare all collapse to ONE 401 — telling a
      // forge probe which piece failed is exactly the oracle this must not be.
      // That stays true below: every branch returns the identical response
      // built in one place. Only the emitted telemetry reason differs, and it
      // never leaves the server.
      const verifyResult = await verifyInternalMcpRequestDetailed(request, hmacSecret);
      if (!verifyResult.ok) {
        emitRequest(401, internalMcpReasonFor(verifyResult.failure), null);
        return internalMcpSignatureDenial(corsHeaders);
      }
      const verified = verifyResult.verified;
      const replayClaim = await claimInternalMcpReplayNonce(verified.userId, verified.nonce);
      if (replayClaim === 'unavailable') {
        // Fail closed: without an atomic replay-cache claim, a valid captured
        // signature could be reused throughout the timestamp window.
        emitRequest(503, 'replay_cache_unavailable', null);
        return new Response(
          JSON.stringify({ error: 'internal_mcp_replay_cache_unavailable' }),
          { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }
      if (replayClaim === 'replay') {
        // Same response as a bad signature, by design — a probe must not learn
        // that its nonce was the thing that was already spent.
        emitRequest(401, 'internal_mcp_replay', null);
        return internalMcpSignatureDenial(corsHeaders);
      }
      // Entitlement re-check at the gateway: the MCP edge already verifies
      // tier ≥ 1 + mcpAccess + validUntil before signing the outbound
      // fetch (api/mcp.ts). This second check defends against (a) the
      // edge being bypassed (e.g. captured signature + leaked secret), (b)
      // mid-request entitlement lapse, (c) future regressions where a
      // non-edge caller signs requests.
      //
      // F1 (U7+U8 review pass): include `validUntil < Date.now()` in the
      // rejection condition. The cache-hot path in `entitlement-check.ts`
      // self-validates `validUntil >= Date.now()` at line 134, but the
      // Convex fallback at lines 154-156 does not — without this check
      // an entitlement row with stale `validUntil` would pass the gateway
      // re-check via the fallback path. Mirror the per-handler runProPreChecks
      // and authorize-pro entitlement guards.
      const ent = await getEntitlements(verified.userId);
      // Single-source Pro MCP decision. The gateway keeps its HTTP denial and
      // telemetry contract; the shared gate owns access and billing precedence.
      const gate = checkProMcpAccess(ent, Date.now());
      const mcpCovered = gate === null;
      const billingDenial = denyForBillingVerification(
        ent,
        corsHeaders,
        mcpCovered,
      );
      if (billingDenial) return billingDenial;
      if (!mcpCovered) {
        emitRequest(401, 'auth_401', null);
        return new Response(
          JSON.stringify({ error: 'insufficient_entitlement' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }
      // Rebuild Request with trusted markers — sanitised header set
      // already had inbound copies stripped above, so this is the ONLY
      // place those markers can enter the downstream path. Body is
      // re-supplied from the bytes we buffered (bodyBytes is null for
      // GET/HEAD, in which case we omit the body field entirely).
      //
      // The verified-marker value is a per-process-startup random nonce,
      // NOT the constant '1'. This protects direct edge functions that
      // call `isCallerPremium` but don't route through this gateway —
      // an attacker can't guess the nonce, so spoofing the marker on
      // those endpoints fails closed.
      //
      // F7 (U7+U8 review pass): strip the inbound HMAC headers BEFORE
      // setting the trusted markers. The gateway has consumed them via
      // verifyInternalMcpRequest; downstream handlers should only see
      // the trusted-marker pair, not the raw signature/userId headers.
      // Defense-in-depth — handlers shouldn't have any reason to read
      // the inbound HMAC.
      const trusted = new Headers(request.headers);
      trusted.delete(INTERNAL_MCP_SIG_HEADER);
      trusted.delete(INTERNAL_MCP_USER_ID_HEADER);
      trusted.delete(INTERNAL_MCP_NONCE_HEADER);
      trusted.set(INTERNAL_MCP_VERIFIED_HEADER, getInternalMcpVerifiedNonce());
      trusted.set(TRUSTED_USER_ID_HEADER, verified.userId);
      // The verified MCP caller is a confirmed paid principal: stamp the
      // rate-limit principal here too, so a downstream fan-out (e.g. a batch
      // issued through the MCP tool path) charges the verified userId bucket
      // instead of silently downgrading to the caller's IP.
      trusted.set(
        TRUSTED_RATE_LIMIT_PRINCIPAL_HEADER,
        formatTrustedRateLimitPrincipal(verified.userId, 'session'),
      );
      const rebuildInit: RequestInit = { method: request.method, headers: trusted };
      if (bodyBytes !== null) rebuildInit.body = bodyBytes;
      request = new Request(request.url, rebuildInit);
      usage.sessionUserId = verified.userId;
      recordUsageEntitlement(ent);
      internalMcpVerified = true;
    }

    let rateLimitPrincipalUserId: string | undefined;
    let sessionUserId: string | null = null;
    let keyCheck: { valid: boolean; required: boolean; error?: string; kind?: string; credential?: string } =
      internalMcpVerified ? { valid: true, required: false } : await validateApiKey(request);
    let isUserApiKey = false;
    const wmKey = getHeaderApiKey(request);
    if (keyCheck.required && !keyCheck.valid && wmKey.startsWith('wm_')) {
      // Unknown wm_ credentials require a Convex-backed hash lookup before we
      // know the account principal. Bound that unattributed work by IP first:
      // otherwise an attacker can rotate syntactically-valid keys and evade the
      // per-hash negative cache while every request reaches Convex. The 600/min
      // ceiling matches the repo-wide global IP budget and deliberately fails
      // closed when Redis is unavailable because this guard protects the auth
      // backend itself.
      const validationGuardResponse = await checkFailClosedScopedIpRateLimit(
        request,
        'user-api-key:pre-auth-validation',
        600,
        '60 s',
        corsHeaders,
      );
      if (validationGuardResponse) {
        const reason = getRateLimitTelemetryReason(
          validationGuardResponse,
          'rate_limit_429',
        );
        emitRequest(validationGuardResponse.status, reason, null);
        return validationGuardResponse;
      }

      // Only destructure validateUserApiKey: several gateway unit tests mock this
      // module with a partial surface. Requiring isUserApiKeyUnavailableError at
      // import time breaks those mocks (vitest throws "No export is defined").
      // Classify unavailability by the stable `code` field instead.
      const { validateUserApiKey } = await import('./_shared/user-api-key');
      try {
        const userKeyResult = await validateUserApiKey(wmKey);
        if (userKeyResult) {
          isUserApiKey = true;
          usage.isUserApiKey = true;
          usage.userApiKeyCustomerRef = userKeyResult.userId;
          keyCheck = { valid: true, required: true };
          // Propagate the resolved key-owner identity to downstream route
          // handlers via x-user-id. The entitlement check itself takes the
          // userId argument directly (see checkEntitlement(sessionUserId, …))
          // so it no longer depends on this header — the header is now for
          // handler consumption + the internal-MCP `isCallerPremium` path.
          sessionUserId = userKeyResult.userId;
          // The Clerk role belongs to the bearer subject, not the user-key owner.
          // Once the explicit wm_ key becomes the identity source, require the
          // key owner's Convex entitlement to drive tier-gated access.
          usage.sessionUserId = sessionUserId;
          usage.clerkOrgId = null;
          request = withAuthenticatedUserId(request, sessionUserId);
        }
      } catch (err) {
        // Transient Convex validation outage must not look like an invalid key.
        // Mirror api/_user-api-key.js serviceUnavailable() (503 + Retry-After +
        // X-Validation-Mode: degraded) so clients retry instead of rotating keys.
        // Duck-type on `code` so partial test mocks of user-api-key still work.
        const code =
          typeof err === 'object' && err !== null
            ? (err as { code?: unknown }).code
            : undefined;
        if (code === 'validation_unavailable') {
          emitRequest(503, 'validation_unavailable', null);
          return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'Retry-After': '5',
              'X-Validation-Mode': 'degraded',
              ...corsHeaders,
            },
          });
        }
        throw err;
      }
    }

    const enterpriseCredential = keyCheck.valid && keyCheck.kind === 'enterprise'
      ? (keyCheck.credential ?? wmKey)
      : '';
    if (enterpriseCredential && !isUserApiKey) {
      usage.enterpriseApiKey = enterpriseCredential;
    }

    // ── Active-subscription gate for user API keys (#4611) ──────────────────
    // A wm_ user key that authenticated this request must map to an owner with
    // ACTIVE apiAccess on EVERY keyed route — not just PREMIUM_RPC_PATHS. A
    // cancelled/downgraded customer keeps a valid (un-revoked) key that still
    // resolves to their userId, so without a route-wide gate the key keeps
    // serving the whole paid programmatic surface for free: the API Starter
    // product leaks past churn. Runs BEFORE the #3199 per-account rate-limit
    // block so an expired key is rejected outright, never metered — and the
    // resolved entitlement is reused there to avoid a second lookup.
    //
    // Scoped to isUserApiKey: the wm_ key IS the authenticating credential
    // (isUserApiKey ⇒ sessionUserId is the resolved key owner, set above).
    // This intentionally does NOT re-validate wm_ keys on any other route class:
    //   - Enterprise operator keys (kind 'enterprise', incl. legacy wm_-prefixed
    //     relay keys) never set isUserApiKey and carry no user entitlement row.
    //   - Verified internal paths (MCP / seed-refresh / relay warm-ping) never
    //     set isUserApiKey.
    //   - PUBLIC_NO_AUTH_RPC_PATHS serve free data to everyone; the key is not
    //     the authenticator there. Re-validating an arbitrary header key on that
    //     anonymous surface would add an unauthenticated Convex-lookup
    //     amplification vector (a rotating fake wm_ key per request defeats the
    //     negative cache, ahead of any rate limit) for no revenue gain — public
    //     data is not the paid product — and would wrongly gate the
    //     intentionally-anonymous lead-capture forms.
    let userKeyEntitlement: CachedEntitlements | null | undefined;
    if (isUserApiKey && sessionUserId) {
      userKeyEntitlement = await getEntitlements(sessionUserId);
      recordUsageEntitlement(userKeyEntitlement);
      const apiAccessCovered = !!userKeyEntitlement &&
        userKeyEntitlement.features.apiAccess &&
        hasCurrentEntitlementCoverage(userKeyEntitlement);
      const billingDenial = denyForBillingVerification(
        userKeyEntitlement,
        corsHeaders,
        apiAccessCovered,
      );
      if (billingDenial) return billingDenial;
      // Key ownership does not prove paid access. Missing configuration and
      // unresolved entitlements must remain retryable failures, not grants.
      if (!userKeyEntitlement) {
        emitRequest(503, 'billing_verification_503', null);
        return new Response(
          JSON.stringify({
            error: 'Unable to verify API access',
            code: 'entitlement_verification_unavailable',
          }),
          {
            status: 503,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'Retry-After': '5',
              'X-Billing-Verification': 'entitlement_verification_unavailable',
            },
          },
        );
      } else if (
        !userKeyEntitlement.features.apiAccess ||
        !hasCurrentEntitlementCoverage(userKeyEntitlement)
      ) {
        emitRequest(403, 'tier_403', null);
        return createGatewayAuthErrorResponse(
          403,
          'API access requires an active subscription',
          corsHeaders,
        );
      } else {
        // A validated user key plus active apiAccess is a trusted paid
        // principal even on routes without an endpoint tier policy.
        rateLimitPrincipalUserId = sessionUserId;
      }
    }

    if (keyCheck.required && !keyCheck.valid) {
      emitRequest(401, 'auth_401', null);
      return createGatewayAuthErrorResponse(401, keyCheck.error, corsHeaders);
    }
    const isEnterpriseAuth = keyCheck.valid
      && Boolean(enterpriseCredential)
      && !isUserApiKey
      && keyCheck.kind === 'enterprise';
    // Route matching — if POST doesn't match, convert to GET for stale clients.
    // Strict compatibility 400s stay pending until the normal endpoint/global
    // limiter path runs so malformed or nested bodies still consume the GET
    // route's abuse budget. The pending response is returned before
    // direct-LLM quota and handler dispatch.
    let matchedHandler = router.match(request);
    let pendingPostToGetCompatError: Response | null = null;
    if (!matchedHandler && request.method === 'POST') {
      if (isPostToGetCompatibleBodySize(request.headers)) {
        const url = new URL(request.url);
        const getProbe = new Request(url.toString(), { method: 'GET', headers: request.headers });
        const getProbeHandler = router.match(getProbe);
        if (getProbeHandler) {
          let compatErrorBody: Record<string, unknown> | null = null;
          let compatFields: PostToGetCompatField[] = [];
          try {
            const parsed = parsePostToGetCompatBody(await request.clone().text());
            if (parsed.status === 'ok') {
              compatFields = parsed.fields;
            } else {
              compatErrorBody = postToGetCompatErrorBody(parsed);
            }
          } catch {
            compatErrorBody = { error: 'malformed_request' };
          }
          if (compatErrorBody) {
            pendingPostToGetCompatError = new Response(JSON.stringify(compatErrorBody), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
            matchedHandler = getProbeHandler;
            request = getProbe;
          } else {
            applyPostToGetCompatFields(url.searchParams, compatFields);
            const getReq = new Request(url.toString(), { method: 'GET', headers: request.headers });
            matchedHandler = router.match(getReq);
            if (matchedHandler) request = getReq;
          }
        }
      }
    }
    if (!matchedHandler) {
      const allowed = router.allowedMethods(new URL(request.url).pathname);
      if (allowed.length > 0) {
        emitRequest(405, 'method_not_allowed', null);
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', Allow: allowed.join(', '), ...corsHeaders },
        });
      }
      emitRequest(404, 'unknown_route', null);
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const identityForScope = buildUsageIdentity(usage);

    // ── Idempotency-Key support (mutation retry-safety) ──────────────────────
    // Opt-in: only a POST carrying the header. POST→GET-converted batch reads
    // (compat block above) are already GET here and are skipped. Scope by the
    // resolved principal so a key can never replay another caller's response.
    // Fail-open: any Redis issue proceeds without idempotency (see the module).
    let idempotency: IdempotencyOutcome | null = null;
    const hasIdempotencyKey = request.method === 'POST' && request.headers.has(IDEMPOTENCY_HEADER);
    const idScope = identityForScope.principal_id ?? identityForScope.customer_id;
    const idempotencyScope = idScope ? `${identityForScope.auth_kind}:${idScope}` : null;

    // Look up an existing idempotency record before rate-limit/quota counters.
    // This lets a retry of completed work replay without charging a duplicate
    // unit. A miss does NOT claim the key; fresh executions still pass through
    // the normal abuse controls before `beginIdempotency()` below.
    if (hasIdempotencyKey) {
      const peek = await peekIdempotency({
        request,
        pathname,
        scope: idempotencyScope,
        idempotencyKey: request.headers.get(IDEMPOTENCY_HEADER) ?? '',
        corsHeaders,
      });
      switch (peek.kind) {
        case 'invalid':
          emitRequest(400, 'idempotency_invalid', null);
          return peek.response;
        case 'replay':
          emitRequest(peek.response.status, 'idempotent_replay', null);
          return peek.response;
        case 'conflict':
          emitRequest(409, 'idempotency_conflict', null);
          return peek.response;
        case 'mismatch':
          emitRequest(422, 'idempotency_mismatch', null);
          return peek.response;
        // 'miss' proceeds to rate limiting; 'disabled' preserves fail-open behavior.
      }
    }

    // Gateway rate limiting — two-phase: endpoint-specific first, then global fallback.
    // Confirmed paid principals use per-user buckets; other traffic uses IP.
    //
    // Only a single-use admission for this exact request waives the prepaid
    // endpoint/global limit. Account meters and auth still run for every call.
    const subRequestAdmission = await consumeSubRequestAdmission(request, rateLimitPrincipalUserId
      ? formatTrustedRateLimitPrincipal(rateLimitPrincipalUserId, isUserApiKey ? 'api_key' : 'session')
      : null);
    if (subRequestAdmission === 'unavailable') {
      const response = new Response(JSON.stringify({ error: 'Rate-limit service temporarily unavailable' }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...RATE_LIMIT_DEGRADED_HEADERS,
          ...corsHeaders,
        },
      });
      emitRequest(503, 'rate_limit_degraded', null);
      return response;
    }
    const isServerSubRequest = subRequestAdmission === 'admitted';
    // Google searches need their tighter upstream budget even after MCP admission.
    if (!internalMcpVerified) {
      // ── Per-account API rate limit (#3199) ──────────────────────────────
      // Eligible authenticated keys — a valid user key (which carries NO
      // keyCheck.kind, so `isUserApiKey` is the discriminator) or an enterprise
      // env key — are governed by a per-account burst + daily meter (enforced
      // at the sold allowance, #4635) instead of the global fallback. In ENFORCE
      // confirmed burst admission bypasses that fallback; in SHADOW they record telemetry
      // and still fall through to it. Validated user keys use their trusted
      // principal there, while enterprise keys retain IP attribution.
      // Limits are NOT in scope here (checkEntitlement discards `features`), so
      // user keys resolve getEntitlements explicitly (cached); enterprise keys
      // carry no entitlement and use hardcoded limits.
      let governedByApiKeyLayer = false;
      let rollbackDailyMeter: (() => Promise<void>) | undefined;
      if (keyCheck.valid && (isUserApiKey || isEnterpriseAuth)) {
        const enforce = process.env.API_RATE_LIMIT_ENFORCE === 'true';
        let perMinute = 0;
        let allowance = -1;
        let identity = '';
        let planKey = ''; // #4635 — hoisted for the informative 429 (ent is block-scoped below)
        if (isEnterpriseAuth) {
          perMinute = ENTERPRISE_API_RATE_LIMIT; // hardcoded — no entitlement row
          allowance = -1; // unlimited daily / no ceiling
          planKey = 'enterprise'; // top tier — named in the 429, but no upgrade_url
          usage.tier = 3; // enterprise tier — no entitlement row to read it from
          // (plan_key defaults to 'enterprise' in buildUsageIdentity)
          // Enterprise burst is keyed PER KEY (not per account) by design:
          // these are operator-issued WORLDMONITOR_VALID_KEYS with no shared
          // userId, and unlimited daily — so there's no quota to multiply by
          // minting keys, and each operator key gets its own 1,000/min budget
          // rather than contending for one shared bucket. (User keys below key
          // on userId so a customer can't multiply their allowance.)
          identity = hashKeySync(enterpriseCredential);
        } else if (sessionUserId) {
          // Reuse the entitlement the #4611 gate above already resolved for this
          // same user key (undefined ⇒ the gate didn't run, e.g. a Clerk-session
          // caller with no wm_ key — resolve it now). Avoids a duplicate lookup
          // on the hot active-key path.
          const ent =
            userKeyEntitlement !== undefined
              ? userKeyEntitlement
              : await getEntitlements(sessionUserId);
          if (ent) {
            // #4572 — attribute the usage event to the caller's real tier +
            // plan (recorded even for downgraded keys), so the limit-abuse
            // audit can compare each request to the customer's actual cap.
            recordUsageEntitlement(ent);
          }
          if (ent && ent.features.apiAccess && ent.features.apiRateLimit > 0) {
            perMinute = ent.features.apiRateLimit;
            // undefined ⇒ fail-open (no daily limit); -1 ⇒ unlimited.
            allowance =
              typeof ent.features.apiDailyAllowance === 'number'
                ? ent.features.apiDailyAllowance
                : -1;
            planKey = ent.planKey;
            identity = sessionUserId;
          }
          // else: downgraded / null entitlement ⇒ not eligible (perMinute = 0),
          // falls through to the per-IP path — never a slidingWindow(0).
        }

        if (perMinute > 0 && identity) {
          // #4635 — informative 429 upgrade link; omitted for enterprise/top tier.
          const upgradeUrl =
            planKey && planKey !== 'enterprise' ? 'https://worldmonitor.app/' : undefined;
          // 1. Per-minute burst (hard limit).
          const burst = await checkBurst(perMinute, identity);
          if (burst.ok === false) {
            if (enforce) {
              const retryAfterSec = Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000));
              emitRequest(429, 'rl_min_429', null);
              return new Response(JSON.stringify({
                error: 'Too many requests',
                plan: planKey || undefined,
                limit: burst.limit,
                limit_type: 'per_minute',
                reset: new Date(burst.reset).toISOString(),
                upgrade_url: upgradeUrl,
              }), {
                status: 429,
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'no-store',
                  ...rateLimitHeaders({ limit: burst.limit, remaining: 0, resetMs: burst.reset, retryAfterSec, windowSec: 60 }),
                  ...corsHeaders,
                },
              });
            }
            pendingShadowReason = 'rl_min_shadow';
          } else if (allowance >= 0) {
            // 2. Daily meter — hard-rejects at the sold allowance (#4635).
            //    Skipped for unlimited (-1); reserveDailyMeter fail-opens on <=0.
            const meter = await reserveDailyMeter({
              userId: identity,
              allowance,
              pipeline: (cmds) => runRedisPipeline(cmds),
            });
            if (meter.metered) rollbackDailyMeter = meter.rollback;
            if (meter.overLimit) {
              if (enforce) {
                await meter.rollback();
                emitRequest(429, 'rl_ceiling_429', null);
                return new Response(JSON.stringify({
                  error: 'Daily request limit reached',
                  plan: planKey || undefined,
                  limit: allowance,
                  limit_type: 'daily',
                  reset: new Date(Date.now() + meter.retryAfterSec * 1000).toISOString(),
                  upgrade_url: upgradeUrl,
                }), {
                  status: 429,
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                    ...rateLimitHeaders({
                      limit: allowance,
                      remaining: 0,
                      resetMs: Date.now() + meter.retryAfterSec * 1000,
                      retryAfterSec: meter.retryAfterSec,
                      // Daily ceiling window (24 h) for the advertised policy.
                      windowSec: 86_400,
                    }),
                    ...corsHeaders,
                  },
                });
              }
              pendingShadowReason = 'rl_ceiling_shadow';
            }
          }
          // Confirmed burst admission + enforce ⇒ the per-account layer governs
          // this request and skips the global fallback. If unavailable or in shadow, keep that
          // fallback active: validated user keys use their trusted principal,
          // while enterprise keys retain IP attribution.
          if (enforce && burst.ok === true) governedByApiKeyLayer = true;
        }
      }

      if (!isServerSubRequest && !governedByApiKeyLayer) {
        // WORLDMONITOR-12A: scope the bucket to the credential, not just the
        // user. An API key and a browser session resolve to the same Clerk id,
        // so without this a customer's own scraper drains the 600/min budget
        // and their dashboard 429s. In production on 2026-09-11 that was 598
        // scraper successes against 2 for the same person's browser.
        const rateLimitResponse = rateLimitPrincipalUserId
          ? await checkRateLimit(request, corsHeaders, {
              principalUserId: rateLimitPrincipalUserId,
              principalScope: isUserApiKey ? 'api_key' : 'session',
            })
          : await checkRateLimit(request, corsHeaders);
        if (rateLimitResponse) {
          await rollbackDailyMeter?.();
          const reason = getRateLimitTelemetryReason(
            rateLimitResponse,
            'rate_limit_429_global',
          );
          emitRequest(rateLimitResponse.status, reason, null);
          return rateLimitResponse;
        }
      }
    }

    if (pendingPostToGetCompatError) {
      emitRequest(400, 'malformed_request', null);
      return pendingPostToGetCompatError;
    }

    if (hasIdempotencyKey) {
      idempotency = await beginIdempotency({
        request,
        pathname,
        // Tag the scope with the auth kind so value spaces (Clerk id vs hashed
        // key vs customer ref) can never collide across authentication methods.
        scope: idempotencyScope,
        idempotencyKey: request.headers.get(IDEMPOTENCY_HEADER) ?? '',
        corsHeaders,
      });
      switch (idempotency.kind) {
        case 'invalid':
          emitRequest(400, 'idempotency_invalid', null);
          return idempotency.response;
        case 'replay':
          emitRequest(idempotency.response.status, 'idempotent_replay', null);
          return idempotency.response;
        case 'conflict':
          emitRequest(409, 'idempotency_conflict', null);
          return idempotency.response;
        case 'mismatch':
          emitRequest(422, 'idempotency_mismatch', null);
          return idempotency.response;
        // 'disabled' (fail-open) and 'proceed' fall through to execution.
      }
    }

    // Execute handler with top-level error boundary.
    // Wrap in runWithUsageScope so deep fetch helpers (fetchJson,
    // cachedFetchJsonWithMeta) can attribute upstream calls to this customer
    // without leaf handlers having to thread a usage hook through every call.
    let response: Response;
    const handlerCall = matchedHandler;
    // Handlers that re-dispatch sub-requests must charge the caller's own
    // budget; the identity resolved above is the only trustworthy source for
    // it, since raw credential headers are unvalidated at that point. Absent
    // a resolved principal the marker stays unset and handlers fall back to
    // the caller's IP, matching this gateway's own attribution.
    const requestForHandler = rateLimitPrincipalUserId
      ? withTrustedRateLimitPrincipal(
          request,
          rateLimitPrincipalUserId,
          isUserApiKey ? 'api_key' : 'session',
        )
      : request;
    try {
      response = await runWithUsageScope(
        {
          ctx: ctx ?? { waitUntil: () => {} },
          requestId: deriveRequestId(originalRequest),
          customerId: identityForScope.customer_id,
          route: pathname,
          tier: identityForScope.tier,
        },
        () => handlerCall(requestForHandler),
      );
    } catch (err) {
      console.error('[gateway] Unhandled handler error:', err);
      response = new Response(JSON.stringify({ message: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Merge CORS + handler side-channel headers into response
    const mergedHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      mergedHeaders.set(key, value);
    }
    const extraHeaders = drainResponseHeaders(request);
    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        mergedHeaders.set(key, value);
      }
    }
    appendDeprecationPolicyLink(mergedHeaders);
    const retryableResponse = drainRetryableResponse(request);
    const statusOverride = drainSuccessStatusOverride(request);
    const finalStatus =
      statusOverride !== undefined && request.method === 'POST' && response.status === 200
        ? statusOverride
        : response.status;

    const resolvedCacheTier = 'no-store';
    if (response.status === 200 && (request.method === 'GET' || request.method === 'HEAD') && response.body) {
      const bodyBytes = await response.arrayBuffer();
      const bodyStr = new TextDecoder().decode(bodyBytes);
      if (new URL(request.url).searchParams.has('_debug')) mergedHeaders.set('X-Cache-Tier', resolvedCacheTier);
      let responseView = new Uint8Array(bodyBytes);
      const jmespathExpr = new URL(request.url).searchParams.get('jmespath');
      if (jmespathExpr && (mergedHeaders.get('Content-Type') ?? '').includes('application/json')) {
        const projection = projectJsonResponse(bodyStr, jmespathExpr);
        if (!projection.ok) {
          const errorBody = JSON.stringify(projection.envelope);
          emitRequest(400, 'malformed_request', null, errorBody.length);
          maybeAttachDevHealthHeader(mergedHeaders);
          return new Response(errorBody, {
            status: 400,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json; charset=utf-8',
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': 'no-store',
            },
          });
        }
        responseView = new TextEncoder().encode(projection.body);
        // The projected body has a different length than the handler's — drop any
        // stale Content-Length so the runtime recomputes it (a leftover value
        // would truncate the response).
        mergedHeaders.delete('Content-Length');
      }

      // FNV-1a inspired fast hash — good enough for cache validation
      let hash = 2166136261;
      const view = responseView;
      for (let i = 0; i < view.length; i++) {
        hash ^= view[i]!;
        hash = Math.imul(hash, 16777619);
      }
      const etag = `"${(hash >>> 0).toString(36)}-${view.length.toString(36)}"`;
      mergedHeaders.set('ETag', etag);

      const ifNoneMatch = request.headers.get('If-None-Match');
      if (ifNoneMatch === etag) {
        emitRequest(304, 'ok', resolvedCacheTier, 0);
        maybeAttachDevHealthHeader(mergedHeaders);
        return new Response(null, { status: 304, headers: mergedHeaders });
      }

      emitRequest(response.status, 'ok', resolvedCacheTier, view.length);
      maybeAttachDevHealthHeader(mergedHeaders);
      return new Response(responseView, {
        status: response.status,
        statusText: response.statusText,
        headers: mergedHeaders,
      });
    }

    // Idempotent POST (opt-in): buffer the body so it can be persisted for
    // replay, then echo the key. Only reached when the client sent a valid
    // Idempotency-Key on a first request; normal POSTs keep the streaming path
    // below untouched.
    if (idempotency?.kind === 'proceed') {
      const bodyBytes = response.body ? await response.arrayBuffer() : new ArrayBuffer(0);
      mergedHeaders.set(IDEMPOTENCY_HEADER, idempotency.key);
      mergedHeaders.set(IDEMPOTENT_REPLAYED_HEADER, 'false');
      // Awaited (not waitUntil'd) so a sub-second retry sees the completed
      // record rather than a lingering 'processing' lock → 409. store() is
      // best-effort/fail-open, so a Redis blip degrades to a re-executable
      // retry, never a failed response.
      // Generated response-envelope RPCs can report a retryable ServiceError
      // inside HTTP 200. Feed store() a retryable status only for its
      // persist-vs-release decision; the client still receives finalStatus.
      await idempotency.store(
        retryableResponse ? 503 : finalStatus,
        bodyBytes,
        response.headers.get('content-type'),
      );
      emitRequest(finalStatus, 'ok', resolvedCacheTier, bodyBytes.byteLength);
      maybeAttachDevHealthHeader(mergedHeaders);
      return new Response(bodyBytes, {
        status: finalStatus,
        statusText: response.statusText,
        headers: mergedHeaders,
      });
    }

    // Streaming/non-GET-200 responses: res_bytes is best-effort 0 (Content-Length
    // is often absent on chunked responses; teeing the stream would add latency).
    const finalContentLen = response.headers.get('content-length');
    const finalResBytes = finalContentLen ? Number(finalContentLen) || 0 : 0;
    emitRequest(finalStatus, 'ok', resolvedCacheTier, finalResBytes);
    maybeAttachDevHealthHeader(mergedHeaders);
    return new Response(response.body, {
      status: finalStatus,
      statusText: response.statusText,
      headers: mergedHeaders,
    });
  }

  return async function handler(originalRequest: Request, ctx?: GatewayCtx): Promise<Response> {
    const response = await dispatch(originalRequest, ctx);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.delete('CDN-Cache-Control');
    response.headers.delete('Vercel-CDN-Cache-Control');
    return originalRequest.method === 'HEAD' ? toHeadResponse(response) : response;
  };
}
