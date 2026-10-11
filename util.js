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
