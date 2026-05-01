# Claude Web Chat Folders — Privacy Policy

**Effective:** 2026-05-01

## Summary

Claude Web Chat Folders organizes your chats on claude.ai into folders.
All data stays on your device. Nothing is transmitted to any server, no
third parties are involved, no telemetry is collected.

## What the extension reads

On claude.ai, the extension's content script reads:

- URL paths of chat links rendered on the page (used to extract chat
  UUIDs that identify which chat to organize)
- Visible text of chat list anchors (used to display titles in the
  folder UI)
- `data-item-ref` attributes the extension itself stamps on its own
  panel rows (these encode the same chat UUIDs the URL paths expose)
- The structure of the navigation block (used to position the folder
  strip and panel correctly over claude.ai's sidebar)

The extension does **not** read:

- Chat message content (questions, answers, attachments, anything
  inside a conversation)
- Account information (email, name, billing, organization)
- Any site other than claude.ai

## Where data is stored

Folder names, color choices, chat-to-folder assignments, settings, and
the chat title cache are stored in `chrome.storage.local` on your
device. Nothing syncs to a cloud service.

The chat title cache stores **only chat UUIDs and the visible title
text** that claude.ai's DOM exposes. No message content is cached, no
timestamps beyond what claude.ai itself renders are stored, and no
third party ever sees this data.

Folders and settings are stored separately in each browser you install
the extension on. To move them between browsers, use the **Export** and
**Import** buttons in the settings overlay.

## Data movement

The extension never transmits data. The only way data leaves your
device is when you click **Export** in the settings overlay, which
downloads a JSON backup to your local Downloads folder. You can also
**Import** a JSON file you previously exported.

## Third parties

None. No analytics, no error reporting, no advertising networks, no
external APIs.

## Anthropic's API

The extension does not call Anthropic's API. It reads only what
claude.ai already renders in your browser.

## Permissions used

The extension requests two permissions:

- `storage` — to persist your folders and settings in
  `chrome.storage.local`.
- `host_permissions: https://claude.ai/*` — to run the content script
  on claude.ai. This is the narrowest permission that lets the
  extension organize chats on claude.ai while having no access to any
  other site you visit.

No `tabs`, `<all_urls>`, `scripting`, `downloads`, or any network
permissions are requested.

## Changes to this policy

If this policy changes, the new version will be posted at the same URL
with an updated effective date.

## Contact

Questions or concerns:
[github.com/Monocratic/Claude-Web-Chat-Folders/issues](https://github.com/Monocratic/Claude-Web-Chat-Folders/issues)
