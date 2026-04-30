import * as S from '../lib/storage.js';
import { listPresets } from '../lib/themes.js';

let overlayEl = null;
let backdropEl = null;
let api = null;
let mainState = null;
let escListener = null;
let suppressEvents = false;
let pendingFile = null;
let promptResolver = null;

const APP_VERSION_BYTES_LIMIT = 10 * 1024 * 1024;
const COLOR_PRESETS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6b7280'
];

export function mount(state, apiHandle) {
  mainState = state;
  api = apiHandle;
  if (overlayEl) {
    populate();
    return;
  }
  buildDom();
  document.body.appendChild(backdropEl);
  document.body.appendChild(overlayEl);
  attachDismissHandlers();
  populate();
  refreshStorageUsage();
  // Move focus into the overlay for keyboard users
  const firstFocus = overlayEl.querySelector('select, input, button');
  if (firstFocus) firstFocus.focus();
}

export function unmount() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  if (backdropEl) {
    backdropEl.remove();
    backdropEl = null;
  }
  if (escListener) {
    document.removeEventListener('keydown', escListener);
    escListener = null;
  }
  pendingFile = null;
  promptResolver = null;
}

export function isOpen() {
  return overlayEl !== null;
}

// Re-populate values when storage changes from another surface (popup,
// service worker context menu, etc).
export function onStateChange(state) {
  mainState = state;
  if (overlayEl) {
    populate();
    refreshStorageUsage();
  }
}

function buildDom() {
  backdropEl = document.createElement('div');
  backdropEl.className = 'cwcf-settings-backdrop';
  backdropEl.setAttribute('data-cwcf-settings', 'true');

  overlayEl = document.createElement('div');
  overlayEl.className = 'cwcf-settings';
  overlayEl.setAttribute('data-cwcf-settings', 'true');
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-modal', 'true');
  overlayEl.setAttribute('aria-labelledby', 'cwcf-settings-title');

  const header = document.createElement('header');
  header.className = 'cwcf-settings__header';
  const title = document.createElement('h2');
  title.id = 'cwcf-settings-title';
  title.className = 'cwcf-settings__title';
  title.textContent = 'Settings';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cwcf-settings__close';
  closeBtn.title = 'Close settings';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  closeBtn.addEventListener('click', unmount);
  header.appendChild(closeBtn);
  overlayEl.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cwcf-settings__body';

  body.appendChild(buildAppearanceSection());
  body.appendChild(buildViewSection());
  body.appendChild(buildAutoOrganizeSection());
  body.appendChild(buildFoldersSection());
  body.appendChild(buildBehaviorSection());
  body.appendChild(buildDataSection());

  overlayEl.appendChild(body);
}

function buildAppearanceSection() {
  const section = sectionEl('Appearance');
  const themeOptions = listPresets().map(p => ({ value: p.id, label: p.label }));
  section.appendChild(rowSelect('Theme', 'cwcf-set-theme', themeOptions,
    (value) => apply({ activeTheme: value })));

  section.appendChild(rowSelect('Density', 'cwcf-set-density', [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' }
  ], (value) => apply({ density: value })));

  section.appendChild(rowCheckbox('Reduce motion', 'cwcf-set-reduce-motion',
    (checked) => apply({ reduceMotion: checked })));

  section.appendChild(buildColorPickerRow('Default folder color', 'cwcf-set-default-color',
    (value) => apply({ defaultFolderColor: value })));

  return section;
}

function buildColorPickerRow(label, id, onChange) {
  const row = document.createElement('div');
  row.className = 'cwcf-settings__row';
  const span = document.createElement('span');
  span.className = 'cwcf-settings__label';
  span.textContent = label;
  row.appendChild(span);

  const grid = document.createElement('div');
  grid.id = id;
  grid.className = 'cwcf-settings__color-grid';
  for (const color of COLOR_PRESETS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'cwcf-settings__swatch';
    sw.style.background = color;
    sw.dataset.color = color;
    sw.title = color;
    sw.setAttribute('aria-label', `Set default folder color to ${color}`);
    sw.addEventListener('click', () => {
      grid.querySelectorAll('.cwcf-settings__swatch--selected').forEach(el =>
        el.classList.remove('cwcf-settings__swatch--selected'));
      sw.classList.add('cwcf-settings__swatch--selected');
      onChange(color);
    });
    grid.appendChild(sw);
  }
  row.appendChild(grid);
  return row;
}

