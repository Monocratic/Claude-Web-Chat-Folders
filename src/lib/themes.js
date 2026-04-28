const TOKEN_NAMES = [
  'bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-elevated',
  'border-subtle', 'border-default', 'border-focus',
  'text-primary', 'text-secondary', 'text-tertiary',
  'accent-primary', 'accent-secondary', 'accent-danger', 'accent-warning', 'accent-success',
  'inject-button-bg', 'inject-button-text'
];

export const PRESETS = {
  'neon-purple': {
    label: 'Neon Purple',
    tokens: {
      'bg-primary': '#0E0B1A',
      'bg-secondary': '#1E1830',
      'bg-tertiary': '#2A2240',
      'bg-elevated': '#322748',
      'border-subtle': '#3D3252',
      'border-default': '#4D4262',
      'border-focus': '#A78BFA',
      'text-primary': '#E5E0F0',
      'text-secondary': '#C4B8DC',
      'text-tertiary': '#9A8FB5',
      'accent-primary': '#A78BFA',
      'accent-secondary': '#6D4DCD',
      'accent-danger': '#FF6B9D',
      'accent-warning': '#F0B14A',
      'accent-success': '#6FD08C',
      'inject-button-bg': 'rgba(167, 139, 250, 0.15)',
      'inject-button-text': '#A78BFA'
    }
  },
  // STUB. Final palette TBD. Distinguishable hue family so the preset switcher is testable.
  'vscode-dark': {
    label: 'VS Code Dark',
    tokens: {
      'bg-primary': '#1E1E1E',
      'bg-secondary': '#252526',
      'bg-tertiary': '#2D2D30',
      'bg-elevated': '#383838',
      'border-subtle': '#3C3C3C',
      'border-default': '#5A5A5A',
      'border-focus': '#007FD4',
      'text-primary': '#CCCCCC',
      'text-secondary': '#969696',
      'text-tertiary': '#6A6A6A',
      'accent-primary': '#007ACC',
      'accent-secondary': '#0E5A94',
      'accent-danger': '#F48771',
      'accent-warning': '#DCDCAA',
      'accent-success': '#4EC9B0',
      'inject-button-bg': 'rgba(0, 122, 204, 0.15)',
      'inject-button-text': '#007ACC'
    }
  },
  // STUB. Final palette TBD. Cream/tan/amber to feel claude.ai-adjacent.
  'claude-warm': {
    label: 'Claude Warm',
    tokens: {
      'bg-primary': '#FAF7F0',
      'bg-secondary': '#F0EBE0',
      'bg-tertiary': '#E8E1D0',
      'bg-elevated': '#FFFCF5',
      'border-subtle': '#D9CFB8',
      'border-default': '#B8A88C',
      'border-focus': '#C9762D',
      'text-primary': '#2A2A2A',
      'text-secondary': '#5A5043',
      'text-tertiary': '#8A7E6C',
      'accent-primary': '#C9762D',
      'accent-secondary': '#A55A1B',
      'accent-danger': '#B83C3C',
      'accent-warning': '#D9A03B',
      'accent-success': '#5A8A5A',
      'inject-button-bg': 'rgba(201, 118, 45, 0.15)',
      'inject-button-text': '#C9762D'
    }
  },
  // STUB. WCAG AAA target. Final palette TBD.
  'high-contrast': {
    label: 'High Contrast',
    tokens: {
      'bg-primary': '#FFFFFF',
      'bg-secondary': '#F0F0F0',
      'bg-tertiary': '#E0E0E0',
      'bg-elevated': '#FFFFFF',
      'border-subtle': '#000000',
      'border-default': '#000000',
      'border-focus': '#FFD700',
      'text-primary': '#000000',
      'text-secondary': '#000000',
      'text-tertiary': '#000000',
      'accent-primary': '#0000FF',
      'accent-secondary': '#000080',
      'accent-danger': '#CC0000',
      'accent-warning': '#B8860B',
      'accent-success': '#006400',
      'inject-button-bg': '#FFFFFF',
      'inject-button-text': '#000000'
    }
  },
  // Solarized Dark canonical palette (Ethan Schoonover). These values are the
  // published reference; the preset is stable, not a stub.
  'solarized-dark': {
    label: 'Solarized Dark',
    tokens: {
      'bg-primary': '#002B36',
      'bg-secondary': '#073642',
      'bg-tertiary': '#094450',
      'bg-elevated': '#0E5063',
      'border-subtle': '#586E75',
      'border-default': '#657B83',
      'border-focus': '#268BD2',
      'text-primary': '#FDF6E3',
      'text-secondary': '#93A1A1',
      'text-tertiary': '#839496',
      'accent-primary': '#268BD2',
      'accent-secondary': '#2AA198',
      'accent-danger': '#DC322F',
      'accent-warning': '#B58900',
      'accent-success': '#859900',
      'inject-button-bg': 'rgba(38, 139, 210, 0.15)',
      'inject-button-text': '#268BD2'
    }
  }
};

export const DEFAULT_PRESET_ID = 'neon-purple';

export function getPreset(id) {
  return PRESETS[id] || PRESETS[DEFAULT_PRESET_ID];
}

export function listPresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({ id, label: preset.label }));
}

// Resolves the active preset's tokens with the user's customTheme overrides applied on top.
// Custom keys that don't match a known token name are ignored.
export function resolveTheme(activeThemeId, customTheme = {}) {
  const preset = getPreset(activeThemeId);
  const merged = { ...preset.tokens };
  for (const [key, value] of Object.entries(customTheme)) {
    if (TOKEN_NAMES.includes(key) && typeof value === 'string') {
      merged[key] = value;
    }
  }
  return merged;
}

// Writes the resolved tokens to the target element as CSS custom properties.
// Prefixes each name with -- and sets via inline style.
export function applyTheme(tokens, target = document.documentElement) {
  for (const [name, value] of Object.entries(tokens)) {
    target.style.setProperty(`--${name}`, value);
  }
}

export { TOKEN_NAMES };
