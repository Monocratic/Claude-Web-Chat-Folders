# Architecture

This document captures the design decisions for Claude Web Chat Folders. It exists so future contributors (including future-you and a fresh Claude session) can pick up the codebase without re-litigating settled questions.

## Goals

Add folder organization to claude.ai chats. Local storage only. JSON export/import for portability. No backend, no API access, no telemetry.

UI surfaces (v0.2):
1. **Toolbar popup** - folder CRUD, settings, import/export, nested-tree view of folders, drag-reorder within sections. Retained from v0.1; redundant with the in-page settings overlay but kept for users who prefer popup workflow.
2. **In-page folder strip (default view mode)** - thin vertical overlay on claude.ai's left edge showing pinned folders as drop targets. Content-script-driven, fixed-position, anchored to the right of `<nav>`.
3. **In-page folder panel (organize view mode)** - full folder tree overlay over claude.ai's sidebar with search, drag-and-drop, nested folders, auto-organize, sync, and the Unsorted union. Content-script-driven, fixed-position, anchored to claude.ai's `<nav>` rect.
4. **In-page settings overlay** - cog buttons on strip and panel open a modal with Appearance / View / Auto-organize / Folders / Behavior / Data sections. Replaces the v0.1 popup-tab fallback (Brave Shields blocked it) and now mirrors the popup's full settings surface.
5. **Folder editor modal** - styled in-page modal for create and edit of folders, replacing the prompt-based `+` button.
6. **In-page right-click menus** - one for chat anchors (Add to folder, Open in new tab, Remove from folder), one for folder rows in the panel (Edit, Pin, Add child, Delete). Replaces the v0.1 `chrome.contextMenus` registration; both menus are styled CWCF surfaces driven by content-script `contextmenu` listeners.

The view mode (`default` vs `organize`) is a per-device setting persisted in `chrome.storage.local`. Toggle buttons in both the strip and the panel flip the setting; subscribeToChanges propagates the change to all open claude.ai tabs.

## Non-goals (v0.1)

- Cross-device sync via cloud backend. JSON export/import covers portability.
- Talking to Anthropic's API.
- Reading or modifying chat content.
- Replacing or restyling claude.ai's sidebar. That real estate belongs to Anthropic and any UI we put inside it would break on every redesign.
- Supporting non-Chromium browsers. Firefox would need MV2/MV3 porting work.

## Storage

`chrome.storage.local` only. 10 MB quota, ample for folder metadata at any reasonable scale.

We do not use `chrome.storage.sync`. Vivaldi (the primary target) does not sync extension data through Google's servers, so calling sync APIs there silently degrades to local-only behavior with worse quotas (100 KB total, 8 KB per item). JSON export/import handles cross-device portability instead.

The full state lives under a single key (`cwcf_data`). Atomic updates, no multi-key race conditions.

### Two-promise write queue

All mutating operations route through `enqueueWrite` in `src/lib/storage.js`:

```js
let writeQueue = Promise.resolve();
function enqueueWrite(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.catch(() => {});
  return result;
}
```

The two-promise pattern matters. `result` is what the caller awaits and sees rejections. `writeQueue` is the chain that survives rejection (via the swallowed `.catch`) so subsequent writes don't inherit a rejected state. A naive single-promise pattern would either swallow all errors or break the chain on first failure.

The popup mirrors this pattern with its own `settingsQueue` for rapid setting toggles.

### Schema versioning

The state has a top-level `version` field. Current value: `1`. Future migrations live in `migrateIfNeeded` and walk forward (v1 to v2, v2 to v3, etc).

On import, an export with `version` greater than the current schema is rejected with a clear error. Exports with the current version pass through. There is no v0 migration code because there are no v0 users.

## Schema (v2)

```
{
  version: 2,
  folders: [
    {
      id: "f_<uuid>",
      name: string,                 // 1-64 chars
      color: "#RRGGBB",
      createdAt: number,            // ms epoch
      pinned: boolean,
      sortOrder: number,
      icon: string | null,          // single grapheme cluster, must be Extended_Pictographic
      description: string | null,   // up to 280 chars
      lastUsedAt: number | null,    // ms epoch, populated by future v0.2 UI
      parentId: string | null,      // v0.2: id of parent folder, or null for root
      collapsed: boolean,           // v0.2: panel expand/collapse state, default false
      autoAssignKeywords: string[]  // v0.2: schema-introduced for v0.3 keyword rules; unused in v0.2
    }
  ],
  assignments: {
    "<type>:<uuid>": [folderId, ...]
  },
  itemTitles: {
    "<type>:<uuid>": string
  },
  settings: { ... },
  lastModified: number
}
```

