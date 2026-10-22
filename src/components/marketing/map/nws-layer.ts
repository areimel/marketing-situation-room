import type { Layer, PickingInfo } from '@deck.gl/core';
import type { MarketingLayerContext } from './types';

/** Layer id prefix; sub-layers use `marketing-nws-*`. */
export const LAYER_ID = 'marketing-nws';

/** W4 fills this in. W0 stub. */
export function buildNwsAlertsLayer(_ctx: MarketingLayerContext): Layer | null {
  return null;
}

/** W4 fills this in; escape all text with escapeHtml. W0 stub. */
export function getNwsAlertsTooltip(_info: PickingInfo): { html: string } | null {
  return null;
}
