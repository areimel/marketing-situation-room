import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Layer, PickingInfo } from '@deck.gl/core';
import {
  EMPTY_MARKETING_LAYER_DATA,
  MARKETING_LAYER_KEYS,
  buildMarketingLayers,
  getMarketingTooltip,
  mergeMarketingLayerData,
  type MarketingLayerBuilders,
  type MarketingLayerContext,
  type MarketingLayerData,
  type MarketingTooltips,
} from '../src/components/marketing/map/index';
import type { MarketingClient, MarketingSignal } from '../shared/marketing/types';
import type { Mention, WeatherAlert } from '../src/services/marketing/api';

function ctx(visible: string[], data: Partial<MarketingLayerData> = {}): MarketingLayerContext {
  return { ...EMPTY_MARKETING_LAYER_DATA, ...data, visibleLayerIds: new Set(visible) };
}

const ALL_IDS = ['marketingClients', 'nwsAlerts', 'localMentions'];
const sentinel = (id: string) => ({ id: `marketing-${id}` }) as unknown as Layer;
const info = (layerId: string | null, object: unknown = { x: 1 }) =>
  ({ layer: layerId == null ? null : { id: layerId, props: {} }, object }) as unknown as PickingInfo;

describe('buildMarketingLayers', () => {
  it('returns no layers with the W0 stubs, even with all ids visible', () => {
    assert.deepEqual(buildMarketingLayers(ctx(ALL_IDS)), []);
    assert.deepEqual(buildMarketingLayers(ctx([])), []);
  });

  it('exposes exactly the three marketing layer keys', () => {
    assert.deepEqual([...MARKETING_LAYER_KEYS], ALL_IDS);
  });

  it('calls only the builders whose layer id is visible', () => {
    const calls: string[] = [];
    const builders: MarketingLayerBuilders = {
      marketingClients: () => { calls.push('clients'); return sentinel('clients'); },
      nwsAlerts: () => { calls.push('nws'); return sentinel('nws'); },
      localMentions: () => { calls.push('mentions'); return sentinel('mentions'); },
    };
    const out = buildMarketingLayers(ctx(['nwsAlerts', 'localMentions', 'weather']), builders);
    assert.deepEqual(calls, ['nws', 'mentions']);
    assert.deepEqual(out, [sentinel('nws'), sentinel('mentions')]);
  });

  it('drops null results', () => {
    const builders: MarketingLayerBuilders = {
      marketingClients: () => null,
      nwsAlerts: () => sentinel('nws'),
      localMentions: () => null,
    };
    assert.deepEqual(buildMarketingLayers(ctx(ALL_IDS), builders), [sentinel('nws')]);
  });

  it('skips a throwing builder, warns, and keeps the others', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const err = new Error('boom');
    const builders: MarketingLayerBuilders = {
      marketingClients: () => sentinel('clients'),
      nwsAlerts: () => { throw err; },
      localMentions: () => sentinel('mentions'),
    };
    const out = buildMarketingLayers(ctx(ALL_IDS), builders);
    assert.deepEqual(out, [sentinel('clients'), sentinel('mentions')]);
    assert.equal(warn.mock.callCount(), 1);
    assert.deepEqual(warn.mock.calls[0]?.arguments, ['[marketing-map] nwsAlerts failed', err]);
  });

  it('does not throw with empty clients and all ids visible', () => {
    assert.doesNotThrow(() => buildMarketingLayers(ctx(ALL_IDS, { clients: [] })));
  });

  it('passes the context through to builders', () => {
    let seen: MarketingLayerContext | null = null;
    const c = ctx(['marketingClients'], { focusedClientId: 'c1' });
    buildMarketingLayers(c, {
      marketingClients: (x) => { seen = x; return null; },
      nwsAlerts: () => null,
      localMentions: () => null,
    });
    assert.equal(seen, c);
  });
});

