import * as S from '../lib/storage.js';
import { SELECTORS, extractChatUuid } from '../lib/selectors.js';

// v0.2.1 Phase 1 diagnostic. Flip to false to silence. The
// per-iteration log inside clickShowMoreUntilDone (already shipped in
// 54a9a6e) stays regardless; these entry/exit logs cover everything
// upstream of the loop so we can locate where execution dies.
const DEBUG = true;
const log = (...args) => { if (DEBUG) console.log('[CWCF sync]', ...args); };

let inFlight = null;
const listeners = new Set();

const INITIAL_WAIT_MS = 8_000;
const POLL_INTERVAL_MS = 250;
const SETTLE_DELAY_MS = 1_200;
const SHOW_MORE_INTERVAL_MS = 600;
const SHOW_MORE_MAX_CLICKS = 50;
const PER_CLICK_TIMEOUT_MS = 5_000;
const PER_CLICK_PLATEAU_MS = 1_500;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (err) { console.error('[CWCF] sync listener error', err); }
  }
}

export async function runSync() {
  log('runSync entered', { inFlight: !!inFlight });
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync() {
  log('doSync entered, creating iframe to /recents');
  emit({ phase: 'starting', count: 0 });
  const iframe = document.createElement('iframe');
  iframe.src = '/recents';
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '-10000px';
  iframe.style.width = '1024px';
  iframe.style.height = '768px';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  document.body.appendChild(iframe);

  try {
    await waitForIframeReady(iframe);
    log('iframe ready, contentDocument accessible');
    emit({ phase: 'loading', count: 0 });
    const initialCount = await waitForInitialCells(iframe);
    log('waitForInitialCells returned', {
      initialCount,
      narrow: countCellsNarrow(iframe.contentDocument),
      broad: countCellsBroad(iframe.contentDocument)
    });
    emit({ phase: 'expanding', count: initialCount });
    log('about to enter clickShowMoreUntilDone');
    const finalCount = await clickShowMoreUntilDone(iframe);
    log('clickShowMoreUntilDone returned', { finalCount });
    emit({ phase: 'settling', count: finalCount });
    const cells = collectCells(iframe.contentDocument);
    const chats = cellsToChats(cells);
    log('extraction complete', { rawCells: cells.length, dedupedChats: chats.length });
    if (chats.length === 0) {
      throw new Error('No chats found on /recents - claude.ai may have blocked iframe embedding or the selector drifted.');
    }
    const result = await S.setCachedChats(chats);
    log('setCachedChats wrote', { count: chats.length, lastSyncedAt: result.lastSyncedAt });
    emit({ phase: 'done', count: chats.length });
    return { count: chats.length, lastSyncedAt: result.lastSyncedAt };
  } catch (err) {
    log('doSync caught error', { message: err.message || String(err) });
    emit({ phase: 'error', count: 0, message: err.message || String(err) });
    throw err;
  } finally {
    iframe.remove();
  }
}

function waitForIframeReady(iframe) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Iframe load timeout')), INITIAL_WAIT_MS);
    iframe.addEventListener('load', () => {
      clearTimeout(timer);
      try {
        if (!iframe.contentDocument) {
          reject(new Error('Iframe contentDocument not accessible'));
          return;
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    }, { once: true });
  });
}

async function waitForInitialCells(iframe) {
  const doc = iframe.contentDocument;
  const start = Date.now();
  while (Date.now() - start < INITIAL_WAIT_MS) {
    const cells = collectCells(doc);
    if (cells.length > 0) return cells.length;
    await sleep(POLL_INTERVAL_MS);
  }
  return 0;
}

