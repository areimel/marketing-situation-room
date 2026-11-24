import type { MarketingServiceHandler } from '../../../../src/generated/server/worldmonitor/marketing/v1/service_server';
import { getDemandTrends } from './get-demand-trends';
import { listCalendarEvents } from './list-calendar-events';
import { listWeatherAlerts } from './list-weather-alerts';
import { searchLocalMentions } from './search-local-mentions';

export const marketingHandler: MarketingServiceHandler = {
  listWeatherAlerts,
  listCalendarEvents,
  searchLocalMentions,
  getDemandTrends,
};
