const STORAGE_KEY = 'cwcf_data';
const CURRENT_SCHEMA_VERSION = 1;
const APP_VERSION = '0.1.0';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_REF_RE = /^(chat|project):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const VALID_ITEM_TYPES = ['chat', 'project'];

const FOLDER_NAME_MAX = 64;
const DESCRIPTION_MAX = 280;
const RECENT_COLORS_MAX = 8;
const RECENT_EMOJIS_MAX = 16;

const VALID_THEME_DENSITY = ['comfortable', 'compact'];
const VALID_INJECT_BUTTON_STYLE = ['dot', 'icon', 'pill'];
const VALID_INJECT_BUTTON_POSITION = ['right', 'left', 'hoverOnly'];
const VALID_AUTO_BACKUP = ['off', 'daily', 'weekly'];

function defaultSettings() {
  return {
    showInjectButtons: true,
    defaultFolderColor: '#3b82f6',
    activeTheme: 'neon-purple',
    customTheme: {},
    density: 'comfortable',
    reduceMotion: false,
    injectButtonStyle: 'icon',
    injectButtonPosition: 'right',
    showFolderDots: true,
    showChatCounts: true,
    quickAssignFolderId: null,
    autoBackup: 'off',
    confirmFolderDelete: true,
    recentColors: [],
    recentEmojis: [],
    searchEnabled: true
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
  if (!state.version || state.version === CURRENT_SCHEMA_VERSION) return state;
  console.warn(`[CWCF] Loaded state with unknown schema version ${state.version}, using as-is`);
  return state;
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
      lastUsedAt: null
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

export async function getItemsInFolder(folderId) {
  const state = await readRaw();
  if (!state.folders.some(f => f.id === folderId)) {
    throw new Error(`Folder not found: ${folderId}`);
  }
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
    showInjectButtons: v => typeof v === 'boolean',
    defaultFolderColor: v => typeof v === 'string' && COLOR_RE.test(v),
    activeTheme: v => typeof v === 'string',
    customTheme: v => v && typeof v === 'object' && !Array.isArray(v),
    density: v => VALID_THEME_DENSITY.includes(v),
    reduceMotion: v => typeof v === 'boolean',
    injectButtonStyle: v => VALID_INJECT_BUTTON_STYLE.includes(v),
    injectButtonPosition: v => VALID_INJECT_BUTTON_POSITION.includes(v),
    showFolderDots: v => typeof v === 'boolean',
    showChatCounts: v => typeof v === 'boolean',
    quickAssignFolderId: v => v === null || typeof v === 'string',
    autoBackup: v => VALID_AUTO_BACKUP.includes(v),
    confirmFolderDelete: v => typeof v === 'boolean',
    recentColors: v => Array.isArray(v) && v.every(c => typeof c === 'string' && COLOR_RE.test(c)),
    recentEmojis: v => Array.isArray(v) && v.every(e => typeof e === 'string'),
    searchEnabled: v => typeof v === 'boolean'
  };
  for (const [key, value] of Object.entries(p)) {
    const check = checks[key];
    if (!check) throw new Error(`Unknown setting: ${key}`);
    if (!check(value)) throw new Error(`Invalid value for setting ${key}: ${JSON.stringify(value)}`);
  }
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
    out.push({
      id: raw.id,
      name: raw.name,
      color,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      pinned: typeof raw.pinned === 'boolean' ? raw.pinned : false,
      sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : out.length,
      icon: isValidImportedIcon(raw.icon) ? raw.icon : null,
      description: raw.description ?? null,
      lastUsedAt: typeof raw.lastUsedAt === 'number' ? raw.lastUsedAt : null
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

// Test page only. Restores to fully-empty default state.
export async function _wipeAll() {
  return enqueueWrite(async () => {
    await chrome.storage.local.remove(STORAGE_KEY);
  });
}