function buildViewSection() {
  const section = sectionEl('In-page view');
  section.appendChild(rowSelect('Default view mode', 'cwcf-set-view-mode', [
    { value: 'default', label: 'Strip' },
    { value: 'organize', label: 'Folder panel' }
  ], (value) => apply({ viewMode: value })));

  section.appendChild(rowNumber('Strip folder cap', 'cwcf-set-strip-cap', 1, 50, (value) => {
    const n = parseInt(value, 10);
    if (!Number.isNaN(n)) apply({ stripCap: n });
  }));

  section.appendChild(rowSelect('Strip overflow', 'cwcf-set-strip-overflow', [
    { value: 'indicator', label: 'Indicator (+N)' },
    { value: 'scroll', label: 'Scrollable' }
  ], (value) => apply({ stripOverflowBehavior: value })));

  return section;
}

function buildAutoOrganizeSection() {
  const section = sectionEl('Auto-organize');
  section.appendChild(rowSelect('Match mode', 'cwcf-set-match-mode', [
    { value: 'contains', label: 'Title contains folder name' },
    { value: 'exact', label: 'Title equals folder name' }
  ], (value) => apply({ autoOrganizeMatchMode: value })));
  return section;
}

function buildFoldersSection() {
  const section = sectionEl('Folders');
  section.appendChild(rowCheckbox('Show chat counts on folders', 'cwcf-set-show-counts',
    (checked) => apply({ showChatCounts: checked })));
  section.appendChild(rowSelect('Quick-assign folder', 'cwcf-set-quick-folder', [],
    (value) => apply({ quickAssignFolderId: value === '' ? null : value })));
  return section;
}

function buildBehaviorSection() {
  const section = sectionEl('Behavior');
  section.appendChild(rowCheckbox('Confirm before deleting folders', 'cwcf-set-confirm-delete',
    (checked) => apply({ confirmFolderDelete: checked })));
  section.appendChild(rowCheckbox('Search bar enabled in panel', 'cwcf-set-search-enabled',
    (checked) => apply({ searchEnabled: checked })));
  return section;
}

