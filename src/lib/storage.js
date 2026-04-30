export const STORAGE_KEY = 'cwcf_data';
const CURRENT_SCHEMA_VERSION = 2;
const APP_VERSION = '0.1.0';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_REF_RE = /^(chat|project):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const VALID_ITEM_TYPES = ['chat', 'project'];

const FOLDER_NAME_MAX = 64;
const DESCRIPTION_MAX = 280;
const RECENT_COLORS_MAX = 8;
const RECENT_EMOJIS_MAX = 16;
const KEYWORD_MAX = 64;
const STRIP_CAP_MAX = 50;

const VALID_THEME_DENSITY = ['comfortable', 'compact'];
const VALID_AUTO_BACKUP = ['off', 'daily', 'weekly'];
const VALID_VIEW_MODE = ['default', 'organize'];
const VALID_STRIP_OVERFLOW = ['indicator', 'scroll'];
const VALID_AUTO_ORGANIZE_MATCH = ['exact', 'contains'];

function defaultSettings() {
  return {
    defaultFolderColor: '#3b82f6',
    activeTheme: 'neon-purple',
    customTheme: {},
    density: 'comfortable',
    reduceMotion: false,
    showChatCounts: true,
    quickAssignFolderId: null,
    autoBackup: 'off',
    confirmFolderDelete: true,
    recentColors: [],
    recentEmojis: [],
    searchEnabled: true,
    viewMode: 'default',
    stripCap: 6,
    stripOverflowBehavior: 'indicator',
    autoOrganizeMatchMode: 'contains'
  };
}

function defaultState() {
  return {
    version: CURRENT_SCHEMA_VERSION,
    folders: [],
    assignments: {},
    itemTitles: {},
    settings: defaultSettings(),
    lastModified: Date.now()
  };
}

async function readRaw() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) return defaultState();
  return migrateIfNeeded(result[STORAGE_KEY]);
}

