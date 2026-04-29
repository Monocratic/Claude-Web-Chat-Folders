# claude.ai DOM Notes

This file tracks the DOM structure the content script depends on. Update every time a selector changes or a behavior is observed.

claude.ai is a React SPA. DOM changes without notice. When the inject button stops appearing or appears in the wrong place, look here first.

## Last verified working

- Date: 2026-04-29
- Browser: Brave (primary dev target alongside Vivaldi)
- claude.ai version: current (no public version string)

When you update selectors, also update this section with the date and browser used to verify.

## Anchors we depend on

### Chat list links (sidebar)

Primary anchor with defensive AND-condition:

```
a[href^="/chat/"][data-dd-action-name="sidebar-chat-item"]
```

Fallback if the Datadog attribute drifts:

```
a[href^="/chat/"]
```

The Datadog `data-dd-action-name` attribute is set for the platform's analytics. It has been stable, and we use it as a secondary anchor on top of the URL pattern so the selector survives either side changing alone. The fallback URL-only selector is what `selectors.js` uses if the Datadog attribute disappears.

Each anchor is the row itself in the sidebar. No wrapper div carries the row semantics; the `<a>` is `position: relative` with `display: inline-flex`, and its children are the title text and (after our injection) the inject button.

UUID extraction: `href.match(/^\/chat\/([0-9a-f-]+)/i)` then validate against the standard 8-4-4-4-12 hex pattern via the regex in `storage.js`. Chat UUIDs in observed accounts are UUIDv7; the validation regex is hex-only and does not care about version.

### Chat title text

The chat title is rendered in a `<span>` inside the anchor's child `<div>`. We read `anchor.innerText.trim()` defensively rather than depending on the specific child class. The trim handles incidental whitespace from React's rendering.

### Sidebar container

The sidebar root is the page's `<nav>` element. There is one `<nav>` per page on claude.ai and it persists across SPA navigation between chats.

```js
const sidebar = document.querySelector('nav');
```

This is the MutationObserver target. Observe with `{ childList: true, subtree: true }`. Subtree because chat rows mount as `<li>` children of `<ul>` children of various sections inside the nav.

Sidebar `<nav>` classes (current, do not anchor on these): `flex flex-col px-0 fixed left-0 border-r-0.5 h-screen lg:bg-gradient-to-t from-b...` (Tailwind utility classes, will change).

### Datadog action names in the sidebar

These are the four observed `data-dd-action-name` values inside the sidebar:

- `sidebar-chat-item` - chat anchors (our v0.1 target)
- `sidebar-more-item` - the "All chats" button at the bottom of the chat list (links to `/recents`)
- `sidebar-nav-item` - top-level nav links (Recents, Projects, etc.)
- `sidebar-new-item` - the "New chat" button

The `sidebar-` prefix is consistent. Datadog action names are likely the most stable anchor surface in the sidebar because Anthropic's analytics dashboards depend on them.

## Selectors known to be unstable

Do not use these as anchors:

- Class names like `.flex`, `.items-center`, `.gap-2`, etc. These are Tailwind utility classes, present on hundreds of unrelated elements, and change without notice when claude.ai's design system updates.
- `data-testid` values that aren't on the chat or project list itself. Test IDs used inside individual chat rows tend to drift; only the structural list-level test IDs are reliable.
- Any selector that depends on SVG path data. Icons are redrawn with new paths when the design changes.
- ARIA attributes used as styling hooks. These are accessibility-driven and change when accessibility patterns change.

## Known DOM behaviors

- Navigation between chats does NOT trigger a full page reload. The content script and observer survive navigation. The sidebar `<nav>` element persists across navigation; selectors must be re-evaluated when new rows mount but the nav itself is the stable observer target.
- The sidebar shows a fixed window of recent chats (47 in the recon account, total varies per account). Older chats are not lazy-mounted into the sidebar via scroll. They live on a separate `/recents` page accessed via the "All chats" button at the bottom of the sidebar (the button with `data-dd-action-name="sidebar-more-item"`). v0.1 covers sidebar chats only; the `/recents` page is a v0.2 surface (see section below).
- New chats appear at the top of the sidebar list when created. The MutationObserver picks them up on insertion and runs the injection sweep.
- Chat anchors carry a `group` Tailwind class. Tailwind's group pattern means children styled with `group-hover:` activate on parent hover. Our inject button relies on the anchor's `:hover` and `:focus-within` directly (not group-hover) since the button is an injected child and we want to keep the styling self-contained.
- The sidebar can be collapsed by the user. When collapsed, the chat list may stay in DOM with `display: none` or similar on a parent. Inject buttons on hidden rows are inert.
- Theme switching on claude.ai (light/dark/auto) changes class names on `<body>` or `<html>`. Inject button colors should read on both light and dark backgrounds without depending on claude.ai's class names. Use the user's extension theme accent color, not claude.ai's theme.
- Page-level navigation away from claude.ai (closing the tab, navigating to another origin) tears down everything. No cleanup needed beyond what the browser handles.
- bfcache restore (back/forward navigation) freezes JS execution but does not tear down observers. Re-run the initial sweep on the `pageshow` event to catch DOM diffs that happened during the freeze.

