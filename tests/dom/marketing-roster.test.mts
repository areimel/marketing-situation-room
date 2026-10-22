import { describe, expect, it } from 'vitest';
import type { MarketingClient } from '../../shared/marketing/types';
import { DEV_CLIENTS } from '../../src/services/marketing/dev-fixtures';
import { getClients, getRosterStatus, onRosterStatusChange, subscribeClients } from '../../src/services/marketing/roster';

function nextClients(): Promise<{ clients: MarketingClient[]; off: () => void }> {
  return new Promise((resolve) => {
    const off = subscribeClients((clients) => resolve({ clients, off }));
  });
}

describe('marketing roster service (DEV fixtures)', () => {
  it('runs with import.meta.env.DEV true', () => {
    expect(import.meta.env.DEV).toBe(true);
  });

  it('returns the dev fixtures from getClients', async () => {
    expect(await getClients()).toEqual(DEV_CLIENTS);
  });

  it('delivers the fixture roster to a subscriber, and again after unsubscribe', async () => {
    const first = await nextClients();
    expect(first.clients).toHaveLength(5);
    first.off();
    const second = await nextClients();
    expect(second.clients).toHaveLength(5);
    second.off();
  });

  it('does not call a subscriber that unsubscribed before delivery', async () => {
    let calls = 0;
    const off = subscribeClients(() => calls++);
    off();
    await getClients();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(0);
  });

  it('reports a ready roster status with a callable unsubscribe', () => {
    expect(getRosterStatus()).toBe('ready');
    const off = onRosterStatusChange(() => {});
    expect(typeof off).toBe('function');
    off();
  });
});