### Migration v1 → v2

v0.2 introduces nested folders via `parentId`, persistent expand/collapse via `collapsed`, and a future-use `autoAssignKeywords` field, plus four new settings (`viewMode`, `stripCap`, `stripOverflowBehavior`, `autoOrganizeMatchMode`). Migration is additive and idempotent: existing folders get `parentId: null` (all root), existing settings get default values for new fields, no data is dropped. `migrateV1ToV2` in `storage.js` handles the walk-forward; running it twice on the same v1 state produces the same v2 state.

### Typed item refs

Assignments key on `<type>:<uuid>` strings where `type` is `chat` or `project`. This lets a single folder hold both chats (URL pattern `claude.ai/chat/<uuid>`) and projects (URL pattern `claude.ai/project/<uuid>`).

The original design used bare UUIDs. The typed prefix was added before any user data existed so no migration is needed. `parseItemRef(ref)` and `formatItemRef(type, uuid)` in `storage.js` are the canonical constructors. Validation regex enforces the format on every public API entry point.

Multi-folder per item is supported. Folders are tags, not directories.

### Assignments map shape

`assignments` is keyed by item ref, not by folder. Looking up "what folders is this chat in" is O(1). Looking up "what items are in this folder" requires scanning the assignments map but is acceptable for v0.1 scale.

`itemTitles` is a separate cache keyed the same way. Title freshness is best-effort and refreshed on every content script sweep (when that surface lands).

### Settings fields

```
defaultFolderColor: "#RRGGBB"
activeTheme: string                    // preset id
customTheme: { tokenName: hex, ... }   // overrides applied on top of active preset
density: "comfortable" | "compact"     // v0.2 UI
reduceMotion: boolean                  // v0.2 UI; CSS already honors prefers-reduced-motion
showChatCounts: boolean                // count badges on folders in popup
quickAssignFolderId: string | null     // self-heals if folder no longer exists; v0.2 candidate for top-level context menu shortcut
autoBackup: "off" | "daily" | "weekly" // v0.2 UI; no chrome.downloads permission for v0.1
confirmFolderDelete: boolean
recentColors: string[]                 // capped at 8, MRU
recentEmojis: string[]                 // capped at 16, MRU
searchEnabled: boolean
viewMode: "default" | "organize"       // v0.2: which content-script surface is active
stripCap: number                       // v0.2: integer 1-50, user-preferred max swatches in strip
stripOverflowBehavior: "indicator" | "scroll"  // v0.2: how strip handles too-many pinned folders
autoOrganizeMatchMode: "exact" | "contains"    // v0.2: name-match strictness for auto-organize
```

The earlier settings list included `showInjectButtons`, `injectButtonStyle`, `injectButtonPosition`, and `showFolderDots`. Those were removed in the post-pivot cleanup since the inject button surface they governed no longer exists. Pre-release means no installed users had data referencing those keys.

Settings are device-local. They are not exported or imported. Both `replace` and `merge` import modes preserve the importing device's existing settings.

## Theme system

Three layers, highest priority first:

1. `customTheme` - per-token overrides set by the user.
2. `activeTheme` - the named preset selected by the user.
3. Built-in default - the `neon-purple` preset, used when `activeTheme` is null or unrecognized.

`resolveTheme(activeThemeId, customTheme)` in `src/lib/themes.js` returns the merged token map. `applyTheme(tokens, target)` writes them as CSS custom properties on `:root` via inline style.

### Brand-color tokens (15)

```
Backgrounds: --bg-primary, --bg-secondary, --bg-tertiary, --bg-elevated
Borders:     --border-subtle, --border-default, --border-focus
Text:        --text-primary, --text-secondary, --text-tertiary
Accents:     --accent-primary, --accent-secondary, --accent-danger,
             --accent-warning, --accent-success
Component:   --inject-button-bg, --inject-button-text
```

