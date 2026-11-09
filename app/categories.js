// Note categories: one focus area per note (migration 041). Labels are picked here by language rather than through the
// page translator, because "Sync" and "Other" already mean something else elsewhere in the app (calendar sync, other events).
import { isKo } from './i18n.js';

// key, English, Korean, color (a dot next to the label, readable on light and dark), what it covers
export const CATEGORIES = [
  ['timing', 'Timing', '타이밍', '#3b9eff', 'On the beat, accents, musicality', '박자, 액센트, 음악 해석'],
  ['technique', 'Technique', '동작', '#8b7cff', 'Angles, lines, depth, details', '각도, 라인, 깊이, 디테일'],
  ['sync', 'Sync', '싱크', '#f0609e', 'Matching each other', '멤버 간 합 맞추기'],
  ['formation', 'Formation', '동선', '#22b37a', 'Spacing, positions, traffic', '대형, 간격, 위치, 이동'],
  ['performance', 'Performance', '표현', '#f5a524', 'Facials, energy, focus', '표정, 에너지, 시선'],
  ['other', 'Other', '기타', '#8e96a3', 'Anything else', '그 밖의 피드백']
];
const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c[0], c]));

export const catLabel = (key) => (BY_KEY[key] ? BY_KEY[key][isKo ? 2 : 1] : '');
export const catHint = (key) => (BY_KEY[key] ? BY_KEY[key][isKo ? 5 : 4] : '');
export const catColor = (key) => BY_KEY[key]?.[3] || '#8e96a3';
// The topics a note can start from (no "Other"; "Sync" only when there's someone to sync with).
export const starterKeys = (solo) => CATEGORIES.map((c) => c[0]).filter((k) => k !== 'other' && !(solo && k === 'sync'));
// A chip: a colored dot and the label (already in the page's language, so the translator leaves it alone).
export const catChip = (key, attrs = '') => (key ? `<span class="cat-chip" style="--cat:${catColor(key)}" ${attrs}>${catLabel(key)}</span>` : '');
