import * as S from '../lib/storage.js';
import { state, $, showView, showToast, openInTab, itemRefToUrl, showConfirm } from './popup-shared.js';
import { openEditFolderModal } from './popup-modals.js';

let dragSrcId = null;

export function renderFolderList() {
  if (!state.loaded) return;
  const all = [...state.loaded.folders].sort((a, b) => a.sortOrder - b.sortOrder);
  const filtered = filterFolders(all, state.searchQuery);
  const pinned = filtered.filter(f => f.pinned);
  const unpinned = filtered.filter(f => !f.pinned);

  const pinnedList = $('folder-list-pinned');
  const allList = $('folder-list-all');
  pinnedList.replaceChildren(...pinned.map(buildFolderRow));
  allList.replaceChildren(...unpinned.map(buildFolderRow));

  $('section-pinned').hidden = pinned.length === 0;

  const totalFolders = state.loaded.folders.length;
  const countEl = $('folder-count');
  countEl.textContent = `${totalFolders}`;
  countEl.hidden = totalFolders === 0;

  $('empty-folders').hidden = filtered.length > 0;
  $('section-all-heading').textContent = state.searchQuery
    ? `Matches (${filtered.length})`
    : 'All folders';
}

function filterFolders(folders, query) {
  if (!query) return folders;
  const q = query.toLowerCase();
  return folders.filter(f => {
    if (f.name.toLowerCase().includes(q)) return true;
    if (f.description && f.description.toLowerCase().includes(q)) return true;
    const titles = state.loaded.itemTitles || {};
    const itemRefs = Object.entries(state.loaded.assignments || {})
      .filter(([_, ids]) => ids.includes(f.id))
      .map(([ref]) => ref);
    return itemRefs.some(ref => (titles[ref] || '').toLowerCase().includes(q));
  });
}

function buildFolderRow(folder) {
  const li = document.createElement('li');
  li.className = 'folder-row';
  li.dataset.folderId = folder.id;
  li.draggable = true;
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `Open folder ${folder.name}`);

  const swatch = document.createElement('span');
  swatch.className = 'folder-swatch';
  swatch.style.background = folder.color;
  li.appendChild(swatch);

  if (folder.icon) {
    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.textContent = folder.icon;
    li.appendChild(icon);
  }

  const name = document.createElement('span');
  name.className = 'folder-row__name';
  name.textContent = folder.name;
  li.appendChild(name);

  if (state.loaded.settings.showChatCounts) {
    const count = countItemsInFolder(folder.id);
    if (count > 0) {
      const countEl = document.createElement('span');
      countEl.className = 'folder-row__count';
      countEl.textContent = `${count}`;
      li.appendChild(countEl);
    }
  }

  if (folder.pinned) {
    const pin = document.createElement('span');
    pin.className = 'folder-row__pin';
    pin.textContent = '★';
    pin.setAttribute('aria-label', 'Pinned');
    li.appendChild(pin);
  }

  li.addEventListener('click', () => openFolderDetail(folder.id));
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFolderDetail(folder.id);
    }
  });

  li.addEventListener('dragstart', handleDragStart);
  li.addEventListener('dragover', handleDragOver);
  li.addEventListener('dragleave', handleDragLeave);
  li.addEventListener('drop', handleDrop);
  li.addEventListener('dragend', handleDragEnd);

  return li;
}

function countItemsInFolder(folderId) {
  if (!state.loaded) return 0;
  let n = 0;
  for (const ids of Object.values(state.loaded.assignments)) {
    if (ids.includes(folderId)) n++;
  }
  return n;
}

function handleDragStart(e) {
  dragSrcId = e.currentTarget.dataset.folderId;
  e.currentTarget.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}

function handleDragOver(e) {
  if (!dragSrcId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.folder-row.is-drop-target').forEach(el => {
    if (el !== e.currentTarget) el.classList.remove('is-drop-target');
  });
  e.currentTarget.classList.add('is-drop-target');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('is-drop-target');
}

