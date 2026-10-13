// Today's date in the user's local time zone, as YYYY-MM-DD.
export function today() {
  return new Date().toLocaleDateString('en-CA');
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
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
