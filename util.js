// Today's date in the user's local time zone, as YYYY-MM-DD.
export function today() {
  return new Date().toLocaleDateString('en-CA');
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

// ---- Class days (the class meets on set weekdays; default Saturday) ----
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const iso = (d) => d.toLocaleDateString('en-CA');
const okDays = (days) => (Array.isArray(days) && days.length ? days.map(Number) : [6]);

export function isClassDay(date, days) {
  return okDays(days).includes(new Date(date + 'T00:00:00').getDay());
}

// Today if it is a class day, otherwise the most recent class day.
export function lastClassDay(days) {
  const set = okDays(days);
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    if (set.includes(d.getDay())) return iso(d);
    d.setDate(d.getDate() - 1);
  }
  return today();
}

// The last n class days up to today, oldest first.
export function classDates(days, n) {
  const set = okDays(days);
  const out = [];
  const d = new Date();
  for (let i = 0; i < 400 && out.length < n; i++) {
    if (set.includes(d.getDay())) out.unshift(iso(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

// "Saturday", "Friday & Saturday", "Thursday, Friday & Saturday"
export function classDaysLabel(days) {
  const names = okDays(days).slice().sort((a, b) => a - b).map((i) => WEEKDAYS[i]);
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names[0];
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Turn a Saudi (or international) phone number into the digits wa.me expects.
export function waNumber(raw) {
  if (!raw) return '';
  let n = String(raw).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('05') && n.length === 10) n = '966' + n.slice(1);
  else if (n.startsWith('5') && n.length === 9) n = '966' + n;
  return n;
}

// Opens WhatsApp (app or web) with a pre-filled message. Free — no API needed.
export function whatsappLink(phone, message) {
  const num = waNumber(phone);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

export const STATUS_LABELS = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
};

export function errorText(err) {
  if (!err) return '';
  return err.message || String(err);
}

// Logins made without an email get a hidden placeholder address.
export const isPlaceholderEmail = (e) => /@noemail\.quranclass\.local$/i.test(e || '');
export const realEmail = (e) => (isPlaceholderEmail(e) ? '' : e || '');

// Usernames: 3–40 letters, numbers or . _ + -  (a phone number like 0551234567 is fine)
export const USERNAME_RULE = /^[A-Za-z0-9._+-]{3,40}$/;
export function cleanUsername(v) {
  return String(v || '').trim().replace(/\s+/g, '');
}
export function usernameError(e) {
  const m = e?.message || '';
  if (/profiles_username_key|duplicate key/.test(m)) return 'That username is already taken. Please choose another.';
  if (/profiles_username_format/.test(m)) return 'Username can only use letters, numbers and . _ + - (3 to 40 characters, no spaces).';
  if (/username/.test(m) && /column/.test(m)) return 'Usernames are not installed yet. Run update-12.sql in Supabase → SQL Editor.';
  return m;
}

// ---- Groups & class limits ----
// Age in whole years today.
export function ageOf(dob) {
  if (!dob) return null;
  const b = new Date(dob + 'T00:00:00'), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a -= 1;
  return a;
}

// The group a student belongs to (same rule as the database), or null.
export function groupFor(student, groups) {
  const a = ageOf(student?.date_of_birth);
  if (a == null) return null;
  return (groups || []).slice().sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name))
    .find((g) => a >= g.min_age && a <= g.max_age && (g.gender === 'any' || g.gender === student.gender)) || null;
}

// "Group 2 – Class A · Ages 8–12 · Boys" (no repeated "Group 2").
export function classTag(c) {
  if (!c) return '';
  const name = c.name || '';
  let parts = (c.group_name || '').split(' · ').filter(Boolean);
  if (parts.length > 1 && name.toLowerCase().startsWith(parts[0].toLowerCase())) parts = parts.slice(1);
  return [name, ...parts].filter(Boolean).join(' · ');
}

// Number of enrolled students per class id.
export function classCounts(students) {
  const n = {};
  for (const s of students || []) if (s.class_id && (!s.status || s.status === 'approved')) n[s.class_id] = (n[s.class_id] || 0) + 1;
  return n;
}

export const GENDER_LABEL = { any: 'Boys & Girls', male: 'Boys', female: 'Girls' };
