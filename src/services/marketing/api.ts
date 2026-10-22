/**
 * Typed wrappers over the generated MarketingService client (R8).
 *
 * Every call goes through premiumFetch so the Clerk token is attached. There
 * is deliberately no circuit-breaker fallback: a transport failure rejects,
 * so panels can show "source unavailable", and `degraded` on a resolved
 * response reaches the panel unchanged.
 */
import type {
  CalendarEvent,
  DemandTrend,
  GetDemandTrendsRequest,
  GetDemandTrendsResponse,
  ListCalendarEventsRequest,
  ListCalendarEventsResponse,
  ListWeatherAlertsRequest,
  ListWeatherAlertsResponse,
  Mention,
  MentionQuery,
  SearchLocalMentionsRequest,
  SearchLocalMentionsResponse,
  TrendingTerm,
  TrendPoint,
  WeatherAlert,
} from '@/generated/client/worldmonitor/marketing/v1/service_client';
import { MarketingServiceClient } from '@/services/generated-rpc-clients';
import { premiumFetch } from '@/services/premium-fetch';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';

export type {
  CalendarEvent,
  DemandTrend,
  GetDemandTrendsRequest,
  GetDemandTrendsResponse,
  ListCalendarEventsRequest,
  ListCalendarEventsResponse,
  ListWeatherAlertsRequest,
  ListWeatherAlertsResponse,
  Mention,
  MentionQuery,
  SearchLocalMentionsRequest,
  SearchLocalMentionsResponse,
  TrendingTerm,
  TrendPoint,
  WeatherAlert,
};

const getClient = createLazyClient(() => new MarketingServiceClient(getRpcBaseUrl(), { fetch: premiumFetch }));

export function listWeatherAlerts(req: ListWeatherAlertsRequest): Promise<ListWeatherAlertsResponse> {
  return getClient().listWeatherAlerts(req);
}

export function listCalendarEvents(req: ListCalendarEventsRequest): Promise<ListCalendarEventsResponse> {
  return getClient().listCalendarEvents(req);
}

export function searchLocalMentions(req: SearchLocalMentionsRequest): Promise<SearchLocalMentionsResponse> {
  return getClient().searchLocalMentions(req);
}

export function getDemandTrends(req: GetDemandTrendsRequest): Promise<GetDemandTrendsResponse> {
  return getClient().getDemandTrends(req);
}
