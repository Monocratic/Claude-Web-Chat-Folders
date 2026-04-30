// Centralized claude.ai DOM selectors. When the site changes, fix this file.
// See docs/DOM-NOTES.md for the verified-working record and reconnaissance
// playbook.

export const SELECTORS = {
  // Primary anchor for sidebar chat rows. Defensive AND-condition: the URL
  // pattern and the Datadog action name both have to match. Either drifting
  // alone falls back to the URL-only selector below.
  chatAnchor: 'a[href^="/chat/"][data-dd-action-name="sidebar-chat-item"]',

  // Fallback if the Datadog attribute disappears. URL pattern alone.
  chatAnchorFallback: 'a[href^="/chat/"]',

  // Sidebar root. Single <nav> per page on claude.ai. MutationObserver target.
  sidebar: 'nav',

  // v0.2 references. Not used by the v0.1 content script. Documented here so
  // the v0.2 author lands on them without re-doing reconnaissance.
  projectAnchor: 'a[href^="/project/"][data-dd-action-name="project-cell"]',
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
