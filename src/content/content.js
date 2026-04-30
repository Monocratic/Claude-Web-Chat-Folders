// Bootstrap for the v0.2 content script. MV3 content_scripts entries don't
// natively support ES module imports, so this tiny entry uses dynamic import
// via chrome.runtime.getURL to load main.js. main.js then statically imports
// folder-strip.js, folder-panel.js, drag-handlers.js, and the lib modules.
// All those imported files are listed in web_accessible_resources scoped to
// claude.ai/* so the dynamic import has permission to load them.

(async () => {
  try {
    const url = chrome.runtime.getURL('src/content/main.js');
    const m = await import(url);
    await m.start();
  } catch (err) {
    console.error('[CWCF] content script bootstrap failed', err);
  }
})();
