import * as S from '../src/lib/storage.js';

async function wipeStorage() {
  await chrome.storage.local.remove(S.STORAGE_KEY);
}

const VALID_UUID_A = '11111111-2222-3333-4444-555555555555';
const VALID_UUID_B = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const VALID_UUID_C = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

const REF_CHAT_A = `chat:${VALID_UUID_A}`;
const REF_CHAT_B = `chat:${VALID_UUID_B}`;
const REF_PROJECT_A = `project:${VALID_UUID_C}`;

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function downloadJson(filename, jsonString) {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function backupCurrentState(prefix = 'cwcf-backup') {
  const json = await S.exportToJson();
  await downloadJson(`${prefix}-${timestamp()}.json`, json);
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

function assertTrue(v, msg) {
  if (!v) throw new Error(msg);
}

async function assertThrows(fn, msgPart, label) {
  try {
    await fn();
  } catch (e) {
    if (msgPart && !String(e.message).includes(msgPart)) {
      throw new Error(`${label}: threw, but message did not contain "${msgPart}". Got: ${e.message}`);
    }
    return;
  }
  throw new Error(`${label}: expected throw, none occurred`);
}

const tests = [
  ['empty storage returns default state', async () => {
    const s = await S.loadState();
    assertEqual(s.version, 2, 'version should be 2');
    assertEqual(s.folders, [], 'folders should be empty');
    assertEqual(s.assignments, {}, 'assignments should be empty');
    assertEqual(s.itemTitles, {}, 'itemTitles should be empty');
    assertTrue(s.settings && s.settings.activeTheme === 'neon-purple', 'default activeTheme');
  }],

  ['createFolder round-trip', async () => {
    const folder = await S.createFolder('Work', '#ff0000');
    assertTrue(folder.id.startsWith('f_'), 'folder id has f_ prefix');
    assertEqual(folder.name, 'Work', 'name set');
    assertEqual(folder.color, '#ff0000', 'color set');
    assertEqual(folder.pinned, false, 'pinned defaults false');
    assertEqual(folder.icon, null, 'icon defaults null');
    const all = await S.getAllFolders();
    assertEqual(all.length, 1, 'one folder stored');
    assertEqual(all[0].id, folder.id, 'returned folder matches');
  }],

  ['createFolder uses default color when null', async () => {
    const folder = await S.createFolder('NoColor');
    const state = await S.loadState();
    assertEqual(folder.color, state.settings.defaultFolderColor, 'falls back to default');
  }],

  ['createFolder rejects bad name and color', async () => {
    await assertThrows(() => S.createFolder(''), 'Folder name', 'empty name');
    await assertThrows(() => S.createFolder('x'.repeat(65)), 'Folder name', 'name too long');
    await assertThrows(() => S.createFolder('OK', 'red'), 'Invalid color', 'non-hex color');
    await assertThrows(() => S.createFolder('OK', '#fff'), 'Invalid color', 'short hex');
  }],

  ['parallel createFolders all land', async () => {
    const names = ['A', 'B', 'C', 'D', 'E'];
    const results = await Promise.all(names.map(n => S.createFolder(n)));
    assertEqual(results.length, 5, '5 results returned');
    const all = await S.getAllFolders();
    assertEqual(all.length, 5, '5 folders stored');
    const sortedNames = all.map(f => f.name).sort();
    assertEqual(sortedNames, ['A', 'B', 'C', 'D', 'E'], 'all names present');
    const sortOrders = all.map(f => f.sortOrder).sort((a, b) => a - b);
    assertEqual(sortOrders, [0, 1, 2, 3, 4], 'sortOrders are unique 0..4');
  }],

  ['renameFolder', async () => {
    const f = await S.createFolder('Old');
    await S.renameFolder(f.id, 'New');
    const all = await S.getAllFolders();
    assertEqual(all[0].name, 'New', 'rename took effect');
    await assertThrows(() => S.renameFolder('f_bogus', 'X'), 'not found', 'renaming missing folder throws');
    await assertThrows(() => S.renameFolder(f.id, ''), 'Folder name', 'empty rename throws');
  }],

  ['deleteFolder cleans assignments and quickAssignFolderId', async () => {
    const f = await S.createFolder('ToDelete');
    await S.assignItemToFolder(REF_CHAT_A, f.id);
    await S.updateSettings({ quickAssignFolderId: f.id });
    await S.deleteFolder(f.id);
    const state = await S.loadState();
    assertEqual(state.folders.length, 0, 'folder removed');
    assertEqual(state.assignments[REF_CHAT_A], undefined, 'assignment removed');
    assertEqual(state.settings.quickAssignFolderId, null, 'quickAssignFolderId cleared');
    await assertThrows(() => S.deleteFolder('f_bogus'), 'not found', 'deleting missing throws');
  }],

  ['togglePin', async () => {
    const f = await S.createFolder('Pinnable');
    const r1 = await S.togglePin(f.id);
    assertEqual(r1, true, 'first toggle pins');
    const r2 = await S.togglePin(f.id);
    assertEqual(r2, false, 'second toggle unpins');
  }],

  ['reorderFolders rewrites sortOrder', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    const c = await S.createFolder('C');
    await S.reorderFolders([c.id, a.id, b.id]);
    const all = await S.getAllFolders();
    assertEqual(all.map(f => f.name), ['C', 'A', 'B'], 'reordered as expected');
    await assertThrows(() => S.reorderFolders([a.id, b.id]), 'permutation', 'missing folder rejected');
    await assertThrows(() => S.reorderFolders([a.id, b.id, c.id, 'f_extra']), 'permutation', 'extra folder rejected');
  }],

  ['setFolderColor updates recentColors MRU', async () => {
    const f = await S.createFolder('X');
    await S.setFolderColor(f.id, '#aabbcc');
    await S.setFolderColor(f.id, '#112233');
    await S.setFolderColor(f.id, '#aabbcc');
    const state = await S.loadState();
    assertEqual(state.settings.recentColors[0], '#aabbcc', 'most recent first');
    assertEqual(state.settings.recentColors[1], '#112233', 'second-most recent');
    assertEqual(state.settings.recentColors.length, 2, 'no duplicates');
  }],

  ['recentColors capped at 8', async () => {
    const f = await S.createFolder('Y');
    for (let i = 0; i < 10; i++) {
      const hex = '#' + i.toString(16).padStart(6, '0');
      await S.setFolderColor(f.id, hex);
    }
    const state = await S.loadState();
    assertEqual(state.settings.recentColors.length, 8, 'capped at 8');
    assertEqual(state.settings.recentColors[0], '#000009', 'most recent');
  }],

  ['setFolderIcon validates emoji and updates recentEmojis', async () => {
    const f = await S.createFolder('Z');
    await S.setFolderIcon(f.id, '\u{1F527}');
    const state1 = await S.loadState();
    assertEqual(state1.folders[0].icon, '\u{1F527}', 'icon stored');
    assertEqual(state1.settings.recentEmojis[0], '\u{1F527}', 'emoji recorded as recent');
    await assertThrows(() => S.setFolderIcon(f.id, 'x'), 'emoji', 'rejects non-emoji single char');
    await assertThrows(() => S.setFolderIcon(f.id, 'ab'), 'grapheme', 'rejects multi-cluster non-emoji');
    await assertThrows(() => S.setFolderIcon(f.id, '\u{1F527}\u{1F4BB}'), 'grapheme', 'rejects multiple emoji');
    await S.setFolderIcon(f.id, null);
    const state2 = await S.loadState();
    assertEqual(state2.folders[0].icon, null, 'null clears icon');
  }],

  ['setFolderDescription enforces 280 char cap', async () => {
    const f = await S.createFolder('Described');
    await S.setFolderDescription(f.id, 'A note');
    const s1 = await S.loadState();
    assertEqual(s1.folders[0].description, 'A note', 'description set');
    await assertThrows(() => S.setFolderDescription(f.id, 'x'.repeat(281)), 'Description', 'rejects too long');
    await S.setFolderDescription(f.id, null);
    const s2 = await S.loadState();
    assertEqual(s2.folders[0].description, null, 'null clears');
  }],

  ['parseItemRef and formatItemRef round-trip', async () => {
    const ref = S.formatItemRef('chat', VALID_UUID_A);
    assertEqual(ref, REF_CHAT_A, 'formatted ref matches expected');
    const parsed = S.parseItemRef(ref);
    assertEqual(parsed, { type: 'chat', uuid: VALID_UUID_A }, 'parsed back to parts');
    assertEqual(S.parseItemRef('garbage'), null, 'bad ref returns null');
    await assertThrows(() => S.formatItemRef('blog', VALID_UUID_A), 'Invalid item type', 'bad type throws');
    await assertThrows(() => S.formatItemRef('chat', 'not-a-uuid'), 'Invalid UUID', 'bad uuid throws');
  }],

  ['assignItemToFolder + getFoldersForItem + getItemsInFolder', async () => {
    const a = await S.createFolder('FA');
    const b = await S.createFolder('FB');
    await S.assignItemToFolder(REF_CHAT_A, a.id);
    await S.assignItemToFolder(REF_CHAT_A, b.id);
    await S.assignItemToFolder(REF_PROJECT_A, a.id);
    const foldersForChat = await S.getFoldersForItem(REF_CHAT_A);
    assertEqual(foldersForChat.map(f => f.name).sort(), ['FA', 'FB'], 'chat in two folders');
    const itemsInA = await S.getItemsInFolder(a.id);
    assertEqual(itemsInA.sort(), [REF_CHAT_A, REF_PROJECT_A].sort(), 'folder A has chat and project');
    const itemsInB = await S.getItemsInFolder(b.id);
    assertEqual(itemsInB, [REF_CHAT_A], 'folder B has only chat');
    await assertThrows(() => S.assignItemToFolder(REF_CHAT_A, 'f_bogus'), 'not found', 'bad folder throws');
    await assertThrows(() => S.assignItemToFolder('garbage', a.id), 'Invalid item ref', 'bad ref throws');
  }],

  ['query functions are graceful on missing identifiers', async () => {
    const itemsInMissing = await S.getItemsInFolder('f_does_not_exist');
    assertEqual(itemsInMissing, [], 'missing folder returns []');
    const foldersForUnassigned = await S.getFoldersForItem(REF_CHAT_A);
    assertEqual(foldersForUnassigned, [], 'unassigned item returns []');
    await assertThrows(() => S.getItemsInFolder(123), 'must be a string', 'bad folderId type throws');
    await assertThrows(() => S.getFoldersForItem('garbage'), 'Invalid item ref', 'bad item ref format throws');
  }],

  ['assign is idempotent', async () => {
    const f = await S.createFolder('Idempotent');
    await S.assignItemToFolder(REF_CHAT_A, f.id);
    await S.assignItemToFolder(REF_CHAT_A, f.id);
    await S.assignItemToFolder(REF_CHAT_A, f.id);
    const folders = await S.getFoldersForItem(REF_CHAT_A);
    assertEqual(folders.length, 1, 'only one membership');
  }],

  ['removeItemFromFolder is idempotent and silent', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    await S.assignItemToFolder(REF_CHAT_A, a.id);
    await S.assignItemToFolder(REF_CHAT_A, b.id);
    await S.removeItemFromFolder(REF_CHAT_A, a.id);
    await S.removeItemFromFolder(REF_CHAT_A, a.id);
    await S.removeItemFromFolder(REF_CHAT_B, a.id);
    const folders = await S.getFoldersForItem(REF_CHAT_A);
    assertEqual(folders.map(f => f.name), ['B'], 'left B only');
  }],

  ['removeItemFromAllFolders clears assignments and title', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    await S.assignItemToFolder(REF_CHAT_A, a.id);
    await S.assignItemToFolder(REF_CHAT_A, b.id);
    await S.updateItemTitle(REF_CHAT_A, 'Cached title');
    await S.removeItemFromAllFolders(REF_CHAT_A);
    const state = await S.loadState();
    assertEqual(state.assignments[REF_CHAT_A], undefined, 'assignments gone');
    assertEqual(state.itemTitles[REF_CHAT_A], undefined, 'title gone');
  }],

  ['updateSettings merges and validates', async () => {
    await S.updateSettings({ confirmFolderDelete: false, density: 'compact' });
    const s = await S.loadState();
    assertEqual(s.settings.confirmFolderDelete, false, 'bool merged');
    assertEqual(s.settings.density, 'compact', 'enum merged');
    await assertThrows(() => S.updateSettings({ unknownKey: 1 }), 'Unknown setting', 'unknown key throws');
    await assertThrows(() => S.updateSettings({ density: 'spacious' }), 'Invalid value', 'bad enum throws');
    await assertThrows(() => S.updateSettings({ defaultFolderColor: 'blue' }), 'Invalid value', 'bad color throws');
  }],

  ['exportToJson includes metadata, omits settings', async () => {
    await S.createFolder('Exported');
    const json = await S.exportToJson();
    const parsed = JSON.parse(json);
    assertEqual(parsed.exportedBy, 'cwcf', 'exportedBy stamped');
    assertEqual(parsed.appVersion, '0.1.0', 'appVersion stamped');
    assertTrue(typeof parsed.exportedAt === 'string', 'exportedAt is string');
    assertEqual(parsed.version, 2, 'schema version stamped');
    assertTrue(Array.isArray(parsed.folders), 'folders array present');
    assertEqual(parsed.settings, undefined, 'settings not exported');
  }],

  ['importFromJson replace mode preserves settings', async () => {
    await S.createFolder('Pre-import');
    await S.updateSettings({ confirmFolderDelete: false });
    const exportPayload = {
      exportedBy: 'cwcf',
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      version: 1,
      folders: [{
        id: 'f_imported', name: 'Imported', color: '#123456',
        createdAt: 1000, pinned: false, sortOrder: 0,
        icon: null, description: null, lastUsedAt: null
      }],
      assignments: {},
      itemTitles: {}
    };
    await S.importFromJson(JSON.stringify(exportPayload), 'replace');
    const state = await S.loadState();
    assertEqual(state.folders.length, 1, 'replaced with imported folder');
    assertEqual(state.folders[0].name, 'Imported', 'imported name present');
    assertEqual(state.settings.confirmFolderDelete, false, 'settings preserved across replace');
  }],

  ['importFromJson merge mode adds non-conflicting folders', async () => {
    const existing = await S.createFolder('Existing');
    const exportPayload = {
      exportedBy: 'cwcf', exportedAt: new Date().toISOString(),
      appVersion: '0.1.0', version: 1,
      folders: [
        { id: existing.id, name: 'WouldClash', color: '#ff0000', createdAt: 0, pinned: false, sortOrder: 0, icon: null, description: null, lastUsedAt: null },
        { id: 'f_new', name: 'NewFolder', color: '#00ff00', createdAt: 0, pinned: false, sortOrder: 0, icon: null, description: null, lastUsedAt: null }
      ],
      assignments: { [REF_CHAT_A]: ['f_new'] },
      itemTitles: { [REF_CHAT_A]: 'Title' }
    };
    await S.importFromJson(JSON.stringify(exportPayload), 'merge');
    const state = await S.loadState();
    assertEqual(state.folders.length, 2, 'one new folder added');
    assertTrue(state.folders.some(f => f.name === 'Existing'), 'existing kept');
    assertTrue(state.folders.some(f => f.name === 'NewFolder'), 'new added');
    assertEqual(state.assignments[REF_CHAT_A], ['f_new'], 'assignment imported');
    assertEqual(state.itemTitles[REF_CHAT_A], 'Title', 'title imported');
  }],

  ['importFromJson rejects future schema version', async () => {
    const payload = {
      exportedBy: 'cwcf', exportedAt: new Date().toISOString(),
      appVersion: '99.0.0', version: 99,
      folders: [], assignments: {}, itemTitles: {}
    };
    await assertThrows(() => S.importFromJson(JSON.stringify(payload)), 'newer version', 'future version rejected');
  }],

  ['importFromJson rejects wrong exportedBy', async () => {
    const payload = {
      exportedBy: 'something-else', version: 1,
      folders: [], assignments: {}, itemTitles: {}
    };
    await assertThrows(() => S.importFromJson(JSON.stringify(payload)), 'exportedBy', 'wrong source rejected');
  }],

  ['importFromJson rejects malformed JSON', async () => {
    await assertThrows(() => S.importFromJson('not json'), 'Invalid JSON', 'bad JSON rejected');
  }],

  ['importFromJson drops bad item refs from assignments and titles', async () => {
    const payload = {
      exportedBy: 'cwcf', exportedAt: new Date().toISOString(),
      appVersion: '0.1.0', version: 1,
      folders: [{ id: 'f_a', name: 'A', color: '#000000', createdAt: 0, pinned: false, sortOrder: 0, icon: null, description: null, lastUsedAt: null }],
      assignments: {
        [REF_CHAT_A]: ['f_a'],
        'garbage': ['f_a'],
        'chat:not-a-uuid': ['f_a']
      },
      itemTitles: {
        [REF_CHAT_A]: 'Real',
        'bad-ref': 'Should drop'
      }
    };
    await S.importFromJson(JSON.stringify(payload), 'replace');
    const state = await S.loadState();
    assertEqual(state.assignments[REF_CHAT_A], ['f_a'], 'good ref kept');
    assertEqual(state.assignments['garbage'], undefined, 'bad ref dropped');
    assertEqual(state.assignments['chat:not-a-uuid'], undefined, 'bad uuid dropped');
    assertEqual(state.itemTitles[REF_CHAT_A], 'Real', 'good title kept');
    assertEqual(state.itemTitles['bad-ref'], undefined, 'bad title dropped');
  }],

  ['importFromJson replaces bad folder color with default', async () => {
    const payload = {
      exportedBy: 'cwcf', exportedAt: new Date().toISOString(),
      appVersion: '0.1.0', version: 1,
      folders: [{ id: 'f_a', name: 'A', color: 'pinkish', createdAt: 0, pinned: false, sortOrder: 0, icon: null, description: null, lastUsedAt: null }],
      assignments: {}, itemTitles: {}
    };
    await S.importFromJson(JSON.stringify(payload), 'replace');
    const state = await S.loadState();
    assertEqual(state.folders[0].color, '#3b82f6', 'bad color replaced with default');
  }],

  ['importFromJson rejects folder name over 64 chars', async () => {
    const payload = {
      exportedBy: 'cwcf', exportedAt: new Date().toISOString(),
      appVersion: '0.1.0', version: 1,
      folders: [{ id: 'f_a', name: 'x'.repeat(65), color: '#000000', createdAt: 0, pinned: false, sortOrder: 0, icon: null, description: null, lastUsedAt: null }],
      assignments: {}, itemTitles: {}
    };
    await assertThrows(() => S.importFromJson(JSON.stringify(payload)), 'name length', 'long name rejected');
  }],

  ['importFromJson rejects folder description over 280 chars', async () => {
    const payload = {
      exportedBy: 'cwcf', exportedAt: new Date().toISOString(),
      appVersion: '0.1.0', version: 1,
      folders: [{ id: 'f_a', name: 'A', color: '#000000', createdAt: 0, pinned: false, sortOrder: 0, icon: null, description: 'x'.repeat(281), lastUsedAt: null }],
      assignments: {}, itemTitles: {}
    };
    await assertThrows(() => S.importFromJson(JSON.stringify(payload)), '280', 'long description rejected');
  }],

  ['getBytesInUse returns a number', async () => {
    await S.createFolder('Sizable');
    const bytes = await S.getBytesInUse();
    assertTrue(typeof bytes === 'number' && bytes > 0, 'bytes is positive number');
  }],

  ['subscribeToChanges fires on mutation', async () => {
    let calls = 0;
    let lastNew = null;
    const unsub = S.subscribeToChanges((newVal) => { calls++; lastNew = newVal; });
    await S.createFolder('Sub');
    await new Promise(r => setTimeout(r, 50));
    unsub();
    assertTrue(calls >= 1, 'subscriber fired at least once');
    assertTrue(lastNew && Array.isArray(lastNew.folders), 'received state shape');
  }],

  // ---------- Schema v2 migration ----------

  ['createFolder produces v2 fields by default', async () => {
    const f = await S.createFolder('Modern');
    assertEqual(f.parentId, null, 'parentId defaults null');
    assertEqual(f.collapsed, false, 'collapsed defaults false');
    assertEqual(f.autoAssignKeywords, [], 'autoAssignKeywords defaults []');
  }],

  ['default state declares schema version 2', async () => {
    const s = await S.loadState();
    assertEqual(s.version, 2, 'version is 2');
    assertEqual(s.settings.viewMode, 'default', 'viewMode default');
    assertEqual(s.settings.stripCap, 6, 'stripCap default');
    assertEqual(s.settings.stripOverflowBehavior, 'indicator', 'overflow default');
    assertEqual(s.settings.autoOrganizeMatchMode, 'contains', 'matchMode default');
  }],

  ['v1 state imported as a v1 export migrates to v2 on next load', async () => {
    // Plant a synthetic v1 export and round-trip it through importFromJson.
    // After import, loadState should return v2-shaped state.
    const v1Export = {
      exportedBy: 'cwcf',
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      version: 1,
      folders: [{
        id: 'f_legacy', name: 'Legacy', color: '#aabbcc',
        createdAt: 1000, pinned: true, sortOrder: 0,
        icon: null, description: 'pre-v0.2', lastUsedAt: null
        // no parentId, collapsed, autoAssignKeywords - v1 didn't have these
      }],
      assignments: {},
      itemTitles: {}
    };
    await S.importFromJson(JSON.stringify(v1Export), 'replace');
    const state = await S.loadState();
    assertEqual(state.folders.length, 1, 'folder imported');
    const f = state.folders[0];
    assertEqual(f.name, 'Legacy', 'original data preserved');
    assertEqual(f.parentId, null, 'parentId backfilled to null');
    assertEqual(f.collapsed, false, 'collapsed backfilled to false');
    assertEqual(f.autoAssignKeywords, [], 'autoAssignKeywords backfilled to []');
    assertEqual(state.version, 2, 'state migrated to v2');
  }],

  ['migration is idempotent on already-v2 state', async () => {
    await S.createFolder('A');
    const first = await S.loadState();
    const second = await S.loadState();
    assertEqual(first.version, 2, 'first read is v2');
    assertEqual(second.version, 2, 'second read also v2');
    assertEqual(first.folders[0].id, second.folders[0].id, 'folder identity stable');
    assertEqual(first.settings.viewMode, second.settings.viewMode, 'settings stable');
  }],

  // ---------- Settings validation for v2 fields ----------

  ['v2 settings reject invalid values', async () => {
    await assertThrows(() => S.updateSettings({ viewMode: 'turbo' }), 'Invalid value', 'bad viewMode');
    await assertThrows(() => S.updateSettings({ stripCap: 0 }), 'Invalid value', 'stripCap below min');
    await assertThrows(() => S.updateSettings({ stripCap: 51 }), 'Invalid value', 'stripCap above max');
    await assertThrows(() => S.updateSettings({ stripCap: 3.5 }), 'Invalid value', 'stripCap non-integer');
    await assertThrows(() => S.updateSettings({ stripOverflowBehavior: 'wrap' }), 'Invalid value', 'bad overflow');
    await assertThrows(() => S.updateSettings({ autoOrganizeMatchMode: 'fuzzy' }), 'Invalid value', 'bad match mode');
  }],

  ['v2 settings accept valid values', async () => {
    await S.updateSettings({ viewMode: 'organize', stripCap: 12, stripOverflowBehavior: 'scroll', autoOrganizeMatchMode: 'exact' });
    const s = await S.loadState();
    assertEqual(s.settings.viewMode, 'organize', 'viewMode set');
    assertEqual(s.settings.stripCap, 12, 'stripCap set');
    assertEqual(s.settings.stripOverflowBehavior, 'scroll', 'overflow set');
    assertEqual(s.settings.autoOrganizeMatchMode, 'exact', 'matchMode set');
  }],

  // ---------- isAncestor cycle detection ----------

  ['isAncestor detects direct parent, transitive ancestor, sibling, unrelated', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    const c = await S.createFolder('C');
    const d = await S.createFolder('D');
    await S.moveToParent(b.id, a.id);  // A -> B
    await S.moveToParent(c.id, b.id);  // A -> B -> C
    const state = await S.loadState();
    assertTrue(S.isAncestor(state, a.id, b.id), 'A is ancestor of B (direct)');
    assertTrue(S.isAncestor(state, a.id, c.id), 'A is ancestor of C (transitive)');
    assertTrue(!S.isAncestor(state, b.id, a.id), 'B is not ancestor of A (reverse)');
    assertTrue(!S.isAncestor(state, d.id, c.id), 'D is not ancestor of C (sibling/unrelated)');
    assertTrue(S.isAncestor(state, a.id, a.id), 'self-ancestor returns true (self-cycle guard)');
  }],

  // ---------- Recursive folder helpers ----------

  ['getRootFolders returns parentId-null only', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    const c = await S.createFolder('C');
    await S.moveToParent(b.id, a.id);
    const state = await S.loadState();
    const roots = await S.getRootFolders(state);
    const rootNames = roots.map(f => f.name).sort();
    assertEqual(rootNames, ['A', 'C'], 'A and C are roots, B is nested');
  }],

  ['getChildFolders returns direct children only', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    const c = await S.createFolder('C');
    const d = await S.createFolder('D');
    await S.moveToParent(b.id, a.id);
    await S.moveToParent(c.id, a.id);
    await S.moveToParent(d.id, b.id);
    const state = await S.loadState();
    const children = await S.getChildFolders(state, a.id);
    const childNames = children.map(f => f.name).sort();
    assertEqual(childNames, ['B', 'C'], 'A has direct children B and C, not D (transitive)');
  }],

  ['getDescendantFolders returns all descendants recursively', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    const c = await S.createFolder('C');
    const d = await S.createFolder('D');
    await S.moveToParent(b.id, a.id);
    await S.moveToParent(c.id, a.id);
    await S.moveToParent(d.id, b.id);
    const state = await S.loadState();
    const descendants = await S.getDescendantFolders(state, a.id);
    const names = descendants.map(f => f.name).sort();
    assertEqual(names, ['B', 'C', 'D'], 'A descendants include B, C, D');
  }],

  // ---------- moveToParent ----------

  ['moveToParent succeeds for valid root-to-child reparent', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    await S.moveToParent(b.id, a.id);
    const state = await S.loadState();
    const moved = state.folders.find(f => f.id === b.id);
    assertEqual(moved.parentId, a.id, 'B is now child of A');
  }],

  ['moveToParent accepts null to un-nest', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    await S.moveToParent(b.id, a.id);
    await S.moveToParent(b.id, null);
    const state = await S.loadState();
    const moved = state.folders.find(f => f.id === b.id);
    assertEqual(moved.parentId, null, 'B is back to root');
  }],

  ['moveToParent rejects non-existent target parent', async () => {
    const a = await S.createFolder('A');
    await assertThrows(() => S.moveToParent(a.id, 'f_doesnt_exist'), 'not found', 'rejects bad parent');
  }],

  ['moveToParent rejects self-as-parent', async () => {
    const a = await S.createFolder('A');
    await assertThrows(() => S.moveToParent(a.id, a.id), 'own parent', 'rejects self-parent');
  }],

  ['moveToParent rejects cycle (move parent under its own descendant)', async () => {
    const a = await S.createFolder('A');
    const b = await S.createFolder('B');
    const c = await S.createFolder('C');
    await S.moveToParent(b.id, a.id);  // A -> B
    await S.moveToParent(c.id, b.id);  // A -> B -> C
    // Now try to move A under C (would create A -> B -> C -> A cycle)
    await assertThrows(() => S.moveToParent(a.id, c.id), 'cycle', 'rejects descendant-as-parent');
  }]
];

