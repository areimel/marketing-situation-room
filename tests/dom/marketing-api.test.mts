/**
 * `src/services/marketing/api.ts` (R8): every wrapper goes through
 * premiumFetch, returns the response object unchanged (including
 * `degraded`), and rejects on transport failure with no fallback.
 * Mention queries carry client names, so they travel in a POST body and
 * never in the URL (R5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const premiumFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/premium-fetch', () => ({
  premiumFetch: (...args: unknown[]) => premiumFetchMock(...args),
}));

import {
  getDemandTrends,
  listCalendarEvents,
  listWeatherAlerts,
  searchLocalMentions,
} from '@/services/marketing/api';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function lastCall(): { url: string; init: RequestInit } {
  const call = premiumFetchMock.mock.calls.at(-1);
  if (!call) throw new Error('premiumFetch was not called');
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

beforeEach(() => {
  premiumFetchMock.mockReset();
});

describe('marketing api wrappers', () => {
  it('listWeatherAlerts sends a GET with state codes and returns the response unchanged', async () => {
    const payload = {
      alerts: [{
        id: 'a1', event: 'Heat Advisory', severity: 'watch', headline: 'h', areaDesc: 'Travis',
        onset: 1, expires: 2, polygonGeojson: '', zoneCodes: ['TXZ192'], stateCodes: ['TX'],
      }],
      degraded: true,
    };
    premiumFetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const res = await listWeatherAlerts({ stateCodes: ['TX', 'CA'] });
    expect(res).toEqual(payload);
    const { url, init } = lastCall();
    expect(url).toContain('/api/marketing/v1/list-weather-alerts');
    expect(new URL(url, 'http://x').searchParams.getAll('state_codes')).toEqual(['TX', 'CA']);
    expect(init.method).toBe('GET');
  });

  it('listCalendarEvents sends the date window and returns the response unchanged', async () => {
    const payload = { events: [{ id: 'e1', date: '2026-11-26', name: 'Thanksgiving', kind: 'holiday', categories: [] }], degraded: false };
    premiumFetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const res = await listCalendarEvents({ fromDate: '2026-11-01', toDate: '2026-11-30', categories: ['restaurant'] });
    expect(res).toEqual(payload);
    const { url, init } = lastCall();
    const params = new URL(url, 'http://x').searchParams;
    expect(url).toContain('/api/marketing/v1/list-calendar-events');
    expect(params.get('from_date')).toBe('2026-11-01');
    expect(params.get('to_date')).toBe('2026-11-30');
    expect(init.method).toBe('GET');
  });

  it('searchLocalMentions POSTs the queries in the body, never in the URL', async () => {
    const payload = { mentions: [], degraded: true };
    premiumFetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const req = { queries: [{ clientId: 'fixture_1', terms: ['Fixture Bakery'], city: 'Austin', stateCode: 'TX' }] };
    const res = await searchLocalMentions(req);
    expect(res).toEqual(payload);
    const { url, init } = lastCall();
    expect(url).toContain('/api/marketing/v1/search-local-mentions');
    expect(url).not.toContain('Fixture');
    expect(url).not.toContain('?');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(req);
  });

  it('getDemandTrends sends a GET and returns the response unchanged', async () => {
    const payload = {
      trends: [{ category: 'restaurant', points: [{ date: 1, value: 50 }] }],
      trendingNow: [{ term: 'pie', geo: 'US', traffic: '50K+' }],
      degraded: false,
    };
    premiumFetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const res = await getDemandTrends({ categories: [], stateCodes: ['TX'] });
    expect(res).toEqual(payload);
    const { url, init } = lastCall();
    expect(url).toContain('/api/marketing/v1/get-demand-trends');
    expect(init.method).toBe('GET');
  });

  it('a rejected fetch rejects each wrapper', async () => {
    const calls = [
      () => listWeatherAlerts({ stateCodes: ['TX'] }),
      () => listCalendarEvents({ fromDate: '2026-11-01', toDate: '2026-11-30', categories: [] }),
      () => searchLocalMentions({ queries: [] }),
      () => getDemandTrends({ categories: [], stateCodes: [] }),
    ];
    for (const call of calls) {
      premiumFetchMock.mockRejectedValueOnce(new TypeError('network down'));
      await expect(call()).rejects.toThrow('network down');
    }
  });
});
