# claude.ai DOM Notes

This file tracks the DOM structure the content script depends on. Update every time a selector changes or a behavior is observed.

claude.ai is a React SPA. DOM changes without notice. When the inject button stops appearing or appears in the wrong place, look here first.

## Last verified working

- Date: TBD (populate on first content script reconnaissance)
- Browser: TBD (Vivaldi version, Chrome version)
- claude.ai version: N/A (no public version string)

When you update selectors, also update this section with the date and browser used to verify.

## Anchors we depend on

### Chat list links

```
a[href^="/chat/"]
```

Each chat in the sidebar is an anchor tag with `href` starting `/chat/`. The UUID is the path segment after `/chat/`. Example:

```html
<a href="/chat/abc12345-...-...">Cached chat title text</a>
```

This selector has been stable across multiple claude.ai redesigns because it is structural (link to a chat URL) rather than presentational. Do not replace it with a class-based selector unless the URL pattern itself changes.

UUID extraction: `href.match(/^\/chat\/([0-9a-f-]+)/i)` then validate against the standard 8-4-4-4-12 hex pattern via the regex in `storage.js`.

### Project list links

```
a[href^="/project/"]
```

To verify on first content script run. Anthropic's projects appear in their own sidebar section with URL pattern `/project/<uuid>`. UUID format assumed identical to chat UUIDs. If projects use a different ID shape, relax the validation regex in `storage.js` (currently `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`).

### Chat title text

TBD. The current best guess: `el.innerText` of the `<a>` element itself, or a child text node. We grab `innerText` defensively rather than depending on a specific child class. Verify on first content script run and document the actual structure here.

### Sidebar container

TBD. We anchor on the chat link selector itself and walk upward to find the row container suitable for inject button placement. Document the upward walk path here once verified (for example: "two `parentElement` hops to reach the row that contains hover backgrounds").

### Project section container (projects only)

TBD. To support project-specific behavior, we may need to detect the projects section as a separate scope from the chat section. Verify whether the sidebar groups them under distinct DOM containers.

## Selectors known to be unstable

Do not use these as anchors:

- Class names like `.flex`, `.items-center`, `.gap-2`, etc. These are Tailwind utility classes, present on hundreds of unrelated elements, and change without notice when claude.ai's design system updates.
- `data-testid` values that aren't on the chat or project list itself. Test IDs used inside individual chat rows tend to drift; only the structural list-level test IDs are reliable.
- Any selector that depends on SVG path data. Icons are redrawn with new paths when the design changes.
- ARIA attributes used as styling hooks. These are accessibility-driven and change when accessibility patterns change.

## Known DOM behaviors

To populate during reconnaissance and ongoing observation:

- Navigation between chats does NOT trigger a full page reload. The content script and observer survive navigation; selectors must be re-evaluated against the new DOM.
- Chat list items mount and unmount lazily as the user scrolls. The MutationObserver must handle late mounts; no reliance on a fixed initial DOM.
- New chats appear at the top of the list when created.
- The sidebar can be collapsed by the user. When collapsed, the chat list may stay in DOM with `display: none` or similar on a parent. Inject buttons on hidden rows are inert.
- Theme switching on claude.ai (light/dark/auto) changes class names on `<body>` or `<html>`. Inject button colors should read on both light and dark backgrounds without depending on claude.ai's class names.
- Page-level navigation away from claude.ai (closing the tab, navigating to another origin) tears down everything. No cleanup needed beyond what the browser handles.
- bfcache restore (back/forward navigation) freezes JS execution but does not tear down observers. Re-run the initial sweep on the `pageshow` event to catch DOM diffs that happened during the freeze.

## Inject button placement strategy

To populate after first reconnaissance:

- Where on the row does the button live? Right edge, left edge, or hover-only-overlay?
- What sentinel attribute keeps re-injection idempotent? Current plan: `data-cwcf-injected="true"` on the row container.
- How does the button avoid layout shift when added? Reserve space, or use absolute positioning.
- How does the button visually belong to the row without fighting claude.ai's hover styles?

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
