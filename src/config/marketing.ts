import { isMarketingDeploy } from '../../shared/marketing/deploy-flag';

function readViteMarketingDeploy(): string | undefined {
  try {
    // Under a plain node import `import.meta.env` is undefined, so this throws
    // and the flag resolves to false.
    return import.meta.env.VITE_MARKETING_DEPLOY;
  } catch {
    return undefined;
  }
}

/** Client-side deploy flag (`VITE_MARKETING_DEPLOY=1`). W9 adds every consumer. */
export const MARKETING_DEPLOY: boolean = isMarketingDeploy({ MARKETING_DEPLOY: readViteMarketingDeploy() });