(17 by name including the two component-specific tokens; the locked spec calls out 15 brand colors plus 2 inject-button tokens.)

### Layout tokens (not themed)

`--radius-sm/md/lg`, `--space-1` through `--space-6`, `--shadow-elevated`, `--transition-fast`, `--font-stack` live alongside the brand tokens on `:root` but are not part of the preset contract. Spacing and radii are layout decisions, not branding. Allowing presets to override them would let preset authors break layout. If a future v0.2 preset genuinely needs different sizing, that is a schema expansion (more locked token names per preset), not a per-preset override.

### Presets shipped in v0.1

| ID | Status |
|---|---|
| `neon-purple` | Final, default |
| `solarized-dark` | Final (canonical Schoonover palette) |
| `vscode-dark` | Stub. Final palette TBD. |
| `claude-warm` | Stub. Final palette TBD. |
| `high-contrast` | Stub. Final palette TBD. WCAG AAA target. |

Stubs are functional and visually distinguishable but the exact hex values are placeholders.

## UI surfaces

### Popup

`src/popup/`. Three views switched via `data-view` attribute on `#app`:

- `folders` - list with pinned section, search, create button.
- `folder-detail` - header with edit and delete buttons, item list, empty state.
- `settings` - theme selector, default color, chat-count toggle, quick-assign target, confirm-on-delete, export, import, storage usage.

Three native `<dialog>` elements for modals: folder edit (shared between create and edit modes), emoji picker, generic confirm/choice. `showChoice(message, choices)` builds buttons dynamically per call so the same dialog serves two-button confirms and three-button choices (used by the import flow).

Module split:

```
popup.js              entry, init, theme application, top-level events
popup-shared.js       state, refs, view nav, toast, showChoice/showConfirm
popup-folders.js      list rendering, search filter, drag-reorder, detail view
popup-modals.js       folder edit modal, color picker, emoji picker
popup-settings.js     settings panel, export/import, storage usage
```

The popup does not depend on claude.ai's DOM. It is fully testable in isolation.

### Browser context menu

Per-chat assignment is handled through `chrome.contextMenus`. Right-clicking a chat link on claude.ai shows an "Add chat to folder" submenu with the user's folders (pinned first, then by `sortOrder`), each as a clickable item. A trailing "Manage folders…" item opens the popup. With no folders yet, a single "No folders yet — click to manage" item opens the popup directly.

The menu is registered and refreshed by `src/background.js`. Menu items are filtered to claude.ai chat links only via `documentUrlPatterns: ["https://claude.ai/*"]` and `targetUrlPatterns: ["https://claude.ai/chat/*"]`.

This surface has zero DOM dependency on claude.ai. Anthropic can redesign the sidebar at any time and the assignment path keeps working because we never touch the rendered page.

### Service worker

`src/background.js`. Minimal scope: register the context menu on `chrome.runtime.onInstalled` and `onStartup`, refresh the menu (debounced 200 ms) when folders change via `chrome.storage.onChanged`, handle `chrome.contextMenus.onClicked` by parsing the chat UUID from `info.linkUrl` and calling the storage API.

The service worker imports `storage.js` and `selectors.js` directly via static ES module imports. MV3 service workers support modules natively when the manifest declares `"type": "module"`, unlike content scripts. The service worker is event-driven; it suspends between events and re-runs the entry script on wake. Top-level `addListener` calls register listeners that survive suspension.

### What we do not do

We do not replace claude.ai's sidebar. We do not restyle it. We do not fetch chat data from Anthropic's API. We do not modify chat content. We do not run a content script on claude.ai pages. The only data we read about a chat is the UUID extracted from a URL the user right-clicked.

## v0.1 architecture pivot history

An earlier iteration of v0.1 attempted a per-chat-row inject button (a small folder icon appearing on hover at the right edge of each chat anchor) plus an in-page popover. That work landed in commits `ae6d69c` through `e636869`. Live testing on claude.ai surfaced an unsolvable real-estate conflict: claude.ai already renders its own three-dot context menu at the right edge of every chat row, with no usable padding on the left edge either. The inject button overlapped Anthropic's existing UI and lost mouse events to it.

