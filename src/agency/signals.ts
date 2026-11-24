function headlineList(xml: string): HTMLUListElement {
  const rss = new DOMParser().parseFromString(xml, 'application/xml');
  const channel = rss.querySelector('rss > channel');
  if (!channel || rss.querySelector('parsererror')) throw new Error('Invalid RSS');

  const list = document.createElement('ul');
  const seen = new Set<string>();
  for (const item of channel.querySelectorAll('item')) {
    const title = item.querySelector('title')?.textContent?.trim();
    const href = item.querySelector('link')?.textContent?.trim();
    if (!title || !href || !URL.canParse(href)) continue;
    const url = new URL(href);
    if (url.origin !== 'https://news.google.com' || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);

    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = title;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const row = document.createElement('li');
    row.append(link);
    list.append(row);
    if (list.childElementCount === 6) break;
  }
  return list;
}

export function mountSignals(root: HTMLElement, clientName: string): () => void {
  const lifetime = new AbortController();
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = 'Marketing headlines';
  const context = document.createElement('p');
  context.textContent = clientName
    ? `Industry coverage for the ${clientName} workspace. Shared across clients.`
    : 'Industry coverage shared across clients.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Loading Google News headlines…';
  section.append(heading, context, status);
  root.append(section);

  async function load(): Promise<void> {
    try {
      const response = await fetch('/api/agency-headlines', {
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw new Error('Feed unavailable');
      const list = headlineList(await response.text());
      if (lifetime.signal.aborted) return;
      status.textContent = list.childElementCount
        ? 'Source · Google News RSS'
        : 'Google News returned no displayable headlines.';
      if (list.childElementCount) section.append(list);
    } catch {
      if (!lifetime.signal.aborted) status.textContent = 'Google News headlines are unavailable.';
    }
  }
  void load();
  return () => {
    lifetime.abort();
    section.remove();
  };
}
