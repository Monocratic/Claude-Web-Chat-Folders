# Claude Web Chat Folders

Folder organization for claude.ai chats. Local storage only, no API access, no telemetry. Chromium-based browsers (Chrome, Vivaldi, Edge, Brave). Firefox not supported.

The extension adds a toolbar popup for managing folders, and a "Add chat to folder" item to the browser's right-click menu when you right-click a chat link on claude.ai. Data lives in `chrome.storage.local`. JSON export and import is the only data movement, and it is always user-initiated.

## Usage

**To assign a chat to a folder:** right-click the chat link in claude.ai's sidebar, hover "Add chat to folder", click the folder name. The assignment is immediate and persists locally.

**To create or manage folders:** click the extension icon in your toolbar. The popup lets you create folders, edit names/colors/icons, pin folders, drag-reorder, view chats inside a folder, change settings, and import/export your data.

**No folders yet?** The right-click menu's first item links to the popup so you can set up.

## Install (unpacked from source)

This is the canonical install path until v1.0 ships on the Chrome Web Store.

### Prerequisites

- Git
- A Chromium browser: Brave, Chrome, Vivaldi, or Edge

### Steps

1. Clone the repo to a permanent location. Do not move the folder after install; the browser reads from the path forever.

   ```
   git clone https://github.com/Monocratic/Claude-Web-Chat-Folders.git <destination-path>
   cd <destination-path>
   ```

2. The default branch (`main`) holds the latest release. A fresh clone leaves you on `main` already; if you've previously checked out a different branch, switch back:

   ```
   git checkout main
   ```

3. Open your browser's extensions page:
   - Brave: `brave://extensions/`
   - Chrome: `chrome://extensions/`
   - Vivaldi: `vivaldi://extensions/`
   - Edge: `edge://extensions/`

4. Toggle **Developer mode** on (top-right corner of the extensions page).

5. Click **Load unpacked**. Select the repo's root directory (the folder containing `manifest.json`, not a subfolder).

6. Note the extension ID shown on the loaded extension's card. With the embedded `key` field in `manifest.json`, this ID is deterministic and stable across reinstalls and machines.

### Test page (for verifying storage layer)

After install, the storage test page is reachable at:

```
chrome-extension://<extension-id>/tests/storage-tests.html
```

Replace `<extension-id>` with the ID from step 6.

## Updating after a pull

When the branch advances and you want the latest code:

1. Pull the latest commits.

   ```
   cd <repo-path>
   git pull origin main
   ```

2. Open the extensions page in your browser.

3. Click the **reload** icon (circular arrow) on the extension's card. The reload picks up the new code without changing the extension ID or wiping `chrome.storage.local`.

4. If you have the popup open during reload, close and reopen it. The popup is a fresh document on each open and will pick up the reloaded code.

## Run the storage tests

The test page exercises 32 cases covering schema validation, race conditions on parallel writes, idempotency, MRU caps, import format validation, subscription firing, and storage byte counting.

1. Open the test page URL from the install section.
2. Click **Back up current state**. A timestamped JSON file downloads to your Downloads folder. Keep it; the test run wipes storage.
3. Click **Run tests (auto-backs up first, then wipes)**. A second pre-test backup downloads, you confirm the wipe, and the test runner steps through every case.
4. Expected result: `32 passed, 0 failed of 32`.
5. To restore your folders, use the popup's settings panel: **Import** and select the backup JSON.

## Browser support

| Browser | Status |
|---|---|
| Brave | Tested |
| Chrome | Tested |
| Vivaldi | Tested (primary dev target) |
| Edge | Should work, untested |
| Opera | Should work, untested |
| Firefox | Not supported |

Firefox uses a different MV3 implementation and a different add-on ID mechanism. The `key` field in `manifest.json` is Chromium-specific. A Firefox port would need separate manifest handling and is out of scope for v0.1.

## Privacy and data

- All folder data is stored in `chrome.storage.local` on your device. Nothing is sent to Anthropic, to the extension author, or to any third party.
- The extension does not call Anthropic's API.
- The extension does not include analytics, error reporting, or any other telemetry.
- The only data movement is JSON export and import, both user-initiated through the settings panel. Exports download to your local Downloads folder. Imports read a file you select from your local disk.
- When you right-click a chat link on claude.ai, the browser passes the link URL to the extension's context menu handler. That URL is the only data the extension sees about a chat. The extension does not read claude.ai's page content. It does not modify claude.ai's page content. It does not read chat content.
- The host permission `https://claude.ai/*` scopes the right-click context menu to claude.ai. The extension does not run a content script on the page.

## Issues and contributions

This is a personal-utility extension. Pre-Web-Store, contributions are not expected, and there is no formal issue triage workflow. After v1.0 lands on the Chrome Web Store, this section will be revisited.

## Maintenance discipline (for contributors)

The README is the install and developer contract. Any commit that changes how install or update works must include a README update in the same commit. Do not let the README drift from reality.

This applies to:

- Branch renames (the current dev branch will merge to `main` at v0.1 release; the install section's branch reference must update in the same commit that flips canonical install to `main`).
- New prerequisites (a future build step, a node version pin, a CLI dependency).
- Path changes (release ZIPs shipping from a `/dist/` directory; the install section must distinguish source vs ZIP install).
- New install paths (Web Store URL once published).
- Removed install paths (deprecating unpacked install if a build step becomes mandatory).