async function clickShowMoreUntilDone(iframe) {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  let clicks = 0;
  let lastCount = countCellsForGrowth(doc);
  log('clickShowMoreUntilDone entered', {
    startNarrow: countCellsNarrow(doc),
    startBroad: countCellsBroad(doc),
    lastCount,
    showMoreFound: !!findShowMoreButton(doc),
    totalButtons: doc.querySelectorAll('button').length,
    sampleButtonTexts: [...doc.querySelectorAll('button')].slice(0, 8)
      .map(b => (b.textContent || '').trim()).filter(Boolean)
  });
  emit({ phase: 'expanding', count: lastCount });

  while (clicks < SHOW_MORE_MAX_CLICKS) {
    const btn = findShowMoreButton(doc);
    if (!btn) {
      log('loop exited: findShowMoreButton returned null', { iterationsCompleted: clicks });
      break;
    }

    const beforeNarrow = countCellsNarrow(doc);
    const beforeBroad = countCellsBroad(doc);
    const beforeCount = Math.max(beforeNarrow, beforeBroad);

    // dispatchEvent over .click() because btn.click() can hit edge cases in
    // React's event delegation when the click target is inside an iframe.
    // view: iframe.contentWindow scopes the event to the iframe's abstract
    // view; otherwise the event identifies as parent-window-originated and
    // some React handlers reject it.
    btn.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: win
    }));
    clicks++;

    const newCount = await waitForGrowth(doc, beforeCount);
    const afterNarrow = countCellsNarrow(doc);
    const afterBroad = countCellsBroad(doc);
    const buttonStillPresent = !!findShowMoreButton(doc);

    // Per-iteration diagnostic. Sync is user-triggered, fires <50 times max
    // per click, cost is nil. Keeps the next debugging session unblocked
    // when /recents DOM drifts.
    console.log('[CWCF sync]', {
      iteration: clicks,
      beforeNarrow,
      beforeBroad,
      afterNarrow,
      afterBroad,
      newCount,
      buttonStillPresent,
      buttonText: (btn.textContent || '').trim()
    });

    if (newCount > lastCount) {
      lastCount = newCount;
      emit({ phase: 'expanding', count: lastCount });
    }
    if (newCount === beforeCount) {
      break;
    }
    await sleep(SHOW_MORE_INTERVAL_MS);
  }

  await waitForSettle(doc);
  return countCellsForGrowth(doc);
}

async function waitForGrowth(doc, beforeCount) {
  const start = Date.now();
  let count = beforeCount;
  while (Date.now() - start < PER_CLICK_TIMEOUT_MS) {
    count = countCellsForGrowth(doc);
    if (count > beforeCount) {
      const growStop = Date.now();
      while (Date.now() - growStop < PER_CLICK_PLATEAU_MS) {
        await sleep(POLL_INTERVAL_MS);
        const next = countCellsForGrowth(doc);
        if (next > count) {
          count = next;
          break;
        }
      }
      return count;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return count;
}

async function waitForSettle(doc) {
  let last = countCellsForGrowth(doc);
  let stable = 0;
  while (stable < SETTLE_DELAY_MS) {
    await sleep(POLL_INTERVAL_MS);
    const cur = countCellsForGrowth(doc);
    if (cur !== last) {
      last = cur;
      stable = 0;
    } else {
      stable += POLL_INTERVAL_MS;
    }
  }
}

// Growth detection uses the max of broad and narrow selectors. The broad
// selector (a[href^="/chat/"]) catches any new chat anchors regardless of
// data-dd-action-name drift, but it also includes the iframe-rendered
// sidebar which overlaps with the recents grid. The narrow selector
// (conversation-cell) catches grid cells precisely but breaks if claude.ai
// drops the data attribute. Max-of-both is robust to either failure mode
// without committing to a single theory.
function countCellsForGrowth(doc) {
  return Math.max(countCellsNarrow(doc), countCellsBroad(doc));
}

function countCellsNarrow(doc) {
  return doc.querySelectorAll(SELECTORS.recentsConversationCell).length;
}

function countCellsBroad(doc) {
  return doc.querySelectorAll('a[href^="/chat/"]').length;
}

function findShowMoreButton(doc) {
  const buttons = doc.querySelectorAll('button');
  for (const b of buttons) {
    const text = (b.textContent || '').trim().toLowerCase();
    if (text === 'show more') return b;
  }
  return null;
}

function collectCells(doc) {
  const cells = doc.querySelectorAll(SELECTORS.recentsConversationCell);
  if (cells.length > 0) return cells;
  return doc.querySelectorAll('a[href^="/chat/"]');
}

function cellsToChats(cells) {
  const seen = new Set();
  const out = [];
  for (const a of cells) {
    const uuid = extractChatUuid(a.getAttribute('href'));
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    const title = (a.textContent || '').trim();
    if (!title) continue;
    out.push({ uuid, title });
  }
  return out;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