function buildDataSection() {
  const section = sectionEl('Data');

  section.appendChild(rowSelect('Auto backup', 'cwcf-set-auto-backup', [
    { value: 'off', label: 'Off' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' }
  ], (value) => apply({ autoBackup: value })));

  const dataRow = document.createElement('div');
  dataRow.className = 'cwcf-settings__row cwcf-settings__row--buttons';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'cwcf-settings__btn';
  exportBtn.textContent = 'Export';
  exportBtn.addEventListener('click', handleExport);
  dataRow.appendChild(exportBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'cwcf-settings__btn';
  importBtn.textContent = 'Import';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', handleImportFile);
  importBtn.addEventListener('click', () => fileInput.click());
  dataRow.appendChild(importBtn);
  dataRow.appendChild(fileInput);

  section.appendChild(dataRow);

  const usageRow = document.createElement('div');
  usageRow.className = 'cwcf-settings__row cwcf-settings__row--info';
  const usageLabel = document.createElement('span');
  usageLabel.className = 'cwcf-settings__label';
  usageLabel.textContent = 'Storage usage';
  usageRow.appendChild(usageLabel);
  const usageValue = document.createElement('span');
  usageValue.className = 'cwcf-settings__value';
  usageValue.id = 'cwcf-set-storage-usage';
  usageValue.textContent = '—';
  usageRow.appendChild(usageValue);
  section.appendChild(usageRow);

  return section;
}

// ---------- Section / row builders ----------

function sectionEl(label) {
  const s = document.createElement('section');
  s.className = 'cwcf-settings__section';
  const h = document.createElement('h3');
  h.className = 'cwcf-settings__section-title';
  h.textContent = label;
  s.appendChild(h);
  return s;
}

function rowSelect(label, id, options, onChange) {
  const row = document.createElement('label');
  row.className = 'cwcf-settings__row';
  const span = document.createElement('span');
  span.className = 'cwcf-settings__label';
  span.textContent = label;
  row.appendChild(span);
  const sel = document.createElement('select');
  sel.id = id;
  sel.className = 'cwcf-settings__select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', (e) => onChange(e.target.value));
  row.appendChild(sel);
  return row;
}

function rowNumber(label, id, min, max, onChange) {
  const row = document.createElement('label');
  row.className = 'cwcf-settings__row';
  const span = document.createElement('span');
  span.className = 'cwcf-settings__label';
  span.textContent = label;
  row.appendChild(span);
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.id = id;
  inp.min = String(min);
  inp.max = String(max);
  inp.step = '1';
  inp.className = 'cwcf-settings__number';
  inp.addEventListener('change', (e) => onChange(e.target.value));
  row.appendChild(inp);
  return row;
}

function rowCheckbox(label, id, onChange) {
  const row = document.createElement('label');
  row.className = 'cwcf-settings__row cwcf-settings__row--toggle';
  const span = document.createElement('span');
  span.className = 'cwcf-settings__label';
  span.textContent = label;
  row.appendChild(span);
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.id = id;
  inp.className = 'cwcf-settings__checkbox';
  inp.addEventListener('change', (e) => onChange(e.target.checked));
  row.appendChild(inp);
  return row;
}

// ---------- Population ----------

function populate() {
  if (!mainState?.loaded) return;
  suppressEvents = true;
  const s = mainState.loaded.settings;

  setVal('cwcf-set-theme', s.activeTheme || 'neon-purple');
  setVal('cwcf-set-density', s.density || 'comfortable');
  setChecked('cwcf-set-reduce-motion', !!s.reduceMotion);
  setSwatchSelected('cwcf-set-default-color', s.defaultFolderColor || '#3b82f6');
  setVal('cwcf-set-view-mode', s.viewMode || 'default');
  setVal('cwcf-set-strip-cap', String(s.stripCap ?? 6));
  setVal('cwcf-set-strip-overflow', s.stripOverflowBehavior || 'indicator');
  setVal('cwcf-set-match-mode', s.autoOrganizeMatchMode || 'contains');
  setChecked('cwcf-set-show-counts', !!s.showChatCounts);
  setChecked('cwcf-set-confirm-delete', !!s.confirmFolderDelete);
  setChecked('cwcf-set-search-enabled', !!s.searchEnabled);
  setVal('cwcf-set-auto-backup', s.autoBackup || 'off');

  populateQuickAssignFolders(s.quickAssignFolderId || '');

  suppressEvents = false;
}

function setSwatchSelected(gridId, color) {
  const grid = overlayEl?.querySelector(`#${gridId}`);
  if (!grid) return;
  grid.querySelectorAll('.cwcf-settings__swatch--selected').forEach(el =>
    el.classList.remove('cwcf-settings__swatch--selected'));
  const target = grid.querySelector(`[data-color="${color}"]`);
  if (target) target.classList.add('cwcf-settings__swatch--selected');
}

function populateQuickAssignFolders(currentValue) {
  const sel = overlayEl?.querySelector('#cwcf-set-quick-folder');
  if (!sel) return;
  sel.replaceChildren();
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'None';
  sel.appendChild(noneOpt);
  const folders = [...(mainState?.loaded?.folders || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const f of folders) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.icon ? `${f.icon} ${f.name}` : f.name;
    sel.appendChild(o);
  }
  sel.value = currentValue;
}

function setVal(id, value) {
  const el = overlayEl?.querySelector(`#${id}`);
  if (el) el.value = value;
}

function setChecked(id, checked) {
  const el = overlayEl?.querySelector(`#${id}`);
  if (el) el.checked = checked;
}

// ---------- Settings serialization ----------

let settingsQueue = Promise.resolve();
function apply(partial) {
  if (suppressEvents) return Promise.resolve();
  const result = settingsQueue.then(async () => {
    try {
      await S.updateSettings(partial);
    } catch (err) {
      console.error('[CWCF] in-page settings update failed', err);
      // Re-populate from storage to recover from any rejected change
      const fresh = await S.loadState();
      mainState = { loaded: fresh };
      populate();
    }
  });
  settingsQueue = result.catch(() => {});
  return result;
}

// ---------- Storage usage ----------

async function refreshStorageUsage() {
  try {
    const bytes = await S.getBytesInUse();
    const valueEl = overlayEl?.querySelector('#cwcf-set-storage-usage');
    if (valueEl) {
      valueEl.textContent = formatBytesInUse(bytes);
    }
  } catch {
    // ignore
  }
}

function formatBytesInUse(bytes) {
  let display;
  if (bytes < 1024) display = `${bytes} B`;
  else if (bytes < 1024 * 1024) display = `${(bytes / 1024).toFixed(1)} KB`;
  else display = `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  const limitMB = (APP_VERSION_BYTES_LIMIT / 1024 / 1024).toFixed(0);
  return `${display} of ${limitMB} MB`;
}

// ---------- Export / import ----------

async function handleExport() {
  try {
    const json = await S.exportToJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `claude-folders-export-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('[CWCF] export failed', err);
    alert(`Export failed: ${err.message}`);
  }
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  pendingFile = file;

  const folderCount = mainState?.loaded?.folders?.length || 0;
  if (folderCount > 0) {
    const choice = await showImportChoice(folderCount);
    if (!choice) {
      pendingFile = null;
      return;
    }
    await runImport(choice);
  } else {
    await runImport('replace');
  }
  pendingFile = null;
}

