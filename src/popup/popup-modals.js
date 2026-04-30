import * as S from '../lib/storage.js';
import { EMOJI_CATEGORIES } from '../lib/emoji-set.js';
import { state, $, PRESET_COLORS, showToast } from './popup-shared.js';

let mode = 'create';

export function openCreateFolderModal() {
  mode = 'create';
  state.editingFolderId = null;
  $('folder-edit-title').textContent = 'New folder';
  $('btn-folder-edit-save').textContent = 'Create';

  const defaultColor = state.loaded.settings.defaultFolderColor;
  $('folder-edit-name').value = '';
  $('folder-edit-color').value = defaultColor;
  $('folder-edit-icon').value = '';
  $('folder-edit-description').value = '';
  updateDescriptionCount();
  renderColorPickerSwatches(defaultColor);
  $('modal-folder-edit').showModal();
  setTimeout(() => $('folder-edit-name').focus(), 0);
}

export function openEditFolderModal(folder) {
  mode = 'edit';
  state.editingFolderId = folder.id;
  $('folder-edit-title').textContent = 'Edit folder';
  $('btn-folder-edit-save').textContent = 'Save';

  $('folder-edit-name').value = folder.name;
  $('folder-edit-color').value = folder.color;
  $('folder-edit-icon').value = folder.icon || '';
  $('folder-edit-description').value = folder.description || '';
  updateDescriptionCount();
  renderColorPickerSwatches(folder.color);
  $('modal-folder-edit').showModal();
  setTimeout(() => $('folder-edit-name').focus(), 0);
}

function renderColorPickerSwatches(currentColor) {
  const presetsEl = $('color-picker-presets');
  presetsEl.replaceChildren(...PRESET_COLORS.map(c => buildSwatch(c, currentColor)));

  const recents = state.loaded.settings.recentColors || [];
  const recentsEl = $('color-picker-recents');
  if (recents.length === 0) {
    recentsEl.hidden = true;
    recentsEl.replaceChildren();
  } else {
    recentsEl.hidden = false;
    recentsEl.replaceChildren(...recents.map(c => buildSwatch(c, currentColor)));
  }
}

function buildSwatch(color, currentColor) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'color-swatch-btn';
  btn.style.background = color;
  btn.title = color;
  btn.setAttribute('aria-label', `Use color ${color}`);
  if (color.toLowerCase() === currentColor.toLowerCase()) {
    btn.classList.add('is-selected');
  }
  btn.addEventListener('click', () => {
    $('folder-edit-color').value = color;
    renderColorPickerSwatches(color);
  });
  return btn;
}

function updateDescriptionCount() {
  const value = $('folder-edit-description').value;
  $('folder-edit-description-count').textContent = `${value.length} / 280`;
}

export function wireFolderEditModal() {
  $('folder-edit-form').addEventListener('submit', handleFolderFormSubmit);
  $('btn-folder-edit-cancel').addEventListener('click', () => {
    $('modal-folder-edit').close();
  });
  $('folder-edit-color').addEventListener('input', (e) => {
    renderColorPickerSwatches(e.target.value);
  });
  $('folder-edit-description').addEventListener('input', updateDescriptionCount);
  $('btn-emoji-pick').addEventListener('click', openEmojiPickerModal);
  $('btn-emoji-clear').addEventListener('click', () => {
    $('folder-edit-icon').value = '';
  });
}

async function handleFolderFormSubmit(e) {
  e.preventDefault();
  const name = $('folder-edit-name').value.trim();
  const color = $('folder-edit-color').value;
  const iconRaw = $('folder-edit-icon').value.trim();
  const icon = iconRaw === '' ? null : iconRaw;
  const descRaw = $('folder-edit-description').value.trim();
  const description = descRaw === '' ? null : descRaw;

  if (!name) {
    showToast('Folder name is required', 'error');
    return;
  }

  try {
    if (mode === 'create') {
      const folder = await S.createFolder(name, color);
      const tasks = [];
      if (icon !== null) tasks.push(S.setFolderIcon(folder.id, icon));
      if (description !== null) tasks.push(S.setFolderDescription(folder.id, description));
      await Promise.all(tasks);
      showToast(`Created "${name}"`, 'success');
    } else {
      const folder = state.loaded.folders.find(f => f.id === state.editingFolderId);
      if (!folder) {
        showToast('Folder no longer exists', 'warning');
        $('modal-folder-edit').close();
        return;
      }
      const tasks = [];
      if (folder.name !== name) tasks.push(S.renameFolder(folder.id, name));
      if (folder.color.toLowerCase() !== color.toLowerCase()) tasks.push(S.setFolderColor(folder.id, color));
      if ((folder.icon || null) !== icon) tasks.push(S.setFolderIcon(folder.id, icon));
      if ((folder.description || null) !== description) tasks.push(S.setFolderDescription(folder.id, description));
      await Promise.all(tasks);
      showToast(`Saved "${name}"`, 'success');
    }
    $('modal-folder-edit').close();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------- Emoji picker ----------

function openEmojiPickerModal() {
  const dialog = $('modal-emoji-picker');
  renderEmojiPickerContent();
  dialog.showModal();
}

function renderEmojiPickerContent() {
  const recents = state.loaded.settings.recentEmojis || [];
  const recentsContainer = $('emoji-picker-recents');
  const recentsGrid = $('emoji-grid-recents');
  if (recents.length === 0) {
    recentsContainer.hidden = true;
    recentsGrid.replaceChildren();
  } else {
    recentsContainer.hidden = false;
    recentsGrid.replaceChildren(...recents.map(buildEmojiButton));
  }

  const catContainer = $('emoji-picker-categories');
  catContainer.replaceChildren(...EMOJI_CATEGORIES.map(buildEmojiCategory));
}

function buildEmojiCategory(category) {
  const wrap = document.createElement('div');
  wrap.className = 'emoji-picker__category';
  const heading = document.createElement('h4');
  heading.textContent = category.label;
  wrap.appendChild(heading);
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  category.emojis.forEach(e => grid.appendChild(buildEmojiButton(e)));
  wrap.appendChild(grid);
  return wrap;
}

function buildEmojiButton(emoji) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'emoji-btn';
  btn.textContent = emoji;
  btn.setAttribute('aria-label', `Pick emoji ${emoji}`);
  btn.title = emoji;
  btn.addEventListener('click', () => {
    $('folder-edit-icon').value = emoji;
    $('modal-emoji-picker').close();
  });
  return btn;
}

export function wireEmojiPickerModal() {
  $('btn-emoji-picker-close').addEventListener('click', () => {
    $('modal-emoji-picker').close();
  });
}
