import * as S from '../lib/storage.js';
import { resolveTheme, applyTheme } from '../lib/themes.js';
import {
  state, $, showView, getCurrentView, showToast, debounce,
  reloadState, SEARCH_DEBOUNCE_MS
} from './popup-shared.js';
import { renderFolderList, renderFolderDetail, openFolderDetail, wireFolderDetailButtons } from './popup-folders.js';
import { openCreateFolderModal, wireFolderEditModal, wireEmojiPickerModal } from './popup-modals.js';
import { populateSettingsControls, wireSettingsEvents, updateStorageUsage } from './popup-settings.js';

async function init() {
  await reloadState();
  applyCurrentTheme();
  renderFolderList();
  populateSettingsControls();
  updateStorageUsage();

  wireTopLevelEvents();
  wireFolderDetailButtons();
  wireFolderEditModal();
  wireEmojiPickerModal();
  wireSettingsEvents();

  S.subscribeToChanges(handleStorageChange);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) reloadAndRender();
  });

  document.body.classList.add('cwcf-ready');
}

function applyCurrentTheme() {
  const tokens = resolveTheme(
    state.loaded.settings.activeTheme,
    state.loaded.settings.customTheme
  );
  applyTheme(tokens);
}

async function reloadAndRender() {
  const previousActiveTheme = state.loaded?.settings?.activeTheme;
  const previousCustomTheme = state.loaded?.settings?.customTheme;
  await reloadState();
  if (
    state.loaded.settings.activeTheme !== previousActiveTheme ||
    JSON.stringify(state.loaded.settings.customTheme) !== JSON.stringify(previousCustomTheme)
  ) {
    applyCurrentTheme();
  }
  renderFolderList();
  if (getCurrentView() === 'folder-detail' && state.detailFolderId) {
    await renderFolderDetail();
  }
  populateSettingsControls();
  updateStorageUsage();
}

async function handleStorageChange(newValue) {
  if (!newValue) {
    state.loaded = null;
    await reloadState();
    applyCurrentTheme();
    renderFolderList();
    populateSettingsControls();
    updateStorageUsage();
    return;
  }
  await reloadAndRender();
}

function wireTopLevelEvents() {
  $('btn-create-folder').addEventListener('click', openCreateFolderModal);

  $('btn-settings-open').addEventListener('click', () => showView('settings'));
  $('btn-settings-close').addEventListener('click', () => showView('folders'));

  $('btn-back').addEventListener('click', () => {
    state.detailFolderId = null;
    showView('folders');
  });

  $('btn-search-toggle').addEventListener('click', toggleSearch);

  const searchInput = $('search-input');
  const debouncedSearch = debounce((value) => {
    state.searchQuery = value.trim();
    renderFolderList();
  }, SEARCH_DEBOUNCE_MS);
  searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const view = getCurrentView();
      if (view === 'folder-detail') {
        state.detailFolderId = null;
        showView('folders');
      } else if (view === 'settings') {
        showView('folders');
      } else if (state.searchVisible) {
        toggleSearch();
      }
    }
  });
}

function toggleSearch() {
  state.searchVisible = !state.searchVisible;
  const bar = $('search-bar');
  bar.hidden = !state.searchVisible;
  if (state.searchVisible) {
    setTimeout(() => $('search-input').focus(), 0);
  } else {
    $('search-input').value = '';
    state.searchQuery = '';
    renderFolderList();
  }
}

init().catch(err => {
  console.error('[CWCF] popup init failed', err);
  document.body.classList.add('cwcf-ready');
  showToast(`Init failed: ${err.message}`, 'error');
});