Brief market check: NavVault ships a right-click-context-menu pattern, validating that approach. Easy Folders, AI Chat Organizer, and ChatFoldr ship various sidebar-augmenting patterns with mixed approaches. The market is not converged on any single pattern. We picked context-menu because it was the smallest pivot that solved the actual problem (per-chat assignment) and had the cleanest breakage story (zero claude.ai DOM dependency).

The content script files (`src/content/content.js`, `main.js`, `content.css`) were removed in the pivot commit. The selectors module (`src/lib/selectors.js`) survives because the URL extraction helpers are still used by the service worker. The popup, storage, theme system, and tests are unchanged.

## Cross-surface sync

`chrome.storage.onChanged` is the broadcast channel. Three subscribers in v0.1:

- The popup subscribes via `subscribeToChanges(cb)` exported from `storage.js`. Any mutation re-renders the popup's open view.
- The service worker subscribes for the same reason: when folders change, the context menu must rebuild. The rebuild is debounced 200 ms to avoid thrashing on bulk operations.
- (No content script in v0.1.)

`subscribeToChanges` callback signature: `(newValue, oldValue) => void`. The wrapper filters to the local area and to our `STORAGE_KEY`, hands both values to the callback.

The popup does a naive full re-render on every change. Mid-drag re-render is rare enough to ignore for v0.1. Targeted diff would be a v0.2 optimization if anyone notices the cost.

## CSP constraints

MV3 forbids inline event handlers (`onclick="..."`), inline `<script>` tags, and `eval`. The popup uses `addEventListener` exclusively. SVG icons are inlined in HTML markup (allowed) but no JavaScript runs from inline `<script>` blocks. No `eval`, no `new Function`, no `setTimeout(string, ...)`.

## Permissions

```
permissions:       ["storage", "contextMenus"]
host_permissions:  ["https://claude.ai/*"]
```

Justification:

- `storage`: folder definitions and chat assignments are kept in `chrome.storage.local`.
- `contextMenus`: required for the right-click "Add chat to folder" menu. The service worker registers menu items filtered to claude.ai chat links via `targetUrlPatterns`. The menu only appears when the user right-clicks a link matching `https://claude.ai/chat/*`.
- `host_permissions: claude.ai/*`: scopes the context menu to claude.ai only. Without this, browsers may surface the menu on other sites or refuse to register it.

We do not request `tabs`, `activeTab`, `<all_urls>`, `scripting`, `downloads`, or any network permissions. `chrome.tabs.create({url})` does not require the `tabs` permission when called with only a URL. Export downloads use `URL.createObjectURL(new Blob(...))` plus an anchor click, no `chrome.downloads`. The earlier v0.1 attempt at a content script required `web_accessible_resources` to dynamic-import modules; the pivot to context menus dropped that requirement entirely.

Minimum viable surface area for the Web Store privacy story: two permissions and one host pattern, all narrow.

## Extension ID

`manifest.json` includes a `key` field with the public half of an RSA-2048 keypair. The extension ID is a deterministic hash of the public key, so it stays stable across reinstalls, path changes, and ZIP re-extracts. Without this field, the ID would change every time the unpacked folder moved, orphaning the user's `chrome.storage.local` data.

The private key is not in the repo. `*.pem` and `*.key` are gitignored as defensive guards.

## Browser targets

Primary: Vivaldi (Chromium-based, my dev driver).
Tested: Chrome.
Should work: Edge, Brave, Opera, any modern Chromium with MV3.
Not supported: Firefox. Different MV3 implementation, different `browser.*` namespace conventions, would require a porting layer.

The `key` field is Chromium-specific. Firefox uses a different add-on ID mechanism.

## Distribution

v0.1: GitHub Releases. Users download a ZIP, extract, load unpacked via `chrome://extensions/` or `vivaldi://extensions/` with developer mode on. README documents the install steps and the release-zip exclusion command (excludes `tests/`, `docs/`, `.git/`, `*.pem`).

For internal MSP-managed machines: enterprise force-install via `ExtensionInstallForcelist` plus a self-hosted `updates.xml` is a real path post-v0.1 if the audience grows.

Vivaldi may honor `update_url` for non-Web-Store extensions where Chrome no longer does. Worth a 10-minute test once a tagged release exists.

v1.0: Chrome Web Store. Same source, same repo, built from a tagged release. README will list both install paths. The `key` field already in `manifest.json` matches the eventual Web Store ID, so users who installed unpacked during v0.1 get a clean upgrade path with their data intact.

