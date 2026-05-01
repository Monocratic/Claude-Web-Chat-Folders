import * as S from '../lib/storage.js';
import { extractChatUuid } from '../lib/selectors.js';

// Diagnostic logging gate. Default off for shipping; flip to true in
// place when investigating chat-context regressions. Each log call is
// fenced inside `if (DEBUG)` so the cost in the false case is one
// branch comparison, no string allocation.
const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log('[CWCF chat-context]', ...args); };

let mainState = null;
let api = null;
let activeMenu = null;
let listenerAttached = false;

export function attach(state, apiHandle) {
  mainState = state;
  api = apiHandle;
  if (listenerAttached) {
    log('attach() called but listener already registered, skipping');
    return;
  }
  document.addEventListener('contextmenu', onContextMenu, true);
  listenerAttached = true;
  log('attach() ran, capture-phase contextmenu listener registered on document');
}

export function setState(state) {
  mainState = state;
}

function onContextMenu(e) {
  const tEl = e.target;
  const refEl = tEl.closest && tEl.closest('[data-item-ref^="chat:"]');
  const anchorEl = tEl.closest && tEl.closest('a[href^="/chat/"]');
  log('onContextMenu fired', {
    targetTag: tEl.tagName,
    targetClass: typeof tEl.className === 'string' ? tEl.className : '(non-string)',
    closestDataItemRef: refEl ? refEl.getAttribute('data-item-ref') : 'none',
    closestAnchorHref: anchorEl ? anchorEl.getAttribute('href') : 'none'
  });

  let itemRef = null;
  let href = null;

  // Panel chat rows are <div data-item-ref="chat:UUID"> with no anchor in
  // the tree, so anchor-only matching misses them. Try the dataset first;
  // fall back to a chat anchor for sidebar/recents <a> elements.
  if (refEl) {
    itemRef = refEl.getAttribute('data-item-ref');
    const uuid = itemRef.slice('chat:'.length);
    href = `/chat/${uuid}`;
    log('matched via data-item-ref', { itemRef });
  } else if (anchorEl) {
    const uuid = extractChatUuid(anchorEl.getAttribute('href'));
    if (uuid) {
      itemRef = `chat:${uuid}`;
      href = anchorEl.getAttribute('href');
      log('matched via anchor href', { itemRef });
    } else {
      log('anchor matched but extractChatUuid returned null', { href: anchorEl.getAttribute('href') });
    }
  }
  if (!itemRef) {
    log('no chat target found, bailing without preventDefault');
    return;
  }

  log('about to preventDefault and stopPropagation');
  e.preventDefault();
  e.stopPropagation();

  const sourceFolderId = inferSourceFolderId(e.target);
  showChatContextMenu({
    itemRef,
    href,
    sourceFolderId,
    clientX: e.clientX,
    clientY: e.clientY
  });
}

function inferSourceFolderId(targetEl) {
  // Panel chat-row rendering stamps data-source-folder-id on the row when
  // the chat is currently inside a folder. Read it so the menu can offer
  // "Remove from folder".
  const row = targetEl.closest('[data-source-folder-id]');
  if (row) return row.getAttribute('data-source-folder-id') || null;
  return null;
}

function showChatContextMenu({ itemRef, href, sourceFolderId, clientX, clientY }) {
  log('showChatContextMenu entered', { itemRef, href, sourceFolderId });
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'cwcf-fmenu cwcf-fmenu--chat';
  menu.setAttribute('role', 'menu');

  appendItem(menu, {
    label: 'Open chat',
    onClick: () => { window.location.href = href; }
  });
  appendItem(menu, {
    label: 'Open in new tab',
    onClick: () => { window.open(href, '_blank', 'noopener'); }
  });
  appendSeparator(menu);

  const folders = (mainState?.loaded?.folders || []).slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  if (folders.length === 0) {
    appendItem(menu, {
      label: 'No folders yet — open settings…',
      onClick: () => api?.openSettingsOverlay && api.openSettingsOverlay()
    });
  } else {
    const header = document.createElement('div');
    header.className = 'cwcf-fmenu__group-label';
    header.textContent = 'Add to folder';
    menu.appendChild(header);

    const assignedSet = new Set(mainState?.loaded?.assignments?.[itemRef] || []);
    for (const folder of folders) {
      const isAssigned = assignedSet.has(folder.id);
      appendItem(menu, {
        label: `${folder.icon ? folder.icon + ' ' : ''}${folder.pinned ? '★ ' : ''}${folder.name}${isAssigned ? '  ✓' : ''}`,
        onClick: async () => {
          try {
            if (isAssigned) {
              await S.removeItemFromFolder(itemRef, folder.id);
            } else {
              await S.assignItemToFolder(itemRef, folder.id);
            }
          } catch (err) {
            console.error('[CWCF] chat menu assign failed', err);
          }
        }
      });
    }

    appendSeparator(menu);
    appendItem(menu, {
      label: 'Manage folders…',
      onClick: () => api?.openSettingsOverlay && api.openSettingsOverlay()
    });

    if (sourceFolderId && assignedSet.has(sourceFolderId)) {
      appendSeparator(menu);
      appendItem(menu, {
        label: 'Remove from this folder',
        destructive: true,
        onClick: async () => {
          try {
            await S.removeItemFromFolder(itemRef, sourceFolderId);
          } catch (err) {
            console.error('[CWCF] chat menu remove failed', err);
          }
        }
      });
    } else if (assignedSet.size > 0) {
      appendSeparator(menu);
      appendItem(menu, {
        label: 'Remove from all folders',
        destructive: true,
        onClick: async () => {
          try {
            await S.removeItemFromAllFolders(itemRef);
          } catch (err) {
            console.error('[CWCF] chat menu remove-all failed', err);
          }
        }
      });
    }
  }

  positionAndShow(menu, clientX, clientY);
}

function appendItem(menu, { label, onClick, destructive }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cwcf-fmenu__item';
  if (destructive) btn.classList.add('cwcf-fmenu__item--danger');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    closeMenu();
    Promise.resolve().then(onClick);
  });
  menu.appendChild(btn);
}

function appendSeparator(menu) {
  const sep = document.createElement('div');
  sep.className = 'cwcf-fmenu__sep';
  menu.appendChild(sep);
}

function positionAndShow(menu, clientX, clientY) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - rect.width - 4);
  const maxTop = Math.max(0, window.innerHeight - rect.height - 4);
  menu.style.left = `${Math.min(clientX, maxLeft)}px`;
  menu.style.top = `${Math.min(clientY, maxTop)}px`;
  menu.style.visibility = '';
  activeMenu = menu;

  const dismiss = (e) => {
    if (e && e.target && menu.contains(e.target)) return;
    closeMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', dismiss, { once: true });
    document.addEventListener('contextmenu', dismiss, { once: true });
  }, 0);
}

function closeMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}
