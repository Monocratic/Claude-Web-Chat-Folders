import * as S from '../lib/storage.js';

let activeRoot = null;
let escHandler = null;

const PRESETS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6b7280'
];

// options: { mode: 'create' | 'edit', folderId?: string, parentId?: string }
export function mount(state, api, options = {}) {
  if (activeRoot) close();

  const mode = options.mode === 'edit' ? 'edit' : 'create';
  const editingFolder = mode === 'edit'
    ? state.loaded.folders.find(f => f.id === options.folderId)
    : null;

  if (mode === 'edit' && !editingFolder) {
    console.error('[CWCF] folder-modal: edit mode requires valid folderId', options);
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'cwcf-fmodal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const root = document.createElement('div');
  root.className = 'cwcf-fmodal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', mode === 'edit' ? 'Edit folder' : 'Create folder');

  // Header
  const header = document.createElement('div');
  header.className = 'cwcf-fmodal__header';
  const title = document.createElement('h2');
  title.className = 'cwcf-fmodal__title';
  title.textContent = mode === 'edit' ? 'Edit folder' : 'Create folder';
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cwcf-fmodal__close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  closeBtn.addEventListener('click', close);
  header.appendChild(closeBtn);
  root.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'cwcf-fmodal__body';

  body.appendChild(buildField('Name', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cwcf-fmodal__input';
    input.maxLength = 64;
    input.placeholder = 'Folder name';
    input.value = editingFolder?.name ?? '';
    input.dataset.field = 'name';
    input.required = true;
    return input;
  }));

  body.appendChild(buildField('Parent', () => {
    const select = document.createElement('select');
    select.className = 'cwcf-fmodal__select';
    select.dataset.field = 'parentId';
    const rootOpt = document.createElement('option');
    rootOpt.value = '';
    rootOpt.textContent = '(root)';
    select.appendChild(rootOpt);

    // Build options excluding self and descendants when editing, to prevent
    // creating a cycle. moveToParent enforces this on the storage side too,
    // but excluding from the UI gives the user accurate options upfront.
    const excludedIds = new Set();
    if (editingFolder) {
      excludedIds.add(editingFolder.id);
      const stack = state.loaded.folders.filter(f => f.parentId === editingFolder.id);
      while (stack.length) {
        const f = stack.pop();
        excludedIds.add(f.id);
        state.loaded.folders.filter(c => c.parentId === f.id).forEach(c => stack.push(c));
      }
    }

    const sortedFolders = [...state.loaded.folders].sort((a, b) => {
      // Sort by name for predictable picker order; pinned-first is less
      // useful here since the user is choosing a hierarchy parent
      return (a.name || '').localeCompare(b.name || '');
    });
    for (const folder of sortedFolders) {
      if (excludedIds.has(folder.id)) continue;
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = folder.name;
      if (mode === 'edit' && editingFolder.parentId === folder.id) {
        opt.selected = true;
      } else if (mode === 'create' && options.parentId === folder.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    return select;
  }));

  body.appendChild(buildColorPicker(state, editingFolder));
  body.appendChild(buildEmojiSection(state, editingFolder));

  body.appendChild(buildField('Description', () => {
    const ta = document.createElement('textarea');
    ta.className = 'cwcf-fmodal__textarea';
    ta.maxLength = 280;
    ta.rows = 2;
    ta.placeholder = 'Optional notes';
    ta.value = editingFolder?.description ?? '';
    ta.dataset.field = 'description';
    return ta;
  }));

  root.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'cwcf-fmodal__footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cwcf-fmodal__btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);
  footer.appendChild(cancelBtn);
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'cwcf-fmodal__btn cwcf-fmodal__btn--primary';
  submitBtn.textContent = mode === 'edit' ? 'Save' : 'Create';
  submitBtn.addEventListener('click', () => handleSubmit(root, mode, editingFolder));
  footer.appendChild(submitBtn);
  root.appendChild(footer);

  document.body.appendChild(backdrop);
  document.body.appendChild(root);
  activeRoot = { backdrop, root };

  escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);

  // Submit on Enter from the name input
  const nameInput = root.querySelector('[data-field="name"]');
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(root, mode, editingFolder);
    }
  });

  setTimeout(() => nameInput?.focus(), 50);
}

function buildField(labelText, controlBuilder) {
  const wrap = document.createElement('div');
  wrap.className = 'cwcf-fmodal__field';
  const label = document.createElement('label');
  label.className = 'cwcf-fmodal__label';
  label.textContent = labelText;
  wrap.appendChild(label);
  const control = controlBuilder();
  wrap.appendChild(control);
  return wrap;
}

function buildColorPicker(state, editingFolder) {
  const wrap = document.createElement('div');
  wrap.className = 'cwcf-fmodal__field';
  const label = document.createElement('label');
  label.className = 'cwcf-fmodal__label';
  label.textContent = 'Color';
  wrap.appendChild(label);

  const grid = document.createElement('div');
  grid.className = 'cwcf-fmodal__color-grid';
  grid.dataset.field = 'color';

  const recents = state.loaded.settings.recentColors || [];
  const allColors = [...new Set([...recents, ...PRESETS])];
  const currentColor = editingFolder?.color ?? state.loaded.settings.defaultFolderColor;
  grid.dataset.selected = currentColor;

  for (const color of allColors) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'cwcf-fmodal__swatch';
    sw.style.background = color;
    sw.dataset.color = color;
    sw.setAttribute('aria-label', `Color ${color}`);
    sw.title = color;
    if (color === currentColor) sw.classList.add('cwcf-fmodal__swatch--selected');
    sw.addEventListener('click', () => {
      grid.querySelectorAll('.cwcf-fmodal__swatch--selected').forEach(el =>
        el.classList.remove('cwcf-fmodal__swatch--selected'));
      sw.classList.add('cwcf-fmodal__swatch--selected');
      grid.dataset.selected = color;
    });
    grid.appendChild(sw);
  }
  wrap.appendChild(grid);
  return wrap;
}

