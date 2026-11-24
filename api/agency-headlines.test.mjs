import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './agency-headlines.js';

test('headlines always fetch the fixed marketing feed', async (t) => {
  const xml = '<rss><channel><title>Industry coverage</title></channel></rss>';
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(xml));
  const result = await handler(new Request('https://example.org/api/agency-headlines?url=https://example.org'));
  assert.equal(result.status, 200);
  assert.equal(await result.text(), xml);
  const source = new URL(fetch.mock.calls[0].arguments[0]);
  assert.equal(source.origin, 'https://news.google.com');
  assert.match(source.searchParams.get('q'), /marketing/);
});

test('unsupported methods and unavailable feeds have explicit status codes', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('<html>Unavailable</html>'));
  const request = new Request('https://example.org/api/agency-headlines');
  assert.equal((await handler(new Request(request, { method: 'POST' }))).status, 405);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal((await handler(request)).status, 502);
});
