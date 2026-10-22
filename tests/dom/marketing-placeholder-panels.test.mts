import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import en from '@/locales/en.json';
import { MARKETING_CATEGORIES } from '../../shared/marketing/types';
import { ClientRosterPanel } from '@/components/marketing/ClientRosterPanel';
import { MarketingAlertsPanel } from '@/components/marketing/MarketingAlertsPanel';
import { WeatherAlertsPanel } from '@/components/marketing/WeatherAlertsPanel';
import { MarketingCalendarPanel } from '@/components/marketing/MarketingCalendarPanel';
import { LocalMentionsPanel } from '@/components/marketing/LocalMentionsPanel';
import { DemandTrendsPanel } from '@/components/marketing/DemandTrendsPanel';
import {
  categoryLabel,
  renderNoClientsState,
  renderSourceUnavailable,
} from '@/components/marketing/empty-state';
import { safeHtmlToString } from '@/utils/sanitize';
import { initTestI18n } from './helpers/i18n.mts';

const PANELS = [
  { Panel: ClientRosterPanel, id: 'client-roster', title: en.marketing.panels.clientRoster },
  { Panel: MarketingAlertsPanel, id: 'marketing-alerts', title: en.marketing.panels.alerts },
  { Panel: WeatherAlertsPanel, id: 'weather-alerts', title: en.marketing.panels.weatherAlerts },
  { Panel: MarketingCalendarPanel, id: 'marketing-calendar', title: en.marketing.panels.calendar },
  { Panel: LocalMentionsPanel, id: 'local-mentions', title: en.marketing.panels.localMentions },
  { Panel: DemandTrendsPanel, id: 'demand-trends', title: en.marketing.panels.demandTrends },
] as const;

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  // Test-only parse of the helper's escaped SafeHtml output.
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

beforeAll(async () => {
  await initTestI18n();
});

beforeEach(() => {
  document.body.replaceChildren();
});

describe('marketing placeholder panels', () => {
  for (const { Panel, id, title } of PANELS) {
    it(`${id} carries its contract id, title and coming-soon copy`, () => {
      const el = new Panel().getElement();
      expect(el.dataset.panel).toBe(id);
      expect(el.textContent).toContain(title);
      const placeholder = el.querySelector('.panel-content .marketing-coming-soon');
      expect(placeholder).not.toBeNull();
      expect(placeholder!.textContent).toBe(en.marketing.panel.comingSoon);
    });
  }
});

describe('marketing empty-state helpers', () => {
  it('renderNoClientsState shows the add-first-client copy', () => {
    const host = mount(safeHtmlToString(renderNoClientsState()));
    const el = host.querySelector('.marketing-empty.marketing-empty--no-clients');
    expect(el).not.toBeNull();
    expect(el!.textContent!.trim()).toBe(en.marketing.empty.noClients);
  });

  it('renderSourceUnavailable is a status region with the copy and a marketing-retry action', () => {
    const host = mount(safeHtmlToString(renderSourceUnavailable()));
    const el = host.querySelector('.marketing-empty.marketing-empty--source-unavailable');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('role')).toBe('status');
    expect(el!.querySelector('.marketing-empty__message')!.textContent).toBe(en.marketing.common.sourceUnavailable);
    const retry = el!.querySelector<HTMLButtonElement>('button[data-action="marketing-retry"]');
    expect(retry).not.toBeNull();
    expect(retry!.type).toBe('button');
    expect(retry!.textContent!.trim()).toBe(en.common.retry);
  });

  it('categoryLabel resolves every marketing category to a translated label', () => {
    for (const id of MARKETING_CATEGORIES) {
      const label = categoryLabel(id);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(`marketing.category.${id}`);
      expect(label).toBe((en.marketing.category as Record<string, string>)[id]);
    }
  });
});