describe('mergeMarketingLayerData', () => {
  const clients = [{ id: 'c1' }] as unknown as MarketingClient[];
  const signals = [{ id: 's1' }] as unknown as MarketingSignal[];
  const mentions = [{ id: 'm1' }] as unknown as Mention[];
  const alerts = [{ id: 'a1' }] as unknown as WeatherAlert[];
  const base: MarketingLayerData = { ...EMPTY_MARKETING_LAYER_DATA, clients, signals, mentions };

  it('a weatherAlerts patch keeps clients, mentions and signals', () => {
    const next = mergeMarketingLayerData(base, { weatherAlerts: alerts });
    assert.equal(next.clients, clients);
    assert.equal(next.mentions, mentions);
    assert.equal(next.signals, signals);
    assert.equal(next.weatherAlerts, alerts);
  });

  it('a later mentions patch keeps the alerts', () => {
    const withAlerts = mergeMarketingLayerData(base, { weatherAlerts: alerts });
    const newMentions = [{ id: 'm2' }] as unknown as Mention[];
    const next = mergeMarketingLayerData(withAlerts, { mentions: newMentions });
    assert.equal(next.weatherAlerts, alerts);
    assert.equal(next.mentions, newMentions);
  });

  it('an empty patch returns equal data', () => {
    assert.deepEqual(mergeMarketingLayerData(base, {}), base);
  });

  it('drops a visibleLayerIds key', () => {
    const patch = { visibleLayerIds: new Set(['nwsAlerts']), focusedClientId: 'c1' } as Partial<MarketingLayerData>;
    const next = mergeMarketingLayerData(base, patch);
    assert.equal('visibleLayerIds' in next, false);
    assert.equal(next.focusedClientId, 'c1');
  });

  it('does not mutate the previous data', () => {
    const prev: MarketingLayerData = { ...EMPTY_MARKETING_LAYER_DATA };
    mergeMarketingLayerData(prev, { clients });
    assert.deepEqual(prev, EMPTY_MARKETING_LAYER_DATA);
  });

  it('EMPTY_MARKETING_LAYER_DATA has empty arrays and no focus', () => {
    assert.deepEqual(EMPTY_MARKETING_LAYER_DATA, {
      clients: [], focusedClientId: null, signals: [], weatherAlerts: [], mentions: [],
    });
  });
});

describe('getMarketingTooltip', () => {
  it('returns null for every W0 stub', () => {
    for (const id of ['marketing-clients', 'marketing-nws', 'marketing-mentions', 'marketing-nws-fill']) {
      assert.equal(getMarketingTooltip(info(id)), null, id);
    }
  });

  it('returns null for a non-marketing layer id', () => {
    const tooltips: MarketingTooltips = {
      marketingClients: () => ({ html: 'x' }),
      nwsAlerts: () => ({ html: 'x' }),
      localMentions: () => ({ html: 'x' }),
    };
    assert.equal(getMarketingTooltip(info('weather-layer'), tooltips), null);
    assert.equal(getMarketingTooltip(info(null), tooltips), null);
    assert.equal(getMarketingTooltip(info('marketing-unknown'), tooltips), null);
  });

  it('returns null when a tooltip throws', (t) => {
    t.mock.method(console, 'warn', () => {});
    const tooltips: MarketingTooltips = {
      marketingClients: () => { throw new Error('bad'); },
      nwsAlerts: () => null,
      localMentions: () => null,
    };
    assert.equal(getMarketingTooltip(info('marketing-clients'), tooltips), null);
  });

  it('routes a marketing-nws-* sub-layer to the NWS tooltip and returns its result', () => {
    const seen: string[] = [];
    const tooltips: MarketingTooltips = {
      marketingClients: () => { seen.push('clients'); return { html: 'c' }; },
      nwsAlerts: (i) => { seen.push(`nws:${i.layer?.id}`); return { html: 'nws' }; },
      localMentions: () => { seen.push('mentions'); return { html: 'm' }; },
    };
    assert.deepEqual(getMarketingTooltip(info('marketing-nws-polygons'), tooltips), { html: 'nws' });
    assert.deepEqual(seen, ['nws:marketing-nws-polygons']);
  });

  it('does not route marketing-nwsx to the NWS tooltip', () => {
    const tooltips: MarketingTooltips = {
      marketingClients: () => null,
      nwsAlerts: () => ({ html: 'nws' }),
      localMentions: () => null,
    };
    assert.equal(getMarketingTooltip(info('marketing-nwsx'), tooltips), null);
  });

  it('forwards to the layer props getTooltip when the layer defines one (R25)', () => {
    const picked = {
      layer: { id: 'marketing-mentions', props: { getTooltip: () => ({ html: 'from-props' }) } },
      object: {},
    } as unknown as PickingInfo;
    assert.deepEqual(getMarketingTooltip(picked), { html: 'from-props' });
  });
});
