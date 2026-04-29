import * as S from '../lib/storage.js';
import {
  SELECTORS, SENTINEL_ATTR, BUTTON_MARKER_ATTR, CSS_CLASSES,
  extractChatUuid
} from '../lib/selectors.js';

const SWEEP_DEBOUNCE_MS = 150;

const state = {
  loaded: null,
  unsubscribe: null,
  observer: null,
  sweepTimer: null,
  popover: null,
  popoverButton: null,
  popoverItemRef: null,
  popoverDocListener: null,
  popoverKeyListener: null
};

export async function start() {
  state.loaded = await S.loadState();
  state.unsubscribe = S.subscribeToChanges((newValue) => {
    if (!newValue) {
      state.loaded = null;
      if (state.popover) closePopover();
      S.loadState().then(s => { state.loaded = s; if (state.popover) renderPopoverList(); });
      return;
    }
    state.loaded = newValue;
    if (state.popover) renderPopoverList();
  });

  attachObserver();
  runSweep();

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) runSweep();
  });
}

function attachObserver() {
  const sidebar = document.querySelector(SELECTORS.sidebar);
  if (!sidebar) {
    setTimeout(attachObserver, 200);
    return;
  }
  if (state.observer) state.observer.disconnect();
  state.observer = new MutationObserver(() => queueSweep());
  state.observer.observe(sidebar, { childList: true, subtree: true });
}

function queueSweep() {
  if (state.sweepTimer) clearTimeout(state.sweepTimer);
  state.sweepTimer = setTimeout(() => {
    state.sweepTimer = null;
    runSweep();
  }, SWEEP_DEBOUNCE_MS);
}

function runSweep() {
  if (!state.loaded || !state.loaded.settings.showInjectButtons) {
    removeAllInjectedButtons();
    if (state.popover) closePopover();
    return;
  }

  let anchors = document.querySelectorAll(SELECTORS.chatAnchor);
  if (anchors.length === 0) {
    anchors = document.querySelectorAll(SELECTORS.chatAnchorFallback);
  }

  for (const anchor of anchors) {
    if (anchor.hasAttribute(SENTINEL_ATTR)) continue;
    injectButton(anchor);
  }
}

function removeAllInjectedButtons() {
  const buttons = document.querySelectorAll(`[${BUTTON_MARKER_ATTR}="true"]`);
  for (const btn of buttons) btn.remove();
  const anchors = document.querySelectorAll(`[${SENTINEL_ATTR}="true"]`);
  for (const a of anchors) a.removeAttribute(SENTINEL_ATTR);
}

