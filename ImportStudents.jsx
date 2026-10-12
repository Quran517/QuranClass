import { useState } from 'react';
import { supabase } from './supabase.js';

// Column names people are likely to use in their sheet → database field.
const HEADERS = {
  full_name: ['name', 'full name', 'student name', 'student', 'full_name', 'student full name'],
  admission_no: ['admission no', 'admission number', 'adm no', 'adm. no', 'adm', 'admission', 'school admission number', 'school admission no', 'admission_no', 'admn no', 'gr no'],
  gender: ['gender', 'sex', 'boy/girl'],
  date_of_birth: ['date of birth', 'dob', 'birth date', 'birthday', 'date_of_birth'],
  school_grade: ['grade', 'school grade', 'class at school', 'school_grade'],
  quran_level: ['quran level', 'level', 'quran', 'quran_level'],
  guardian_name: ['guardian', 'guardian name', 'parent', 'parent name', 'father name', 'guardian_name'],
  guardian_phone: ['guardian phone', 'phone', 'mobile', 'parent phone', 'contact', 'guardian_phone', 'phone number'],
  whatsapp: ['whatsapp', 'whatsapp number', 'wa'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  address: ['address', 'area', 'location'],
  notes: ['notes', 'note', 'remarks', 'comments'],
  class_name: ['class', 'class name', 'quran class', 'group'],
};

const TEMPLATE_COLUMNS = [
  'Full name', 'Admission No', 'Gender', 'Date of birth', 'School grade', 'Quran level',
  'Guardian name', 'Guardian phone', 'WhatsApp', 'Email', 'Address', 'Class', 'Notes',
];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function fieldFor(header) {
  const h = norm(header);
  for (const [field, names] of Object.entries(HEADERS)) if (names.includes(h)) return field;
  return null;
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toLocaleDateString('en-CA');
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function toGender(v) {
  const s = norm(v);
  if (['m', 'male', 'boy', 'b', 'ذكر'].includes(s)) return 'male';
  if (['f', 'female', 'girl', 'g', 'أنثى', 'انثى'].includes(s)) return 'female';
  return null;
}

const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function downloadTemplate() {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_COLUMNS,
    ['Abdullah Ahmed', '2024/1234', 'Male', '15/03/2015', 'Grade 5', 'Juz 30', 'Ahmed Ali', '0551234567', '0551234567', 'parent@example.com', 'Al Safa', '', ''],
  ]);
  ws['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'student-upload-template.xlsx');
}

// Upload many students from an Excel or CSV file.
// fixedClassId: when used inside a class, every student goes into that class.
export default function ImportStudents({ classes, fixedClassId = null, onDone }) {
  const [rows, setRows] = useState(null);
  const [unknown, setUnknown] = useState([]);
  const [classId, setClassId] = useState(fixedClassId || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState('');

  const classByName = Object.fromEntries(classes.map((c) => [norm(c.name), c.id]));

  async function readFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(''); setResult(''); setRows(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      if (!raw.length) { setErr('The sheet is empty.'); return; }

      const headers = Object.keys(raw[0]);
      const map = Object.fromEntries(headers.map((h) => [h, fieldFor(h)]));
      if (!Object.values(map).includes('full_name')) {
        setErr('Could not find a "Full name" column. Please use the template (first row must be the column names).');
        return;
      }
      setUnknown(headers.filter((h) => !map[h] && !String(h).startsWith('__EMPTY')));

      const parsed = raw.map((r, i) => {
        const o = {};
        for (const [h, f] of Object.entries(map)) if (f) o[f] = r[h];
        const student = {
          full_name: text(o.full_name),
          admission_no: text(o.admission_no),
          gender: toGender(o.gender),
          date_of_birth: toDate(o.date_of_birth),
          school_grade: text(o.school_grade),
          quran_level: text(o.quran_level),
          guardian_name: text(o.guardian_name),
          guardian_phone: text(o.guardian_phone),
          whatsapp: text(o.whatsapp),
          email: text(o.email)?.toLowerCase() || null,
          address: text(o.address),
          notes: text(o.notes),
        };
        const className = text(o.class_name);
        const sheetClassId = className ? classByName[norm(className)] : null;
        const problems = [];
        if (!student.full_name) problems.push('no name');
        if (className && !sheetClassId && !fixedClassId) problems.push(`class "${className}" not found`);
        if (student.email && !/^\S+@\S+\.\S+$/.test(student.email)) problems.push('email looks wrong');
        return { line: i + 2, student, className, sheetClassId, problems };
      }).filter((r) => Object.values(r.student).some((v) => v));
      setRows(parsed);
    } catch (e2) {
      setErr('Could not read this file: ' + e2.message);
    }
    e.target.value = '';
  }

  async function upload() {
    const good = rows.filter((r) => r.student.full_name);
    if (!good.length) return;
    setBusy(true); setErr('');
    const payload = good.map((r) => ({
      ...r.student,
      class_id: fixedClassId || r.sheetClassId || classId || null,
      status: 'approved',
      consent_given: true,
    }));
    let added = 0;
    for (let i = 0; i < payload.length; i += 100) {
      const { error } = await supabase.from('students').insert(payload.slice(i, i + 100));
      if (error) { setErr(`Stopped after ${added} students: ${error.message}`); break; }
      added += Math.min(100, payload.length - i);
    }
    setBusy(false);
    if (added) {
      setResult(`${added} student${added > 1 ? 's' : ''} added.`);
      setRows(null);
      onDone?.();
    }
  }

  const fixedName = fixedClassId && classes.find((c) => c.id === fixedClassId)?.name;
  const withProblems = rows ? rows.filter((r) => r.problems.length).length : 0;
  const skipped = rows ? rows.filter((r) => !r.student.full_name).length : 0;

  return (
    <div className="import">
      <ol className="small steps">
        <li><button type="button" className="link" onClick={downloadTemplate}>Download the Excel template</button> (or use your own sheet with similar column names).</li>
        <li>Fill in one student per row. Only <b>Full name</b> is required.{!fixedClassId && <> Put the class name in the <b>Class</b> column, or choose one class below for everyone.</>}</li>
        <li>Choose the file. Check the preview, then click <b>Add students</b>.</li>
      </ol>

      <div className="filters">
        <label className="file-btn btn ghost">
          Choose Excel / CSV file
          <input type="file" accept=".xlsx,.xls,.csv" onChange={readFile} hidden />
        </label>
        {fixedClassId ? (
          <span className="small">All students go into <b>{fixedName}</b>.</span>
        ) : (
          <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class for students without a class">
            <option value="">Class from sheet (or none)</option>
            {classes.map((c) => <option key={c.id} value={c.id}>Everyone without a class → {c.name}</option>)}
          </select>
        )}
      </div>

      {err && <p className="error">{err}</p>}
      {result && <p className="success">{result}</p>}

      {rows && (
        <>
          <p className="small">
            <b>{rows.length - skipped}</b> students ready.
            {skipped > 0 && <> {skipped} row(s) without a name will be skipped.</>}
            {withProblems > 0 && <> Rows marked ⚠ have something to check.</>}
            {unknown.length > 0 && <> Ignored columns: {unknown.join(', ')}.</>}
          </p>
          <div className="table-wrap preview">
            <table>
              <thead><tr><th>Row</th><th>Name</th><th>Adm No</th><th>Gender</th><th>Guardian</th><th>Phone</th><th>Email</th><th>Class</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={r.problems.length ? 'warn' : ''}>
                    <td>{r.line}{r.problems.length > 0 && <span title={r.problems.join(', ')}> ⚠</span>}</td>
                    <td>{r.student.full_name || <i className="muted">missing</i>}</td>
                    <td>{r.student.admission_no || ''}</td>
                    <td className="cap">{r.student.gender || ''}</td>
                    <td>{r.student.guardian_name || ''}</td>
                    <td>{r.student.guardian_phone || ''}</td>
                    <td>{r.student.email || ''}</td>
                    <td>{fixedName || (r.sheetClassId ? r.className : classes.find((c) => c.id === classId)?.name) || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {withProblems > 0 && (
            <ul className="small muted">
              {rows.filter((r) => r.problems.length).slice(0, 10).map((r) => <li key={r.line}>Row {r.line}: {r.problems.join(', ')}</li>)}
            </ul>
          )}
          <div className="actions">
            <button className="btn" disabled={busy || rows.length === skipped} onClick={upload}>
              {busy ? 'Adding…' : `Add ${rows.length - skipped} students`}
            </button>
            <button className="btn ghost" onClick={() => setRows(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
