import * as S from '../lib/storage.js';
import { listPresets } from '../lib/themes.js';
import { state, $, showToast, formatBytes, showChoice } from './popup-shared.js';

let suppressSettingsEvents = false;

export function populateSettingsControls() {
  if (!state.loaded) return;
  suppressSettingsEvents = true;

  populateThemeSelect();
  populateQuickAssignSelect();

  const s = state.loaded.settings;
  $('setting-default-color').value = s.defaultFolderColor;
  $('setting-show-counts').checked = s.showChatCounts;
  $('setting-confirm-delete').checked = s.confirmFolderDelete;
  $('setting-theme').value = s.activeTheme;
  $('setting-quick-folder').value = s.quickAssignFolderId || '';

  if ($('setting-auto-organize-mode')) $('setting-auto-organize-mode').value = s.autoOrganizeMatchMode || 'contains';
  if ($('setting-view-mode')) $('setting-view-mode').value = s.viewMode || 'default';
  if ($('setting-strip-cap')) $('setting-strip-cap').value = String(s.stripCap ?? 6);
  if ($('setting-strip-overflow')) $('setting-strip-overflow').value = s.stripOverflowBehavior || 'indicator';

  suppressSettingsEvents = false;
}

function populateThemeSelect() {
  const sel = $('setting-theme');
  const presets = listPresets();
  sel.replaceChildren(...presets.map(({ id, label }) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    return opt;
  }));
}

function populateQuickAssignSelect() {
  const sel = $('setting-quick-folder');
  const folders = [...state.loaded.folders].sort((a, b) => a.sortOrder - b.sortOrder);
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'None';
  const opts = [noneOpt];
  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.icon ? `${f.icon} ${f.name}` : f.name;
    opts.push(opt);
  }
  sel.replaceChildren(...opts);

  const currentSetting = state.loaded.settings.quickAssignFolderId;
  if (currentSetting && !state.loaded.folders.some(f => f.id === currentSetting)) {
    S.updateSettings({ quickAssignFolderId: null }).catch(err => {
      console.warn('[CWCF] Failed to clear stale quickAssignFolderId', err);
    });
  }
}

// Popup-side serialization mirror of storage.js's enqueueWrite. Prevents
// flicker from concurrent updateSettings calls when the user toggles
// multiple controls in quick succession.
let settingsQueue = Promise.resolve();
function applySettingChange(partial) {
  if (suppressSettingsEvents) return Promise.resolve();
  const result = settingsQueue.then(async () => {
    try {
      await S.updateSettings(partial);
    } catch (err) {
      showToast(`Setting failed: ${err.message}`, 'error');
      populateSettingsControls();
    }
  });
  settingsQueue = result.catch(() => {});
  return result;
}

export function wireSettingsEvents() {
  $('setting-theme').addEventListener('change', (e) => {
    applySettingChange({ activeTheme: e.target.value });
  });
  $('setting-default-color').addEventListener('change', (e) => {
    applySettingChange({ defaultFolderColor: e.target.value });
  });
  $('setting-show-counts').addEventListener('change', (e) => {
    applySettingChange({ showChatCounts: e.target.checked });
  });
  $('setting-confirm-delete').addEventListener('change', (e) => {
    applySettingChange({ confirmFolderDelete: e.target.checked });
  });
  $('setting-quick-folder').addEventListener('change', (e) => {
    const value = e.target.value === '' ? null : e.target.value;
    applySettingChange({ quickAssignFolderId: value });
  });

  if ($('setting-auto-organize-mode')) {
    $('setting-auto-organize-mode').addEventListener('change', (e) => {
      applySettingChange({ autoOrganizeMatchMode: e.target.value });
    });
  }
  if ($('setting-view-mode')) {
    $('setting-view-mode').addEventListener('change', (e) => {
      applySettingChange({ viewMode: e.target.value });
    });
  }
  if ($('setting-strip-cap')) {
    $('setting-strip-cap').addEventListener('change', (e) => {
      const n = parseInt(e.target.value, 10);
      if (!Number.isNaN(n)) applySettingChange({ stripCap: n });
    });
  }
  if ($('setting-strip-overflow')) {
    $('setting-strip-overflow').addEventListener('change', (e) => {
      applySettingChange({ stripOverflowBehavior: e.target.value });
    });
  }

  $('btn-export').addEventListener('click', handleExport);
  $('btn-import').addEventListener('click', () => $('import-file-input').click());
  $('import-file-input').addEventListener('change', handleImportFile);
}

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
    showToast('Exported to Downloads', 'success');
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  let text;
  try {
    text = await file.text();
  } catch (err) {
    showToast(`Could not read file: ${err.message}`, 'error');
    return;
  }

  let mode;
  if (state.loaded.folders.length > 0) {
    const choice = await showChoice(
      `You have ${state.loaded.folders.length} existing folders. Choose how to apply the import.`,
      [
        { label: 'Cancel', value: null },
        { label: 'Merge', value: 'merge', primary: true },
        { label: 'Replace all', value: 'replace', danger: true }
      ]
    );
    if (choice === null) return;
    mode = choice;
  } else {
    mode = 'replace';
  }

  try {
    await S.importFromJson(text, mode);
    showToast(`Imported (${mode})`, 'success');
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  }
}

export async function updateStorageUsage() {
  try {
    const bytes = await S.getBytesInUse();
    $('storage-usage').textContent = `${formatBytes(bytes)} of 10 MB`;
  } catch (err) {
    $('storage-usage').textContent = '—';
  }
}
