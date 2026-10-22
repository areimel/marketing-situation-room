import { isMarketingClientId } from '../../../shared/marketing/ids';
import type { MarketingClient } from '../../../shared/marketing/types';
import { subscribeClients } from './roster';

/**
 * In-memory focused-client state (R12, R13). W3 adds URL sync and map zoom.
 *
 * - `onFocusChange` does not fire on subscribe.
 * - Setting the current id again does nothing.
 * - A malformed id clears focus.
 * - Once a roster has been seen, an unknown or inactive id clears focus.
 *   Before the first roster, a well-formed id is held provisionally.
 */

type FocusListener = (id: string | null) => void;

let focusedClientId: string | null = null;
let activeClientIds: Set<string> | null = null;
let rosterSubscribed = false;
const listeners = new Set<FocusListener>();

function ensureRosterSubscription(): void {
  if (rosterSubscribed) return;
  rosterSubscribed = true;
  subscribeClients(reconcileFocusWithRoster);
}

function commit(next: string | null): void {
  if (next === focusedClientId) return;
  focusedClientId = next;
  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch (err) {
      console.error('[marketing-focus] listener failed', err);
    }
  }
}

function accepts(id: string | null): id is string {
  if (!isMarketingClientId(id)) return false;
  return activeClientIds === null || activeClientIds.has(id);
}

export function getFocusedClientId(): string | null {
  return focusedClientId;
}

export function setFocusedClientId(id: string | null): void {
  ensureRosterSubscription();
  commit(accepts(id) ? id : null);
}

export function onFocusChange(cb: FocusListener): () => void {
  ensureRosterSubscription();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Records the active ids and clears focus (one notification) if the focused client is not among them. */
export function reconcileFocusWithRoster(clients: MarketingClient[]): void {
  activeClientIds = new Set(clients.filter((c) => c.active).map((c) => c.id));
  if (focusedClientId !== null && !activeClientIds.has(focusedClientId)) commit(null);
}
