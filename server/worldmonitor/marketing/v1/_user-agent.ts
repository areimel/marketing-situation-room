/**
 * Shared User-Agent for marketing upstream fetches (R6). NWS requires a
 * contact, so production refuses to run without MARKETING_CONTACT_EMAIL.
 * The env is read on every call, never at module scope.
 */
export function marketingUserAgent(env: Record<string, string | undefined> = process.env): string {
  const email = env.MARKETING_CONTACT_EMAIL?.trim();
  if (email) return `MarketingSituationRoom/1.0 (+mailto:${email})`;
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    throw new Error('MARKETING_CONTACT_EMAIL is required');
  }
  return 'MarketingSituationRoom/1.0 (+mailto:unset@localhost)';
}
