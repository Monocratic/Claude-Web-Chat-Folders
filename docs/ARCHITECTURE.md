# Architecture

This document captures the design decisions for v0.1 of Claude Web Chat Folders. It exists so future contributors (including future-you and a fresh Claude session) can pick up the codebase without re-litigating settled questions.

## Goals

Add folder organization to claude.ai chats. Local storage only. JSON export/import for portability. No backend, no API access, no telemetry.

Two UI surfaces:
1. Toolbar popup for folder management (folder CRUD, settings, import/export).
2. Browser right-click context menu on claude.ai chat links for per-chat assignment.

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

## Schema (v1)

```
{
  version: 1,
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
      lastUsedAt: number | null     // ms epoch, populated by future v0.2 UI
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

## Deferred features

Schema fields exist for these where relevant. UI lands in v0.2 or later.

- Custom theme override panel (the user-facing UI for setting per-token hex values; the schema field `customTheme` is honored by `resolveTheme` already).
- Density toggle (`density: "comfortable" | "compact"`).
- Auto-backup (`autoBackup: "off" | "daily" | "weekly"`). Adding this needs the `chrome.downloads` permission, an explicit Web Store review surface increase. Defer until requested.
- Folder description display in the detail view as more than a single paragraph.
- Recently-used folder sort (`lastUsedAt` field exists, no UI yet).
- Bulk operations (select multiple chats, assign to folder).
- Search expansion (per-item search, full-text across descriptions).
- Keyboard shortcuts. `Alt+1-9` to assign current chat to one of the top 9 folders. The `commands` manifest key has a hard limit of 4 default shortcuts. Beyond 4, the user assigns keys via `chrome://extensions/shortcuts`. v0.2 ships `Alt+1-4` as defaults.
- Title cache. The popup's "items in folder" view shows item refs (`chat:<uuid>`) plus a cached title where one is present. v0.1 has no path for populating that cache (the content script that did so was removed in the pivot). v0.2 options: a minimal content script whose only job is reading `<a href="/chat/...">` titles into the cache, or surfacing the cache as "tab title at time of assignment" populated when the user right-clicks. For now, the popup falls back to displaying `chat <uuid-prefix>` when no cached title exists.
- In-page discoverability surface. Right-click is efficient but not self-evident to users who do not read the README. v0.2 may add a small affordance somewhere on the page (top-of-sidebar pill, toolbar-icon badge, or similar) once usage data shows where it is needed. The pivot history note explains why this is deferred rather than included.
- Projects support. The schema accepts `project:<uuid>` typed item refs and `selectors.js` exports a project URL pattern. v0.1 right-click only fires on chat links. v0.2 can extend the context menu to project URLs (`https://claude.ai/project/*`) once the project DOM has been characterized. Recon for projects is captured in DOM-NOTES.
- /recents page support. Same shape as projects: anchors there carry a different Datadog action name (`conversation-cell`) but the URL pattern is identical (`/chat/<uuid>`). v0.1 right-click works on any link matching the chat URL pattern, including those rendered on /recents, so this may already work without further effort. v0.2 verifies and documents.
- Three-button-or-more bulk import options (replace specific folder, merge with override, etc).

## Why no bundler

ES modules work natively in MV3 with `"type": "module"` on the popup HTML's `<script>` tag and on the service worker's manifest declaration. Plain JS, no transpilation, no build step. Adds a bundler (Vite, esbuild, etc.) later if and only if it is justified by TypeScript adoption, code splitting, or a polyfill need that doesn't exist in v0.1.
