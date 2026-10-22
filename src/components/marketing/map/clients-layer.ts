import type { Layer, PickingInfo } from '@deck.gl/core';
import type { MarketingLayerContext } from './types';

/** Layer id prefix; sub-layers use `marketing-clients-*`. */
export const LAYER_ID = 'marketing-clients';

/** W3 fills this in. W0 stub. */
export function buildMarketingClientsLayer(_ctx: MarketingLayerContext): Layer | null {
  return null;
}

/** W3 fills this in; escape all text with escapeHtml. W0 stub. */
export function getMarketingClientsTooltip(_info: PickingInfo): { html: string } | null {
  return null;
}
