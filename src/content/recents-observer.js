import * as S from '../lib/storage.js';
import { SELECTORS, extractChatUuid } from '../lib/selectors.js';

// Runs whenever the user is on /recents. Watches the page for new
// conversation-cell anchors as they render (initial load + scroll +
// "Show more" clicks) and incrementally writes them to chatCache via
// the additive appendCachedChats storage method.
//
// Pure DOM observation; no API calls, no triggered navigation. The
// sync button (commit 3) just navigates to /recents and lets this
// observer do the work.

const SWEEP_DEBOUNCE_MS = 300;
const PASSIVE_PATH = '/recents';

let observer = null;
let mountedDoc = null;
let sweepTimer = null;
let lastBatchKey = '';

export function start() {
  if (observer) return;
  if (window.location.pathname !== PASSIVE_PATH) return;

  mountedDoc = document;
  scheduleSweep();

  observer = new MutationObserver(() => scheduleSweep());
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

export function stop() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
  mountedDoc = null;
  lastBatchKey = '';
}

export function isRunning() {
  return !!observer;
}

function scheduleSweep() {
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    runSweep().catch(err => console.error('[CWCF recents] sweep failed', err));
  }, SWEEP_DEBOUNCE_MS);
}

async function runSweep() {
  if (!mountedDoc) return;
  const cells = collectCells(mountedDoc);
  if (cells.length === 0) return;

  // Skip the storage write if nothing has changed since last sweep.
  // Cheap dedupe: hash the sorted-uuid+title concatenation.
  const batchKey = cellsToKey(cells);
  if (batchKey === lastBatchKey) return;
  lastBatchKey = batchKey;

  const chats = cellsToChats(cells);
  if (chats.length === 0) return;

  await S.appendCachedChats(chats);
}

function collectCells(doc) {
  // Prefer the recents-specific data attribute. Fall back to broad chat
  // anchors if the attribute drifts. The /recents grid is in main, so
  // we'd ideally scope to that container — but the broad selector also
  // matches sidebar anchors, which is fine because sidebar-only anchors
  // are already covered by the panel's existing union logic and the
  // dedupe in extraction means duplicates are harmless.
  const narrow = doc.querySelectorAll(SELECTORS.recentsConversationCell);
  if (narrow.length > 0) return narrow;
  return doc.querySelectorAll('a[href^="/chat/"]');
}

function cellsToKey(cells) {
  const parts = [];
  for (const a of cells) {
    const uuid = extractChatUuid(a.getAttribute('href'));
    if (!uuid) continue;
    const title = (a.textContent || '').trim();
    parts.push(`${uuid}|${title}`);
  }
  parts.sort();
  return parts.join('\n');
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
