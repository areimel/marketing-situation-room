import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MarketingClient } from '../shared/marketing/types.ts';
import { MARKETING_CATEGORIES } from '../shared/marketing/types.ts';
import { pointInServiceArea } from '../shared/marketing/geo.ts';
import { isMarketingClientId, MARKETING_CLIENT_ID_RE } from '../shared/marketing/ids.ts';
import { DEV_CLIENTS } from '../src/services/marketing/dev-fixtures.ts';
import {
  getFocusedClientId,
  onFocusChange,
  reconcileFocusWithRoster,
  setFocusedClientId,
} from '../src/services/marketing/focus.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function client(id: string, active = true): MarketingClient {
  return { id, name: id, category: 'other', locations: [], competitors: [], keywords: [], accountManagerEmail: null, active };
}

function record(): { calls: Array<string | null>; off: () => void } {
  const calls: Array<string | null> = [];
  const off = onFocusChange((id) => calls.push(id));
  return { calls, off };
}

describe('marketing client ids', () => {
  it('accepts the R12 format and rejects everything else', () => {
    assert.equal(MARKETING_CLIENT_ID_RE.source, '^[A-Za-z0-9_-]{1,64}$');
    assert.equal(isMarketingClientId('jd7a_b-C9'), true);
    assert.equal(isMarketingClientId('x'.repeat(64)), true);
    assert.equal(isMarketingClientId('x'.repeat(65)), false);
    assert.equal(isMarketingClientId(''), false);
    assert.equal(isMarketingClientId('bad id!'), false);
    assert.equal(isMarketingClientId(42), false);
    assert.equal(isMarketingClientId(null), false);
  });
});

// focus.ts holds module state, so these run in order: provisional
// behaviour first, then behaviour once a roster has been seen.
describe('marketing focus service', () => {
  it('does not fire on subscribe', () => {
    const { calls, off } = record();
    assert.deepEqual(calls, []);
    assert.equal(getFocusedClientId(), null);
    off();
  });

  it('notifies once per change and ignores a repeated id', () => {
    const { calls, off } = record();
    setFocusedClientId('a');
    setFocusedClientId('a');
    assert.deepEqual(calls, ['a']);
    assert.equal(getFocusedClientId(), 'a');
    off();
  });

  it('clears focus on a malformed id', () => {
    setFocusedClientId('a');
    const { calls, off } = record();
    setFocusedClientId('bad id!');
    assert.equal(getFocusedClientId(), null);
    setFocusedClientId('a');
    setFocusedClientId('x'.repeat(65));
    assert.equal(getFocusedClientId(), null);
    assert.deepEqual(calls, [null, 'a', null]);
    off();
  });

  it('stops calling a listener after unsubscribe', () => {
    const { calls, off } = record();
    off();
    setFocusedClientId('a');
    assert.deepEqual(calls, []);
  });

  it('keeps notifying other listeners when one throws', () => {
    const logged = mock.method(console, 'error', () => {});
    setFocusedClientId(null);
    const offBad = onFocusChange(() => {
      throw new Error('listener failure');
    });
    const { calls, off } = record();
    setFocusedClientId('a');
    assert.deepEqual(calls, ['a']);
    assert.equal(getFocusedClientId(), 'a');
    assert.equal(logged.mock.callCount(), 1);
    logged.mock.restore();
    offBad();
    off();
  });

  it('clears focus once when the focused client is absent from the roster', () => {
    reconcileFocusWithRoster([client('a')]);
    assert.equal(getFocusedClientId(), 'a');
    const { calls, off } = record();
    reconcileFocusWithRoster([client('b')]);
    assert.equal(getFocusedClientId(), null);
    assert.deepEqual(calls, [null]);
    off();
  });

  it('clears focus once when the focused client is inactive', () => {
    reconcileFocusWithRoster([client('a')]);
    setFocusedClientId('a');
    const { calls, off } = record();
    reconcileFocusWithRoster([client('a', false)]);
    assert.equal(getFocusedClientId(), null);
    assert.deepEqual(calls, [null]);
    setFocusedClientId('a');
    assert.equal(getFocusedClientId(), null, 'an inactive client cannot be focused');
    assert.deepEqual(calls, [null]);
    off();
  });

  it('clears focus on an unknown id once a roster has been seen', () => {
    reconcileFocusWithRoster([client('b')]);
    setFocusedClientId('b');
    const { calls, off } = record();
    setFocusedClientId('unknown-id');
    assert.equal(getFocusedClientId(), null);
    assert.deepEqual(calls, [null]);
    off();
  });
});

describe('marketing dev fixtures', () => {
  it('holds five active, clearly fake clients', () => {
    assert.equal(DEV_CLIENTS.length, 5);
    for (const c of DEV_CLIENTS) {
      assert.ok(c.name.startsWith('Fixture '), c.name);
      assert.equal(c.active, true);
    }
    assert.deepEqual(DEV_CLIENTS.map((c) => c.id), [1, 2, 3, 4, 5].map((n) => `fixture-client-${n}`));
  });

  it('uses valid ids, distinct categories and five storm-prone states', () => {
    const categories = DEV_CLIENTS.map((c) => c.category);
    assert.equal(new Set(categories).size, 5);
    for (const cat of categories) assert.ok((MARKETING_CATEGORIES as readonly string[]).includes(cat), cat);
    const states = new Set(DEV_CLIENTS.flatMap((c) => c.locations.map((l) => l.stateCode)));
    assert.deepEqual([...states].sort(), ['CO', 'FL', 'NC', 'OK', 'TX']);
    for (const c of DEV_CLIENTS) {
      assert.ok(isMarketingClientId(c.id), c.id);
      assert.ok(c.locations.length > 0, c.id);
      for (const loc of c.locations) assert.ok(isMarketingClientId(loc.id), loc.id);
    }
  });

  it('gives every location valid coordinates and a 10-40 mile radius', () => {
    for (const loc of DEV_CLIENTS.flatMap((c) => c.locations)) {
      assert.ok(loc.serviceRadiusMiles >= 10 && loc.serviceRadiusMiles <= 40, loc.id);
      assert.equal(pointInServiceArea(loc, loc.lat, loc.lon), true, loc.id);
    }
  });
});

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('dev fixture import graph (Review Focus 2)', () => {
  it('is imported only by roster.ts, dynamically, behind the literal import.meta.env.DEV', () => {
    const importers = listTs(join(ROOT, 'src'))
      .filter((file) => /['"][^'"]*dev-fixtures(\.ts)?['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    assert.deepEqual(importers, ['src/services/marketing/roster.ts']);

    const roster = readFileSync(join(ROOT, 'src/services/marketing/roster.ts'), 'utf8');
    assert.equal(roster.match(/dev-fixtures/g)?.length, 1, 'roster.ts references dev-fixtures exactly once');
    assert.match(roster, /await import\('\.\/dev-fixtures'\)/);
    assert.match(roster, /if \(import\.meta\.env\.DEV\) \{\s*const \{ DEV_CLIENTS \} = await import\('\.\/dev-fixtures'\);/);
  });
});
