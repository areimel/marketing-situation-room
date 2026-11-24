import { isMarketingDeploy } from '../../shared/marketing/deploy-flag';

export const MARKETING_DEPLOY = isMarketingDeploy({
  MARKETING_DEPLOY: import.meta.env?.VITE_MARKETING_DEPLOY,
});