function injectButton(anchor) {
  const uuid = extractChatUuid(anchor.getAttribute('href'));
  if (!uuid) return;
  const itemRef = `chat:${uuid}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = CSS_CLASSES.injectButton;
  btn.setAttribute(BUTTON_MARKER_ATTR, 'true');
  btn.setAttribute('aria-label', 'Add chat to folder');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.title = 'Add chat to folder';
  btn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 7v3M6.5 8.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleInjectClick(btn, itemRef, anchor);
  });
  btn.addEventListener('mousedown', (e) => e.stopPropagation());

  anchor.setAttribute(SENTINEL_ATTR, 'true');
  anchor.appendChild(btn);

  const cachedTitle = (anchor.innerText || '').trim();
  if (cachedTitle) {
    S.updateItemTitle(itemRef, cachedTitle).catch(() => {});
  }
}

function handleInjectClick(button, itemRef, anchor) {
  if (state.popover && state.popoverItemRef === itemRef) {
    closePopover();
    return;
  }
  if (state.popover) closePopover();
  openPopover(button, itemRef, anchor);
}

function openPopover(button, itemRef, anchor) {
  const popover = document.createElement('div');
  popover.className = CSS_CLASSES.popover;
  popover.setAttribute(BUTTON_MARKER_ATTR, 'true');
  popover.setAttribute('role', 'menu');
  popover.tabIndex = -1;

  const header = document.createElement('div');
  header.className = `${CSS_CLASSES.popover}__header`;
  const cachedTitle = (anchor.innerText || '').trim();
  header.textContent = cachedTitle ? `Add "${cachedTitle.slice(0, 40)}${cachedTitle.length > 40 ? '...' : ''}" to:` : 'Add chat to:';
  popover.appendChild(header);

  const list = document.createElement('div');
  list.className = CSS_CLASSES.popoverList;
  popover.appendChild(list);

  document.body.appendChild(popover);

  state.popover = popover;
  state.popoverButton = button;
  state.popoverItemRef = itemRef;
  button.setAttribute('aria-expanded', 'true');

  positionPopover(button, popover);
  renderPopoverList();

  state.popoverDocListener = (e) => {
    if (!state.popover) return;
    if (state.popover.contains(e.target)) return;
    if (button === e.target || button.contains(e.target)) return;
    closePopover();
  };
  state.popoverKeyListener = (e) => {
    if (!state.popover) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePopover();
      button.focus();
    }
  };
  document.addEventListener('mousedown', state.popoverDocListener, true);
  document.addEventListener('keydown', state.popoverKeyListener);
  window.addEventListener('resize', repositionOpenPopover);
  window.addEventListener('scroll', repositionOpenPopover, true);

  const firstFocusable = popover.querySelector('button');
  if (firstFocusable) firstFocusable.focus();
}

function closePopover() {
  if (!state.popover) return;
  if (state.popoverButton) {
    state.popoverButton.setAttribute('aria-expanded', 'false');
  }
  state.popover.remove();
  if (state.popoverDocListener) {
    document.removeEventListener('mousedown', state.popoverDocListener, true);
  }
  if (state.popoverKeyListener) {
    document.removeEventListener('keydown', state.popoverKeyListener);
  }
  window.removeEventListener('resize', repositionOpenPopover);
  window.removeEventListener('scroll', repositionOpenPopover, true);
  state.popover = null;
  state.popoverButton = null;
  state.popoverItemRef = null;
  state.popoverDocListener = null;
  state.popoverKeyListener = null;
}

function repositionOpenPopover() {
  if (!state.popover || !state.popoverButton) return;
  if (!document.contains(state.popoverButton)) {
    closePopover();
    return;
  }
  positionPopover(state.popoverButton, state.popover);
}

function positionPopover(button, popover) {
  const rect = button.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const margin = 8;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = rect.right + margin;
  if (left + popRect.width > viewportW - margin) {
    left = rect.left - popRect.width - margin;
  }
  if (left < margin) left = margin;

  let top = rect.top;
  if (top + popRect.height > viewportH - margin) {
    top = viewportH - popRect.height - margin;
  }
  if (top < margin) top = margin;

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function renderPopoverList() {
  if (!state.popover || !state.loaded) return;
  const list = state.popover.querySelector(`.${CSS_CLASSES.popoverList}`);
  if (!list) return;

  const folders = [...state.loaded.folders].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });

  if (folders.length === 0) {
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = CSS_CLASSES.popoverEmpty;
    empty.textContent = 'No folders yet. Open the toolbar popup to create one.';
    list.appendChild(empty);
    return;
  }

  const assigned = state.loaded.assignments[state.popoverItemRef] || [];
  const items = folders.map(folder => buildPopoverItem(folder, assigned.includes(folder.id)));
  list.replaceChildren(...items);
}

function buildPopoverItem(folder, isAssigned) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = CSS_CLASSES.popoverItem;
  if (isAssigned) btn.classList.add(CSS_CLASSES.popoverItemActive);
  btn.setAttribute('role', 'menuitemcheckbox');
  btn.setAttribute('aria-checked', isAssigned ? 'true' : 'false');

  const check = document.createElement('span');
  check.className = `${CSS_CLASSES.popoverItem}__check`;
  check.textContent = isAssigned ? '✓' : '';
  btn.appendChild(check);

  const swatch = document.createElement('span');
  swatch.className = `${CSS_CLASSES.popoverItem}__swatch`;
  swatch.style.background = folder.color;
  btn.appendChild(swatch);

  if (folder.icon) {
    const icon = document.createElement('span');
    icon.className = `${CSS_CLASSES.popoverItem}__icon`;
    icon.textContent = folder.icon;
    btn.appendChild(icon);
  }

  const name = document.createElement('span');
  name.className = `${CSS_CLASSES.popoverItem}__name`;
  name.textContent = folder.name;
  btn.appendChild(name);

  if (folder.pinned) {
    const pin = document.createElement('span');
    pin.className = `${CSS_CLASSES.popoverItem}__pin`;
    pin.textContent = '★';
    btn.appendChild(pin);
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleFolderToggle(folder.id, isAssigned);
  });

  return btn;
}

async function handleFolderToggle(folderId, isCurrentlyAssigned) {
  const itemRef = state.popoverItemRef;
  if (!itemRef) return;
  try {
    if (isCurrentlyAssigned) {
      await S.removeItemFromFolder(itemRef, folderId);
    } else {
      await S.assignItemToFolder(itemRef, folderId);
    }
  } catch (err) {
    console.error('[CWCF] folder toggle failed', err);
  }
}
