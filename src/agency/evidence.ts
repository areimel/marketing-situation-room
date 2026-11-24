type Evidence = { brand: string; source: string; change: string };

function webUrl(value: string) {
  const url = URL.parse(value);
  return url?.protocol === 'https:' || url?.protocol === 'http:';
}

export function mountEvidence(stored: string, save: (value: string) => void) {
  const section = document.createElement('section');
  section.className = 'agency-card';
  section.innerHTML = `
    <h2>Competitor evidence</h2>
    <form>
      <div class="agency-toolbar">
        <label>Competitor or brand<input name="brand" required></label>
        <label>Source URL<input name="source" type="url" required></label>
      </div>
      <label>Observed change<textarea name="change" required></textarea></label>
      <button>Add evidence</button>
    </form>
    <ul></ul>
  `;
  const form = section.querySelector('form')!;
  const list = section.querySelector('ul')!;
  let entries: Evidence[] = [];
  try {
    const data = JSON.parse(stored || '[]');
    if (Array.isArray(data)) entries = data.filter(entry => entry && typeof entry.brand === 'string'
      && typeof entry.change === 'string' && typeof entry.source === 'string' && webUrl(entry.source));
  } catch { /* Ignore unreadable browser data. */ }

  function render() {
    list.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement('li');
      const brand = document.createElement('strong');
      brand.textContent = entry.brand;
      const change = document.createElement('p');
      change.textContent = entry.change;
      const source = document.createElement('a');
      source.href = entry.source;
      source.textContent = 'View source';
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      const remove = document.createElement('button');
      remove.textContent = 'Remove evidence';
      remove.onclick = () => {
        entries = entries.filter(other => other !== entry);
        save(JSON.stringify(entries));
        render();
      };
      item.append(brand, change, source, ' ', remove);
      list.append(item);
    }
  }

  form.onsubmit = event => {
    event.preventDefault();
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
    const brand = field('brand').value.trim();
    const change = field('change').value.trim();
    const source = field('source').value.trim();
    for (const [name, valid, message] of [
      ['brand', brand, 'Enter a competitor or brand.'],
      ['source', webUrl(source), 'Enter an HTTP or HTTPS source URL.'],
      ['change', change, 'Describe the observed change.'],
    ] as const) {
      if (valid) continue;
      const input = field(name);
      input.setCustomValidity(message);
      input.reportValidity();
      input.oninput = () => input.setCustomValidity('');
      return;
    }
    entries.unshift({ brand, source, change });
    save(JSON.stringify(entries));
    form.reset();
    render();
  };
  render();
  return section;
}
