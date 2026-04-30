import * as S from '../lib/storage.js';
import { extractChatUuid, SELECTORS } from '../lib/selectors.js';

let panelEl = null;
let api = null;
let mainState = null;
let searchQuery = '';
let suggestions = new Map();
let pendingCollapseWrites = new Set();

const SUGGESTION_PREFIX = 'cwcf-suggestion-';

export function mount(state, apiHandle) {
  mainState = state;
  api = apiHandle;
  if (panelEl) return;
  panelEl = buildPanelDom();
  document.body.appendChild(panelEl);
  reposition();
  render(state);
}

export function unmount() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  searchQuery = '';
  suggestions.clear();
  mainState = null;
}

// Panel covers the chat list area of nav, leaving the top nav block
// (logo, sidebar collapse, New chat through More) visible. Top edge starts
// below "More" via api.getTopNavBottomOffset; bottom matches nav's bottom.
export function reposition() {
  if (!panelEl) return;
  const navEl = api && api.getNavElement && api.getNavElement();
  if (!navEl) return;
  const rect = navEl.getBoundingClientRect();
  const top = api.getTopNavBottomOffset ? api.getTopNavBottomOffset() : Math.round(rect.top + 280);
  panelEl.style.left = `${Math.round(rect.left)}px`;
  panelEl.style.width = `${Math.round(Math.max(rect.width, 240))}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.height = `${Math.round(rect.bottom - top)}px`;
}

export function render(state) {
  if (!panelEl) return;
  mainState = state;
  const treeEl = panelEl.querySelector('.cwcf-panel__tree');
  treeEl.replaceChildren();

  const folders = (state?.loaded?.folders || []).slice();
  const assignments = state?.loaded?.assignments || {};
  const itemTitles = state?.loaded?.itemTitles || {};

  // Real folders render first (organized content user created), then the
  // Unsorted virtual folder at the bottom as the catch-all.
  const childrenByParent = groupByParent(folders);
  const roots = (childrenByParent.get(null) || []).slice().sort(folderSortCompare);
  for (const f of roots) {
    treeEl.appendChild(buildFolderNode(f, 0, childrenByParent, assignments, itemTitles));
  }

  treeEl.appendChild(buildUnsortedNode(folders, assignments, itemTitles));
}

function buildPanelDom() {
  const root = document.createElement('div');
  root.className = 'cwcf-panel';
  root.setAttribute('data-cwcf-panel', 'true');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Claude folders panel');

  const header = document.createElement('header');
  header.className = 'cwcf-panel__header';

  const title = document.createElement('h2');
  title.textContent = 'Folders';
  title.className = 'cwcf-panel__title';
  header.appendChild(title);

  const headerBtns = document.createElement('div');
  headerBtns.className = 'cwcf-panel__header-btns';

  const organizeBtn = document.createElement('button');
  organizeBtn.type = 'button';
  organizeBtn.className = 'cwcf-panel__icon-btn';
  organizeBtn.title = 'Auto-organize by folder name match';
  organizeBtn.setAttribute('aria-label', 'Auto-organize');
  organizeBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M9 2L4 9h3l-1 5 5-7H8l1-5z" fill="currentColor"/></svg>';
  organizeBtn.addEventListener('click', runAutoOrganize);
  headerBtns.appendChild(organizeBtn);

  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'cwcf-panel__icon-btn';
  syncBtn.title = 'Sync chat list from /recents (catches chats not in sidebar)';
  syncBtn.setAttribute('aria-label', 'Sync chats');
  syncBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8a5 5 0 018.66-3.4M13 8a5 5 0 01-8.66 3.4M11 2v3h-3M5 14v-3h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  syncBtn.addEventListener('click', () => handleSyncClick(syncBtn));
  headerBtns.appendChild(syncBtn);

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'cwcf-panel__icon-btn';
  createBtn.title = 'Create folder';
  createBtn.setAttribute('aria-label', 'Create folder');
  createBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  createBtn.addEventListener('click', handleCreateFolder);
  headerBtns.appendChild(createBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'cwcf-panel__icon-btn';
  settingsBtn.title = 'Open extension settings';
  settingsBtn.setAttribute('aria-label', 'Open extension settings');
  settingsBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1l1 2 2 .5 1.5 1.5L12 7l1 2-1.5 2L9 12l-1 2-1-2-2-.5L3.5 10 4 8 3 6l1.5-2L7 3l1-2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  settingsBtn.addEventListener('click', () => {
    if (api && api.openSettingsOverlay) api.openSettingsOverlay();
  });
  headerBtns.appendChild(settingsBtn);

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'cwcf-panel__icon-btn';
  collapseBtn.title = 'Collapse to strip';
  collapseBtn.setAttribute('aria-label', 'Collapse to strip');
  collapseBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  collapseBtn.addEventListener('click', () => {
    if (api) api.setViewMode('default');
  });
  headerBtns.appendChild(collapseBtn);

  header.appendChild(headerBtns);
  root.appendChild(header);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'cwcf-panel__search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'cwcf-panel__search-input';
  searchInput.placeholder = 'Search folders and chats';
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    if (mainState) render(mainState);
  });
  searchWrap.appendChild(searchInput);
  root.appendChild(searchWrap);

  const tree = document.createElement('div');
  tree.className = 'cwcf-panel__tree';
  tree.setAttribute('role', 'tree');
  attachRootDropZone(tree);
  root.appendChild(tree);

  return root;
}

function buildUnsortedNode(folders, assignments, itemTitles) {
  const collapsed = !!(mainState?.loaded?.settings?.unsortedCollapsed);

  const node = document.createElement('div');
  node.className = 'cwcf-panel__folder cwcf-panel__folder--unsorted';
  node.setAttribute('role', 'treeitem');

  const row = document.createElement('div');
  row.className = 'cwcf-panel__folder-row';

  const arrow = document.createElement('span');
  arrow.className = collapsed
    ? 'cwcf-panel__arrow cwcf-panel__arrow--collapsed'
    : 'cwcf-panel__arrow cwcf-panel__arrow--expanded';
  arrow.textContent = collapsed ? '▸' : '▾';
  row.appendChild(arrow);

  const swatch = document.createElement('span');
  swatch.className = 'cwcf-panel__swatch cwcf-panel__swatch--unsorted';
  swatch.textContent = '?';
  row.appendChild(swatch);

  const name = document.createElement('span');
  name.className = 'cwcf-panel__name';
  name.textContent = 'Unsorted (sidebar)';
  name.title = 'Showing chats from claude.ai\'s sidebar that have no folder assignments. Older chats not currently rendered in the sidebar are not visible here.';
  row.appendChild(name);

  const unsortedItems = collectUnsortedItems(assignments);
  const count = document.createElement('span');
  count.className = 'cwcf-panel__count';
  count.textContent = `${unsortedItems.length}`;
  count.title = 'Sidebar-scoped count. claude.ai only renders ~47 chats at a time; older chats are not counted here.';
  row.appendChild(count);

  attachUnsortedDropTarget(row);
  // Click anywhere on the Unsorted row toggles collapse. Drop handlers
  // already preventDefault on dragover/drop, so click won't fire from
  // a drag operation.
  row.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    toggleUnsortedCollapse();
  });
  node.appendChild(row);

  if (!collapsed) {
    const itemList = document.createElement('div');
    itemList.className = 'cwcf-panel__items';
    for (const itemRef of unsortedItems) {
      const itemEl = buildItemRow(itemRef, itemTitles, null);
      if (itemEl) itemList.appendChild(itemEl);
    }
    node.appendChild(itemList);
  }

  return node;
}

async function toggleUnsortedCollapse() {
  try {
    const current = !!(mainState?.loaded?.settings?.unsortedCollapsed);
    await S.updateSettings({ unsortedCollapsed: !current });
  } catch (err) {
    console.error('[CWCF] toggleUnsortedCollapse failed', err);
  }
}

function collectUnsortedItems(assignments) {
  const all = collectAllChatRefs();
  const assigned = new Set(Object.keys(assignments).filter(k => (assignments[k] || []).length > 0));
  const unsorted = all.filter(ref => !assigned.has(ref));
  return filterByQuery(unsorted, null);
}

// Union sidebar-rendered chat anchors with chatCache from the last /recents
// sync. The sidebar only renders ~47 chats at a time; chatCache extends
// coverage to anything captured by the sync button. Dedupe by UUID, sidebar
// entries take precedence (they are guaranteed live; cache may be stale).
function collectAllChatRefs() {
  const seen = new Set();
  const out = [];

  const anchors = document.querySelectorAll(SELECTORS.chatAnchorFallback);
  for (const a of anchors) {
    const uuid = extractChatUuid(a.getAttribute('href'));
    if (!uuid) continue;
    const ref = `chat:${uuid}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }

  const cache = mainState?.loaded?.chatCache?.chats || {};
  for (const uuid of Object.keys(cache)) {
    const ref = `chat:${uuid}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }

  return out;
}

function buildFolderNode(folder, depth, childrenByParent, assignments, itemTitles) {
  const node = document.createElement('div');
  node.className = 'cwcf-panel__folder';
  node.setAttribute('role', 'treeitem');
  node.dataset.folderId = folder.id;

  const children = (childrenByParent.get(folder.id) || []).slice().sort(folderSortCompare);
  const assignedRefs = itemRefsInFolder(folder.id, assignments);
  const suggestedRefs = itemRefsSuggestedForFolder(folder.id, assignedRefs);
  const itemRefs = filterByQuery([...assignedRefs, ...suggestedRefs], null);
  const directCount = (assignments && Object.entries(assignments).filter(([_, ids]) => ids.includes(folder.id)).length) || 0;
  const collapsed = !!folder.collapsed;

  const row = document.createElement('div');
  row.className = 'cwcf-panel__folder-row';
  row.style.paddingLeft = `${depth * 12 + 6}px`;

  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'cwcf-panel__arrow';
  if (children.length === 0 && itemRefs.length === 0) {
    arrow.classList.add('cwcf-panel__arrow--leaf');
    arrow.textContent = '·';
  } else {
    arrow.classList.add(collapsed ? 'cwcf-panel__arrow--collapsed' : 'cwcf-panel__arrow--expanded');
    arrow.textContent = collapsed ? '▸' : '▾';
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse(folder.id);
    });
  }
  row.appendChild(arrow);

  const swatch = document.createElement('span');
  swatch.className = 'cwcf-panel__swatch';
  swatch.style.background = folder.color;
  if (folder.icon) swatch.textContent = folder.icon;
  row.appendChild(swatch);

  const name = document.createElement('span');
  name.className = 'cwcf-panel__name';
  name.textContent = folder.name;
  row.appendChild(name);

  if (folder.pinned) {
    const pin = document.createElement('span');
    pin.className = 'cwcf-panel__pin';
    pin.textContent = '★';
    row.appendChild(pin);
  }

  const count = document.createElement('span');
  count.className = 'cwcf-panel__count';
  if (children.length > 0 && !collapsed) {
    const descendants = countDescendantItems(folder.id, childrenByParent, assignments);
    count.textContent = `${directCount}` + (descendants > directCount ? ` (+${descendants - directCount})` : '');
  } else {
    count.textContent = `${directCount}`;
  }
  row.appendChild(count);

  row.draggable = true;
  attachFolderDragSource(row, folder.id);
  attachFolderDropTarget(row, folder.id);
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showFolderContextMenu(folder, e.clientX, e.clientY);
  });
  node.appendChild(row);

  if (!collapsed) {
    if (children.length > 0 || itemRefs.length > 0) {
      const childList = document.createElement('div');
      childList.className = 'cwcf-panel__children';

      for (const itemRef of itemRefs) {
        const itemEl = buildItemRow(itemRef, itemTitles, folder.id, depth + 1);
        if (itemEl) childList.appendChild(itemEl);
      }

      for (const child of children) {
        childList.appendChild(buildFolderNode(child, depth + 1, childrenByParent, assignments, itemTitles));
      }

      node.appendChild(childList);
    }
  }

  return node;
}

function buildItemRow(itemRef, itemTitles, parentFolderId, depth = 1) {
  const titleQuery = filterByQuery([itemRef], itemTitles);
  if (titleQuery.length === 0) return null;

  const parsed = itemRef.split(':');
  const uuid = parsed[1];
  const chatCacheEntry = mainState?.loaded?.chatCache?.chats?.[uuid];
  const cachedTitle = itemTitles[itemRef]
    || chatCacheEntry?.title
    || `chat ${uuid.slice(0, 8)}`;

  const row = document.createElement('div');
  row.className = 'cwcf-panel__item-row';
  row.style.paddingLeft = `${depth * 12 + 18}px`;
  row.dataset.itemRef = itemRef;
  if (parentFolderId) row.dataset.sourceFolderId = parentFolderId;
  row.draggable = true;
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');

  const suggestion = suggestions.get(itemRef);
  if (suggestion && suggestion.has(parentFolderId)) {
    row.classList.add('cwcf-panel__item-row--suggested');
  }

  const icon = document.createElement('span');
  icon.className = 'cwcf-panel__item-icon';
  icon.textContent = '💬';
  row.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'cwcf-panel__item-title';
  title.textContent = cachedTitle;
  row.appendChild(title);

  if (suggestion && suggestion.has(parentFolderId)) {
    const sugBadge = document.createElement('span');
    sugBadge.className = 'cwcf-panel__suggest-badge';
    sugBadge.textContent = '?';
    sugBadge.title = 'Auto-organize suggestion - click row to confirm or use the X to dismiss';
    row.appendChild(sugBadge);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'cwcf-panel__suggest-dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.title = 'Dismiss suggestion';
    dismissBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissSuggestion(itemRef, parentFolderId);
    });
    row.appendChild(dismissBtn);

    row.addEventListener('click', (e) => {
      if (e.target === dismissBtn || dismissBtn.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      confirmSuggestion(itemRef, parentFolderId);
    });
  } else {
    row.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToItem(itemRef);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigateToItem(itemRef);
      }
    });
  }

  attachItemDragSource(row, itemRef, parentFolderId);
  return row;
}

function navigateToItem(itemRef) {
  const parsed = itemRef.split(':');
  const type = parsed[0];
  const uuid = parsed[1];
  if (!uuid) return;

  // Synthetic click on existing anchor preserves SPA navigation. Falls back
  // to location.href for chats not currently rendered (e.g., scrolled out
  // of a virtualized list).
  const existing = api && api.getChatAnchorByUuid && api.getChatAnchorByUuid(uuid);
  if (existing && document.contains(existing)) {
    existing.click();
    return;
  }
  window.location.href = `/${type}/${uuid}`;
}

function itemRefsInFolder(folderId, assignments) {
  const out = [];
  for (const [ref, ids] of Object.entries(assignments || {})) {
    if (ids.includes(folderId)) out.push(ref);
  }
  return out;
}

function itemRefsSuggestedForFolder(folderId, alreadyAssignedRefs) {
  const seen = new Set(alreadyAssignedRefs);
  const out = [];
  for (const [ref, folderIds] of suggestions.entries()) {
    if (seen.has(ref)) continue;
    if (folderIds.has(folderId)) out.push(ref);
  }
  return out;
}

function countDescendantItems(folderId, childrenByParent, assignments) {
  const stack = [folderId];
  let count = 0;
  while (stack.length > 0) {
    const id = stack.pop();
    for (const [_, ids] of Object.entries(assignments || {})) {
      if (ids.includes(id)) count++;
    }
    const children = childrenByParent.get(id) || [];
    for (const c of children) stack.push(c.id);
  }
  return count;
}

function groupByParent(folders) {
  const map = new Map();
  for (const f of folders) {
    const parent = f.parentId ?? null;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(f);
  }
  return map;
}

function folderSortCompare(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.sortOrder - b.sortOrder;
}

function filterByQuery(items, itemTitles) {
  if (!searchQuery) return items;
  const titles = itemTitles || (mainState?.loaded?.itemTitles || {});
  const cache = mainState?.loaded?.chatCache?.chats || {};
  const folders = mainState?.loaded?.folders || [];
  return items.filter(ref => {
    const title = (titles[ref] || '').toLowerCase();
    if (title.includes(searchQuery)) return true;
    const [kind, uuid] = ref.split(':');
    if (kind === 'chat' && uuid && cache[uuid]) {
      const cTitle = (cache[uuid].title || '').toLowerCase();
      if (cTitle.includes(searchQuery)) return true;
    }
    // Item ref itself can match (e.g., partial UUID)
    if (ref.toLowerCase().includes(searchQuery)) return true;
    // Match if any folder containing this item has a name match
    for (const f of folders) {
      const assignments = mainState?.loaded?.assignments || {};
      if ((assignments[ref] || []).includes(f.id)) {
        if (f.name.toLowerCase().includes(searchQuery)) return true;
      }
    }
    return false;
  });
}

async function toggleCollapse(folderId) {
  if (pendingCollapseWrites.has(folderId)) return;
  pendingCollapseWrites.add(folderId);
  try {
    const state = await S.loadState();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;
    // Use a direct write because there's no public API for this single field;
    // the popup-side commit 8 may add one.
    folder.collapsed = !folder.collapsed;
    await chrome.storage.local.set({ cwcf_data: state });
  } catch (err) {
    console.error('[CWCF] toggle collapse failed', err);
  } finally {
    pendingCollapseWrites.delete(folderId);
  }
}

function attachUnsortedDropTarget(el) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('cwcf-panel__folder-row--drop-target');
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('cwcf-panel__folder-row--drop-target');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('cwcf-panel__folder-row--drop-target');
    const payload = readDragPayload(e.dataTransfer);
    if (!payload || !payload.itemRef) return;
    if (payload.kind === 'chat') {
      try {
        await S.removeItemFromAllFolders(payload.itemRef);
      } catch (err) {
        console.error('[CWCF] move-to-unsorted failed', err);
      }
    }
  });
}

function attachFolderDropTarget(el, targetFolderId) {
  el.addEventListener('dragover', (e) => {
    const payload = readDragPayloadPreview(e.dataTransfer);
    if (!payload) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = payload.kind === 'folder' ? 'move' : 'copy';
    el.classList.add('cwcf-panel__folder-row--drop-target');
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('cwcf-panel__folder-row--drop-target');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('cwcf-panel__folder-row--drop-target');
    const payload = readDragPayload(e.dataTransfer);
    if (!payload) return;
    try {
      if (payload.kind === 'folder') {
        if (payload.folderId === targetFolderId) return;
        await S.moveToParent(payload.folderId, targetFolderId);
      } else if (payload.kind === 'chat') {
        if (payload.sourceFolderId && payload.sourceFolderId !== targetFolderId) {
          await S.removeItemFromFolder(payload.itemRef, payload.sourceFolderId);
        }
        await S.assignItemToFolder(payload.itemRef, targetFolderId);
      }
    } catch (err) {
      console.error('[CWCF] folder drop failed', err);
    }
  });
}

function attachRootDropZone(treeEl) {
  // Drop a folder onto empty tree space (or specifically the tree's top
  // padding) to un-nest it back to root.
  treeEl.addEventListener('dragover', (e) => {
    const payload = readDragPayloadPreview(e.dataTransfer);
    if (!payload || payload.kind !== 'folder') return;
    if (e.target !== treeEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    treeEl.classList.add('cwcf-panel__tree--drop-root');
  });
  treeEl.addEventListener('dragleave', (e) => {
    if (e.target !== treeEl) return;
    treeEl.classList.remove('cwcf-panel__tree--drop-root');
  });
  treeEl.addEventListener('drop', async (e) => {
    if (e.target !== treeEl) return;
    e.preventDefault();
    treeEl.classList.remove('cwcf-panel__tree--drop-root');
    const payload = readDragPayload(e.dataTransfer);
    if (!payload || payload.kind !== 'folder') return;
    try {
      await S.moveToParent(payload.folderId, null);
    } catch (err) {
      console.error('[CWCF] move-to-root failed', err);
    }
  });
}

function attachFolderDragSource(el, folderId) {
  el.addEventListener('dragstart', (e) => {
    const payload = { kind: 'folder', folderId };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-cwcf-item', JSON.stringify(payload));
    el.classList.add('cwcf-panel__folder-row--dragging');
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('cwcf-panel__folder-row--dragging');
  });
}

function attachItemDragSource(el, itemRef, sourceFolderId) {
  el.addEventListener('dragstart', (e) => {
    const payload = { kind: 'chat', itemRef, sourceFolderId: sourceFolderId || null };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-cwcf-item', JSON.stringify(payload));
    el.classList.add('cwcf-panel__item-row--dragging');
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('cwcf-panel__item-row--dragging');
  });
}

function readDragPayload(dt) {
  const raw = dt.getData('application/x-cwcf-item');
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  // Fallback path: claude.ai's React often clears or replaces dataTransfer
  // between dragstart and drop, so the CWCF payload is gone by drop time.
  // Reconstruct from any URL-bearing native DnD data the browser populates
  // for an anchor drag. Try all variants we have observed.
  const uuid = extractUuidFromDataTransfer(dt);
  if (uuid) {
    console.warn('[CWCF] DnD: CWCF payload missing at drop time; falling back to URL data. claude.ai likely preempted dataTransfer between dragstart and drop.');
    return { kind: 'chat', itemRef: `chat:${uuid}`, sourceFolderId: null };
  }
  const types = dt.types ? Array.from(dt.types).join(', ') : '(none)';
  console.warn(`[CWCF] DnD: drop received with no usable payload. Available dataTransfer types: ${types}`);
  return null;
}

function extractUuidFromDataTransfer(dt) {
  const candidates = [
    dt.getData('text/uri-list'),
    dt.getData('text/plain'),
    dt.getData('text/x-moz-url'),
    dt.getData('URL')
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    // text/uri-list and text/x-moz-url can be multi-line
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      try {
        const path = new URL(trimmed, window.location.origin).pathname;
        const uuid = extractChatUuid(path);
        if (uuid) return uuid;
      } catch {}
    }
  }
  return null;
}

function readDragPayloadPreview(dt) {
  // dragover doesn't have access to dataTransfer.getData() in some browsers.
  // We use types[] to peek at what's available without reading the value.
  const types = dt.types ? Array.from(dt.types) : [];
  if (types.includes('application/x-cwcf-item')) {
    // We don't know kind without reading, so report a generic kind that
    // matches both folder and chat acceptance criteria for dragover styling.
    // Drop handler does the real read.
    return { kind: 'unknown' };
  }
  if (types.includes('text/uri-list') || types.includes('text/plain')) {
    return { kind: 'chat' };
  }
  return null;
}

// ---------- Auto-organize (commit 7 will refine, this stub provides the entry) ----------

function runAutoOrganize() {
  if (!mainState) return;
  const folders = mainState.loaded?.folders || [];
  const titles = mainState.loaded?.itemTitles || {};
  const matchMode = mainState.loaded?.settings?.autoOrganizeMatchMode || 'contains';
  const allChatRefs = collectAllChatRefs();
  const allRefs = new Set([...allChatRefs, ...Object.keys(titles)]);

  suggestions.clear();
  for (const ref of allRefs) {
    const title = (titles[ref] || '').toLowerCase();
    if (!title) continue;
    for (const folder of folders) {
      const folderName = folder.name.trim().toLowerCase();
      if (!folderName) continue;
      let isMatch = false;
      if (matchMode === 'exact') {
        isMatch = title === folderName;
      } else {
        isMatch = title.includes(folderName);
      }
      if (!isMatch) continue;
      const assignments = mainState.loaded?.assignments?.[ref] || [];
      if (assignments.includes(folder.id)) continue;
      if (!suggestions.has(ref)) suggestions.set(ref, new Set());
      suggestions.get(ref).add(folder.id);
    }
  }
  // Also add Unsorted-row suggestions: items in suggestions but currently
  // unassigned should also show "?" in the Unsorted area pointing at the
  // suggested folder. Handled via the existing suggestion check in
  // buildItemRow with parentFolderId === null. Since the panel renders
  // Unsorted-only when items have no folders, and a suggestion's target is
  // always a real folder, the Unsorted "?" indicator shows up when the
  // user hovers - kept simple for v0.2.
  render(mainState);
}

async function confirmSuggestion(itemRef, currentParentFolderId) {
  const sug = suggestions.get(itemRef);
  if (!sug) return;
  // If the user is currently looking at this row in a specific folder context,
  // assume they confirm a suggestion targeting that folder. Otherwise pick
  // the first suggestion target.
  const targetId = currentParentFolderId && sug.has(currentParentFolderId)
    ? currentParentFolderId
    : Array.from(sug)[0];
  if (!targetId) return;
  try {
    await S.assignItemToFolder(itemRef, targetId);
    sug.delete(targetId);
    if (sug.size === 0) suggestions.delete(itemRef);
  } catch (err) {
    console.error('[CWCF] confirmSuggestion failed', err);
  }
}

function dismissSuggestion(itemRef, currentParentFolderId) {
  const sug = suggestions.get(itemRef);
  if (!sug) return;
  if (currentParentFolderId && sug.has(currentParentFolderId)) {
    sug.delete(currentParentFolderId);
    if (sug.size === 0) suggestions.delete(itemRef);
  } else {
    suggestions.delete(itemRef);
  }
  if (mainState) render(mainState);
}

function handleCreateFolder() {
  if (api && api.openFolderModal) {
    api.openFolderModal({ mode: 'create' });
  }
}

let syncInFlight = false;
let syncStatusEl = null;
let syncStatusHideTimer = null;
let syncUnsubscribe = null;

async function handleSyncClick(btn) {
  if (syncInFlight) return;
  if (!api || !api.runSync) return;
  syncInFlight = true;
  btn.classList.add('cwcf-panel__icon-btn--busy');
  btn.disabled = true;

  showSyncStatus('Syncing…', 'progress');
  await ensureSyncSubscription();

  try {
    const result = await api.runSync();
    showSyncStatus(`Synced ${result.count} chats`, 'success');
    scheduleSyncStatusHide(3000);
  } catch (err) {
    console.error('[CWCF] sync failed', err);
    const reason = err && err.message ? err.message : String(err);
    showSyncStatus(`Sync failed: ${reason}`, 'error');
    scheduleSyncStatusHide(6000);
  } finally {
    syncInFlight = false;
    btn.classList.remove('cwcf-panel__icon-btn--busy');
    btn.disabled = false;
  }
}

async function ensureSyncSubscription() {
  if (syncUnsubscribe) return;
  if (!api || !api.subscribeSync) return;
  syncUnsubscribe = await api.subscribeSync(handleSyncEvent);
}

function handleSyncEvent(event) {
  if (!event) return;
  switch (event.phase) {
    case 'starting':
      showSyncStatus('Opening /recents…', 'progress');
      break;
    case 'loading':
      showSyncStatus('Waiting for chats to render…', 'progress');
      break;
    case 'expanding':
      showSyncStatus(`Loading more… ${event.count} chats found`, 'progress');
      break;
    case 'settling':
      showSyncStatus(`Finalizing… ${event.count} chats found`, 'progress');
      break;
    case 'done':
      showSyncStatus(`Synced ${event.count} chats`, 'success');
      break;
    case 'error':
      showSyncStatus(`Sync failed: ${event.message || 'unknown error'}`, 'error');
      break;
  }
}

function ensureSyncStatusEl() {
  if (syncStatusEl && document.body.contains(syncStatusEl)) return syncStatusEl;
  if (!panelEl) return null;
  syncStatusEl = document.createElement('div');
  syncStatusEl.className = 'cwcf-panel__sync-status';
  syncStatusEl.setAttribute('role', 'status');
  syncStatusEl.setAttribute('aria-live', 'polite');
  panelEl.appendChild(syncStatusEl);
  return syncStatusEl;
}

function showSyncStatus(text, kind) {
  const el = ensureSyncStatusEl();
  if (!el) return;
  if (syncStatusHideTimer) {
    clearTimeout(syncStatusHideTimer);
    syncStatusHideTimer = null;
  }
  el.textContent = text;
  el.classList.remove('cwcf-panel__sync-status--success', 'cwcf-panel__sync-status--error', 'cwcf-panel__sync-status--progress');
  el.classList.add(`cwcf-panel__sync-status--${kind}`);
  el.classList.add('cwcf-panel__sync-status--visible');
}

function scheduleSyncStatusHide(ms) {
  if (syncStatusHideTimer) clearTimeout(syncStatusHideTimer);
  syncStatusHideTimer = setTimeout(() => {
    if (syncStatusEl) syncStatusEl.classList.remove('cwcf-panel__sync-status--visible');
    syncStatusHideTimer = null;
  }, ms);
}

let activeFolderMenu = null;

function showFolderContextMenu(folder, clientX, clientY) {
  closeFolderContextMenu();

  const menu = document.createElement('div');
  menu.className = 'cwcf-fmenu';
  menu.setAttribute('role', 'menu');

  const items = [
    {
      label: 'Edit folder…',
      onClick: () => {
        if (api && api.openFolderModal) {
          api.openFolderModal({ mode: 'edit', folderId: folder.id });
        }
      }
    },
    {
      label: folder.pinned ? 'Unpin' : 'Pin',
      onClick: async () => {
        try {
          await S.togglePin(folder.id);
        } catch (err) {
          console.error('[CWCF] toggle pin failed', err);
        }
      }
    },
    {
      label: 'Add child folder…',
      onClick: () => {
        if (api && api.openFolderModal) {
          api.openFolderModal({ mode: 'create', parentId: folder.id });
        }
      }
    },
    { kind: 'sep' },
    {
      label: 'Delete folder',
      destructive: true,
      onClick: async () => {
        const ok = window.confirm(
          `Delete folder "${folder.name}"? Chats in it become unsorted. Child folders are also deleted.`
        );
        if (!ok) return;
        try {
          await S.deleteFolder(folder.id);
        } catch (err) {
          console.error('[CWCF] deleteFolder failed', err);
          window.alert(`Delete failed: ${err.message || err}`);
        }
      }
    }
  ];

  for (const item of items) {
    if (item.kind === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'cwcf-fmenu__sep';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cwcf-fmenu__item';
    if (item.destructive) btn.classList.add('cwcf-fmenu__item--danger');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeFolderContextMenu();
      Promise.resolve().then(item.onClick);
    });
    menu.appendChild(btn);
  }

  // Position offscreen first to measure, then clamp inside viewport.
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
  activeFolderMenu = menu;

  const dismiss = (e) => {
    if (e && e.target && menu.contains(e.target)) return;
    closeFolderContextMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', dismiss, { once: true });
    document.addEventListener('contextmenu', dismiss, { once: true });
  }, 0);
}

function closeFolderContextMenu() {
  if (activeFolderMenu) {
    activeFolderMenu.remove();
    activeFolderMenu = null;
  }
}
