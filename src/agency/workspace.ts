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
  const roster = element('aside');
  roster.className = 'client-roster';
  roster.dataset.testid = 'client-roster';
  const form = element('form');
  const label = element('label', 'New client');
  const input = element('input');
  input.required = true;
  input.dataset.testid = 'client-name';
  label.append(input);
  form.append(label, element('button', 'Add client'));
  const list = element('ul');
  roster.append(element('h2', 'Client roster'), form, list);
  const detail = element('section');
  detail.className = 'client-detail';
  const status = element('p');
  status.setAttribute('role', 'status');
  workspace.append(roster, detail, status);
  root.replaceChildren(workspace);

  const clients: Client[] = [];
  let selected = '';
  function save(key: string, value: string) {
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
    detail.append(element('h2', current.name));
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
