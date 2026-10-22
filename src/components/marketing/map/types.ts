import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Mention, WeatherAlert } from '@/services/marketing/api';
import type { MarketingClient, MarketingSignal } from '../../../../shared/marketing/types';

/**
 * Shared contract for the marketing map layers (index "Map layers" + R9).
 *
 * Kept free of deck.gl runtime imports so MapContainer can use the pure merge
 * helper without pulling the WebGL renderer into its eager chunk.
 */
export interface MarketingLayerContext {
  clients: MarketingClient[];
  focusedClientId: string | null;
  /** Reserved for W8. */
  signals: MarketingSignal[];
  visibleLayerIds: Set<string>;
  weatherAlerts: WeatherAlert[];
  mentions: Mention[];
}

/** The stored part of the context; `visibleLayerIds` is derived per build. */
export type MarketingLayerData = Omit<MarketingLayerContext, 'visibleLayerIds'>;

export const MARKETING_LAYER_KEYS = ['marketingClients', 'nwsAlerts', 'localMentions'] as const;
export type MarketingLayerKey = typeof MARKETING_LAYER_KEYS[number];

export type MarketingLayerBuilder = (ctx: MarketingLayerContext) => Layer | null;
export type MarketingTooltip = (info: PickingInfo) => { html: string } | null;
export type MarketingLayerBuilders = Record<MarketingLayerKey, MarketingLayerBuilder>;
export type MarketingTooltips = Record<MarketingLayerKey, MarketingTooltip>;

export const EMPTY_MARKETING_LAYER_DATA: Readonly<MarketingLayerData> = Object.freeze({
  clients: [],
  focusedClientId: null,
  signals: [],
  weatherAlerts: [],
  mentions: [],
});

/**
 * Shallow-merges a patch into the stored data. Each key replaces only that
 * key, so independent writers (clients, alerts, mentions, signals) never
 * overwrite each other. A `visibleLayerIds` key is ignored.
 */
export function mergeMarketingLayerData(
  prev: MarketingLayerData,
  patch: Partial<MarketingLayerData>,
): MarketingLayerData {
  const { visibleLayerIds: _ignored, ...rest } = patch as Partial<MarketingLayerContext>;
  const next: MarketingLayerData = { ...prev };
  for (const [key, value] of Object.entries(rest) as [keyof MarketingLayerData, unknown][]) {
    if (value !== undefined) (next as Record<keyof MarketingLayerData, unknown>)[key] = value;
  }
  return next;
}
