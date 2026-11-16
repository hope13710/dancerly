// Note categories: one focus area per note (migration 041).

// key, label, color (a dot next to the label, readable on light and dark), what it covers
export const CATEGORIES = [
  ['timing', 'Timing', '#3b9eff', 'On the beat, accents, musicality'],
  ['technique', 'Technique', '#8b7cff', 'Angles, lines, depth, details'],
  ['sync', 'Sync', '#f0609e', 'Matching each other'],
  ['formation', 'Formation', '#22b37a', 'Spacing, positions, traffic'],
  ['performance', 'Performance', '#f5a524', 'Facials, energy, focus'],
  ['other', 'Other', '#8e96a3', 'Anything else']
];
const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c[0], c]));

export const catLabel = (key) => (BY_KEY[key] ? BY_KEY[key][1] : '');
export const catHint = (key) => (BY_KEY[key] ? BY_KEY[key][3] : '');
export const catColor = (key) => BY_KEY[key]?.[2] || '#8e96a3';
// The topics a note can start from (no "Other"; "Sync" only when there's someone to sync with).
export const starterKeys = (solo) => CATEGORIES.map((c) => c[0]).filter((k) => k !== 'other' && !(solo && k === 'sync'));
// A chip: a colored dot and the label.
export const catChip = (key, attrs = '') => (key ? `<span class="cat-chip" style="--cat:${catColor(key)}" ${attrs}>${catLabel(key)}</span>` : '');
