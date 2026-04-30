import { SELECTORS, extractChatUuid } from '../lib/selectors.js';

const SENTINEL_ATTR = 'data-cwcf-drag-attached';
let preemptionLogged = false;

// Called by main.js on each sweep. Walks claude.ai's chat anchors and
// attaches dragstart listeners that enrich the native anchor drag with a
// CWCF payload. Strip and panel drop handlers prefer the CWCF payload over
// the URL fallback, so this gives them richer source context (sourceContext,
// itemRef pre-parsed) without breaking the URL-fallback path.
export function attachListenersToAnchors() {
  const anchors = document.querySelectorAll(SELECTORS.chatAnchorFallback);
  for (const a of anchors) {
    if (a.hasAttribute(SENTINEL_ATTR)) continue;
    a.addEventListener('dragstart', onAnchorDragStart);
    a.setAttribute(SENTINEL_ATTR, 'true');
  }

  // Recon item 4 (drag conflict test) executed lazily on first attach. If
  // the test reveals claude.ai preempting native dragstart on chat anchors,
  // we log once and fall back to a visible drag handle injection (deferred
  // implementation; logged for v0.3 if it matters).
  if (!preemptionLogged && anchors.length > 0) {
    runDragPreemptionTest(anchors[0]);
    preemptionLogged = true;
  }
}

function onAnchorDragStart(e) {
  const anchor = e.currentTarget;
  const href = anchor.getAttribute('href');
  const uuid = extractChatUuid(href);
  if (!uuid) return;
  const itemRef = `chat:${uuid}`;
  try {
    e.dataTransfer.setData('application/x-cwcf-item', JSON.stringify({
      kind: 'chat',
      itemRef,
      sourceContext: 'claude-sidebar',
      sourceFolderId: null
    }));
    e.dataTransfer.effectAllowed = 'copyMove';
  } catch {
    // setData failures are silent; URL fallback in strip/panel still works.
  }
}

function runDragPreemptionTest(anchor) {
  let listenerFired = false;
  const probe = () => { listenerFired = true; };
  anchor.addEventListener('dragstart', probe);
  let event;
  try {
    event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
  } catch {
    anchor.removeEventListener('dragstart', probe);
    return;
  }
  anchor.removeEventListener('dragstart', probe);
  if (!listenerFired) {
    console.warn('[CWCF] drag listener probe did not fire on chat anchor; native DnD may be blocked. Drag-from-sidebar to strip/panel may not work in this browser/version.');
  } else if (event.defaultPrevented) {
    console.warn('[CWCF] dragstart on chat anchor was defaultPrevented by another listener. Native HTML5 drag may not initiate when user attempts a drag from claude.ai sidebar.');
  }
}
