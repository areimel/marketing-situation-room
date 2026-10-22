import type { Layer, PickingInfo } from '@deck.gl/core';
import type { MarketingLayerContext } from './types';

/** Layer id prefix; sub-layers use `marketing-mentions-*`. */
export const LAYER_ID = 'marketing-mentions';

/** W6 fills this in. W0 stub. */
export function buildLocalMentionsLayer(_ctx: MarketingLayerContext): Layer | null {
  return null;
}

/** W6 fills this in; escape all text with escapeHtml. W0 stub. */
export function getLocalMentionsTooltip(_info: PickingInfo): { html: string } | null {
  return null;
}
