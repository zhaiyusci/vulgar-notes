import { locale, t } from './i18n';

export interface DocumentHomeRecent {
  id: string;
  name: string;
  path?: string;
  lastOpened?: number | string;
}

export interface DocumentHomeRecovery {
  id: string;
  name: string;
  updatedAt?: number | string;
}

export interface DocumentHomeState {
  recentDocuments?: readonly DocumentHomeRecent[];
  recoveries?: readonly DocumentHomeRecovery[];
  loading?: boolean;
  error?: string;
}

export interface DocumentHomeCallbacks {
  onNew: () => void | Promise<void>;
  onOpen: () => void | Promise<void>;
  onRecent: (id: string) => void | Promise<void>;
  onRecover?: (id: string) => void | Promise<void>;
  onRemoveRecent?: (id: string) => void | Promise<void>;
  onPreferences: () => void | Promise<void>;
}

export interface DocumentHome {
  refresh: (state: DocumentHomeState) => void;
  unmount: () => void;
}

const iconPaths = {
  new: ['M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z', 'M12 3v6h6', 'M12 12v6', 'M9 15h6'],
  open: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2', 'M3 10h18l-3 10H3Z'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M9 3h6l.7 2.5 2.5 1.4L21 7l2 5-2.8 2.1-.7 2.9.5 2-5 3-2.2-2H10l-2.2 2-5-3 .5-2-.7-2.9L0 12l2-5 2.8-.1 2.5-1.4Z'],
} as const;

function icon(name: keyof typeof iconPaths): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of iconPaths[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Application chrome only: the start screen never owns or creates document data. */
export function mountDocumentHome(
  container: HTMLElement,
  callbacks: DocumentHomeCallbacks,
  initialState: DocumentHomeState = {},
): DocumentHome {
  let state = initialState;
  let pending = false;
  let active = true;
  let actionError = '';
  const root = element('section', 'document-home');
  root.setAttribute('aria-label', t('Start page'));
  const inner = element('div', 'document-home-inner');
  const header = element('header', 'document-home-header');
  header.append(element('h1', 'document-home-title', 'Vulgar Notes'));
  const preferences = element('button', 'document-home-icon-button');
  preferences.type = 'button';
  preferences.setAttribute('aria-label', t('Preferences'));
  preferences.title = t('Preferences');
  preferences.append(icon('settings'));
  header.append(preferences);
  const actions = element('div', 'document-home-actions');
  const newButton = element('button', 'document-home-action document-home-action-primary');
  newButton.type = 'button';
  newButton.append(icon('new'), element('span', '', t('New document')));
  const openButton = element('button', 'document-home-action');
  openButton.type = 'button';
  openButton.append(icon('open'), element('span', '', t('Open document')));
  actions.append(newButton, openButton);
  const status = element('p', 'document-home-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const error = element('p', 'document-home-error');
  error.setAttribute('role', 'alert');
  const recoveries = element('section', 'document-home-section');
  recoveries.setAttribute('aria-label', t('Unsaved documents'));
  const recent = element('section', 'document-home-section');
  recent.setAttribute('aria-label', t('Recent documents'));
  inner.append(header, actions, status, error, recoveries, recent);
  root.append(inner);
  container.append(root);

  async function run(action: () => void | Promise<void>): Promise<void> {
    if (!active || pending || state.loading) return;
    pending = true;
    actionError = '';
    updateStatus();
    try {
      await action();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : t('Unable to open document');
    } finally {
      pending = false;
      if (active) updateStatus();
    }
  }

  function updateStatus(): void {
    const busy = !!state.loading || pending;
    root.setAttribute('aria-busy', String(busy));
    root.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    status.textContent = busy ? t('Loading…') : '';
    status.hidden = !busy;
    error.textContent = actionError || state.error || '';
    error.hidden = !error.textContent;
  }

  function dateLabel(value: number | string | undefined, label: string): HTMLTimeElement | null {
    if (value === undefined) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const el = element('time', 'document-home-date');
    el.dateTime = date.toISOString();
    el.textContent = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
    el.title = `${t(label)}: ${el.textContent}`;
    el.setAttribute('aria-label', el.title);
    return el;
  }

  function renderList(): void {
    recent.replaceChildren(element('h2', 'document-home-heading', t('Recent documents')));
    if (!state.recentDocuments?.length) {
      if (!state.loading) recent.append(element('p', 'document-home-empty', t('No recent documents')));
    } else {
      const list = element('ul', 'document-home-list');
      for (const item of state.recentDocuments) {
        const row = element('li', 'document-home-row');
        const open = element('button', 'document-home-file');
        open.type = 'button';
        open.dataset.recentId = item.id;
        open.append(icon('file'));
        const details = element('span', 'document-home-file-details');
        details.append(element('span', 'document-home-file-name', item.name));
        if (item.path) {
          const path = element('span', 'document-home-file-path', item.path);
          path.title = item.path;
          details.append(path);
        }
        open.append(details);
        const date = dateLabel(item.lastOpened, 'Last opened');
        if (date) open.append(date);
        open.addEventListener('click', () => { void run(() => callbacks.onRecent(item.id)); });
        row.append(open);
        if (callbacks.onRemoveRecent) {
          const remove = element('button', 'document-home-icon-button document-home-remove');
          remove.type = 'button';
          remove.title = t('Remove from recent documents');
          remove.setAttribute('aria-label', `${t('Remove from recent documents')}: ${item.name}`);
          remove.append(icon('close'));
          remove.addEventListener('click', () => { void run(() => callbacks.onRemoveRecent!(item.id)); });
          row.append(remove);
        }
        list.append(row);
      }
      recent.append(list);
    }
    recoveries.replaceChildren();
    recoveries.hidden = !callbacks.onRecover || !state.recoveries?.length;
    if (!recoveries.hidden) {
      recoveries.append(element('h2', 'document-home-heading', t('Unsaved documents')));
      const list = element('ul', 'document-home-list');
      for (const item of state.recoveries!) {
        const row = element('li', 'document-home-row');
        const open = element('button', 'document-home-file');
        open.type = 'button';
        open.dataset.recoveryId = item.id;
        open.append(icon('file'));
        const details = element('span', 'document-home-file-details');
        details.append(element('span', 'document-home-file-name', item.name));
        open.append(details);
        const date = dateLabel(item.updatedAt, 'Last edited');
        if (date) open.append(date);
        open.addEventListener('click', () => { void run(() => callbacks.onRecover!(item.id)); });
        row.append(open);
        list.append(row);
      }
      recoveries.append(list);
    }
    updateStatus();
  }

  preferences.addEventListener('click', () => { void run(callbacks.onPreferences); });
  newButton.addEventListener('click', () => { void run(callbacks.onNew); });
  openButton.addEventListener('click', () => { void run(callbacks.onOpen); });
  renderList();
  return {
    refresh(nextState) {
      if (!active) return;
      state = nextState;
      actionError = '';
      renderList();
    },
    unmount() {
      active = false;
      root.remove();
    },
  };
}
