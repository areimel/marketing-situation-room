import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { pinPrepaintVariant } from '../shared/pin-prepaint-variant.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
const vercelConfig = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8'));
const csp = vercelConfig.headers
  .find((entry) => entry.headers?.some(
    (header) => header.key === 'X-Frame-Options' && header.value === 'SAMEORIGIN',
  ))
  ?.headers
  ?.find((header) => header.key === 'Content-Security-Policy')
  ?.value ?? '';
const variantBootstrapScript = indexHtml.match(/<script data-wm-prepaint>([\s\S]*?)<\/script>/)?.[1];

describe('variant inline bootstrap', () => {
  it('detects every public variant host before the app bundle loads', () => {
    for (const variant of ['happy', 'tech', 'finance', 'commodity', 'energy']) {
      assert.ok(
        indexHtml.includes(`h.startsWith('${variant}.'))v='${variant}'`),
        `index.html inline bootstrap must set data-variant for ${variant}.worldmonitor.app`,
      );
    }
  });

  it('allows the inline variant bootstrap through the CSP', () => {
    assert.ok(variantBootstrapScript, 'index.html must include the inline variant bootstrap script');
    assert.ok(
      variantBootstrapScript.includes('worldmonitor-variant') && variantBootstrapScript.includes('document.documentElement.dataset.variant'),
      'the marked pre-paint script must retain variant bootstrapping',
    );

    const hash = createHash('sha256').update(variantBootstrapScript).digest('base64');
    assert.ok(
      csp.includes(`'sha256-${hash}'`),
      `Vercel Content-Security-Policy must include sha256-${hash} for the inline variant bootstrap script`,
    );
  });

  it('keeps the pinned-variant prepaint script syntactically valid', () => {
    const pinned = pinPrepaintVariant(indexHtml, 'marketing');
    const src = pinned.match(/<script data-wm-prepaint>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(src);
    assert.doesNotThrow(() => new vm.Script(src));
    const root = { dataset: {}, classList: { add() {} }, removeAttribute() {} };
    const ctx = {
      location: { hostname: 'example.com' },
      localStorage: { getItem: () => null, removeItem() {} },
      window: { self: 1, top: 1 },
      document: { documentElement: root },
    };
    ctx.window.matchMedia = undefined;
    vm.runInNewContext(src, ctx);
    assert.equal(root.dataset.variant, 'marketing');
  });
});
