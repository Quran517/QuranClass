import { supabase } from './supabase.js';
import { getSettings } from './settings.js';
import { downloadPdf } from './exports.js';
import { formatDate } from './util.js';

// ---------- money ----------
export const cur = () => getSettings().fin_currency || 'SAR';
export const money = (n, withCur = true) => {
  const v = Number(n || 0);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return withCur ? `${cur()} ${s}` : s;
};
export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ---------- months & years ----------
export const monthStart = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`; };
export const monthLabel = (m) => new Date(m + (m.length === 7 ? '-01' : '') + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
export const addMonths = (m, n) => { const d = new Date(m + 'T00:00:00'); d.setMonth(d.getMonth() + n); return monthStart(d); };
export const monthEnd = (m) => { const d = new Date(addMonths(m, 1) + 'T00:00:00'); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Financial year from the academic year label ("2026–2027") and the start month (9 = September)
export function finYear(label, startMonth) {
  const st = getSettings();
  const lab = label || st.academic_year || '';
  const sm = Number(startMonth || st.fin_year_start || 9);
  const y = Number((String(lab).match(/(\d{4})/) || [])[1]) || new Date().getFullYear();
  const from = `${y}-${String(sm).padStart(2, '0')}-01`;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(from, i));
  return { label: lab, from, to: monthEnd(months[11]), months };
}
export function yearLabels() {
  const y = Number((String(getSettings().academic_year || '').match(/(\d{4})/) || [])[1]) || new Date().getFullYear();
  return [y - 1, y, y + 1].map((a) => `${a}–${a + 1}`);
}

// ---------- shared data ----------
export const fetchCategories = () => supabase.from('fin_categories').select('*').order('kind').order('sort').order('name');
export const fetchMethods = () => supabase.from('fin_methods').select('*').order('sort').order('name');
export const isMissing = (err) => /fin_|fee_|payslip|staff_pay|schema cache|does not exist/i.test(String(err?.message || err || ''));
export const NEEDS_SQL = 'Finance needs a database update — run update-28.sql in Supabase → SQL Editor, then refresh this page.';

// ---------- statement: fees charged vs paid, oldest first ----------
// charges: fee_charges rows; payments: income fin_entries for the student (active only)
export function statement(charges, payments) {
  const lines = [
    ...charges.filter((c) => c.status === 'active').map((c) => ({ date: c.period_start, kind: 'charge', ref: c.period_label, text: (c.fee_plans?.name || 'Fee') + ' — ' + c.period_label, debit: round2(c.amount - c.discount), note: c.discount > 0 ? `Discount ${money(c.discount)}${c.discount_note ? ' · ' + c.discount_note : ''}` : '', due: c.due_date, id: c.id })),
    ...payments.filter((p) => p.status === 'active').map((p) => ({ date: p.entry_date, kind: 'payment', ref: p.entry_no, text: `Payment ${p.entry_no}${p.method ? ' · ' + p.method : ''}`, credit: round2(p.amount), note: p.details || '', id: p.id })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'charge' ? -1 : 1));
  let bal = 0;
  for (const l of lines) { bal = round2(bal + (l.debit || 0) - (l.credit || 0)); l.balance = bal; }
  const charged = round2(lines.reduce((n, l) => n + (l.debit || 0), 0));
  const paid = round2(lines.reduce((n, l) => n + (l.credit || 0), 0));
  // which charges are still open (payments pay the oldest first)
  let left = paid;
  const open = [];
  for (const l of lines.filter((x) => x.kind === 'charge')) {
    const take = Math.min(left, l.debit); left = round2(left - take);
    const owe = round2(l.debit - take);
    if (owe > 0) open.push({ ...l, owe });
  }
  return { lines, charged, paid, balance: round2(charged - paid), open, credit: left };
}

export const statusOf = (s) => (s.charged === 0 ? 'none' : s.balance <= 0 ? 'paid' : s.paid > 0 ? 'part' : 'unpaid');
export const STATUS_TEXT = { paid: 'Paid', part: 'Part paid', unpaid: 'Not paid', none: 'No fees' };

// age of the oldest unpaid fee, in months
export function ageBucket(open, on = new Date()) {
  if (!open.length) return '';
  const d = new Date((open[0].due || open[0].date) + 'T00:00:00');
  const months = (on.getFullYear() - d.getFullYear()) * 12 + (on.getMonth() - d.getMonth());
  return months <= 0 ? 'Current' : months === 1 ? '1 month' : months === 2 ? '2 months' : '3+ months';
}

// ---------- receipt PDF ----------
export async function receiptPdf({ entries, studentNames, family, balanceAfter, print = false }) {
  const st = getSettings();
  const list = Array.isArray(entries) ? entries : [entries];
  const total = round2(list.reduce((n, e) => n + Number(e.amount), 0));
  const first = list[0];
  await downloadPdf(`receipt-${list.map((e) => e.entry_no).join('-')}.pdf`, {
    title: `Payment receipt ${list.map((e) => e.entry_no).join(', ')}`,
    subtitle: `${formatDate(first.entry_date)}   ·   ${st.school_name}`,
    orientation: 'portrait',
    print,
    tables: [
      { heading: 'Received from', columns: ['Name', 'For', 'Method', 'Reference'], rows: [[first.party || family || '—', studentNames || '—', first.method || '—', first.reference || '—']], compact: true },
      { heading: 'Details', columns: ['Receipt no.', 'Student', 'Details', `Amount (${cur()})`], rows: list.map((e) => [e.entry_no, e.student_label || '', e.details || '', money(e.amount, false)]), compact: true },
      { heading: 'Total', columns: ['Total received', ...(balanceAfter != null ? ['Balance still to pay'] : [])], rows: [[money(total), ...(balanceAfter != null ? [money(balanceAfter)] : [])]], compact: true },
    ],
    signatures: ['Received by', 'Treasurer / Admin'],
  });
}

export function receiptText({ entries, family, studentNames, balanceAfter }) {
  const st = getSettings();
  const list = Array.isArray(entries) ? entries : [entries];
  const total = round2(list.reduce((n, e) => n + Number(e.amount), 0));
  return `Assalamu Alaikum ${family || 'Parent'},\n\nJazakAllahu khairan — we received ${money(total)} on ${formatDate(list[0].entry_date)}${studentNames ? ` for ${studentNames}` : ''}.\nReceipt: ${list.map((e) => e.entry_no).join(', ')}${list[0].method ? ` (${list[0].method})` : ''}` +
    (balanceAfter != null ? `\nBalance still to pay: ${money(balanceAfter)}` : '') + `\n\n${st.school_name}`;
}

// ---------- attachments ----------
// images are made smaller (max 1400 px) before saving; PDFs up to 1.5 MB
export async function fileToData(file) {
  if (/^image\//.test(file.type)) {
    const img = await createImageBitmap(file);
    const r = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.65, 0.5]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 900000) return { data: d, mime: 'image/jpeg', size: Math.round(d.length * 0.75) }; }
    throw new Error('That photo is too large.');
  }
  if (file.type === 'application/pdf') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('PDF is larger than 1.5 MB — please attach a photo instead.');
    const d = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    return { data: d, mime: 'application/pdf', size: file.size };
  }
  throw new Error('Please attach a photo (JPG / PNG) or a PDF.');
}
export async function openFile(id) {
  const { data } = await supabase.from('fin_files').select('name, data, mime').eq('id', id).single();
  if (!data) return;
  const w = window.open();
  if (w) w.document.write(/^image\//.test(data.mime) ? `<title>${data.name}</title><img src="${data.data}" style="max-width:100%">` : `<title>${data.name}</title><iframe src="${data.data}" style="border:0;width:100%;height:100vh"></iframe>`);
}
