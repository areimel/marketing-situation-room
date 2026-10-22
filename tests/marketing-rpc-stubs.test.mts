/**
 * MarketingService contract pins (W0 Task 5).
 *
 * - The four stub handlers resolve to empty lists with `degraded: false`.
 * - Every marketing path is `no-store` in RPC_CACHE_TIER (R5): mention
 *   queries carry client names, so nothing may land in a shared cache.
 * - `marketingUserAgent()` follows R6 (throws in production without a
 *   contact email, falls back in dev).
 * - The generated routes expose exactly the four paths and methods, and
 *   generated request validation rejects bad input before the handler runs.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDomainGateway, serverOptions } from '../server/gateway.ts';
import { marketingHandler } from '../server/worldmonitor/marketing/v1/handler.ts';
import { marketingUserAgent } from '../server/worldmonitor/marketing/v1/_user-agent.ts';
import {
  createMarketingServiceRoutes,
  type GetDemandTrendsResponse,
  type ListCalendarEventsResponse,
  type ListWeatherAlertsResponse,
  type MarketingServiceHandler,
  type SearchLocalMentionsResponse,
  type ServerContext,
  type WeatherAlert,
} from '../src/generated/server/worldmonitor/marketing/v1/service_server.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const BASE = '/api/marketing/v1';
const PATHS = {
  weather: `${BASE}/list-weather-alerts`,
  calendar: `${BASE}/list-calendar-events`,
  mentions: `${BASE}/search-local-mentions`,
  trends: `${BASE}/get-demand-trends`,
};

// Type-level contract (R3/R4). Enforced where this file is type-checked.
const _alertShape = {
  id: '', event: '', severity: 'warning', headline: '', areaDesc: '',
  onset: 0, expires: 0, polygonGeojson: '', zoneCodes: [], stateCodes: [],
} satisfies WeatherAlert;
const _degradedShapes = [
  { alerts: [], degraded: false } satisfies ListWeatherAlertsResponse,
  { events: [], degraded: false } satisfies ListCalendarEventsResponse,
  { mentions: [], degraded: false } satisfies SearchLocalMentionsResponse,
  { trends: [], trendingNow: [], degraded: false } satisfies GetDemandTrendsResponse,
];
void _alertShape;
void _degradedShapes;

const originalEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function ctx(): ServerContext {
  return { request: new Request('http://x'), pathParams: {}, headers: {} };
}

describe('marketing stub handlers', () => {
  it('each handler resolves to its empty response with degraded: false', async () => {
    assert.deepEqual(await marketingHandler.listWeatherAlerts(ctx(), { stateCodes: [] }), { alerts: [], degraded: false });
    assert.deepEqual(
      await marketingHandler.listCalendarEvents(ctx(), { fromDate: '2026-10-01', toDate: '2026-10-31', categories: [] }),
      { events: [], degraded: false },
    );
    assert.deepEqual(await marketingHandler.searchLocalMentions(ctx(), { queries: [] }), { mentions: [], degraded: false });
    assert.deepEqual(
      await marketingHandler.getDemandTrends(ctx(), { categories: [], stateCodes: [] }),
      { trends: [], trendingNow: [], degraded: false },
    );
  });
});

describe('marketing cache tier (R5)', () => {
  it('RPC_CACHE_TIER maps all four marketing paths to no-store', () => {
    const src = readFileSync(resolve(root, 'server/gateway.ts'), 'utf-8');
    for (const path of Object.values(PATHS)) {
      const escaped = path.replace(/[/-]/g, (c) => `\\${c}`);
      assert.match(src, new RegExp(`'${escaped}':\\s*'no-store'`), `${path} must be no-store`);
    }
  });

  it('a mentions request through the gateway is served Cache-Control: no-store', async () => {
    process.env.WORLDMONITOR_VALID_KEYS = 'marketing-test-key';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const gateway = createDomainGateway(createMarketingServiceRoutes(marketingHandler, serverOptions));
    const res = await gateway(new Request(`https://worldmonitor.app${PATHS.mentions}`, {
      method: 'POST',
      headers: {
        Origin: 'https://worldmonitor.app',
        'X-WorldMonitor-Key': 'marketing-test-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ queries: [{ clientId: 'fixture_1', terms: ['Fixture Bakery'], city: 'Austin', stateCode: 'TX' }] }),
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { mentions: [], degraded: false });
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('CDN-Cache-Control'), null);
  });
});

describe('marketingUserAgent (R6)', () => {
  it('formats the contact email', () => {
    assert.equal(
      marketingUserAgent({ MARKETING_CONTACT_EMAIL: 'ops@example.com' }),
      'MarketingSituationRoom/1.0 (+mailto:ops@example.com)',
    );
  });

  it('throws in production when the email is unset or blank', () => {
    assert.throws(() => marketingUserAgent({ NODE_ENV: 'production' }), /MARKETING_CONTACT_EMAIL is required/);
    assert.throws(() => marketingUserAgent({ VERCEL_ENV: 'production', MARKETING_CONTACT_EMAIL: '  ' }), /MARKETING_CONTACT_EMAIL is required/);
  });

  it('falls back outside production', () => {
    assert.equal(marketingUserAgent({ NODE_ENV: 'development' }), 'MarketingSituationRoom/1.0 (+mailto:unset@localhost)');
    assert.equal(marketingUserAgent({}), 'MarketingSituationRoom/1.0 (+mailto:unset@localhost)');
  });

  it('reads process.env per call when no env is passed', () => {
    process.env.MARKETING_CONTACT_EMAIL = 'first@example.com';
    assert.equal(marketingUserAgent(), 'MarketingSituationRoom/1.0 (+mailto:first@example.com)');
    process.env.MARKETING_CONTACT_EMAIL = 'second@example.com';
    assert.equal(marketingUserAgent(), 'MarketingSituationRoom/1.0 (+mailto:second@example.com)');
  });
});

describe('generated marketing routes', () => {
  it('exposes exactly the four paths with their methods', () => {
    const routes = createMarketingServiceRoutes(marketingHandler, serverOptions);
    assert.deepEqual(
      routes.map((r) => `${r.method} ${r.path}`).sort(),
      [
        `GET ${PATHS.trends}`,
        `GET ${PATHS.calendar}`,
        `GET ${PATHS.weather}`,
        `POST ${PATHS.mentions}`,
      ].sort(),
    );
  });

  function spyRoutes() {
    const calls: string[] = [];
    const spy: MarketingServiceHandler = {
      listWeatherAlerts: async () => { calls.push('weather'); return { alerts: [], degraded: false }; },
      listCalendarEvents: async () => { calls.push('calendar'); return { events: [], degraded: false }; },
      searchLocalMentions: async () => { calls.push('mentions'); return { mentions: [], degraded: false }; },
      getDemandTrends: async () => { calls.push('trends'); return { trends: [], trendingNow: [], degraded: false }; },
    };
    const routes = createMarketingServiceRoutes(spy, serverOptions);
    const route = (path: string) => {
      const found = routes.find((r) => r.path === path);
      assert.ok(found, `route ${path} missing`);
      return found;
    };
    return { calls, route };
  }

  it('rejects 21 mention queries with 400 and no handler call', async () => {
    const { calls, route } = spyRoutes();
    const queries = Array.from({ length: 21 }, (_, i) => ({ clientId: `c${i}`, terms: ['t'], city: '', stateCode: '' }));
    const res = await route(PATHS.mentions).handler(new Request(`http://x${PATHS.mentions}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    }));
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
  });

  it('rejects a non-date from_date on calendar with 400 and no handler call', async () => {
    const { calls, route } = spyRoutes();
    const res = await route(PATHS.calendar).handler(
      new Request(`http://x${PATHS.calendar}?from_date=tomorrow&to_date=2026-10-31`),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
  });

  it('rejects a three-letter state code on weather with 400 and no handler call', async () => {
    const { calls, route } = spyRoutes();
    const res = await route(PATHS.weather).handler(new Request(`http://x${PATHS.weather}?state_codes=TEX`));
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
  });

  it('accepts valid requests and calls the handler', async () => {
    const { calls, route } = spyRoutes();
    assert.equal((await route(PATHS.weather).handler(new Request(`http://x${PATHS.weather}?state_codes=TX&state_codes=CA`))).status, 200);
    assert.equal((await route(PATHS.calendar).handler(new Request(`http://x${PATHS.calendar}?from_date=2026-10-01&to_date=2026-10-31`))).status, 200);
    assert.deepEqual(calls, ['weather', 'calendar']);
  });
});
