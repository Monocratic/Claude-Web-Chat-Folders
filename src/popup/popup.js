// Repurposed v0.3.0 popup. Status, master UI toggle, and quick actions.
// All folder management lives in the in-page settings overlay
// (src/content/settings-overlay.js). The popup's job is to be the
// always-available status surface even when the user isn't on
// claude.ai, plus the master switch for hiding the in-page UI.

import * as S from '../lib/storage.js';
import { resolveTheme, applyTheme } from '../lib/themes.js';

const $ = (id) => document.getElementById(id);

const els = {
  status: $('popup-status'),
  statusText: $('popup-status-text'),
  toggle: $('popup-ui-toggle'),
  btnSettings: $('popup-btn-settings'),
  btnSync: $('popup-btn-sync'),
  version: $('popup-version')
};

let state = null;

init().catch(err => console.error('[CWCF popup] init failed', err));

async function init() {
  els.version.textContent = `v${chrome.runtime.getManifest().version}`;

  state = await S.loadState();
  applyPopupTheme();
  renderToggle();

  const tab = await getActiveClaudeTab();
  renderStatus(tab);
  els.btnSync.disabled = !tab;

  els.toggle.addEventListener('change', onToggle);
  els.btnSettings.addEventListener('click', onOpenSettings);
  els.btnSync.addEventListener('click', onSync);

  S.subscribeToChanges((next) => {
    state = next || state;
    applyPopupTheme();
    renderToggle();
  });
}

function applyPopupTheme() {
  const settings = state?.settings || {};
  const tokens = resolveTheme(settings.activeTheme || 'neon-purple', settings.customTheme || {});
  applyTheme(tokens, document.documentElement);
}

function renderToggle() {
  const enabled = state?.settings?.uiEnabled !== false;
  els.toggle.checked = enabled;
}

function renderStatus(tab) {
  if (tab) {
    els.status.dataset.state = 'active';
    els.statusText.textContent = 'Active on claude.ai';
  } else {
    els.status.dataset.state = 'idle';
    els.statusText.textContent = 'Open claude.ai to use the folder UI';
  }
}

async function getActiveClaudeTab() {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
      url: 'https://claude.ai/*'
    });
    return tabs[0] || null;
  } catch {
    return null;
  }
}

async function onToggle(e) {
  const next = !!e.target.checked;
  try {
    await S.updateSettings({ uiEnabled: next });
  } catch (err) {
    console.error('[CWCF popup] toggle failed', err);
    e.target.checked = !next;
  }
}

async function onOpenSettings() {
  const tab = await getActiveClaudeTab();
  if (!tab) {
    chrome.tabs.create({ url: 'https://claude.ai/' });
    window.close();
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'cwcf:openSettingsOverlay' });
  } catch (err) {
    console.warn('[CWCF popup] open settings dispatch failed; opening claude.ai', err);
    chrome.tabs.create({ url: 'https://claude.ai/' });
  }
  window.close();
}

async function onSync() {
  const tab = await getActiveClaudeTab();
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'cwcf:triggerSync' });
  } catch (err) {
    console.warn('[CWCF popup] sync dispatch failed', err);
  }
  window.close();
}
