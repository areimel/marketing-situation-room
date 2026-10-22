import { Panel } from '@/components/Panel';
import { t } from '@/services/i18n';

/**
 * W0 placeholder for a marketing panel. Each owning workstream replaces its
 * own panel file and keeps the export name and the no-arg constructor.
 */
export class MarketingPlaceholderPanel extends Panel {
  constructor(id: string, titleKey: string) {
    super({ id, title: t(titleKey) });
    const message = document.createElement('p');
    message.className = 'marketing-coming-soon';
    message.textContent = t('marketing.panel.comingSoon');
    this.setContentNodes(message);
  }
}
