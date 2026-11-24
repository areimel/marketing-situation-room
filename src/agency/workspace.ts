import { element } from './dom';
import { demoPortfolio } from './demo';
import { downloadBrief } from './brief-download';
import { mountEvidence } from './evidence';
import './workspace.css';
import { mountSignals } from './signals';

const prefix = 'agency.workspace.v1.';
type Client = { id: string; name: string; demo?: boolean };


export function mountWorkspace(root: HTMLElement) {
  const workspace = element('section');
  workspace.className = 'agency-workspace';
  const header = element('header');
  header.className = 'agency-header';
  header.append(element('h1', 'Marketing Situation Room'));
  const layout = element('div');
  layout.className = 'agency-layout';
  const roster = element('aside');
  roster.className = 'agency-sidebar';
  roster.dataset.testid = 'client-roster';
  const form = element('form');
  const label = element('label', 'New client');
  const input = element('input');
  input.required = true;
  input.dataset.testid = 'client-name';
  label.append(input);
  form.append(label, element('button', 'Add client'));
  const list = element('ul');
  list.className = 'agency-nav';
  roster.append(element('h2', 'Client roster'), form, list);
  const detail = element('section');
  detail.className = 'agency-main';
  const status = element('p');
  status.setAttribute('role', 'status');
  layout.append(roster, detail);
  workspace.append(header, layout, status);
  root.replaceChildren(workspace);

  const clients: Client[] = [];
  let selected = '';
  const defaults = new Map<string, string>();
  const session = new Map<string, string>();
  function read(key: string) {
    try { return session.get(key) ?? localStorage.getItem(prefix + key) ?? defaults.get(key) ?? ''; }
    catch { return session.get(key) ?? defaults.get(key) ?? ''; }
  }
  function save(key: string, value: string) {
    session.set(key, value);
    try {
      localStorage.setItem(prefix + key, value);
      status.textContent = '';
    } catch {
      status.textContent = 'Browser storage is unavailable. Changes last for this session only.';
    }
  }
  try {
    const keys = Object.keys(localStorage);
    if (localStorage.getItem(prefix + 'demo-portfolio') === '1') loadDemo();
    for (const key of keys) {
      if (!key.startsWith(prefix + 'client.')) continue;
      const name = localStorage.getItem(key);
      if (name?.trim()) {
        const id = key.slice((prefix + 'client.').length);
        const existing = clients.find(client => client.id === id);
        if (existing) existing.name = name;
        else clients.push({ id, name });
      }
    }
    selected = localStorage.getItem(prefix + 'selected') ?? selected;
    if (!keys.some(key => key.startsWith(prefix))) {
      loadDemo();
      save('demo-portfolio', '1');
    }
  } catch {
    if (clients.length === 0) loadDemo();
    status.textContent = 'Saved clients could not be loaded. Changes may last for this session only.';
  }

  function loadDemo() {
    for (const example of demoPortfolio) {
      const { id, name, brief, notes, brand, source, change } = example;
      clients.push({ id, name, demo: true });
      defaults.set('daily-brief.' + id, brief);
      defaults.set('client-notes.' + id, notes);
      defaults.set('evidence.' + id, JSON.stringify([{ brand, source, change }]));
    }
    selected = demoPortfolio[0]!.id;
  }

  function briefPreview(value: string) {
    const compact = value.trim().replace(/\s+/g, ' ');
    return compact.length > 80 ? compact.slice(0, 79).trimEnd() + '…' : compact || 'No brief yet';
  }

  let cleanSignals: (() => void) | undefined;
  function render() {
    cleanSignals?.();
    list.replaceChildren();
    detail.replaceChildren();
    const current = clients.find(client => client.id === selected) ?? clients[0];
    let activePreview: HTMLElement | undefined;
    for (const client of clients) {
      const item = element('li');
      const button = element('button', client.name);
      button.setAttribute('aria-pressed', String(client === current));
      button.onclick = () => {
        selected = client.id;
        save('selected', selected);
        render();
        list.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
      };
      const preview = element('p', briefPreview(read('daily-brief.' + client.id)));
      preview.className = 'agency-brief-preview';
      if (client === current) activePreview = preview;
      item.append(button);
      if (client.demo) item.append(element('small', 'Demo client'));
      item.append(preview);
      list.append(item);
    }
    if (!current) {
      detail.append(element('h2', 'No clients yet'), element('p', 'Add a client to start their daily brief.'));
      cleanSignals = mountSignals(detail, '');
      return;
    }
    const rename = element('form');
    rename.className = 'agency-toolbar';
    const nameLabel = element('label', 'Client name');
    const nameField = element('input');
    nameField.required = true;
    nameField.value = current.name;
    nameLabel.append(nameField);
    rename.append(nameLabel, element('button', 'Rename client'));
    rename.onsubmit = event => {
      event.preventDefault();
      const name = nameField.value.trim();
      if (!name) return;
      current.name = name;
      save('client.' + current.id, name);
      render();
      detail.querySelector('input')?.focus();
    };
    const grid = element('div');
    grid.className = 'agency-grid';
    for (const [field, title] of [['daily-brief', 'Daily brief'], ['client-notes', 'Client notes']] as const) {
      const key = field + '.' + current.id;
      const card = element('section');
      const label = element('label', title);
      card.className = 'agency-card';
      const editor = element('textarea');
      editor.dataset.testid = field;
      editor.rows = 6;
      editor.placeholder = field === 'daily-brief' ? 'Write the daily brief…' : 'Add client context…';
      editor.value = read(key);
      editor.oninput = () => {
        save(key, editor.value);
        if (field === 'daily-brief' && activePreview) activePreview.textContent = briefPreview(editor.value);
      };
      label.append(editor);
      card.append(label);
      if (field === 'daily-brief') {
        const download = element('button', 'Download brief');
        download.type = 'button';
        download.disabled = !editor.value.trim();
        editor.addEventListener('input', () => { download.disabled = !editor.value.trim(); });
        download.onclick = () => downloadBrief(current.name, editor.value, current.demo === true);
        card.append(download);
      }
      grid.append(card);
    }
    const signals = element('section');
    signals.dataset.testid = 'client-signals';
    detail.append(element('h2', current.name));
    if (current.demo) detail.append(element('p', 'Demo client · Fictional portfolio and sample competitor evidence'));
    detail.append(rename, grid, signals);
    const evidenceKey = 'evidence.' + current.id;
    detail.append(mountEvidence(read(evidenceKey), value => save(evidenceKey, value)));
    cleanSignals = mountSignals(signals, current.name);
  }

  form.onsubmit = event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const client = { id: crypto.randomUUID(), name };
    clients.push(client);
    selected = client.id;
    save('client.' + selected, name);
    save('selected', selected);
    input.value = '';
    render();
  };
  render();
  return () => {
    cleanSignals?.();
    workspace.remove();
  };
}
