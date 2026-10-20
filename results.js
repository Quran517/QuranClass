// Exams, results, report cards and certificates (update-18).
import { supabase } from './supabase.js';
import { getSettings } from './settings.js';
import { downloadPdf, finishPdf, logoData } from './exports.js';
import { formatDate } from './util.js';

export const EXAM_STATUS = {
  draft: ['Draft', 'pending'],
  submitted: ['Submitted', 'late'],
  finalized: ['Finalized', 'approved'],
};
export const CERT_STATUS = {
  draft: ['Draft', 'inactive'],
  submitted: ['Submitted', 'pending'],
  pending_approval: ['Pending approval', 'late'],
  approved: ['Approved', 'approved'],
  rejected: ['Rejected', 'rejected'],
  issued: ['Issued', 'present'],
};

const sorted = (rows, key = 'sort') => (rows || []).slice().sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0) || String(a.name).localeCompare(String(b.name)));

// Everything the exam pages need about the school's setup.
export async function fetchSetup() {
  const [years, subjects, types, grades, templates] = await Promise.all([
    supabase.from('academic_years').select('*').order('name', { ascending: false }),
    supabase.from('subjects').select('*').order('sort'),
    supabase.from('exam_types').select('*').order('sort'),
    supabase.from('grade_rules').select('*').order('min_pct', { ascending: false }),
    supabase.from('certificate_templates').select('*').order('sort'),
  ]);
  const err = [years, subjects, types, grades, templates].find((r) => r.error)?.error;
  if (err) {
    const missing = /academic_years|subjects|exam_types|grade_rules|certificate_templates|does not exist/.test(err.message);
    throw new Error(missing ? 'Exams are not installed yet. Run update-18.sql in Supabase → SQL Editor.' : err.message);
  }
  return {
    years: years.data, subjects: sorted(subjects.data), types: sorted(types.data),
    grades: grades.data, templates: sorted(templates.data),
    currentYear: (years.data.find((y) => y.is_current) || years.data[0])?.name || getSettings().academic_year,
  };
}

export function gradeOf(pct, grades) {
  if (pct == null || Number.isNaN(pct)) return '';
  return (grades || []).find((g) => pct >= Number(g.min_pct))?.grade || '';
}
export function gradeRemark(grade, grades) {
  return (grades || []).find((g) => g.grade === grade)?.remark || '';
}
export const pctOf = (marks, max) => (marks == null || !max ? null : Math.round((Number(marks) * 1000) / Number(max)) / 10);

// Group result rows (from exam_results) into report cards:
// one card per academic year + exam type + term.
export function reportCards(rows, { types, subjects, grades }) {
  const by = {};
  for (const r of rows) {
    const key = `${r.academic_year}|${r.exam_type}|${r.term || ''}`;
    (by[key] ||= { key, academic_year: r.academic_year, exam_type: r.exam_type, term: r.term || '', rows: [] }).rows.push(r);
  }
  return Object.values(by).map((c) => {
    const total = c.rows.reduce((a, r) => a + Number(r.marks || 0), 0);
    const max = c.rows.reduce((a, r) => a + Number(r.max_marks || 0), 0);
    const pct = max ? Math.round((total * 1000) / max) / 10 : null;
    const type = (types || []).find((t) => t.code === c.exam_type);
    return {
      ...c,
      typeName: type?.name || c.exam_type,
      sort: type?.sort ?? 0,
      total, max, pct,
      grade: gradeOf(pct, grades),
      passed: c.rows.every((r) => r.passed),
      published: c.rows.every((r) => r.published_at),
      subjectName: (id) => (subjects || []).find((s) => s.id === id)?.name || '',
    };
  }).sort((a, b) => b.academic_year.localeCompare(a.academic_year) || b.sort - a.sort || b.term.localeCompare(a.term));
}

// Report card PDF (portrait A4) — print or download.
export function reportCardPdf({ student, className, card, subjects, grades }, print = false) {
  const subj = (id) => (subjects || []).find((s) => s.id === id)?.name || '';
  return downloadPdf(`report-card-${student.student_code}-${card.academic_year}-${card.exam_type}${card.term ? '-' + card.term : ''}.pdf`.replace(/[^\w.-]+/g, '_'), {
    orientation: 'portrait',
    print,
    title: `Report card · ${card.typeName}${card.term ? ' · ' + card.term : ''} · ${card.academic_year}`,
    subtitle: `${student.full_name} (${student.student_code})${student.admission_no ? ' · Adm ' + student.admission_no : ''}${className ? ' · ' + className : ''}`,
    tables: [{
      columns: ['Subject', 'Exam', 'Date', 'Marks', 'Max', '%', 'Grade', 'Result', 'Remark'],
      rows: [
        ...card.rows.map((r) => [subj(r.subject_id), r.title, formatDate(r.exam_date), r.absent ? 'Absent' : r.marks ?? '—', r.max_marks, r.pct ?? '—', r.grade || '—', r.passed ? 'Pass' : 'Fail', r.remark || '']),
        [{ content: 'Total', colSpan: 3, styles: { fontStyle: 'bold' } }, card.total, card.max, card.pct ?? '—', card.grade, card.passed ? 'PASS' : 'FAIL', gradeRemark(card.grade, grades)],
      ],
    }],
  });
}

