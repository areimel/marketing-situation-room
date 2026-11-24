import type { MarketingServiceHandler } from '../../../../src/generated/server/worldmonitor/marketing/v1/service_server';

// W0 stub; W7 owns the demand-trends implementation.
export const getDemandTrends: MarketingServiceHandler['getDemandTrends'] = async () => ({
  trends: [],
  trendingNow: [],
  degraded: false,
});
