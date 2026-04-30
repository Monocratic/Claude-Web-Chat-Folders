import * as S from '../lib/storage.js';
import { extractChatUuid } from '../lib/selectors.js';

let stripEl = null;
let api = null;
let mainState = null;
let docClickListener = null;
let overflowPopover = null;

export function mount(state, apiHandle) {
  mainState = state;
  api = apiHandle;
  if (stripEl) return;
  stripEl = buildStripDom();
  document.body.appendChild(stripEl);
  render(state);
}

export function unmount() {
  if (stripEl) {
    stripEl.remove();
    stripEl = null;
  }
  closeOverflowPopover();
  mainState = null;
}

export function reposition() {
  // Strip is anchored to viewport left edge; reposition is a no-op for
  // layout but kept as part of the module API for parity with the panel.
}

export function render(state) {
  if (!stripEl) return;
  mainState = state;
  const list = stripEl.querySelector('.cwcf-strip__list');
  list.replaceChildren();

  const settings = state?.loaded?.settings || {};
  const cap = settings.stripCap || 6;
  const overflowMode = settings.stripOverflowBehavior || 'indicator';

  const folders = (state?.loaded?.folders || []).slice();
  const pinned = folders
    .filter(f => f.pinned)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  let visible = pinned;
  let overflowCount = 0;
  if (overflowMode === 'indicator' && pinned.length > cap) {
    visible = pinned.slice(0, Math.max(1, cap - 1));
    overflowCount = pinned.length - visible.length;
  }

  for (const f of visible) {
    list.appendChild(buildFolderSwatch(f));
  }
  if (overflowCount > 0) {
    list.appendChild(buildOverflowSwatch(overflowCount, pinned.slice(visible.length)));
  }

  if (overflowMode === 'scroll') {
    list.classList.add('cwcf-strip__list--scroll');
  } else {
    list.classList.remove('cwcf-strip__list--scroll');
  }
}

function buildStripDom() {
  const aside = document.createElement('aside');
  aside.className = 'cwcf-strip';
  aside.setAttribute('data-cwcf-strip', 'true');
  aside.setAttribute('aria-label', 'Claude folders strip');

  const header = document.createElement('div');
  header.className = 'cwcf-strip__header';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'cwcf-strip__toggle';
  toggleBtn.title = 'Open folder panel';
  toggleBtn.setAttribute('aria-label', 'Open folder panel');
  toggleBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 4h5l1 1h6v8H2V4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  toggleBtn.addEventListener('click', () => {
    if (api) api.setViewMode('organize');
  });
  header.appendChild(toggleBtn);
  aside.appendChild(header);

  const list = document.createElement('div');
  list.className = 'cwcf-strip__list';
  aside.appendChild(list);

  return aside;
}

function buildFolderSwatch(folder) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cwcf-strip__folder';
  btn.dataset.folderId = folder.id;
  btn.style.background = folder.color;
  btn.title = `${folder.name}${folder.icon ? ' (' + folder.icon + ')' : ''}`;
  btn.setAttribute('aria-label', `Folder ${folder.name}`);

  if (folder.icon) {
    const icon = document.createElement('span');
    icon.className = 'cwcf-strip__icon';
    icon.textContent = folder.icon;
    btn.appendChild(icon);
  }

  attachDropTarget(btn, folder.id);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // For v0.2 commit 4, click on a swatch is a no-op (drop target only).
    // Future commits may add a click-popover for managing the folder.
  });
  return btn;
}

function buildOverflowSwatch(count, hiddenFolders) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cwcf-strip__overflow';
  btn.textContent = `+${count}`;
  btn.title = `${count} more pinned folders`;
  btn.setAttribute('aria-label', `${count} more pinned folders, click to expand`);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleOverflowPopover(btn, hiddenFolders);
  });
  return btn;
}

function toggleOverflowPopover(anchorBtn, hiddenFolders) {
  if (overflowPopover) {
    closeOverflowPopover();
    return;
  }
  overflowPopover = document.createElement('div');
  overflowPopover.className = 'cwcf-strip__overflow-popover';
  overflowPopover.setAttribute('data-cwcf-strip', 'true');
  for (const f of hiddenFolders) {
    overflowPopover.appendChild(buildFolderSwatch(f));
  }
  document.body.appendChild(overflowPopover);
  const rect = anchorBtn.getBoundingClientRect();
  overflowPopover.style.left = `${rect.right + 8}px`;
  overflowPopover.style.top = `${rect.top}px`;

  docClickListener = (e) => {
    if (overflowPopover && !overflowPopover.contains(e.target) && e.target !== anchorBtn) {
      closeOverflowPopover();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', docClickListener, true), 0);
}

function closeOverflowPopover() {
  if (overflowPopover) {
    overflowPopover.remove();
    overflowPopover = null;
  }
  if (docClickListener) {
    document.removeEventListener('mousedown', docClickListener, true);
    docClickListener = null;
  }
}

// Drop target wiring. claude.ai chat anchors are natively draggable as <a>
// elements; on drop we extract the chat UUID from dataTransfer (which the
// browser populates with the link URL by default for native anchor drags)
// and call assignItemToFolder.
function attachDropTarget(el, folderId) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('cwcf-strip__folder--drop-target');
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('cwcf-strip__folder--drop-target');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('cwcf-strip__folder--drop-target');
    const itemRef = readDraggedItemRef(e.dataTransfer);
    if (!itemRef) return;
    try {
      await S.assignItemToFolder(itemRef, folderId);
    } catch (err) {
      console.error('[CWCF] strip drop assign failed', err);
    }
  });
}

function readDraggedItemRef(dt) {
  // Prefer a CWCF-formatted payload from drag-handlers.js if present.
  const cwcfPayload = dt.getData('application/x-cwcf-item');
  if (cwcfPayload) {
    try {
      const parsed = JSON.parse(cwcfPayload);
      if (parsed && parsed.itemRef) return parsed.itemRef;
    } catch {
      // fall through
    }
  }
  // Fallback: native anchor drag carries the URL as text/uri-list or text/plain.
  const uriList = dt.getData('text/uri-list') || dt.getData('text/plain');
  if (!uriList) return null;
  let path;
  try {
    path = new URL(uriList, window.location.origin).pathname;
  } catch {
    return null;
  }
  const uuid = extractChatUuid(path);
  return uuid ? `chat:${uuid}` : null;
}