export function fillTemplate(text, v) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] != null && v[k] !== '' ? v[k] : m === '{grade}' || m === '{percent}' ? '—' : ''));
}

export function certificateValues(cert, { student, className, types, templates }) {
  const t = (templates || []).find((x) => x.code === cert.certificate_type) || {};
  const exam = (types || []).find((x) => x.code === cert.exam_type)?.name || cert.exam_type;
  const v = {
    student: student?.full_name || '', class: className || '', year: cert.academic_year, exam,
    grade: cert.result_grade || '', percent: cert.result_pct ?? '', type: t.name || cert.certificate_type,
  };
  const iso = (x) => (x == null || x === '' ? x : `\u2066${x}\u2069`);
  const va = { ...v, student: iso(v.student), class: iso(v.class), year: iso(String(v.year || '').replace(/[–—]/g, '-')), grade: iso(v.grade), exam: iso(v.exam), type: iso(v.type) };
  return { t, v, body: fillTemplate(t.body, v), bodyAr: t.body_ar ? fillTemplate(t.body_ar, va) : '' };
}


// Draw Arabic text with the browser (correct letter joining and right-to-left order) as an image for the PDF.
function arabicImg(text, { size = 14, color = '#1c2f55', bold = false, maxW = 600 } = {}) {
  const k = 4;
  const font = `${bold ? 700 : 400} ${size * k}px Amiri, 'Traditional Arabic', 'Arabic Typesetting', serif`;
  const m = document.createElement('canvas').getContext('2d');
  m.font = font; m.direction = 'rtl';
  const lines = []; let cur = '';
  for (const w of String(text).split(/\s+/)) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && m.measureText(t).width > maxW * k) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  const lh = size * k * 1.6;
  const c = document.createElement('canvas');
  c.width = Math.ceil(Math.max(...lines.map((l) => m.measureText(l).width), 10)) + 16;
  c.height = Math.ceil(lh * lines.length);
  const g = c.getContext('2d');
  g.font = font; g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
  lines.forEach((l, i) => g.fillText(l, c.width / 2, lh * (i + 0.5)));
  return { url: c.toDataURL('image/png'), w: c.width / k, h: c.height / k };
}

