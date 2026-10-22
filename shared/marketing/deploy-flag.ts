/**
 * Single reader for the server-side `MARKETING_DEPLOY` flag (index R11).
 * `scripts/lib/marketing-deploy-flag.cjs` is the relay's CommonJS copy;
 * tests/marketing-shared-contracts.test.mts keeps the two in sync.
 */
export function isMarketingDeploy(
  env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {},
): boolean {
  return env.MARKETING_DEPLOY === '1';
}
