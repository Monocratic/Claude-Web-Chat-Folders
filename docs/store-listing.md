# Chrome Web Store listing copy

Source-of-truth strings for the v0.3.0 Web Store listing. Update when
copy changes; paste into the Chrome Web Store dashboard at submission
time.

## Short description (132 char max)

> Organize your claude.ai chats into folders. Right-click to assign,
> drag to drop. Local-only — no API access, no telemetry.

(128 chars)

## Long description

> **Claude Web Chat Folders** brings folder organization to claude.ai.
>
> ## What it does
>
> - **In-page folder panel** appears alongside claude.ai's sidebar.
>   Drag chats into folders, drag folders to nest them, search across
>   all your folders and chats.
> - **Right-click any chat** in claude.ai to add it to a folder. Works
>   on the sidebar, on /recents, and inside the folder panel.
> - **Right-click any folder** to edit, pin, add a child folder, or
>   delete.
> - **Folder strip mode** for a minimal vertical strip of pinned
>   folders that doubles as drop targets.
> - **Auto-organize** by name match — chats whose titles match a
>   folder name are suggested with a one-click confirm.
> - **Sync** the full chat list from claude.ai/recents into your
>   folder panel, even chats older than the ~30 the sidebar renders.
> - **Themes**: five built-in color schemes; live preview as you
>   change.
> - **Toolbar popup** with a master toggle to show or hide the in-page
>   UI without uninstalling, plus quick access to settings and sync.
> - **Export and import** all your folders and assignments as JSON for
>   backup or transfer.
>
> ## What it doesn't do
>
> - Doesn't read your chat content. Only chat titles and URLs.
> - Doesn't call Anthropic's API or any other API. Reads only what
>   your browser already shows you on claude.ai.
> - Doesn't transmit any data. Nothing leaves your device unless you
>   click Export.
> - Doesn't include analytics, error reporting, or any telemetry.
>   Period.
>
> ## How it works
>
> Folders, color choices, and chat assignments are stored locally in
> Chrome's extension storage on your device. The extension reads the
> chat anchors that claude.ai already renders on the page. That's it.
>
> ## Browser support
>
> - Brave
> - Chrome
> - Vivaldi
> - Edge (should work, untested)
> - Opera (should work, untested)
> - Firefox is not supported (uses a different MV3 implementation)
>
> Note: Folders and settings are stored per-browser. To move your
> folders between browsers, use **Export** and **Import** in the
> settings overlay.
>
> ## Open source
>
> Source code lives at:
> https://github.com/Monocratic/Claude-Web-Chat-Folders
>
> Issues, suggestions, and pull requests welcome. Fork freely; the
> compiled and signed extension on the Chrome Web Store is published
> only by Monocratic.
>
> ## Privacy
>
> Privacy policy:
> https://github.com/Monocratic/Claude-Web-Chat-Folders/blob/main/docs/privacy-policy.md
>
> Plain English: this extension does not phone home. It runs entirely
> in your browser, stores data only on your device, and only ever talks
> to claude.ai because that's where the chat list it organizes lives.

## Category

Productivity

## Languages

English

## Promotional tile

`docs/store-assets/promo_440x280.png` (placed by Tim, sourced from
`promo_440x280.svg` in the same directory).

## Screenshots

Capture on a 1280×800 viewport in Brave or Chrome with a populated
folder set:

1. Folder panel open with several folders and Unsorted populated
2. Right-click chat context menu open with the folder list visible
3. Settings overlay showing Appearance section with theme picker
4. Folder edit modal showing color + emoji pickers
5. Folder strip mode (the minimal vertical bar)

## Privacy policy URL

`https://github.com/Monocratic/Claude-Web-Chat-Folders/blob/main/docs/privacy-policy.md`

(GitHub renders the markdown directly. If a hosted HTML version is
preferred later, GitHub Pages can serve `docs/privacy-policy.md` at
`https://monocratic.github.io/Claude-Web-Chat-Folders/privacy-policy.html`
once Pages is enabled for the repo.)

## Homepage URL

`https://github.com/Monocratic/Claude-Web-Chat-Folders`

## Single-purpose declaration

The extension's single purpose is folder organization for claude.ai
chats. All features (folder panel, strip, context menus, settings
overlay, sync) serve that one purpose.
