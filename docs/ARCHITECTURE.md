# Architecture

This document captures the design decisions for v0.1 of Claude Web Chat Folders. It exists so future contributors (including future-you and a fresh Claude session) can pick up the codebase without re-litigating settled questions.

## Goals

Add folder organization to claude.ai chats. Local storage only. JSON export/import for portability. No backend, no API access, no telemetry.

Two UI surfaces:
1. Toolbar popup for folder management.
2. Per-row inject button on claude.ai's sidebar (deferred to a later commit; currently scaffolded only).

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
showInjectButtons: boolean
defaultFolderColor: "#RRGGBB"
activeTheme: string                    // preset id
customTheme: { tokenName: hex, ... }   // overrides applied on top of active preset
density: "comfortable" | "compact"     // v0.2 UI
reduceMotion: boolean                  // v0.2 UI; CSS already honors prefers-reduced-motion
injectButtonStyle: "dot" | "icon" | "pill"
injectButtonPosition: "right" | "left" | "hoverOnly"
showFolderDots: boolean                // colored dots on chat rows showing assignments
showChatCounts: boolean                // count badges on folders in popup
quickAssignFolderId: string | null     // self-heals if folder no longer exists
autoBackup: "off" | "daily" | "weekly" // v0.2 UI; no chrome.downloads permission for v0.1
confirmFolderDelete: boolean
recentColors: string[]                 // capped at 8, MRU
recentEmojis: string[]                 // capped at 16, MRU
searchEnabled: boolean
```

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
- `settings` - theme selector, default color, inject button preferences, quick-assign target, confirm-on-delete, export, import, storage usage.

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

### Inject button

`src/content/`. Per-row UI on claude.ai's sidebar. Click opens a mini-menu for assigning the chat or project to a folder. Visual style governed by `injectButtonStyle` and `injectButtonPosition` settings.

This surface is deferred. The manifest already declares the `claude.ai/*` host permission and the popup is wired to react to changes from the content script via `chrome.storage.onChanged`.

### What we do not do

We do not replace claude.ai's sidebar. We do not restyle it. We do not fetch chat data from Anthropic's API. We do not modify chat content. The extension reads sidebar URLs and titles from the rendered DOM, nothing else.

## SPA resilience pattern

claude.ai is a React app. Components mount, unmount, and re-render constantly. Selectors that worked on page load will not necessarily match after navigation. The pattern in `content.js` (when written):

1. `MutationObserver` watches `document.body` with `{ childList: true, subtree: true }`.
2. Reactions debounced 150 ms to avoid running on every keystroke in the chat input.
3. Every injection function checks for a sentinel attribute (`data-cwcf-injected="true"`) before adding UI. Idempotent on re-mount.
4. All claude.ai selectors live in `src/lib/selectors.js`. When the site changes, fix one file.
5. Selectors prefer structural anchors (`a[href^="/chat/"]`, `a[href^="/project/"]`, stable `data-testid` values) over class names. Class names are Tailwind utilities and change without notice.

Also: `pageshow` event handler re-runs the initial sweep on bfcache restores. The observer alone does not fire when the document is restored from cache.

See `docs/DOM-NOTES.md` for the live record of which selectors are currently working.

## Cross-surface sync

`chrome.storage.onChanged` is the broadcast channel. The popup and the content script both subscribe via `subscribeToChanges(cb)` exported from `storage.js`. Any mutation from any surface fires the callback in all open surfaces, which re-render against the new state.

`subscribeToChanges` callback signature: `(newValue, oldValue) => void`. The wrapper filters to the local area and to our `STORAGE_KEY`, hands both values to the callback.

The popup does a naive full re-render on every change. Mid-drag re-render is rare enough to ignore for v0.1. Targeted diff would be a v0.2 optimization if anyone notices the cost.

## CSP constraints

MV3 forbids inline event handlers (`onclick="..."`), inline `<script>` tags, and `eval`. The popup uses `addEventListener` exclusively. SVG icons are inlined in HTML markup (allowed) but no JavaScript runs from inline `<script>` blocks. No `eval`, no `new Function`, no `setTimeout(string, ...)`.

## Permissions

```
permissions:                ["storage"]
host_permissions:           ["https://claude.ai/*"]
web_accessible_resources:   src/content/*.js, src/lib/*.js scoped to https://claude.ai/*
```

Justification:

- `storage`: folder definitions and chat assignments are kept in `chrome.storage.local`.
- `host_permissions: claude.ai/*`: the content script needs to read sidebar DOM and inject folder UI on claude.ai. Scoped to claude.ai only.
- `web_accessible_resources`: required for the content script to dynamic-import its own ES modules. MV3's `content_scripts` manifest entries do not natively support `"type": "module"`, so static imports at the entry point fail. The standard buildless workaround is a tiny bootstrap that calls `import(chrome.runtime.getURL('src/content/main.js'))`, which only works if the imported file is in `web_accessible_resources`. Scoped to `https://claude.ai/*` so no other origin can fetch these files via direct URL. The scope matches `host_permissions`. The content script already runs in claude.ai's page context, so making the source readable from that origin is not a meaningful privacy regression; an attacker who could read these files via WAR could already read them by inspecting the rendered page.

We do not request `tabs`, `activeTab`, `<all_urls>`, `scripting`, `downloads`, or any network permissions. `chrome.tabs.create({url})` does not require the `tabs` permission when called with only a URL. Export downloads use `URL.createObjectURL(new Blob(...))` plus an anchor click, no `chrome.downloads`. Minimum viable surface area for the Web Store privacy story.

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
- Theme-aware content script popover. The popover injected by the content script on claude.ai uses hard-coded neon-purple chrome (background, borders, text colors) regardless of the user's `activeTheme`. This is intentional for v0.1: content scripts run in a different document than the popup and cannot read the popup's `:root` CSS custom properties directly. v0.2 path: write the resolved theme tokens to `chrome.storage.local` (or a dedicated subkey), have the content script read them on init and on `subscribeToChanges`, then inject a `<style>` element setting CSS custom properties for `.cwcf-popover` and friends. Roughly 30-50 lines of additional code split between `main.js` and a small theme broadcast helper.
- Title cache refresh on every sweep. `main.js` currently writes `itemTitles[itemRef]` only on first injection per anchor (when the sentinel goes from absent to present). If the user renames a chat in claude.ai's UI, the cached title goes stale until the extension reloads. v0.2 should refresh the title on each sweep, comparing `anchor.innerText` against the cache and writing only on change to avoid storage churn.
- Projects auto-discovery. v0.1 lets users manually assign project URLs to folders alongside chats. v0.2 may add automatic surfacing of claude.ai's project list as virtual folders.
- Content script keyboard reorder (HTML5 native DnD has no keyboard equivalent; v0.2 if anyone reports the gap).
- Three-button-or-more bulk import options (replace specific folder, merge with override, etc).

## Why no bundler

ES modules work natively in MV3 with `"type": "module"` on the popup HTML's `<script>` tag. Plain JS, no transpilation, no build step. Adds a bundler (Vite, esbuild, etc.) later if and only if it is justified by TypeScript adoption, code splitting, or a polyfill need that doesn't exist in v0.1.
