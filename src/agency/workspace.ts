import './workspace.css';

const prefix = 'agency.workspace.v1.';
type Client = { id: string; name: string };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

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
  const session = new Map<string, string>();
  function read(key: string) {
    try { return session.get(key) ?? localStorage.getItem(prefix + key) ?? ''; }
    catch { return session.get(key) ?? ''; }
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
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix + 'client.')) continue;
      const name = localStorage.getItem(key);
      if (name?.trim()) clients.push({ id: key.slice((prefix + 'client.').length), name });
    }
    selected = localStorage.getItem(prefix + 'selected') ?? '';
  } catch {
    status.textContent = 'Saved clients could not be loaded from this browser.';
  }

  function render() {
    list.replaceChildren();
    detail.replaceChildren();
    const current = clients.find(client => client.id === selected) ?? clients[0];
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
      item.append(button);
      list.append(item);
    }
    if (!current) {
      detail.append(element('h2', 'No clients yet'), element('p', 'Add a client to start their daily brief.'));
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
      const card = element('label', title);
      card.className = 'agency-card';
      const editor = element('textarea');
      editor.dataset.testid = field;
      editor.rows = 6;
      editor.placeholder = field === 'daily-brief' ? 'Write the daily brief…' : 'Add client context…';
      editor.value = read(key);
      editor.oninput = () => save(key, editor.value);
      card.append(editor);
      grid.append(card);
    }
    detail.append(element('h2', current.name), rename, grid);
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
}
