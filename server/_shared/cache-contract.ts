export type RpcNoStoreReason =
  | 'upstream-unavailable'
  | 'unavailable'
  | 'data-unavailable'
  | 'degraded'
  | 'available-false'
  | 'error';

interface RpcNoStoreOptions {
  includeAvailableFalse?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function getRpcNoStoreReasonFromPayload(
  payload: unknown,
  options: RpcNoStoreOptions = {},
): RpcNoStoreReason | null {
  if (!isRecord(payload)) return null;

  if (payload.upstreamUnavailable === true) return 'upstream-unavailable';
  if (payload.unavailable === true) return 'unavailable';
  if (payload.dataAvailable === false) return 'data-unavailable';
  if (payload.degraded === true) return 'degraded';
  if (options.includeAvailableFalse !== false && payload.available === false) return 'available-false';
  if (nonEmptyString(payload.error)) return 'error';

  return null;
}
