// Bootstrap for the content script. MV3 content_scripts entries declared in
// manifest.json do not natively support ES module syntax in the entry script
// (no "type": "module" option), so this file dynamic-imports the real logic
// from main.js, which can then use static imports. main.js and its
// dependencies (selectors.js, storage.js) are exposed to claude.ai via
// web_accessible_resources scoped to that origin only.

(async () => {
  try {
    const url = chrome.runtime.getURL('src/content/main.js');
    const m = await import(url);
    await m.start();
  } catch (err) {
    console.error('[CWCF] content script bootstrap failed', err);
  }
})();
