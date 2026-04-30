import * as S from '../lib/storage.js';
import { SELECTORS, extractChatUuid } from '../lib/selectors.js';

let inFlight = null;

// Loads claude.ai's /recents page in a hidden same-origin iframe, polls for
// conversation cells to render, scrapes all chat UUIDs and titles, and writes
// them to chatCache. claude.ai is React-rendered so the cells appear after
// the iframe's load event; we poll up to SCAN_TIMEOUT_MS waiting for at least
// one cell, then accept whatever count is present at SETTLE_DELAY_MS after
// the count last grew.
const SCAN_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 250;
const SETTLE_DELAY_MS = 1_500;

export async function runSync() {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync() {
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
    const chats = await scanIframeForChats(iframe);
    if (chats.length === 0) {
      throw new Error('No chats found on /recents - claude.ai may have blocked iframe embedding or the selector drifted.');
    }
    const result = await S.setCachedChats(chats);
    return { count: chats.length, lastSyncedAt: result.lastSyncedAt };
  } finally {
    iframe.remove();
  }
}

function waitForIframeReady(iframe) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Iframe load timeout')), SCAN_TIMEOUT_MS);
    iframe.addEventListener('load', () => {
      clearTimeout(timer);
      // Same-origin guard: accessing contentDocument throws on cross-origin.
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

async function scanIframeForChats(iframe) {
  const doc = iframe.contentDocument;
  const start = Date.now();
  let lastCount = 0;
  let lastGrowAt = Date.now();

  while (Date.now() - start < SCAN_TIMEOUT_MS) {
    const cells = collectCells(doc);
    if (cells.length !== lastCount) {
      lastCount = cells.length;
      lastGrowAt = Date.now();
    }
    if (cells.length > 0 && Date.now() - lastGrowAt >= SETTLE_DELAY_MS) {
      return cellsToChats(cells);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // Timed out while still seeing growth or never seeing any cells.
  const cells = collectCells(doc);
  return cellsToChats(cells);
}

function collectCells(doc) {
  // Prefer the /recents-specific conversation-cell selector; fall back to any
  // /chat/ anchor in case claude.ai drops the data attribute.
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