async function writeRaw(state) {
  state.lastModified = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function migrateIfNeeded(state) {
  if (!state.version) return state;
  let s = state;
  if (s.version === 1) s = migrateV1ToV2(s);
  if (s.version === CURRENT_SCHEMA_VERSION) return s;
  console.warn(`[CWCF] Loaded state with unknown schema version ${s.version}, using as-is`);
  return s;
}

// Adds nested-folder fields, panel collapse state, future-use keyword field,
// and the four v0.2 settings. Migration is additive and idempotent: running
// it twice on the same v1 state produces the same v2 state.
function migrateV1ToV2(state) {
  return {
    ...state,
    version: 2,
    folders: state.folders.map(f => ({
      ...f,
      parentId: f.parentId ?? null,
      collapsed: f.collapsed ?? false,
      autoAssignKeywords: f.autoAssignKeywords ?? []
    })),
    settings: {
      ...state.settings,
      viewMode: state.settings?.viewMode ?? 'default',
      stripCap: state.settings?.stripCap ?? 6,
      stripOverflowBehavior: state.settings?.stripOverflowBehavior ?? 'indicator',
      autoOrganizeMatchMode: state.settings?.autoOrganizeMatchMode ?? 'contains'
    }
  };
}

let writeQueue = Promise.resolve();
function enqueueWrite(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.catch(() => {});
  return result;
}

export async function loadState() {
  return readRaw();
}

export async function getState() {
  return readRaw();
}

export async function getAllFolders() {
  const state = await readRaw();
  return state.folders.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

export function subscribeToChanges(cb) {
  function listener(changes, areaName) {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    cb(change.newValue, change.oldValue);
  }
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ---------- Item ref helpers ----------

export function parseItemRef(ref) {
  const m = ITEM_REF_RE.exec(ref);
  if (!m) return null;
  return { type: m[1].toLowerCase(), uuid: m[2].toLowerCase() };
}

export function formatItemRef(type, uuid) {
  if (!VALID_ITEM_TYPES.includes(type)) {
    throw new Error(`Invalid item type: ${type}`);
  }
  if (typeof uuid !== 'string' || !UUID_RE.test(uuid)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  return `${type}:${uuid.toLowerCase()}`;
}

function isValidItemRef(ref) {
  return typeof ref === 'string' && ITEM_REF_RE.test(ref);
}

// ---------- Validation ----------

function validateFolderName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > FOLDER_NAME_MAX) {
    throw new Error(`Folder name must be 1-${FOLDER_NAME_MAX} chars`);
  }
}

function validateColor(color) {
  if (typeof color !== 'string' || !COLOR_RE.test(color)) {
    throw new Error(`Invalid color: ${color}. Expected #RRGGBB hex.`);
  }
}

function validateDescription(desc) {
  if (desc === null) return;
  if (typeof desc !== 'string' || desc.length > DESCRIPTION_MAX) {
    throw new Error(`Description must be string up to ${DESCRIPTION_MAX} chars or null`);
  }
}

// Single grapheme cluster containing an Extended_Pictographic codepoint.
function validateIcon(icon) {
  if (icon === null) return;
  if (typeof icon !== 'string' || icon.length === 0) {
    throw new Error('Icon must be string or null');
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const clusters = [...segmenter.segment(icon)];
  if (clusters.length !== 1) {
    throw new Error('Icon must be exactly one grapheme cluster');
  }
  if (!/\p{Extended_Pictographic}/u.test(icon)) {
    throw new Error('Icon must be an emoji character');
  }
}

function validateItemRef(ref) {
  if (!isValidItemRef(ref)) {
    throw new Error(`Invalid item ref: ${ref}. Expected "chat:<uuid>" or "project:<uuid>".`);
  }
}

// ---------- Recent MRU lists ----------

function pushRecent(list, value, max) {
  const filtered = list.filter(x => x !== value);
  filtered.unshift(value);
  return filtered.slice(0, max);
}

// ---------- Folder mutators ----------

export async function createFolder(name, color = null) {
  validateFolderName(name);
  if (color !== null) validateColor(color);
  return enqueueWrite(async () => {
    const state = await readRaw();
    const resolvedColor = color || state.settings.defaultFolderColor;
    const maxSortOrder = state.folders.reduce((m, f) => Math.max(m, f.sortOrder), -1);
    const folder = {
      id: `f_${crypto.randomUUID()}`,
      name,
      color: resolvedColor,
      createdAt: Date.now(),
      pinned: false,
      sortOrder: maxSortOrder + 1,
      icon: null,
      description: null,
      lastUsedAt: null,
      parentId: null,
      collapsed: false,
      autoAssignKeywords: []
    };
    state.folders.push(folder);
    if (color !== null) {
      state.settings.recentColors = pushRecent(state.settings.recentColors, color, RECENT_COLORS_MAX);
    }
    await writeRaw(state);
    return folder;
  });
}

export async function renameFolder(folderId, newName) {
  validateFolderName(newName);
  return enqueueWrite(async () => {
    const state = await readRaw();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    folder.name = newName;
    await writeRaw(state);
  });
}

export async function deleteFolder(folderId) {
  return enqueueWrite(async () => {
    const state = await readRaw();
    const exists = state.folders.some(f => f.id === folderId);
    if (!exists) throw new Error(`Folder not found: ${folderId}`);
    state.folders = state.folders.filter(f => f.id !== folderId);
    for (const ref of Object.keys(state.assignments)) {
      state.assignments[ref] = state.assignments[ref].filter(id => id !== folderId);
      if (state.assignments[ref].length === 0) delete state.assignments[ref];
    }
    if (state.settings.quickAssignFolderId === folderId) {
      state.settings.quickAssignFolderId = null;
    }
    await writeRaw(state);
  });
}

export async function setFolderColor(folderId, color) {
  validateColor(color);
  return enqueueWrite(async () => {
    const state = await readRaw();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    folder.color = color;
    state.settings.recentColors = pushRecent(state.settings.recentColors, color, RECENT_COLORS_MAX);
    await writeRaw(state);
  });
}

export async function setFolderIcon(folderId, icon) {
  validateIcon(icon);
  return enqueueWrite(async () => {
    const state = await readRaw();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    folder.icon = icon;
    if (icon !== null) {
      state.settings.recentEmojis = pushRecent(state.settings.recentEmojis, icon, RECENT_EMOJIS_MAX);
    }
    await writeRaw(state);
  });
}

export async function setFolderDescription(folderId, description) {
  validateDescription(description);
  return enqueueWrite(async () => {
    const state = await readRaw();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    folder.description = description;
    await writeRaw(state);
  });
}

export async function togglePin(folderId) {
  return enqueueWrite(async () => {
    const state = await readRaw();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    folder.pinned = !folder.pinned;
    await writeRaw(state);
    return folder.pinned;
  });
}

// Accepts a permutation of all current folder IDs. sortOrder is rewritten to array index.
export async function reorderFolders(folderIdArray) {
  if (!Array.isArray(folderIdArray)) {
    throw new Error('reorderFolders expects an array of folder IDs');
  }
  return enqueueWrite(async () => {
    const state = await readRaw();
    const existing = new Set(state.folders.map(f => f.id));
    const provided = new Set(folderIdArray);
    if (existing.size !== provided.size || [...existing].some(id => !provided.has(id))) {
      throw new Error('reorderFolders array must be a permutation of all folder IDs');
    }
    const indexById = new Map(folderIdArray.map((id, i) => [id, i]));
    for (const folder of state.folders) {
      folder.sortOrder = indexById.get(folder.id);
    }
    await writeRaw(state);
  });
}

// ---------- Item assignment mutators ----------

export async function assignItemToFolder(itemRef, folderId) {
  validateItemRef(itemRef);
  return enqueueWrite(async () => {
    const state = await readRaw();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    const current = state.assignments[itemRef] || [];
    if (!current.includes(folderId)) {
      state.assignments[itemRef] = [...current, folderId];
    }
    await writeRaw(state);
  });
}

export async function removeItemFromFolder(itemRef, folderId) {
  validateItemRef(itemRef);
  return enqueueWrite(async () => {
    const state = await readRaw();
    const current = state.assignments[itemRef];
    if (!current) return;
    const filtered = current.filter(id => id !== folderId);
    if (filtered.length === 0) delete state.assignments[itemRef];
    else state.assignments[itemRef] = filtered;
    await writeRaw(state);
  });
}

export async function removeItemFromAllFolders(itemRef) {
  validateItemRef(itemRef);
  return enqueueWrite(async () => {
    const state = await readRaw();
    delete state.assignments[itemRef];
    delete state.itemTitles[itemRef];
    await writeRaw(state);
  });
}

export async function getFoldersForItem(itemRef) {
  validateItemRef(itemRef);
  const state = await readRaw();
  const folderIds = state.assignments[itemRef] || [];
  const map = new Map(state.folders.map(f => [f.id, f]));
  return folderIds.map(id => map.get(id)).filter(Boolean);
}

// Returns [] if the folder doesn't exist. Mirrors getFoldersForItem's
// graceful-on-missing behavior so callers can treat both query functions the same.
export async function getItemsInFolder(folderId) {
  if (typeof folderId !== 'string') {
    throw new Error(`folderId must be a string, got ${typeof folderId}`);
  }
  const state = await readRaw();
  return Object.entries(state.assignments)
    .filter(([_, ids]) => ids.includes(folderId))
    .map(([ref]) => ref);
}

export async function updateItemTitle(itemRef, title) {
  validateItemRef(itemRef);
  if (typeof title !== 'string') throw new Error('Title must be a string');
  return enqueueWrite(async () => {
    const state = await readRaw();
    state.itemTitles[itemRef] = title;
    await writeRaw(state);
  });
}

// ---------- Settings ----------

// Shallow merge. Each provided key is validated against its type/enum.
export async function updateSettings(partial) {
  if (!partial || typeof partial !== 'object') {
    throw new Error('updateSettings expects an object');
  }
  validateSettingsPartial(partial);
  return enqueueWrite(async () => {
    const state = await readRaw();
    state.settings = { ...state.settings, ...partial };
    await writeRaw(state);
  });
}

function validateSettingsPartial(p) {
  const checks = {
    defaultFolderColor: v => typeof v === 'string' && COLOR_RE.test(v),
    activeTheme: v => typeof v === 'string',
    customTheme: v => v && typeof v === 'object' && !Array.isArray(v),
    density: v => VALID_THEME_DENSITY.includes(v),
    reduceMotion: v => typeof v === 'boolean',
    showChatCounts: v => typeof v === 'boolean',
    quickAssignFolderId: v => v === null || typeof v === 'string',
    autoBackup: v => VALID_AUTO_BACKUP.includes(v),
    confirmFolderDelete: v => typeof v === 'boolean',
    recentColors: v => Array.isArray(v) && v.every(c => typeof c === 'string' && COLOR_RE.test(c)),
    recentEmojis: v => Array.isArray(v) && v.every(e => typeof e === 'string'),
    searchEnabled: v => typeof v === 'boolean',
    viewMode: v => VALID_VIEW_MODE.includes(v),
    stripCap: v => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= STRIP_CAP_MAX,
    stripOverflowBehavior: v => VALID_STRIP_OVERFLOW.includes(v),
    autoOrganizeMatchMode: v => VALID_AUTO_ORGANIZE_MATCH.includes(v)
  };
  for (const [key, value] of Object.entries(p)) {
    const check = checks[key];
    if (!check) throw new Error(`Unknown setting: ${key}`);
    if (!check(value)) throw new Error(`Invalid value for setting ${key}: ${JSON.stringify(value)}`);
  }
}

// ---------- Nested folder helpers ----------

// Returns true if candidateAncestorId is found in the parentId chain of
// targetFolderId. Treats targetFolderId itself as its own ancestor (self-cycle
// detection). Used by moveToParent to reject cycle-creating reparents.
export function isAncestor(state, candidateAncestorId, targetFolderId) {
  if (!candidateAncestorId || !targetFolderId) return false;
  if (candidateAncestorId === targetFolderId) return true;
  const byId = new Map(state.folders.map(f => [f.id, f]));
  let current = byId.get(targetFolderId);
  while (current) {
    if (current.id === candidateAncestorId) return true;
    if (current.parentId === null || current.parentId === undefined) return false;
    current = byId.get(current.parentId);
  }
  return false;
}

export async function getRootFolders(state) {
  const s = state ?? await readRaw();
  return s.folders.filter(f => (f.parentId ?? null) === null);
}

export async function getChildFolders(state, parentId) {
  const s = state ?? await readRaw();
  return s.folders.filter(f => (f.parentId ?? null) === parentId);
}

export async function getDescendantFolders(state, folderId) {
  const s = state ?? await readRaw();
  const out = [];
  const stack = s.folders.filter(f => (f.parentId ?? null) === folderId);
  while (stack.length > 0) {
    const f = stack.pop();
    out.push(f);
    for (const child of s.folders) {
      if ((child.parentId ?? null) === f.id) stack.push(child);
    }
  }
  return out;
}

export async function getAncestorChain(state, folderId) {
  const s = state ?? await readRaw();
  const byId = new Map(s.folders.map(f => [f.id, f]));
  const chain = [];
  let current = byId.get(folderId);
  if (!current) return chain;
  let parent = byId.get(current.parentId ?? null);
  while (parent) {
    chain.push(parent);
    parent = byId.get(parent.parentId ?? null);
  }
  return chain;
}

// Reparents folderId under newParentId (or to root if newParentId is null).
// Rejects if target parent does not exist, if the move would create a cycle,
// or if newParentId is a descendant of folderId.
export async function moveToParent(folderId, newParentId) {
  if (typeof folderId !== 'string') {
    throw new Error('folderId must be a string');
  }
  if (newParentId !== null && typeof newParentId !== 'string') {
    throw new Error('newParentId must be a string or null');
  }
  return enqueueWrite(async () => {
    const state = await readRaw();
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) throw new Error(`Folder not found: ${folderId}`);
    if (newParentId !== null) {
      const parent = state.folders.find(f => f.id === newParentId);
      if (!parent) throw new Error(`Target parent folder not found: ${newParentId}`);
      if (newParentId === folderId) {
        throw new Error('Folder cannot be its own parent');
      }
      if (isAncestor(state, folderId, newParentId)) {
        throw new Error('Cannot move folder under one of its descendants (would create a cycle)');
      }
    }
    folder.parentId = newParentId;
    await writeRaw(state);
  });
}

// ---------- Export / Import ----------

export async function exportToJson() {
  const state = await readRaw();
  const payload = {
    exportedBy: 'cwcf',
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    version: state.version,
    folders: state.folders,
    assignments: state.assignments,
    itemTitles: state.itemTitles
  };
  return JSON.stringify(payload, null, 2);
}

// mode: 'replace' wipes folders/assignments/titles. 'merge' adds non-conflicting folders.
// Settings are device-local and preserved in both modes.
export async function importFromJson(jsonString, mode = 'replace') {
  if (mode !== 'replace' && mode !== 'merge') {
    throw new Error(`Invalid import mode: ${mode}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new Error('Invalid JSON');
  }
  if (parsed.exportedBy !== 'cwcf') {
    throw new Error('Not a Claude Web Chat Folders export (missing or wrong exportedBy)');
  }
  if (typeof parsed.version !== 'number') {
    throw new Error('Invalid export: missing version');
  }
  if (parsed.version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Export is from a newer version (v${parsed.version}). Update the extension to import.`);
  }
  if (!Array.isArray(parsed.folders)) {
    throw new Error('Invalid export: folders must be an array');
  }

  const cleanFolders = sanitizeImportedFolders(parsed.folders);
  const cleanAssignments = sanitizeImportedAssignments(
    parsed.assignments || {},
    new Set(cleanFolders.map(f => f.id))
  );
  const cleanTitles = sanitizeImportedTitles(parsed.itemTitles || {});

  return enqueueWrite(async () => {
    const state = await readRaw();
    if (mode === 'replace') {
      state.folders = cleanFolders;
      state.assignments = cleanAssignments;
      state.itemTitles = cleanTitles;
    } else {
      const existingIds = new Set(state.folders.map(f => f.id));
      const additions = cleanFolders.filter(f => !existingIds.has(f.id));
      const maxSortOrder = state.folders.reduce((m, f) => Math.max(m, f.sortOrder), -1);
      additions.forEach((f, i) => { f.sortOrder = maxSortOrder + 1 + i; });
      state.folders.push(...additions);
      const importedFolderIds = new Set(cleanFolders.map(f => f.id));
      for (const [ref, ids] of Object.entries(cleanAssignments)) {
        const existing = state.assignments[ref] || [];
        const merged = [...existing];
        for (const id of ids) {
          if (importedFolderIds.has(id) && !merged.includes(id)) merged.push(id);
        }
        if (merged.length > 0) state.assignments[ref] = merged;
      }
      Object.assign(state.itemTitles, cleanTitles);
    }
    await writeRaw(state);
  });
}

function sanitizeImportedFolders(folders) {
  const out = sanitizeImportedFoldersBuild(folders);
  // Null any parentId pointing at a folder not present in the import. Prevents
  // dangling references after sanitize; cycles within the imported set are not
  // checked here (rare in practice for export-then-import) but moveToParent
  // would catch them post-import.
  const validIds = new Set(out.map(f => f.id));
  for (const f of out) {
    if (f.parentId !== null && !validIds.has(f.parentId)) {
      f.parentId = null;
    }
  }
  return out;
}

function sanitizeImportedFoldersBuild(folders) {
  const out = [];
  for (const raw of folders) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.id !== 'string' || !raw.id.startsWith('f_')) continue;
    if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > FOLDER_NAME_MAX) {
      throw new Error(`Folder "${raw.id}" has invalid name length (1-${FOLDER_NAME_MAX} chars required)`);
    }
    if (raw.description != null && (typeof raw.description !== 'string' || raw.description.length > DESCRIPTION_MAX)) {
      throw new Error(`Folder "${raw.name}" description exceeds ${DESCRIPTION_MAX} chars`);
    }
    let color = raw.color;
    if (typeof color !== 'string' || !COLOR_RE.test(color)) {
      console.warn(`[CWCF] Folder "${raw.name}" has invalid color, replacing with default`);
      color = defaultSettings().defaultFolderColor;
    }
    const importedKeywords = Array.isArray(raw.autoAssignKeywords)
      ? raw.autoAssignKeywords.filter(k => typeof k === 'string' && k.length <= KEYWORD_MAX)
      : [];
    out.push({
      id: raw.id,
      name: raw.name,
      color,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      pinned: typeof raw.pinned === 'boolean' ? raw.pinned : false,
      sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : out.length,
      icon: isValidImportedIcon(raw.icon) ? raw.icon : null,
      description: raw.description ?? null,
      lastUsedAt: typeof raw.lastUsedAt === 'number' ? raw.lastUsedAt : null,
      parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
      collapsed: typeof raw.collapsed === 'boolean' ? raw.collapsed : false,
      autoAssignKeywords: importedKeywords
    });
  }
  return out;
}

function isValidImportedIcon(icon) {
  if (icon === null || icon === undefined) return false;
  try {
    validateIcon(icon);
    return true;
  } catch {
    return false;
  }
}

function sanitizeImportedAssignments(assignments, validFolderIds) {
  const out = {};
  for (const [ref, ids] of Object.entries(assignments)) {
    if (!isValidItemRef(ref)) {
      console.warn(`[CWCF] Dropping invalid item ref from assignments: ${ref}`);
      continue;
    }
    if (!Array.isArray(ids)) continue;
    const filtered = ids.filter(id => typeof id === 'string' && validFolderIds.has(id));
    if (filtered.length > 0) out[ref] = filtered;
  }
  return out;
}

function sanitizeImportedTitles(titles) {
  const out = {};
  for (const [ref, title] of Object.entries(titles)) {
    if (!isValidItemRef(ref)) {
      console.warn(`[CWCF] Dropping invalid item ref from itemTitles: ${ref}`);
      continue;
    }
    if (typeof title === 'string') out[ref] = title;
  }
  return out;
}

// ---------- Utilities ----------

export async function getBytesInUse() {
  return chrome.storage.local.getBytesInUse(STORAGE_KEY);
}
