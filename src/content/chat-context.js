import * as S from '../lib/storage.js';
import { extractChatUuid } from '../lib/selectors.js';

let mainState = null;
let api = null;
let activeMenu = null;
let listenerAttached = false;

export function attach(state, apiHandle) {
  mainState = state;
  api = apiHandle;
  if (listenerAttached) return;
  document.addEventListener('contextmenu', onContextMenu, true);
  listenerAttached = true;
}

export function setState(state) {
  mainState = state;
}

function onContextMenu(e) {
  const anchor = e.target.closest('a[href^="/chat/"]');
  if (!anchor) return;
  const uuid = extractChatUuid(anchor.getAttribute('href'));
  if (!uuid) return;

  e.preventDefault();
  e.stopPropagation();

  const itemRef = `chat:${uuid}`;
  const sourceFolderId = inferSourceFolderId(e.target);
  showChatContextMenu({
    itemRef,
    href: anchor.getAttribute('href'),
    title: (anchor.textContent || '').trim(),
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

function showChatContextMenu({ itemRef, href, title, sourceFolderId, clientX, clientY }) {
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
