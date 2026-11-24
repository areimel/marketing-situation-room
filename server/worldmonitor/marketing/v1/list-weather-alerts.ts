import type { MarketingServiceHandler } from '../../../../src/generated/server/worldmonitor/marketing/v1/service_server';

// W0 stub; W4 owns the NWS implementation.
export const listWeatherAlerts: MarketingServiceHandler['listWeatherAlerts'] = async () => ({
  alerts: [],
  degraded: false,
});