async function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('is-drop-target');
  const targetId = e.currentTarget.dataset.folderId;
  if (!dragSrcId || dragSrcId === targetId) return;

  const ordered = [...state.loaded.folders].sort((a, b) => a.sortOrder - b.sortOrder).map(f => f.id);
  const srcIdx = ordered.indexOf(dragSrcId);
  if (srcIdx >= 0) ordered.splice(srcIdx, 1);

  const targetIdx = ordered.indexOf(targetId);
  const rect = e.currentTarget.getBoundingClientRect();
  const insertAfter = (e.clientY - rect.top) > rect.height / 2;
  const insertAt = insertAfter ? targetIdx + 1 : targetIdx;
  ordered.splice(insertAt, 0, dragSrcId);

  try {
    await S.reorderFolders(ordered);
  } catch (err) {
    showToast(`Reorder failed: ${err.message}`, 'error');
  }
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('is-dragging');
  document.querySelectorAll('.folder-row.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
  dragSrcId = null;
}

// ----- Folder detail view -----

export async function openFolderDetail(folderId) {
  state.detailFolderId = folderId;
  showView('folder-detail');
  await renderFolderDetail();
}

export async function renderFolderDetail() {
  if (!state.detailFolderId || !state.loaded) return;
  const folder = state.loaded.folders.find(f => f.id === state.detailFolderId);
  if (!folder) {
    showToast('Folder no longer exists', 'warning');
    showView('folders');
    state.detailFolderId = null;
    return;
  }

  $('detail-name').textContent = folder.name;
  $('detail-swatch').style.background = folder.color;

  const iconEl = $('detail-icon');
  if (folder.icon) {
    iconEl.textContent = folder.icon;
    iconEl.hidden = false;
  } else {
    iconEl.textContent = '';
    iconEl.hidden = true;
  }

  const descEl = $('detail-description');
  if (folder.description) {
    descEl.textContent = folder.description;
    descEl.hidden = false;
  } else {
    descEl.textContent = '';
    descEl.hidden = true;
  }

  const itemRefs = await S.getItemsInFolder(folder.id);
  const list = $('detail-items');
  list.replaceChildren(...itemRefs.map(ref => buildItemRow(ref, folder)));
  $('detail-empty').hidden = itemRefs.length > 0;
}

function buildItemRow(itemRef, folder) {
  const parsed = S.parseItemRef(itemRef);
  const li = document.createElement('li');
  li.className = 'item-row';
  li.dataset.itemRef = itemRef;
  li.tabIndex = 0;
  li.setAttribute('role', 'button');

  const type = document.createElement('span');
  type.className = `item-row__type item-row__type--${parsed.type}`;
  type.textContent = parsed.type;
  li.appendChild(type);

  const title = document.createElement('span');
  title.className = 'item-row__title';
  const cached = state.loaded.itemTitles[itemRef];
  title.textContent = cached || `${parsed.type} ${parsed.uuid.slice(0, 8)}`;
  li.appendChild(title);

  const open = () => {
    const url = itemRefToUrl(itemRef);
    if (url) openInTab(url);
  };
  li.addEventListener('click', open);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  return li;
}

export function wireFolderDetailButtons() {
  $('btn-folder-edit').addEventListener('click', () => {
    if (!state.detailFolderId) return;
    const folder = state.loaded.folders.find(f => f.id === state.detailFolderId);
    if (folder) openEditFolderModal(folder);
  });

  $('btn-folder-delete').addEventListener('click', async () => {
    if (!state.detailFolderId) return;
    const folder = state.loaded.folders.find(f => f.id === state.detailFolderId);
    if (!folder) return;
    if (state.loaded.settings.confirmFolderDelete) {
      const ok = await showConfirm(`Delete folder "${folder.name}"? Chat assignments to this folder are removed; the chats themselves are not affected.`, { okLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    try {
      await S.deleteFolder(folder.id);
      showToast(`Deleted "${folder.name}"`, 'success');
      state.detailFolderId = null;
      showView('folders');
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  });
}
