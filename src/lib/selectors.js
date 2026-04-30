// Centralized claude.ai DOM selectors. When the site changes, fix this file.
// See docs/DOM-NOTES.md for the verified-working record and reconnaissance
// playbook.

export const SELECTORS = {
  // ---- v0.1 selectors (used by service worker for chat URL extraction) ----

  // Primary anchor for sidebar chat rows. Defensive AND-condition: the URL
  // pattern and the Datadog action name both have to match. Either drifting
  // alone falls back to the URL-only selector below.
  chatAnchor: 'a[href^="/chat/"][data-dd-action-name="sidebar-chat-item"]',

  // Fallback if the Datadog attribute disappears. URL pattern alone.
  chatAnchorFallback: 'a[href^="/chat/"]',

  // ---- v0.2 selectors (used by content script for navigation block split) ----

  // The page's single nav element. Sidebar root. In v0.2 this is also the
  // anchor for positioning the folder strip overlay (default mode) and the
  // folder panel overlay (organize mode). The overlay floats over <nav>
  // without modifying its DOM, so React re-renders do not strip our UI.
  navBlock: 'nav',

  // Same as navBlock; kept under the legacy name for any older code path
  // referencing this key. Newer v0.2 content script code should use navBlock.
  sidebar: 'nav',

  // The "New chat" button at the top of the sidebar nav, identified by its
  // Datadog action name. Used by v0.2 content script to find the boundary
  // of the always-visible top nav block (logo, sidebar collapse button,
  // "New chat" button, and the nav links beneath it). Anything below the
  // chat list section is what organize-mode overlay covers.
  newChatButton: '[data-dd-action-name="sidebar-new-item"]',

  // ---- v0.3 references (not used yet) ----

  // Project list anchors on the /projects page. v0.2 right-click context
  // menu is chat-only; v0.3 may extend to projects.
  projectAnchor: 'a[href^="/project/"][data-dd-action-name="project-cell"]',

  // /recents page conversation-cell anchors. Distinct from sidebar-chat-item
  // anchors (which also render on /recents because the sidebar persists
  // across navigation). v0.3 may extend right-click coverage to /recents.
  recentsConversationCell: 'a[href^="/chat/"][data-dd-action-name="conversation-cell"]'
};

export const URL_PATTERNS = {
  chat: /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  project: /^\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
};

export function extractChatUuid(href) {
  if (typeof href !== 'string') return null;
  const m = URL_PATTERNS.chat.exec(href);
  return m ? m[1].toLowerCase() : null;
}

export function extractProjectUuid(href) {
  if (typeof href !== 'string') return null;
  const m = URL_PATTERNS.project.exec(href);
  return m ? m[1].toLowerCase() : null;
}
