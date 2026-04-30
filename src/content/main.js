import * as S from '../lib/storage.js';
import { SELECTORS, extractChatUuid } from '../lib/selectors.js';

const SWEEP_DEBOUNCE_MS = 150;
const TITLE_REFRESH_MIN_INTERVAL_MS = 30_000;

const state = {
  loaded: null,
  observer: null,
  sweepTimer: null,
  unsubscribe: null,
  navEl: null,
  resizeObserver: null,
  modules: {
    strip: null,
    panel: null,
    drag: null
  },
  titleCacheLastWrite: new Map()
};

export async function start() {
  state.loaded = await S.loadState();

  // Recon items 1 and 2: surface drift early without blocking startup.
  state.navEl = document.querySelector(SELECTORS.navBlock);
  if (!state.navEl) {
    console.warn('[CWCF] nav element not found at content script start - claude.ai sidebar may have changed structure');
  }
  const anchorsCount = document.querySelectorAll(SELECTORS.chatAnchorFallback).length;
  if (anchorsCount === 0) {
    console.warn('[CWCF] chat anchors not found - claude.ai chat URL pattern may have changed');
  }

  await loadModulesForViewMode(state.loaded.settings.viewMode);
  attachObserver();
  runSweep();

  state.unsubscribe = S.subscribeToChanges(handleStorageChange);

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) runSweep();
  });
}

async function handleStorageChange(newValue) {
  const previousViewMode = state.loaded?.settings?.viewMode;
  if (!newValue) {
    state.loaded = await S.loadState();
  } else {
    state.loaded = newValue;
  }
  const newViewMode = state.loaded?.settings?.viewMode;
  if (previousViewMode !== newViewMode) {
    await loadModulesForViewMode(newViewMode);
  }
  rerenderActiveModule();
}

async function loadModulesForViewMode(viewMode) {
  // Lazy-load module code only when needed. Both modules can coexist mounted
  // but with different visibility; for v0.2 we only mount the one matching
  // the current view mode and unmount the other.
  if (viewMode === 'organize') {
    if (state.modules.strip && state.modules.strip.unmount) state.modules.strip.unmount();
    if (!state.modules.panel) {
      try {
        const url = chrome.runtime.getURL('src/content/folder-panel.js');
        state.modules.panel = await import(url);
      } catch (err) {
        console.error('[CWCF] failed to load folder-panel module', err);
        return;
      }
    }
    if (state.modules.panel && state.modules.panel.mount) {
      state.modules.panel.mount(state, getApi());
    }
  } else {
    if (state.modules.panel && state.modules.panel.unmount) state.modules.panel.unmount();
    if (!state.modules.strip) {
      try {
        const url = chrome.runtime.getURL('src/content/folder-strip.js');
        state.modules.strip = await import(url);
      } catch (err) {
        console.error('[CWCF] failed to load folder-strip module', err);
        return;
      }
    }
    if (state.modules.strip && state.modules.strip.mount) {
      state.modules.strip.mount(state, getApi());
    }
  }

  if (!state.modules.drag) {
    try {
      const url = chrome.runtime.getURL('src/content/drag-handlers.js');
      state.modules.drag = await import(url);
    } catch (err) {
      // drag-handlers.js may not exist yet in earlier v0.2 commits; log and continue.
      console.warn('[CWCF] drag-handlers module not available yet', err?.message);
    }
  }
}

function rerenderActiveModule() {
  const viewMode = state.loaded?.settings?.viewMode;
  if (viewMode === 'organize' && state.modules.panel && state.modules.panel.render) {
    state.modules.panel.render(state);
  } else if (state.modules.strip && state.modules.strip.render) {
    state.modules.strip.render(state);
  }
}

function attachObserver() {
  if (!state.navEl) {
    setTimeout(() => {
      state.navEl = document.querySelector(SELECTORS.navBlock);
      if (state.navEl) attachObserver();
    }, 200);
    return;
  }
  if (state.observer) state.observer.disconnect();
  state.observer = new MutationObserver(() => queueSweep());
  state.observer.observe(state.navEl, { childList: true, subtree: true });

  if (state.resizeObserver) state.resizeObserver.disconnect();
  state.resizeObserver = new ResizeObserver(() => {
    if (state.modules.panel && state.modules.panel.reposition) state.modules.panel.reposition();
    if (state.modules.strip && state.modules.strip.reposition) state.modules.strip.reposition();
  });
  state.resizeObserver.observe(state.navEl);
}

function queueSweep() {
  if (state.sweepTimer) clearTimeout(state.sweepTimer);
  state.sweepTimer = setTimeout(() => {
    state.sweepTimer = null;
    runSweep();
  }, SWEEP_DEBOUNCE_MS);
}

// Sweep refreshes the title cache and re-renders the active module so any
// new chat anchors are reflected in strip drop targets and panel listings.
function runSweep() {
  refreshTitleCache();
  rerenderActiveModule();
  if (state.modules.drag && state.modules.drag.attachListenersToAnchors) {
    state.modules.drag.attachListenersToAnchors();
  }
}

// Reads chat anchors from the sidebar and updates storage.itemTitles so the
// popup and the panel can display human-readable titles. Throttled per
// itemRef to avoid storage churn when claude.ai re-renders frequently.
function refreshTitleCache() {
  const anchors = document.querySelectorAll(SELECTORS.chatAnchorFallback);
  const now = Date.now();
  for (const a of anchors) {
    const uuid = extractChatUuid(a.getAttribute('href'));
    if (!uuid) continue;
    const itemRef = `chat:${uuid}`;
    const title = (a.innerText || '').trim();
    if (!title) continue;
    const existing = state.loaded?.itemTitles?.[itemRef];
    if (existing === title) continue;
    const lastWrite = state.titleCacheLastWrite.get(itemRef) || 0;
    if (now - lastWrite < TITLE_REFRESH_MIN_INTERVAL_MS && existing) continue;
    state.titleCacheLastWrite.set(itemRef, now);
    S.updateItemTitle(itemRef, title).catch(() => {});
  }
}

// Public API surface passed to modules. Lets strip/panel call back into main
// for cross-cutting concerns without depending on each other directly.
function getApi() {
  return {
    getState: () => state.loaded,
    getNavElement: () => state.navEl,
    setViewMode: async (mode) => {
      try {
        await S.updateSettings({ viewMode: mode });
      } catch (err) {
        console.error('[CWCF] failed to set viewMode', err);
      }
    },
    getChatAnchorByUuid: (uuid) => {
      return document.querySelector(`a[href="/chat/${uuid}"]`);
    },
    runSweep
  };
}
