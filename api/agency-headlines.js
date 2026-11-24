export const config = { runtime: 'edge' };

const feed = new URL('https://news.google.com/rss/search');
feed.search = new URLSearchParams({
  q: '("digital marketing" OR "advertising agencies" OR "paid search") when:7d',
  hl: 'en-US',
  gl: 'US',
  ceid: 'US:en',
}).toString();

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  }

  try {
    const source = await fetch(feed.href, {
      headers: { Accept: 'application/rss+xml', 'User-Agent': 'AgencyMarketingHeadlines/1.0' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (source.ok) {
      const xml = await source.text();
      if (/<rss(?:\s|>)/i.test(xml)) {
        return new Response(xml, { headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=60, s-maxage=600',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        } });
      }
    }
  } catch {
    // Network failures and timeouts share the unavailable state.
  }
  return new Response('Feed unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
}