## Implemented in v0.2 (was deferred from v0.1)

These items moved from "deferred" to "shipped" with the v0.2 visual layer:

- **In-page surfaces.** Folder strip (default mode) and folder panel (organize mode) now exist on claude.ai as fixed-position overlays. Toggle setting `viewMode` flips between them.
- **Nested folders.** `parentId` schema field with cycle detection (`isAncestor`), recursive helpers (`getRootFolders`, `getChildFolders`, `getDescendantFolders`, `getAncestorChain`), and the public `moveToParent` API.
- **Drag-and-drop assignment.** Native HTML5 DnD on chat anchors plus drop targets in strip and panel. Source/target matrix: claude.ai sidebar → strip swatch / panel folder, panel chat → different panel folder, panel chat → Unsorted, panel folder → different panel folder (cycle-checked), panel folder → root drop zone. Drop handlers fall back to `text/uri-list` / `text/plain` URL parsing when claude.ai's React preempts the CWCF payload between dragstart and drop.
- **Auto-organize by name match.** Lightning bolt button in panel header. Match mode (`contains` / `exact`) configurable in settings. Suggestions are in-memory (per-panel-instance), not persisted.
- **Title cache via in-page sweep.** Content script's MutationObserver reads `anchor.innerText` into `storage.itemTitles`, throttled at 30s minimum interval per item ref. Resolves the v0.1 "chat <uuid-prefix>" display fallback for any chat that has been visible in the sidebar since the extension loaded.
- **Schema v3 with chat cache.** `chatCache: { lastSyncedAt, chats: { [uuid]: { title, lastSyncedAt } } }` extends title coverage beyond what claude.ai's sidebar virtualizes. `setCachedChats` / `getChatCache` / `clearChatCache` exposed by storage; `migrateV2ToV3` adds the field on existing installs without dropping data.
- **Sync feature.** Panel-header sync button loads `claude.ai/recents` in a hidden same-origin iframe, polls for the conversation-cell selector to render, then auto-clicks the "Show more" button up to 50 times (or until the count plateaus) to enumerate every chat the user can access. Results write to `chatCache`. A live status overlay anchored inside the panel shows the running count, success message, or failure reason.
- **Folder editor modal.** `src/content/folder-modal.js` renders an in-page modal for create and edit of folders: name, parent (with cycle exclusion), color (recents + presets), emoji icon (lazy-imported `emoji-set.js` with category headings), description. Replaces the prompt-based `+` button.
- **Right-click context menus.** Two custom in-page menus replace browser-native menus across both folder and chat surfaces. Folder rows in the panel: Edit, Pin/Unpin, Add child folder, Delete. Chat anchors anywhere on claude.ai (sidebar or panel rows): Open chat, Open in new tab, Add to folder (each folder listed with `✓` on the assigned ones; click toggles), Manage folders, Remove from this folder / Remove from all folders. Both reuse the `.cwcf-fmenu` styling.
- **Theme broadcast.** `applyActiveTheme` in `main.js` calls `resolveTheme(activeTheme, customTheme)` and writes the token map to `document.documentElement` as CSS custom properties. `content.css` references `var(--bg-primary, ...)` / `var(--accent-primary, ...)` etc. via `color-mix()` for translucent variants. Live-applies on settings change. Strip, panel, modal, settings overlay, and both context menus all pick up the active theme.
- **In-page settings overlay parity.** The cog button on the strip and the panel both open `settings-overlay.js`, which now mirrors the popup's full settings surface: Appearance (theme, density, reduce motion, default folder color), In-page view (view mode, strip cap, strip overflow), Auto-organize (match mode), Folders (counts, quick-assign), Behavior (confirm delete, search enabled), Data (auto backup, export, import, storage usage).
- **Unsorted union.** The Unsorted node in the panel unions sidebar-rendered chat anchors with `chatCache` entries, deduped by UUID. Search across the panel falls through to cached titles when `itemTitles` lacks an entry.

The `chrome.contextMenus` registration was removed in v0.2 along with the `contextMenus` permission. The in-page chat menu fully replaces it. `src/background.js` now only forwards a popup→content "open settings overlay" message; if the popup is removed, the service worker can go too.

## Implemented in v0.2.1

