'use strict';

// CommonJS copy of shared/marketing/deploy-flag.ts (the source of truth) for
// the notification relay (index R11, R21). Keep the rule identical:
// tests/marketing-shared-contracts.test.mts asserts both agree.
function isMarketingDeploy(env = process.env) {
  return (env || {}).MARKETING_DEPLOY === '1';
}

module.exports = { isMarketingDeploy };
