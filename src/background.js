import * as S from './lib/storage.js';
import { extractChatUuid } from './lib/selectors.js';

const PARENT_MENU_ID = 'cwcf-add-to-folder';
const NO_FOLDERS_ID = 'cwcf-no-folders';
const MANAGE_ID = 'cwcf-manage';
const SEPARATOR_ID = 'cwcf-separator';
const FOLDER_PREFIX = 'cwcf-folder-';
const REBUILD_DEBOUNCE_MS = 200;

let rebuildTimer = null;

chrome.runtime.onInstalled.addListener(() => { rebuildMenu(); });
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => { rebuildMenu(); });
}

S.subscribeToChanges(() => {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildMenu();
  }, REBUILD_DEBOUNCE_MS);
});

chrome.contextMenus.onClicked.addListener(handleMenuClick);

async function rebuildMenu() {
  try {
    await chrome.contextMenus.removeAll();
    const state = await S.loadState();

    chrome.contextMenus.create({
      id: PARENT_MENU_ID,
      title: 'Add chat to folder',
      contexts: ['link'],
      documentUrlPatterns: ['https://claude.ai/*'],
      targetUrlPatterns: ['https://claude.ai/chat/*']
    });

    const folders = [...state.folders].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });

    if (folders.length === 0) {
      chrome.contextMenus.create({
        id: NO_FOLDERS_ID,
        parentId: PARENT_MENU_ID,
        title: 'No folders yet — click to manage',
        contexts: ['link']
      });
      return;
    }

    for (const folder of folders) {
      const star = folder.pinned ? '★ ' : '';
      const icon = folder.icon ? `${folder.icon} ` : '';
      chrome.contextMenus.create({
        id: `${FOLDER_PREFIX}${folder.id}`,
        parentId: PARENT_MENU_ID,
        title: `${star}${icon}${folder.name}`,
        contexts: ['link']
      });
    }

    chrome.contextMenus.create({
      id: SEPARATOR_ID,
      parentId: PARENT_MENU_ID,
      type: 'separator',
      contexts: ['link']
    });

    chrome.contextMenus.create({
      id: MANAGE_ID,
      parentId: PARENT_MENU_ID,
      title: 'Manage folders…',
      contexts: ['link']
    });
  } catch (err) {
    console.error('[CWCF] menu rebuild failed', err);
  }
}

async function handleMenuClick(info, tab) {
  const linkUrl = info.linkUrl;
  if (!linkUrl) return;

  const menuId = info.menuItemId;

  if (menuId === NO_FOLDERS_ID || menuId === MANAGE_ID) {
    await openManagementSurface();
    return;
  }

  if (typeof menuId !== 'string' || !menuId.startsWith(FOLDER_PREFIX)) {
    return;
  }

  let path;
  try {
    path = new URL(linkUrl).pathname;
  } catch {
    console.warn('[CWCF] could not parse link URL', linkUrl);
    return;
  }

  const uuid = extractChatUuid(path);
  if (!uuid) {
    console.warn('[CWCF] context menu fired without chat UUID in path', path);
    return;
  }

  const itemRef = `chat:${uuid}`;
  const folderId = menuId.slice(FOLDER_PREFIX.length);

  try {
    await S.assignItemToFolder(itemRef, folderId);
  } catch (err) {
    console.error('[CWCF] assign failed', err);
  }
}

// Asks the active claude.ai content script to open the in-page settings
// overlay. Replaces the previous popup.html new-tab fallback, which Brave
// Shields blocks (ERR_BLOCKED_BY_CLIENT). If no active claude.ai tab is
// available, opens claude.ai itself; the user can then open settings from
// the in-page strip or panel.
async function openManagementSurface() {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
      url: 'https://claude.ai/*'
    });
    if (tabs[0]?.id) {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'cwcf:openSettingsOverlay' });
      return;
    }
  } catch (err) {
    console.warn('[CWCF] openManagementSurface dispatch failed', err);
  }
  chrome.tabs.create({ url: 'https://claude.ai/' });
}