// Certificate PDF (landscape A4, English + Arabic) drawn with the school logo and colours.
export async function certificatePdf(cert, ctx, print = false) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), loadArabicFont()]);
  const s = getSettings();
  const { t, v, body, bodyAr } = certificateValues(cert, ctx);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const navy = [28, 47, 85], orange = [224, 116, 20], gold = [176, 141, 57];
  const ar = (text, y, opt) => { if (!text) return y; const im = arabicImg(text, opt); doc.addImage(im.url, 'PNG', W / 2 - im.w / 2, y, im.w, im.h); return y + im.h; };
  doc.setFillColor(255, 253, 247); doc.rect(0, 0, W, H, 'F');
  doc.setDrawColor(...navy); doc.setLineWidth(10); doc.rect(18, 18, W - 36, H - 36);
  doc.setDrawColor(...gold); doc.setLineWidth(1.5); doc.rect(34, 34, W - 68, H - 68);
  doc.setDrawColor(...orange); doc.setLineWidth(0.8); doc.rect(40, 40, W - 80, H - 80);
  let y = ar('بسم الله الرحمن الرحيم', 44, { size: 15, color: '#b08d39', bold: true, maxW: 400 });
  const logo = await logoData();
  if (logo) doc.addImage(logo, 'PNG', W / 2 - 25, y + 2, 50, 50);
  y += 70;
  doc.setTextColor(...navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(s.school_name || '', W / 2, y, { align: 'center' });
  y = s.school_name_ar ? ar(s.school_name_ar, y + 3, { size: 13, bold: true, maxW: 500 }) : y + 4;
  doc.setFont('times', 'bolditalic'); doc.setFontSize(30); doc.setTextColor(...gold);
  doc.text(t.title || 'Certificate', W / 2, y + 30, { align: 'center' });
  y = t.title_ar ? ar(t.title_ar, y + 35, { size: 21, bold: true, color: '#1c2f55', maxW: 500 }) : y + 38;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(90, 100, 120);
  doc.text('This certificate is proudly presented to', W / 2, y + 12, { align: 'center' });
  y = ar('تُمنح هذه الشهادة إلى', y + 14, { size: 11, color: '#637089', maxW: 400 });
  doc.setFont('times', 'bold'); doc.setFontSize(28); doc.setTextColor(...navy);
  doc.text(v.student, W / 2, y + 26, { align: 'center' });
  doc.setDrawColor(...orange); doc.setLineWidth(1); doc.line(W / 2 - 160, y + 34, W / 2 + 160, y + 34);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(40, 50, 70);
  const en = doc.splitTextToSize(body, W - 240);
  doc.text(en, W / 2, y + 52, { align: 'center', lineHeightFactor: 1.45 });
  y += 52 + en.length * 11 * 1.45 - 6;
  const bodyEnd = bodyAr ? ar(bodyAr, y, { size: 13, color: '#2a3550', maxW: W - 240 }) : y;
  // corner ornaments (8-point stars) and a gold seal
  const star = (cx, cy, r, fill) => {
    doc.setFillColor(...fill);
    for (const rot of [0, Math.PI / 4]) {
      const pts = [0, 1, 2, 3].map((k) => [cx + r * Math.cos(rot + k * Math.PI / 2), cy + r * Math.sin(rot + k * Math.PI / 2)]);
      doc.lines(pts.slice(1).map((p, k) => [p[0] - pts[k][0], p[1] - pts[k][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true);
    }
  };
  for (const [cx, cy] of [[62, 62], [W - 62, 62], [62, H - 62], [W - 62, H - 62]]) {
    star(cx, cy, 15, gold); doc.setFillColor(255, 253, 247); doc.circle(cx, cy, 6.5, 'F'); star(cx, cy, 5, navy);
  }
  const sy = Math.max(H - 140, bodyEnd + 32);
  doc.setFillColor(...gold); doc.circle(W / 2, sy, 31, 'F');
  doc.setFillColor(...navy); doc.circle(W / 2, sy, 25, 'F');
  doc.setDrawColor(...gold); doc.setLineWidth(0.8); doc.circle(W / 2, sy, 21, 'S');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('QTC', W / 2, sy + 1, { align: 'center' });
  doc.setFontSize(5.5); doc.setFont('helvetica', 'normal');
  doc.text('SLIS · JEDDAH', W / 2, sy + 9, { align: 'center' });
  doc.setFillColor(...orange);
  doc.triangle(W / 2 - 14, sy + 26, W / 2 - 4, sy + 26, W / 2 - 18, sy + 46, 'F');
  doc.triangle(W / 2 + 14, sy + 26, W / 2 + 4, sy + 26, W / 2 + 18, sy + 46, 'F');
  // footer: signatures, number, date
  const fy = H - 92;
  doc.setDrawColor(120); doc.setLineWidth(0.6);
  doc.line(90, fy, 270, fy); doc.line(W - 270, fy, W - 90, fy);
  doc.setFontSize(10); doc.setTextColor(60, 70, 90);
  doc.text(t.signature_left || 'Class Teacher', 180, fy + 14, { align: 'center' });
  doc.text(t.signature_right || 'Principal', W - 180, fy + 14, { align: 'center' });
  for (const [txt, cx] of [[t.signature_left_ar || 'معلم الحلقة', 180], [t.signature_right_ar || 'المدير', W - 180]]) {
    const im = arabicImg(txt, { size: 10, color: '#3c465a', maxW: 200 });
    doc.addImage(im.url, 'PNG', cx - im.w / 2, fy + 17, im.w, im.h);
  }
  if (cert.reviewed_by_name) { doc.setFontSize(8); doc.text(`Approved by ${cert.reviewed_by_name}`, W - 180, fy + 44, { align: 'center' }); }
  doc.setFontSize(9.5); doc.setTextColor(...navy);
  doc.text(`Certificate No: ${cert.certificate_no || 'NOT ISSUED'}`, W / 2, fy + 12, { align: 'center' });
  doc.text(`Date of issue: ${cert.issued_at ? formatDate(cert.issued_at) : '—'}  ·  Academic year ${cert.academic_year}${v.class ? ' · ' + v.class : ''}`, W / 2, fy + 26, { align: 'center' });
  if (!cert.certificate_no) {
    doc.setTextColor(220, 60, 60); doc.setFontSize(60); doc.setFont('helvetica', 'bold');
    doc.text('PREVIEW', W / 2, H / 2 + 20, { align: 'center', angle: 20 });
  }
  finishPdf(doc, `certificate-${cert.certificate_no || 'preview'}.pdf`, print);
}

// Arabic font for certificates (free Google font "Amiri"), loaded only when needed.
export function loadArabicFont() {
  if (document.getElementById('font-amiri')) return document.fonts?.load?.('700 20px Amiri').catch(() => {});
  const l = document.createElement('link');
  l.id = 'font-amiri'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,700&display=swap';
  document.head.appendChild(l);
  return new Promise((res) => { l.onload = () => (document.fonts?.load?.('700 20px Amiri') || Promise.resolve()).then(res, res); l.onerror = res; });
}
