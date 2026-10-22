/**
 * Every variant a user can switch to. One desktop binary ships and switches
 * between all of these in-app (#5908), so this list is also the set
 * `/api/download` accepts — `tests/desktop-one-binary-model.test.mjs` fails if
 * the two drift apart.
 */
export const SITE_VARIANTS = ['full', 'tech', 'finance', 'happy', 'commodity', 'energy', 'marketing'] as const;

export type SiteVariant = (typeof SITE_VARIANTS)[number];

export function isSiteVariant(value: string | null | undefined): value is SiteVariant {
  return typeof value === 'string' && (SITE_VARIANTS as readonly string[]).includes(value);
}

/** Internal variants that only exist as their own pinned build, never as a switch target. */
type InternalSiteVariant = 'marketing';

export type SwitchableSiteVariant = Exclude<SiteVariant, InternalSiteVariant>;

/**
 * Variants a user or agent can switch to from inside the app (WebMCP
 * switch_monitor, the stored desktop/localhost variant). The internal
 * marketing variant is excluded so non-marketing builds behave exactly as
 * before it was registered.
 */
export const SWITCHABLE_SITE_VARIANTS = SITE_VARIANTS.filter(
  (variant): variant is SwitchableSiteVariant => variant !== 'marketing',
) as readonly SwitchableSiteVariant[];

export function isSwitchableSiteVariant(
  value: string | null | undefined,
): value is SwitchableSiteVariant {
  return typeof value === 'string' && (SWITCHABLE_SITE_VARIANTS as readonly string[]).includes(value);
}

const buildVariant = (() => {
  try {
    return import.meta.env.VITE_VARIANT || 'full';
  } catch {
    return 'full';
  }
})();

/**
 * A pinned build variant always boots as itself: it ignores the stored
 * desktop/localhost variant and the hostname. Only the internal marketing
 * build is pinned; every other build keeps its existing resolution path.
 */
export function isPinnedBuildVariant(buildVariant: string): boolean {
  return buildVariant === 'marketing';
}

function loadStoredVariant(): string | null {
  try {
    return localStorage.getItem('worldmonitor-variant');
  } catch {
    return null;
  }
}

export const SITE_VARIANT: string = (() => {
  if (isPinnedBuildVariant(buildVariant)) return 'marketing';
  if (typeof window === 'undefined') return buildVariant;

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  if (isTauri) {
    const stored = loadStoredVariant();
    if (isSwitchableSiteVariant(stored)) return stored;
    return buildVariant;
  }

  // window.location, not bare `location`: node-based tests stub `window`
  // without a global `location`, and this module must stay importable there.
  const h = window.location?.hostname;
  if (!h) return buildVariant;
  if (h.startsWith('tech.')) return 'tech';
  if (h.startsWith('finance.')) return 'finance';
  if (h.startsWith('happy.')) return 'happy';
  if (h.startsWith('commodity.')) return 'commodity';
  if (h.startsWith('energy.')) return 'energy';

  if (h === 'localhost' || h === '127.0.0.1') {
    const stored = loadStoredVariant();
    if (isSwitchableSiteVariant(stored)) return stored;
    return buildVariant;
  }

  return 'full';
})();
