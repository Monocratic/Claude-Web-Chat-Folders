import * as S from '../lib/storage.js';
import { SELECTORS, extractChatUuid } from '../lib/selectors.js';

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
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync() {
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
    emit({ phase: 'loading', count: 0 });
    const initialCount = await waitForInitialCells(iframe);
    emit({ phase: 'expanding', count: initialCount });
    const finalCount = await clickShowMoreUntilDone(iframe);
    emit({ phase: 'settling', count: finalCount });
    const cells = collectCells(iframe.contentDocument);
    const chats = cellsToChats(cells);
    if (chats.length === 0) {
      throw new Error('No chats found on /recents - claude.ai may have blocked iframe embedding or the selector drifted.');
    }
    const result = await S.setCachedChats(chats);
    emit({ phase: 'done', count: chats.length });
    return { count: chats.length, lastSyncedAt: result.lastSyncedAt };
  } catch (err) {
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
  let clicks = 0;
  let lastCount = collectCells(doc).length;
  emit({ phase: 'expanding', count: lastCount });

  while (clicks < SHOW_MORE_MAX_CLICKS) {
    const btn = findShowMoreButton(doc);
    if (!btn) break;

    const beforeCount = collectCells(doc).length;
    btn.click();
    clicks++;

    const newCount = await waitForGrowth(doc, beforeCount);
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
  return collectCells(doc).length;
}

async function waitForGrowth(doc, beforeCount) {
  const start = Date.now();
  let count = beforeCount;
  while (Date.now() - start < PER_CLICK_TIMEOUT_MS) {
    count = collectCells(doc).length;
    if (count > beforeCount) {
      const growStop = Date.now();
      while (Date.now() - growStop < PER_CLICK_PLATEAU_MS) {
        await sleep(POLL_INTERVAL_MS);
        const next = collectCells(doc).length;
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
  let last = collectCells(doc).length;
  let stable = 0;
  while (stable < SETTLE_DELAY_MS) {
    await sleep(POLL_INTERVAL_MS);
    const cur = collectCells(doc).length;
    if (cur !== last) {
      last = cur;
      stable = 0;
    } else {
      stable += POLL_INTERVAL_MS;
    }
  }
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
