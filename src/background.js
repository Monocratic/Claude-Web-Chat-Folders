// Service worker. Previously hosted the chrome.contextMenus registration
// for "Add chat to folder"; that was replaced in v0.2 by an in-page custom
// menu (src/content/chat-context.js) so the visual style matches the
// folder context menu and so the menu is fully keyboard-driven by claude.ai's
// existing focus pattern.
//
// The SW now only routes a "open settings overlay" message from the popup
// to the active claude.ai content script. If the popup is removed in a
// future commit, this file can go too.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'cwcf:openSettingsOverlayFromPopup') {
    forwardOpenSettings().then(() => sendResponse({ ok: true })).catch((err) => {
      console.warn('[CWCF] forwardOpenSettings failed', err);
      sendResponse({ ok: false });
    });
    return true;
  }
  return false;
});

async function forwardOpenSettings() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: 'https://claude.ai/*'
  });
  if (tabs[0]?.id) {
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'cwcf:openSettingsOverlay' });
    return;
  }
  await chrome.tabs.create({ url: 'https://claude.ai/' });
}
