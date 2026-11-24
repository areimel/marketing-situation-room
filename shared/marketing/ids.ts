/**
 * Marketing client id rule (R12): the Convex document id string. Convex,
 * server and browser all validate ids with this one rule, and dev fixture
 * ids and location ids use the same format.
 */
export const MARKETING_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isMarketingClientId(id: unknown): id is string {
  return typeof id === 'string' && MARKETING_CLIENT_ID_RE.test(id);
}