async function runAll() {
  const out = document.getElementById('output');
  const stats = document.getElementById('stats');
  out.textContent = '';
  let passed = 0;
  let failed = 0;
  const lines = [];
  for (const [name, fn] of tests) {
    await wipeStorage();
    try {
      await fn();
      lines.push(`PASS  ${name}`);
      passed++;
    } catch (e) {
      lines.push(`FAIL  ${name}`);
      lines.push(`      ${e.message.replace(/\n/g, '\n      ')}`);
      failed++;
    }
    out.textContent = lines.join('\n');
  }
  const summary = `\n\n${passed} passed, ${failed} failed of ${tests.length}`;
  out.textContent += summary;
  stats.innerHTML = failed === 0
    ? `<span class="ok">All ${passed} tests passed.</span>`
    : `<span class="fail">${failed} failing</span> / ${passed} passing`;
  await refreshStats();
}

async function refreshStats() {
  const stats = document.getElementById('stats');
  try {
    const state = await S.loadState();
    const bytes = await S.getBytesInUse();
    const kb = (bytes / 1024).toFixed(2);
    stats.innerHTML = `<strong>${state.folders.length}</strong> folders, <strong>${Object.keys(state.assignments).length}</strong> assigned items, <strong>${kb} KB</strong> in use.`;
  } catch (e) {
    stats.innerHTML = `<span class="fail">Stats error: ${e.message}</span>`;
  }
}

document.getElementById('btn-backup').addEventListener('click', async () => {
  await backupCurrentState('cwcf-backup');
});

document.getElementById('btn-run').addEventListener('click', async () => {
  await backupCurrentState('cwcf-pretest-backup');
  if (!confirm('Backup downloaded to your Downloads folder. Wipe storage and run tests now?')) return;
  await wipeStorage();
  await runAll();
});

document.getElementById('btn-wipe').addEventListener('click', async () => {
  if (!confirm('Wipe all CWCF storage? This is irreversible (without a backup).')) return;
  await wipeStorage();
  await refreshStats();
  document.getElementById('output').textContent = 'Storage wiped.';
});

document.getElementById('btn-stats').addEventListener('click', refreshStats);

refreshStats();
