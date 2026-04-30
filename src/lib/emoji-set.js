// Curated emoji set for the folder icon picker. 136 entries across 9 categories.
//
// Each glyph is written with U+FE0F variation selector (\u{FE0F}) where the
// codepoint defaults to monochrome text presentation on some platforms,
// notably Windows. The grapheme cluster validator in storage.js treats
// <base> and <base>+FE0F as a single cluster, so adding the selector here
// does not affect storage validation. Selector is appended explicitly via
// escape sequence to survive any encoding round-trip in source files.

const VS = '\u{FE0F}';

export const EMOJI_CATEGORIES = [
  {
    id: 'work',
    label: 'Work & Business',
    emojis: [
      '💼', '🏢', '🏦', '📊', '📈', '📉', '💰', '💵', '💳',
      '📅', '📋', '📝', '📁', '📂', '✉' + VS, '📧', '📞', '📦'
    ]
  },
  {
    id: 'tools',
    label: 'Tools & Tech',
    emojis: [
      '🔧', '🔨', '🛠' + VS, '⚙' + VS,
      '🖥' + VS, '💻', '⌨' + VS, '🖱' + VS, '🖨' + VS,
      '💾', '🔌', '🔋', '🌐', '📡',
      '🔒', '🔓', '🔑', '📱', '🤖', '🧰', '🪛', '🐛', '🔐'
    ]
  },
  {
    id: 'knowledge',
    label: 'Knowledge & Learning',
    emojis: [
      '📚', '📖', '📕', '📔', '📓',
      '🧠', '💡', '🔍', '📜', '🔬', '🔭', '🎓', '✏' + VS, '📐'
    ]
  },
  {
    id: 'creative',
    label: 'Creative & Media',
    emojis: [
      '🎨', '🖊' + VS, '✒' + VS,
      '📷', '🎥', '🎬', '🎤', '🎧',
      '🎵', '🎶', '🎼', '🖼' + VS, '🎭'
    ]
  },
  {
    id: 'status',
    label: 'Status & Markers',
    emojis: [
      '⭐', '🌟', '🔥', '💎', '🏆',
      '🚩', '🏁', '📍', '📌', '🔖',
      '⚠' + VS, '✅', '❌', '❗', '❓', '⛔', '🎯', '💯', '🆕'
    ]
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle & Home',
    emojis: [
      '☕', '🌱', '🐶', '🐱', '🏠',
      '🛋' + VS, '🛏' + VS, '🏋' + VS, '💤', '🪴', '🎮'
    ]
  },
  {
    id: 'nature',
    label: 'Nature & Weather',
    emojis: [
      '☀' + VS, '🌙', '☁' + VS, '🌧' + VS,
      '❄' + VS, '🌊', '🌍', '🏔' + VS, '🌲', '🌴', '🌾'
    ]
  },
  {
    id: 'travel',
    label: 'Travel & Places',
    emojis: [
      '✈' + VS, '🚗', '🚂', '🚢', '🚀',
      '🗺' + VS, '🧳', '🏨', '⛺', '🏖' + VS, '🏛' + VS
    ]
  },
  {
    id: 'shapes',
    label: 'Shapes & Colors',
    emojis: [
      '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪',
      '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🔶', '🔷'
    ]
  }
];

export function getAllEmojis() {
  return EMOJI_CATEGORIES.flatMap(c => c.emojis);
}