function buildEmojiSection(state, editingFolder) {
  const wrap = document.createElement('div');
  wrap.className = 'cwcf-fmodal__field';
  const label = document.createElement('label');
  label.className = 'cwcf-fmodal__label';
  label.textContent = 'Icon';
  wrap.appendChild(label);

  const display = document.createElement('div');
  display.className = 'cwcf-fmodal__emoji-display';
  display.dataset.field = 'icon';

  const current = editingFolder?.icon ?? null;
  const currentSpan = document.createElement('span');
  currentSpan.className = 'cwcf-fmodal__emoji-current';
  currentSpan.textContent = current || '(none)';
  display.appendChild(currentSpan);
  display.dataset.value = current || '';

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'cwcf-fmodal__btn cwcf-fmodal__btn--small';
  pickBtn.textContent = 'Pick';
  pickBtn.addEventListener('click', () => toggleEmojiGrid(wrap, state, currentSpan, display));
  display.appendChild(pickBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'cwcf-fmodal__btn cwcf-fmodal__btn--small';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    currentSpan.textContent = '(none)';
    display.dataset.value = '';
  });
  display.appendChild(clearBtn);

  wrap.appendChild(display);
  return wrap;
}

function toggleEmojiGrid(fieldWrap, state, currentSpan, display) {
  const existing = fieldWrap.querySelector('.cwcf-fmodal__emoji-grid');
  if (existing) {
    existing.remove();
    return;
  }
  // Lazy-import emoji set so first folder-modal mount doesn't pay the cost.
  import(chrome.runtime.getURL('src/lib/emoji-set.js')).then(mod => {
    const grid = document.createElement('div');
    grid.className = 'cwcf-fmodal__emoji-grid';

    const recents = state.loaded.settings.recentEmojis || [];
    if (recents.length) {
      grid.appendChild(buildEmojiCategory('Recent', recents, currentSpan, display, grid));
    }
    for (const cat of mod.EMOJI_CATEGORIES) {
      grid.appendChild(buildEmojiCategory(cat.label, cat.emojis, currentSpan, display, grid));
    }
    fieldWrap.appendChild(grid);
  }).catch(err => console.error('[CWCF] emoji-set import failed', err));
}

function buildEmojiCategory(labelText, emojis, currentSpan, display, grid) {
  const wrap = document.createElement('div');
  const lbl = document.createElement('div');
  lbl.className = 'cwcf-fmodal__emoji-cat-label';
  lbl.textContent = labelText;
  wrap.appendChild(lbl);
  const row = document.createElement('div');
  row.className = 'cwcf-fmodal__emoji-row';
  for (const emoji of emojis) {
    row.appendChild(buildEmojiBtn(emoji, currentSpan, display, grid));
  }
  wrap.appendChild(row);
  return wrap;
}

function buildEmojiBtn(emoji, currentSpan, display, grid) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cwcf-fmodal__emoji-btn';
  btn.textContent = emoji;
  btn.setAttribute('aria-label', `Pick ${emoji}`);
  btn.addEventListener('click', () => {
    currentSpan.textContent = emoji;
    display.dataset.value = emoji;
    grid.remove();
  });
  return btn;
}

async function handleSubmit(root, mode, editingFolder) {
  const name = root.querySelector('[data-field="name"]').value.trim();
  if (!name) {
    window.alert('Folder name is required.');
    return;
  }
  const parentSelect = root.querySelector('[data-field="parentId"]');
  const parentId = parentSelect.value || null;
  const color = root.querySelector('[data-field="color"]').dataset.selected;
  const icon = root.querySelector('[data-field="icon"]').dataset.value || null;
  const description = root.querySelector('[data-field="description"]').value.trim() || null;

  try {
    if (mode === 'edit') {
      if (name !== editingFolder.name) await S.renameFolder(editingFolder.id, name);
      if (color !== editingFolder.color) await S.setFolderColor(editingFolder.id, color);
      if (icon !== editingFolder.icon) await S.setFolderIcon(editingFolder.id, icon);
      const oldDesc = editingFolder.description ?? null;
      if (description !== oldDesc) await S.setFolderDescription(editingFolder.id, description);
      const oldParent = editingFolder.parentId ?? null;
      if (parentId !== oldParent) await S.moveToParent(editingFolder.id, parentId);
    } else {
      const folder = await S.createFolder(name, color);
      if (parentId) await S.moveToParent(folder.id, parentId);
      if (icon) await S.setFolderIcon(folder.id, icon);
      if (description) await S.setFolderDescription(folder.id, description);
    }
    close();
  } catch (err) {
    console.error('[CWCF] folder-modal submit failed', err);
    window.alert(`Save failed: ${err.message || err}`);
  }
}

function close() {
  if (!activeRoot) return;
  activeRoot.backdrop.remove();
  activeRoot.root.remove();
  activeRoot = null;
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}
