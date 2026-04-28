import * as S from '../lib/storage.js';

export const PRESET_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
  '#8B5CF6', '#EC4899', '#14B8A6', '#64748B'
];

export const SEARCH_DEBOUNCE_MS = 150;
export const TOAST_DURATION_MS = 2400;

export const state = {
  loaded: null,
  editingFolderId: null,
  detailFolderId: null,
  searchQuery: '',
  searchVisible: false
};

export function $(id) {
  return document.getElementById(id);
}

export function showView(view) {
  $('app').dataset.view = view;
}

export function getCurrentView() {
  return $('app').dataset.view;
}

let toastTimer = null;
export function showToast(message, type = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast';
  if (type !== 'info') el.classList.add(`toast--${type}`);
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, TOAST_DURATION_MS);
}

// Generic multi-button choice dialog. Each choice is { label, value, danger?, primary? }.
// Resolves to the chosen value, or null if dismissed via Escape or backdrop click.
export function showChoice(message, choices) {
  return new Promise((resolve) => {
    const dialog = $('modal-confirm');
    $('confirm-message').textContent = message;
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      dialog.removeEventListener('cancel', onCancel);
      resolve(value);
    };
    const onCancel = () => finish(null);
    dialog.addEventListener('cancel', onCancel);

    const actions = dialog.querySelector('.modal__actions');
    actions.replaceChildren();
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = choice.label;
      if (choice.danger) btn.className = 'danger-btn';
      else if (choice.primary) btn.className = 'primary-btn';
      else btn.className = 'secondary-btn';
      btn.addEventListener('click', () => {
        finish(choice.value);
        dialog.close();
      });
      actions.appendChild(btn);
    }
    dialog.showModal();
  });
}

export function showConfirm(message, { okLabel = 'Confirm', danger = false } = {}) {
  return showChoice(message, [
    { label: 'Cancel', value: false },
    { label: okLabel, value: true, danger, primary: !danger }
  ]).then(value => value === true);
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function reloadState() {
  return S.loadState().then(s => { state.loaded = s; return s; });
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function openInTab(url) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export function itemRefToUrl(itemRef) {
  const parsed = S.parseItemRef(itemRef);
  if (!parsed) return null;
  return `https://claude.ai/${parsed.type}/${parsed.uuid}`;
}
