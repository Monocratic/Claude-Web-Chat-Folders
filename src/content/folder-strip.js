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
  reposition();
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

// Strip sits in the gutter to the right of claude.ai's nav. Top edge starts
// below the "More" nav item (computed by main.js api.getTopNavBottomOffset).
// Bottom matches nav's bottom. Doesn't overlap claude.ai's sidebar content.
export function reposition() {
  if (!stripEl) return;
  const nav = api && api.getNavElement && api.getNavElement();
  if (!nav) return;
  const navRect = nav.getBoundingClientRect();
  const top = api.getTopNavBottomOffset ? api.getTopNavBottomOffset() : Math.round(navRect.top + 280);
  stripEl.style.left = `${Math.round(navRect.right)}px`;
  stripEl.style.top = `${top}px`;
  stripEl.style.height = `${Math.round(navRect.bottom - top)}px`;
  stripEl.style.bottom = '';
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

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'cwcf-strip__settings';
  settingsBtn.title = 'Open extension settings';
  settingsBtn.setAttribute('aria-label', 'Open extension settings');
  settingsBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1l1 2 2 .5 1.5 1.5L12 7l1 2-1.5 2L9 12l-1 2-1-2-2-.5L3.5 10 4 8 3 6l1.5-2L7 3l1-2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  settingsBtn.addEventListener('click', () => {
    if (api && api.openSettingsOverlay) api.openSettingsOverlay();
  });
  header.appendChild(settingsBtn);

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
  const cwcfPayload = dt.getData('application/x-cwcf-item');
  if (cwcfPayload) {
    try {
      const parsed = JSON.parse(cwcfPayload);
      if (parsed && parsed.itemRef) return parsed.itemRef;
    } catch {}
  }
  // Fallback path: claude.ai's React often clears or replaces dataTransfer
  // between dragstart and drop, so the CWCF payload is gone by drop time.
  // Reconstruct from any URL-bearing native DnD data we can find.
  const candidates = [
    dt.getData('text/uri-list'),
    dt.getData('text/plain'),
    dt.getData('text/x-moz-url'),
    dt.getData('URL')
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      try {
        const path = new URL(trimmed, window.location.origin).pathname;
        const uuid = extractChatUuid(path);
        if (uuid) {
          console.warn('[CWCF] DnD: CWCF payload missing at drop time; falling back to URL data. claude.ai likely preempted dataTransfer between dragstart and drop.');
          return `chat:${uuid}`;
        }
      } catch {}
    }
  }
  const types = dt.types ? Array.from(dt.types).join(', ') : '(none)';
  console.warn(`[CWCF] DnD (strip): drop received with no usable payload. Available dataTransfer types: ${types}`);
  return null;
}
