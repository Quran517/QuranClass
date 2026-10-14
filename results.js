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
  return { t, v, body: fillTemplate(t.body, v) };
}

// Certificate PDF (landscape A4) drawn with the school logo and colours.
export async function certificatePdf(cert, ctx, print = false) {
  const { jsPDF } = await import('jspdf');
  const s = getSettings();
  const { t, v, body } = certificateValues(cert, ctx);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const navy = [9, 47, 107], orange = [237, 91, 3], gold = [176, 141, 57];
  doc.setFillColor(255, 253, 247); doc.rect(0, 0, W, H, 'F');
  doc.setDrawColor(...navy); doc.setLineWidth(10); doc.rect(18, 18, W - 36, H - 36);
  doc.setDrawColor(...gold); doc.setLineWidth(1.5); doc.rect(34, 34, W - 68, H - 68);
  doc.setDrawColor(...orange); doc.setLineWidth(0.8); doc.rect(40, 40, W - 80, H - 80);
  const logo = await logoData();
  if (logo) doc.addImage(logo, 'PNG', W / 2 - 34, 56, 68, 68);
  doc.setTextColor(...navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text(s.school_name || '', W / 2, 148, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 100, 120);
  if (s.tagline) doc.text(s.tagline, W / 2, 164, { align: 'center' });
  doc.setFont('times', 'bolditalic'); doc.setFontSize(34); doc.setTextColor(...gold);
  doc.text(t.title || 'Certificate', W / 2, 212, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(60, 70, 90);
  doc.text('This certificate is proudly presented to', W / 2, 244, { align: 'center' });
  doc.setFont('times', 'bold'); doc.setFontSize(30); doc.setTextColor(...navy);
  doc.text(v.student, W / 2, 284, { align: 'center' });
  doc.setDrawColor(...orange); doc.setLineWidth(1); doc.line(W / 2 - 170, 294, W / 2 + 170, 294);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12.5); doc.setTextColor(40, 50, 70);
  doc.text(doc.splitTextToSize(body, W - 220), W / 2, 322, { align: 'center', lineHeightFactor: 1.5 });
  // footer: signatures, number, date
  const y = H - 92;
  doc.setDrawColor(120); doc.setLineWidth(0.6);
  doc.line(90, y, 270, y); doc.line(W - 270, y, W - 90, y);
  doc.setFontSize(10); doc.setTextColor(60, 70, 90);
  doc.text(t.signature_left || 'Class Teacher', 180, y + 14, { align: 'center' });
  doc.text(t.signature_right || 'Principal', W - 180, y + 14, { align: 'center' });
  if (cert.reviewed_by_name) { doc.setFontSize(8.5); doc.text(`Approved by ${cert.reviewed_by_name}`, W - 180, y + 27, { align: 'center' }); }
  doc.setFontSize(9.5); doc.setTextColor(...navy);
  doc.text(`Certificate No: ${cert.certificate_no || 'NOT ISSUED'}`, W / 2, y - 6, { align: 'center' });
  doc.text(`Date of issue: ${cert.issued_at ? formatDate(cert.issued_at) : '—'}`, W / 2, y + 8, { align: 'center' });
  doc.text(`Academic year ${cert.academic_year}${v.class ? ' · ' + v.class : ''}`, W / 2, y + 22, { align: 'center' });
  if (!cert.certificate_no) {
    doc.setTextColor(220, 60, 60); doc.setFontSize(60); doc.setFont('helvetica', 'bold');
    doc.text('PREVIEW', W / 2, H / 2 + 20, { align: 'center', angle: 20 });
  }
  finishPdf(doc, `certificate-${cert.certificate_no || 'preview'}.pdf`, print);
}