async function runImport(mode) {
  if (!pendingFile) return;
  let text;
  try {
    text = await pendingFile.text();
  } catch (err) {
    alert(`Could not read file: ${err.message}`);
    return;
  }
  try {
    await S.importFromJson(text, mode);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
}

// In-overlay choice prompt. Returns 'merge' | 'replace' | null (cancel).
function showImportChoice(folderCount) {
  return new Promise((resolve) => {
    const promptEl = document.createElement('div');
    promptEl.className = 'cwcf-settings__prompt';
    promptEl.innerHTML = `
      <div class="cwcf-settings__prompt-msg">You have ${folderCount} existing folders. Choose how to apply the import.</div>
    `;
    const actions = document.createElement('div');
    actions.className = 'cwcf-settings__prompt-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'cwcf-settings__btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { promptEl.remove(); resolve(null); });
    actions.appendChild(cancelBtn);

    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.className = 'cwcf-settings__btn cwcf-settings__btn--primary';
    mergeBtn.textContent = 'Merge';
    mergeBtn.addEventListener('click', () => { promptEl.remove(); resolve('merge'); });
    actions.appendChild(mergeBtn);

    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'cwcf-settings__btn cwcf-settings__btn--danger';
    replaceBtn.textContent = 'Replace all';
    replaceBtn.addEventListener('click', () => { promptEl.remove(); resolve('replace'); });
    actions.appendChild(replaceBtn);

    promptEl.appendChild(actions);
    overlayEl.appendChild(promptEl);
    cancelBtn.focus();
  });
}

// ---------- Dismiss handlers ----------

function attachDismissHandlers() {
  backdropEl.addEventListener('mousedown', (e) => {
    if (e.target === backdropEl) unmount();
  });
  escListener = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      unmount();
    }
  };
  document.addEventListener('keydown', escListener);
}
