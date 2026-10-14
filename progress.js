// Shared labels for student progress (update-17).
export const KINDS = [
  ['hifz', 'Hifz (new memorisation)'],
  ['revision', 'Revision (muraja\'ah)'],
  ['reading', 'Recitation (tilawah / nazira)'],
  ['qaida', 'Qaida'],
  ['tajweed', 'Tajweed'],
  ['other', 'Other'],
];
export const KIND_LABEL = Object.fromEntries(KINDS.map(([k, v]) => [k, v.split(' (')[0]]));

export const GRADES = [
  ['excellent', 'Excellent'],
  ['very_good', 'Very good'],
  ['good', 'Good'],
  ['fair', 'Fair'],
  ['needs_work', 'Needs more practice'],
];
export const GRADE_LABEL = Object.fromEntries(GRADES);
