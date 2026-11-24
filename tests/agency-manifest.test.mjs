import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the browser entry links a standalone manifest with correctly sized install icons', () => {
  const entry = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const manifestPath = entry.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
  assert.ok(manifestPath);
  const asset = path => new URL('../public' + path, import.meta.url);
  const manifest = JSON.parse(readFileSync(asset(manifestPath), 'utf8'));
  assert.ok(entry.includes(`<title>${manifest.name}</title>`));
  assert.equal(manifest.start_url, '/dashboard');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    const png = readFileSync(asset(icon.src));
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(icon.sizes, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
  }
});