These items shipped in the v0.2.1 fixup round. Each was built from console-driven diagnostic data, not theory:

- **Sync architecture pivot from iframe scrape to passive observation + same-tab autoscroll.** v0.2's `sync.js` loaded `claude.ai/recents` in a hidden iframe and tried to enumerate cells there. Diagnostic logs proved claude.ai's React only renders the app shell (sidebar) inside an iframe-of-itself, not the conversation grid. v0.2.1 replaced the approach with two collaborating modules:
  - `src/content/recents-observer.js` runs whenever the user is on `/recents` (whether they navigated there themselves or via the sync button). A `MutationObserver` on `document.body` watches for conversation-cell anchors as they render — initial 30, then more on scroll or "Show more" click — and writes them to `chatCache` via the new `appendCachedChats` storage method (additive merge, doesn't replace). Pure DOM observation.
  - `src/content/sync-runner.js` runs only when the user clicked the panel sync button and the autosync trigger flag is set. It auto-clicks the page's "Show more" button to exhaustion (up to 80 clicks, terminates when button vanishes or count plateaus) so the observer captures the full chat list. A small overlay reports progress.
  - The trigger uses `sessionStorage` rather than a URL hash. claude.ai's SPA router strips hashes during route mount before content-script `document_idle` runs, so the hash-based version of this never fired. SessionStorage survives the same-tab navigation untouched. Diagnostic logs in the fixup round confirmed both behaviors.
- **`appendCachedChats` storage method.** Replaces the v0.2 `setCachedChats` for incremental population. Existing entries with the same UUID are overwritten so titles stay fresh; entries not in the input are preserved. `lastSyncedAt` updates only when valid entries merged. Five new tests cover empty/merge/overwrite/invalid-drop/no-op semantics. Test count moved from 52 to 57.
- **Chat right-click context menu matches panel rows in addition to anchors.** v0.2 only matched `closest('a[href^="/chat/"]')`, which missed panel chat rows (rendered as `<div data-item-ref="chat:UUID">` without an anchor in the tree). v0.2.1 tries `closest('[data-item-ref^="chat:"]')` first, falls back to anchor matching. Covers both panel rows and sidebar/recents anchors.
- **Within-panel DnD fix.** v0.2's chat→folder and folder→folder drops failed silently. Root cause surfaced via diagnostic logging: `attachItemDragSource` set `effectAllowed = 'move'` but `attachFolderDropTarget`'s dragover set `dropEffect = 'copy'`. Per HTML5 spec the drop is rejected when dropEffect is not in effectAllowed, so the browser fired `dragend` with `dropEffect: 'none'` instead of dispatching `drop`. Fix is one line: dropEffect always 'move' on folder rows. The conditional that branched on payload.kind was brittle — `readDragPayloadPreview` returns `{kind: 'unknown'}` during dragover because `getData` is unavailable at that phase, so the branch never selected 'move' for chats anyway.
- **Edge-zone auto-scroll during drag.** Panel tree auto-scrolls when the dragged item hovers within 60px of the top or bottom edge. Speed ramps from 0 to ~14px/frame proportional to proximity. Driven by `dragover` (which does fire during HTML5 drag) plus `requestAnimationFrame`. Stops on capture-phase document `dragend` / `drop`.
- **Icon set wired into manifest.** `icons/` directory contains PNGs at 16/32/48/128 sizes plus 256 preview and `master.svg` source. `manifest.json` `icons` block and `action.default_icon` both reference the set. Establishes brand identity for future Web Store submission.

## Known limitations (v0.2.1)

These are accepted limitations, not deferred work. The right fix would require a different architecture, and the workaround listed below is good enough that we are not pursuing it for v0.2.x.

- **Cross-source drag from claude.ai's sidebar/recents anchors does not work reliably.** The native HTML5 drag lifecycle on claude.ai's chat anchors is owned by their React tree; Tailwind classes like `disabled:pointer-events-none`, `select-none`, and `can-focus` interact with React state in ways that prevent the OS-level drag from initiating consistently. `src/content/drag-handlers.js`'s `runDragPreemptionTest` already logs `'[CWCF] dragstart on chat anchor was defaultPrevented…'` when this happens, so the diagnostic is visible in the console.
  - **Within-panel drag works.** Panel chat rows are our own `<div data-item-ref="…" draggable>` elements, fully under our control. Drag chat → folder, drag folder → folder, drag folder → root all behave as expected.
  - **The primary cross-source assignment workflow is right-click.** The in-page chat context menu (`src/content/chat-context.js`) attaches at document level in capture phase and matches both panel rows (via `data-item-ref^="chat:"`) and any sidebar/recents `<a href="/chat/…">`. Right-click → Add to folder works regardless of where the chat is rendered.
  - The strip and panel drop handlers retain the `text/uri-list` / `text/plain` URL fallback, so any browser/state combination where claude.ai's drag does happen to fire still produces a correct assignment. The fallback path logs a warning so the React-preempt scenario is visible when it occurs.

- **Mouse wheel does not scroll the panel during a drag.** Chromium does not dispatch `wheel` events to JavaScript while an HTML5 native drag is active. Verified by diagnostic logging in v0.2.1: a document-level capture-phase wheel listener never fires during a drag. The user-facing workaround is the edge-zone auto-scroll: hold the dragged item near the top or bottom edge and the panel scrolls under it. The dormant wheel handler in `folder-panel.js`'s `attachTreeAutoScroll` is kept registered so it just-works if Chromium ever changes the behavior, or activates automatically if a future v0.3 replaces HTML5 native drag with a custom mousedown/mousemove/mouseup implementation.

## Deferred features

Schema fields exist for these where relevant. UI lands in v0.3 or later.

- Custom theme override panel (the user-facing UI for setting per-token hex values; the schema field `customTheme` is honored by `resolveTheme` already, but no editor UI ships in v0.2).
- Folder description display in the detail view as more than a single paragraph.
- Recently-used folder sort (`lastUsedAt` field exists, no UI yet).
- Bulk operations (select multiple chats, assign to folder).
- Search expansion (per-item search, full-text across descriptions).
- Keyboard shortcuts. `Alt+1-9` to assign current chat to one of the top 9 folders. The `commands` manifest key has a hard limit of 4 default shortcuts. Beyond 4, the user assigns keys via `chrome://extensions/shortcuts`.
- Auto-backup actual implementation. The setting accepts `off` / `daily` / `weekly` and persists across sessions, but no scheduler runs yet. Wiring this needs the `chrome.downloads` permission, a Web Store review surface increase. Defer until requested.
- Projects support. The schema accepts `project:<uuid>` typed item refs and `selectors.js` exports a project URL pattern. v0.2 chat menu only fires on `/chat/<uuid>` anchors. v0.3 can extend to project URLs once the project DOM has been characterized. Recon for projects is captured in DOM-NOTES.
- /recents page DnD. Sync covers enumeration; live drag from the `/recents` cards into our overlays does not yet work because the strip/panel drag sources are scoped to the sidebar (`<nav>`) only.
- /recents page support. Same shape as projects: anchors there carry a different Datadog action name (`conversation-cell`) but the URL pattern is identical (`/chat/<uuid>`). The right-click context menu's `targetUrlPatterns` already covers `/chat/<uuid>` regardless of which page the link is on, so this may already work for the menu. The strip/panel drag sources are scoped to the sidebar (`<nav>`) only; v0.3 may extend to `/recents` cards.
- Auto-organize by keyword rules. v0.2 ships name-match only. The `folder.autoAssignKeywords` schema field exists for v0.3 keyword rules but is not consumed yet.
- Auto-organize "apply all" bulk action. v0.2 requires per-suggestion confirm. v0.3 may add an "Apply all suggestions" button.
- Persistent suggestion dismissals. v0.2 dismissals are in-memory; reload re-suggests. v0.3 may persist a `dismissedSuggestions` set in storage.
- Three-button-or-more bulk import options (replace specific folder, merge with override, etc).
- `setFolderCollapsed` public API. v0.2 toggles `folder.collapsed` via direct `chrome.storage.local.set` after re-reading. v0.3 may add the public mutator if more callers need single-field folder updates.

## Why no bundler

ES modules work natively in MV3 with `"type": "module"` on the popup HTML's `<script>` tag and on the service worker's manifest declaration. Plain JS, no transpilation, no build step. Adds a bundler (Vite, esbuild, etc.) later if and only if it is justified by TypeScript adoption, code splitting, or a polyfill need that doesn't exist in v0.1.
