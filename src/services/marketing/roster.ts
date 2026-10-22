import type { MarketingClient } from '../../../shared/marketing/types';

export type MarketingRosterStatus = 'loading' | 'ready' | 'forbidden' | 'error';

/**
 * Every client, inactive ones included; consumers hide inactive clients (R12).
 * W0 serves dev fixtures; W2 replaces this body with Convex.
 *
 * Privacy: the fixture import must stay behind the literal
 * `import.meta.env.DEV` so Vite replaces it with `false` in production and
 * Rollup drops the fixture chunk. Outside DEV the roster is empty.
 */
export async function getClients(): Promise<MarketingClient[]> {
  if (import.meta.env.DEV) {
    const { DEV_CLIENTS } = await import('./dev-fixtures');
    return structuredClone(DEV_CLIENTS);
  }
  return [];
}

/** Calls `cb` once, asynchronously, with the current roster. W2 makes it live. */
export function subscribeClients(cb: (clients: MarketingClient[]) => void): () => void {
  let subscribed = true;
  getClients()
    .then((clients) => {
      if (subscribed) cb(clients);
    })
    .catch(() => {
      // No roster (e.g. a plain node import with no `import.meta.env`); W2 adds error status.
    });
  return () => {
    subscribed = false;
  };
}

/** W0 always reports `'ready'`; W2 makes it real (R18). */
export function getRosterStatus(): MarketingRosterStatus {
  return 'ready';
}

/** W0 never fires the listener; W2 makes it real (R18). */
export function onRosterStatusChange(_cb: (status: MarketingRosterStatus) => void): () => void {
  return () => {};
}