## Inject button placement strategy

The chat anchor `<a>` is `position: relative` natively, so we can append an absolutely-positioned button as a child without any wrapper changes. The button floats over the right edge of the anchor and does not affect layout flow.

```html
<a class="... group relative inline-flex"
   data-cwcf-injected="true"
   data-dd-action-name="sidebar-chat-item"
   href="/chat/...">
  <div class="...">
    <span>{title}</span>
  </div>
  <button class="cwcf-inject-btn"
          data-cwcf-button="true"
          aria-label="Add chat to folder"
          aria-haspopup="menu">
    <svg>...</svg>
  </button>
</a>
```

Sentinel attribute: `data-cwcf-injected="true"` on the anchor itself. The observer skips anchors that already have this attribute. Idempotent on re-render.

Visibility: the button is hidden by default (`opacity: 0`) and revealed on the anchor's `:hover` or `:focus-within`. Always-visible mode is governed by the `injectButtonStyle` setting (`dot` / `icon` / `pill`) and `injectButtonPosition` (`right` / `left` / `hoverOnly`). The hover-only mode matches claude.ai's existing convention of revealing per-row affordances on hover.

Click handling on the inject button:

```js
button.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  togglePopover(button, itemRef);
});
```

Both `preventDefault` (to stop the anchor's navigation) and `stopPropagation` (to stop the click reaching any anchor handler) are required because the button is a child of the anchor.

### Folder assignment popover

The mini-menu opened by the inject button is a popover, not a `<dialog>`. Reasoning: a modal blocks the entire page for what should be a quick "click button → pick folder → done" interaction. A popover lets the user keep scrolling and feels native to the sidebar UX.

Implementation:

- Absolutely-positioned `<div class="cwcf-popover">`, appended to `<body>` (not to the anchor or sidebar). Appending to body lets the popover extend beyond the sidebar's bounds and escape any `overflow: hidden` clipping on ancestors.
- Position computed from the inject button's `getBoundingClientRect()`. Default placement to the right of the button. Edge-collision flips to the left if it would overflow viewport.
- Click-outside listener on `document` (capturing phase) closes it. Listener self-removes on close.
- `Escape` key closes it. `Tab` cycles through the folder buttons. `Enter`/`Space` activates the focused folder.
- Renders the folder list as buttons with checkboxes (multi-folder per chat per locked spec). Click toggles assignment via `assignItemToFolder` / `removeItemFromFolder`.
- Empty state: "No folders yet. Create one in the popup." with a non-functional button (no `chrome.action.openPopup` permission in v0.1; acceptable degradation).
- No "Create folder" affordance inline. v0.2 can add it. v0.1 sends the user to the toolbar popup for that.
- `z-index: 2147483647` (max int) so the popover renders above any claude.ai UI element. If claude.ai uses similar nuclear values somewhere we will see it during testing.

ARIA:

- Inject button: `aria-label`, `aria-haspopup="menu"`, `aria-expanded` toggled.
- Popover: `role="menu"`. Focus moves to the first folder button on open and returns to the inject button on close.

## When something breaks

Steps to investigate when the extension stops injecting buttons or injects them in the wrong place:

1. Open DevTools on claude.ai. Console tab.
2. Run:
   ```js
   document.querySelectorAll('a[href^="/chat/"]').length
   ```
   If zero, claude.ai changed the URL pattern. The fix is in `selectors.js`.
3. Run:
   ```js
   [...document.querySelectorAll('[data-testid]')]
     .map(el => el.getAttribute('data-testid'))
     .filter((v, i, a) => a.indexOf(v) === i)
     .sort()
   ```
   This dumps every unique `data-testid` currently in the DOM. Useful when looking for a stable structural anchor we can adopt.
4. Pick a chat row in the Elements panel. Walk up the parents and identify a stable structural pattern (URL-based, role-based, or test-id-based). Avoid Tailwind class names.
5. Update `src/lib/selectors.js` with the new anchor.
6. Update this file with the new anchor and the date verified.
7. Run the popup smoke test again to confirm nothing else regressed.

## When something is unclear

When in doubt about whether a selector is stable, prefer the more structural choice. Anchor on URL patterns first. Then `data-testid` values that name structural concerns ("sidebar", "chat-list-item"). Then ARIA roles. Class names absolute last resort.

## All chats page (v0.2 reference, not implemented in v0.1)

The sidebar shows a fixed window of recent chats. Older chats live on a separate "All chats" page reached via the `sidebar-more-item` button at the bottom of the sidebar.

### URL pattern

```
https://claude.ai/recents
```

### Anchor on /recents

Chat anchors on `/recents` carry a different Datadog action name than sidebar anchors:

```
a[href^="/chat/"][data-dd-action-name="conversation-cell"]
```

The same chat URL pattern (`/chat/<uuid>`) but the cell attribute differs from the sidebar's `sidebar-chat-item`. The sidebar still renders on `/recents` (the `<nav>` persists across navigation), so a query for `a[href^="/chat/"]` on `/recents` returns both `sidebar-chat-item` rows and `conversation-cell` cards. v0.2 selectors must distinguish them via the Datadog attribute.

### Recon sample

In the dev account, `/recents` listed 77 total chat anchors, of which 47 were the `sidebar-chat-item` rows (the same sidebar that renders on every page) and the remainder were `conversation-cell` cards specific to `/recents`.

### Implementation notes for v0.2

- **Cell DOM structure not fully captured.** The recon hit a tangent before the `conversation-cell` outerHTML was logged. v0.2 must re-verify cell dimensions, structure, and the title text location before designing the inject button placement on cards.
- **Likely card layout, not row layout.** Cells on `/recents` appear to be cards in a grid, not thin sidebar rows. The inject button absolute-position-right-edge pattern that works for sidebar rows may need adaptation for cards (different size, different hover semantics).
- **Route detection.** The content script needs to know when the user is on `/recents`. Wrap `history.pushState`/`replaceState` to fire a custom event, or listen to `popstate` plus check `location.pathname`. The `<nav>` MutationObserver alone will not catch main-content area changes.
- **Separate observer target.** Add a second observer scoped to the main content area on `/recents`. The sidebar observer keeps doing its job; the content observer handles cards on this page.
- **v0.1 user workaround for chats not in sidebar.** Pin the chat (Star button on claude.ai) so it appears in the sidebar's Starred section, assign to folder via the inject button, then unpin. Awkward but workable until v0.2 ships.

## Project list (v0.2 reference, not implemented in v0.1)

Projects are deferred to v0.2. The recon below was captured during the v0.1 content script reconnaissance and is preserved here so the v0.2 implementation does not have to re-discover it. Storage already accepts `project:<uuid>` typed item refs, so adding projects later is purely additive content script work.

### URL pattern

- Listing page: `https://claude.ai/projects` (plural)
- Individual project: `https://claude.ai/project/<uuid>` (singular)

Projects do not appear in the main sidebar with chats. They are accessed via the `/projects` listing page or by direct URL.

### Project cell anchor on the listing page

```
a[href^="/project/"][data-dd-action-name="project-cell"]
```

Defensive AND-condition. If either the URL pattern or the Datadog action name drifts, the other still anchors us.

### UUID format

Projects use UUIDv7 (the third group's leading hex digit is `7`). The existing storage validation regex (`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`) is hex-only and does not care about UUID version, so it matches without changes.

### Project cell text structure

`innerText` is two lines:

```
{title}
Updated {N} days ago
```

Cached `itemTitle` should be the first line only, split on `\n`.

### Implementation notes for v0.2

- **Route detection.** The content script needs to know when the user is on `/projects`. Wrap `history.pushState` and `history.replaceState` to fire a custom event, or listen to `popstate` plus check `location.pathname`. The MutationObserver alone will not help if the route changes within the SPA without a DOM-visible trigger near the top of the tree.
- **Separate observer target.** Inject targets on `/projects` are project cards in a grid, not sidebar rows. Different selector chain, different observer target than the chat sidebar.
- **No in-project inject target yet.** The individual project view at `/project/<uuid>` does not have an obvious place for the inject button. A project-header button or a popup-side "open in folder" affordance would need a separate design pass. Defer until requested.
- **Recon sample.** Five-project sample on the dev account confirmed the pattern. UUIDv7 across all five.
