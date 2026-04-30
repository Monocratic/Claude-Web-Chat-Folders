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
    drag: null,
    settings: null,
    folderModal: null,
    sync: null
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

  // Background service worker dispatches cwcf:openSettingsOverlay when the
  // user clicks "Manage folders…" in the right-click context menu. The
  // listener calls getApi() inside the callback so the api object is fresh
  // each time, not captured at registration.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'cwcf:openSettingsOverlay') {
      const apiRef = getApi();
      apiRef.openSettingsOverlay();
      sendResponse({ ok: true });
    }
    return false;
  });

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
  // If the settings overlay is open, refresh its values from the new state
  // so changes from popup/context-menu/other-tab reflect immediately.
  if (state.modules.settings && state.modules.settings.isOpen && state.modules.settings.isOpen()) {
    state.modules.settings.onStateChange({ loaded: state.loaded });
  }
}

function attachObserver() {
  if (!state.navEl) {
    setTimeout(() => {
      state.navEl = document.querySelector(SELECTORS.navBlock);
      if (state.navEl) {
        attachObserver();
        // Re-fire reposition on any module that mounted before nav existed.
        // Without this, modules that mounted at document_idle while
        // claude.ai's React was still rendering nav would have null-nav
        // reposition calls bail silently and stay at default (broken)
        // position forever.
        if (state.modules.strip && state.modules.strip.reposition) state.modules.strip.reposition();
        if (state.modules.panel && state.modules.panel.reposition) state.modules.panel.reposition();
      }
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
    getTopNavBottomOffset: () => {
      const nav = state.navEl;
      if (!nav) return 0;
      // Primary: button with aria-label="More". This is claude.ai's "More"
      // expand/collapse button at the top of the nav, sitting above the
      // chat list area where strip and panel start.
      //
      // We deliberately do NOT use [data-dd-action-name="sidebar-more-item"]
      // here. claude.ai uses that Datadog action name on the "All chats"
      // link at the BOTTOM of the chat list (href="/recents"), not on the
      // "More" expand button. That's a misleading internal naming choice
      // by Anthropic; using it would land our overlay top-edge below the
      // chat list (off-screen for tall sidebars) instead of below the
      // top nav block. See docs/DOM-NOTES.md for the full recon note.
      const moreBtn = nav.querySelector('button[aria-label="More"]');
      if (moreBtn) return Math.round(moreBtn.getBoundingClientRect().bottom);
      // Fallback: text-content match, defensive against aria-label drift.
      const textMatch = [...nav.querySelectorAll('a, button')].find(
        el => el.textContent.trim() === 'More' && el.children.length < 3
      );
      if (textMatch) return Math.round(textMatch.getBoundingClientRect().bottom);
      // Final fallback: estimate based on top of nav.
      return Math.round(nav.getBoundingClientRect().top + 280);
    },
    openSettingsOverlay: async () => {
      // In-page settings: render the settings UI as an overlay over
      // claude.ai, no popup or new tab. Click outside, Escape, or close
      // X dismisses. The module is dynamic-imported on first open so
      // its code only loads when the user actually clicks the cog.
      try {
        if (!state.modules.settings) {
          const url = chrome.runtime.getURL('src/content/settings-overlay.js');
          state.modules.settings = await import(url);
        }
        if (state.modules.settings && state.modules.settings.mount) {
          state.modules.settings.mount({ loaded: state.loaded }, getApi());
        }
      } catch (err) {
        console.error('[CWCF] failed to open settings overlay', err);
      }
    },
    runSync: async () => {
      if (!state.modules.sync) {
        const url = chrome.runtime.getURL('src/content/sync.js');
        state.modules.sync = await import(url);
      }
      return state.modules.sync.runSync();
    },
    openFolderModal: async (options = {}) => {
      try {
        if (!state.modules.folderModal) {
          const url = chrome.runtime.getURL('src/content/folder-modal.js');
          state.modules.folderModal = await import(url);
        }
        if (state.modules.folderModal && state.modules.folderModal.mount) {
          state.modules.folderModal.mount({ loaded: state.loaded }, getApi(), options);
        }
      } catch (err) {
        console.error('[CWCF] failed to open folder modal', err);
      }
    },
    runSweep
  };
}
