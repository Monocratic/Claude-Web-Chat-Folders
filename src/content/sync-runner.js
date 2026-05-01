// Runs on /recents when the autosync trigger is set. The panel sync button
// writes sessionStorage 'cwcf:autosync' before navigating; we read and
// clear it here. SessionStorage survives same-tab navigation but is not
// touched by claude.ai's SPA router (URL hashes proved unreliable — the
// router strips them on route mount before our content script reads them).
//
// Auto-clicks the "Show more" button to exhaustion so the recents
// observer (running in parallel) captures every chat into chatCache. A
// small overlay reports progress; dismisses itself when done.

const SHOW_MORE_INTERVAL_MS = 600;
const SHOW_MORE_MAX_CLICKS = 80;
const PER_CLICK_TIMEOUT_MS = 6_000;
const POLL_INTERVAL_MS = 250;
const SETTLE_DELAY_MS = 1_500;
const TRIGGER_KEY = 'cwcf:autosync';

const DEBUG = true;
const log = (...args) => { if (DEBUG) console.log('[CWCF sync-runner]', ...args); };

let started = false;

export async function start() {
  let trigger = null;
  try { trigger = sessionStorage.getItem(TRIGGER_KEY); } catch {}
  log('start() entered', {
    started,
    path: window.location.pathname,
    hash: window.location.hash,
    sessionStorageTrigger: trigger
  });
  if (started) return;
  if (window.location.pathname !== '/recents') return;
  if (trigger !== '1') return;
  started = true;

  // Clear the trigger immediately so a manual /recents refresh doesn't
  // re-run autosync. The user can click sync in the panel again to retrigger.
  try { sessionStorage.removeItem(TRIGGER_KEY); } catch {}
  log('trigger consumed, starting auto-click loop');

  const overlay = mountOverlay();
  let finalCount = 0;
  try {
    finalCount = await runShowMoreLoop(overlay);
    overlay.setMessage(`Loaded ${finalCount} chats`, 'success');
    setTimeout(() => overlay.dismiss(), 1500);
  } catch (err) {
    console.error('[CWCF sync-runner] failed', err);
    overlay.setMessage(`Sync failed: ${err.message || err}`, 'error');
    setTimeout(() => overlay.dismiss(), 5000);
  }
}

async function runShowMoreLoop(overlay) {
  let clicks = 0;
  let lastCount = countCells();
  overlay.setMessage(`Loaded ${lastCount} chats — looking for more…`, 'progress');

  while (clicks < SHOW_MORE_MAX_CLICKS) {
    const btn = findShowMoreButton();
    if (!btn) break;

    const before = countCells();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    clicks++;

    const after = await waitForGrowth(before);
    if (after > lastCount) {
      lastCount = after;
      overlay.setMessage(`Loaded ${lastCount} chats — looking for more…`, 'progress');
    }
    if (after === before) break;
    await sleep(SHOW_MORE_INTERVAL_MS);
  }

  await waitForSettle();
  return countCells();
}

async function waitForGrowth(before) {
  const start = Date.now();
  while (Date.now() - start < PER_CLICK_TIMEOUT_MS) {
    const cur = countCells();
    if (cur > before) return cur;
    await sleep(POLL_INTERVAL_MS);
  }
  return countCells();
}

async function waitForSettle() {
  let last = countCells();
  let stable = 0;
  while (stable < SETTLE_DELAY_MS) {
    await sleep(POLL_INTERVAL_MS);
    const cur = countCells();
    if (cur !== last) { last = cur; stable = 0; }
    else stable += POLL_INTERVAL_MS;
  }
}

function findShowMoreButton() {
  const buttons = document.querySelectorAll('button');
  for (const b of buttons) {
    const text = (b.textContent || '').trim().toLowerCase();
    // Substring match — earlier diagnostic surfaced that strict equality
    // breaks on extra whitespace, sr-only suffixes, or wrapping spans.
    if (text.includes('show more')) return b;
  }
  return null;
}

function countCells() {
  // Broad selector: covers any /chat/ anchor on the page. Sidebar and grid
  // overlap by uuid, but for growth tracking we just need a number that
  // increases when Show more works. Storage layer dedupes by uuid.
  return document.querySelectorAll('a[href^="/chat/"]').length;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mountOverlay() {
  const wrap = document.createElement('div');
  wrap.className = 'cwcf-sync-runner-overlay cwcf-sync-runner-overlay--progress';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');

  const msg = document.createElement('span');
  msg.className = 'cwcf-sync-runner-overlay__msg';
  msg.textContent = 'Loading chats…';
  wrap.appendChild(msg);

  document.body.appendChild(wrap);

  return {
    setMessage(text, kind) {
      msg.textContent = text;
      wrap.classList.remove(
        'cwcf-sync-runner-overlay--progress',
        'cwcf-sync-runner-overlay--success',
        'cwcf-sync-runner-overlay--error'
      );
      wrap.classList.add(`cwcf-sync-runner-overlay--${kind}`);
    },
    dismiss() {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
  };
}
