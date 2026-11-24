import type { MarketingServiceHandler } from '../../../../src/generated/server/worldmonitor/marketing/v1/service_server';

// W0 stub; W5 owns the calendar implementation.
export const listCalendarEvents: MarketingServiceHandler['listCalendarEvents'] = async () => ({
  events: [],
  degraded: false,
});
