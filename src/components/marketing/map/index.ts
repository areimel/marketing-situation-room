import type { Layer, PickingInfo } from '@deck.gl/core';
import { LAYER_ID as CLIENTS_LAYER_ID, buildMarketingClientsLayer, getMarketingClientsTooltip } from './clients-layer';
import { LAYER_ID as MENTIONS_LAYER_ID, buildLocalMentionsLayer, getLocalMentionsTooltip } from './mentions-layer';
import { LAYER_ID as NWS_LAYER_ID, buildNwsAlertsLayer, getNwsAlertsTooltip } from './nws-layer';
import {
  MARKETING_LAYER_KEYS,
  type MarketingLayerBuilders,
  type MarketingLayerContext,
  type MarketingLayerKey,
  type MarketingTooltip,
  type MarketingTooltips,
} from './types';

export * from './types';
export { buildLocalMentionsLayer, buildMarketingClientsLayer, buildNwsAlertsLayer };
export { getLocalMentionsTooltip, getMarketingClientsTooltip, getNwsAlertsTooltip };

export const DEFAULT_BUILDERS: MarketingLayerBuilders = {
  marketingClients: buildMarketingClientsLayer,
  nwsAlerts: buildNwsAlertsLayer,
  localMentions: buildLocalMentionsLayer,
};

export const DEFAULT_TOOLTIPS: MarketingTooltips = {
  marketingClients: getMarketingClientsTooltip,
  nwsAlerts: getNwsAlertsTooltip,
  localMentions: getLocalMentionsTooltip,
};

const LAYER_ID_PREFIXES: Record<MarketingLayerKey, string> = {
  marketingClients: CLIENTS_LAYER_ID,
  nwsAlerts: NWS_LAYER_ID,
  localMentions: MENTIONS_LAYER_ID,
};

/**
 * Builds the visible marketing layers. A builder runs only when its layer key
 * is in `ctx.visibleLayerIds`; null results are dropped, and a throwing
 * builder is logged and skipped so one broken layer never blanks the map.
 */
export function buildMarketingLayers(
  ctx: MarketingLayerContext,
  builders: MarketingLayerBuilders = DEFAULT_BUILDERS,
): Layer[] {
  const layers: Layer[] = [];
  for (const key of MARKETING_LAYER_KEYS) {
    if (!ctx.visibleLayerIds.has(key)) continue;
    try {
      const layer = builders[key](ctx);
      if (layer) layers.push(layer);
    } catch (err) {
      console.warn(`[marketing-map] ${key} failed`, err);
    }
  }
  return layers;
}

function ownerOf(layerId: string): MarketingLayerKey | null {
  for (const key of MARKETING_LAYER_KEYS) {
    const prefix = LAYER_ID_PREFIXES[key];
    if (layerId === prefix || layerId.startsWith(`${prefix}-`)) return key;
  }
  return null;
}

/**
 * Tooltip for a picked `marketing-*` layer. Per R25 a layer's own
 * `props.getTooltip` wins when present; otherwise the owning builder file's
 * tooltip export answers. A throwing tooltip yields null.
 */
export function getMarketingTooltip(
  info: PickingInfo,
  tooltips: MarketingTooltips = DEFAULT_TOOLTIPS,
): { html: string } | null {
  const layerId = info.layer?.id ?? '';
  if (!layerId.startsWith('marketing-')) return null;
  const propsTooltip = (info.layer?.props as { getTooltip?: unknown } | undefined)?.getTooltip;
  const owner = ownerOf(layerId);
  const tooltip: MarketingTooltip | null = typeof propsTooltip === 'function'
    ? (propsTooltip as MarketingTooltip)
    : owner ? tooltips[owner] : null;
  if (!tooltip) return null;
  try {
    return tooltip(info) ?? null;
  } catch (err) {
    console.warn(`[marketing-map] tooltip for ${layerId} failed`, err);
    return null;
  }
}
