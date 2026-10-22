import { t } from '@/services/i18n';
import { safeHtml, type SafeHtml } from '@/utils/sanitize';
import type { MarketingCategory } from '../../../shared/marketing/types';

/**
 * Shared marketing empty states (index Resolutions 18 and 28). They return
 * escaped `SafeHtml` so panels can compose them inside `safeHtml` templates
 * and render through `setSafeContent`. The retry button carries
 * `data-action="marketing-retry"`; each panel handles it through its own
 * delegated click listener.
 */
export function renderNoClientsState(): SafeHtml {
  return safeHtml`<div class="marketing-empty marketing-empty--no-clients">${t('marketing.empty.noClients')}</div>`;
}

export function renderSourceUnavailable(): SafeHtml {
  return safeHtml`<div class="marketing-empty marketing-empty--source-unavailable" role="status"><span class="marketing-empty__message">${t('marketing.common.sourceUnavailable')}</span> <button type="button" class="marketing-empty__retry" data-action="marketing-retry">${t('common.retry')}</button></div>`;
}

export function categoryLabel(id: MarketingCategory): string {
  return t(`marketing.category.${id}`);
}
