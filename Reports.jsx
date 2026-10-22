import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { roleLabel, can } from './perms.js';
import UsersReport from './UsersReport.jsx';
import { today, formatDate, STATUS_LABELS, classDates, ageOf } from './util.js';
import { getSettings } from './settings.js';
import { downloadExcel, downloadPdf, saveBlob, makeZip } from './exports.js';

// Supabase returns at most 1000 rows per request, so page through.
async function fetchAll(build) {
  const size = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < size) return all;
    from += size;
  }
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export default function Reports({ profile }) {
  const classes = useQuery(() => fetchMyClasses(profile, 'reports'), [profile.id]);
  const [classId, setClassId] = useState('all');
  const [from, setFrom] = useState(() => classDates(getSettings().class_days, 8)[0] || today()); // last 8 class days
  const [to, setTo] = useState(today());
  const [view, setView] = useState('students');
  const [split, setSplit] = useState('class'); // class | teacher | none
  const [teacherId, setTeacherId] = useState('all');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const classIds = useMemo(
    () => (classId === 'all'
      ? (classes.data || []).filter((c) => teacherId === 'all' || (teacherId === 'none' ? !c.teacher_id : c.teacher_id === teacherId)).map((c) => c.id)
      : [classId]),
    [classId, classes.data, teacherId]
  );
  const className = (id) => (classes.data || []).find((c) => c.id === id)?.name || '';
  const staff = useQuery(() => supabase.from('profiles').select('id, full_name, staff_code, role, staff_title, phone, email').in('role', ['teacher', 'admin']).order('full_name'), [profile.id]);
  const person = (id) => (staff.data || []).find((p) => p.id === id);
  const klassOf = (id) => (classes.data || []).find((c) => c.id === id) || {};
  // Group = ages and boys/girls, e.g. "Ages 12–15 · Boys" (the group name is in the class name)
  const groupOf = (id) => { const c = klassOf(id); const g = (c.group_name || '').split(' · ').filter(Boolean); return g.length > 1 ? g.slice(1).join(' · ') : (c.group_name || ''); };
  const teacherOf = (id) => { const t = person(klassOf(id).teacher_id); return t ? `${t.full_name || ''}${t.staff_code ? ' (' + t.staff_code + ')' : ''}` : ''; };
  const principal = (staff.data || []).find((p) => p.staff_title === 'principal');
  const tName = (id) => person(klassOf(id).teacher_id)?.full_name || '';
  const tCode = (id) => person(klassOf(id).teacher_id)?.staff_code || '';

  async function run() {
    if (!classIds.length) { setData({ students: [], att: [] }); return; }
    setLoading(true); setErr('');
    try {
      const [students, att] = await Promise.all([
        fetchAll(() => supabase.from('students').select('id, full_name, student_code, admission_no, class_id, qr_token, date_of_birth, school_grade, address, guardian_name, guardian_phone, whatsapp, gender, quran_level, email, notes, status')
          .in('class_id', classIds).eq('status', 'approved').order('full_name')),
        fetchAll(() => supabase.from('attendance')
          .select('id, student_id, class_id, att_date, status, method, students(full_name, student_code, admission_no)')
          .in('class_id', classIds).gte('att_date', from).lte('att_date', to)
          .order('att_date', { ascending: false })),
      ]);
      setData({ students, att });
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }

  useEffect(() => { if (classes.data) run(); }, [classes.data, classIds.join(','), from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    if (!data) return [];
    const by = {};
    for (const s of data.students) by[s.id] = { ...s, present: 0, late: 0, absent: 0, excused: 0, total: 0 };
    for (const a of data.att) {
      if (!by[a.student_id]) by[a.student_id] = { id: a.student_id, full_name: a.students?.full_name || '?', student_code: a.students?.student_code || '', admission_no: a.students?.admission_no || '', class_id: a.class_id, present: 0, late: 0, absent: 0, excused: 0, total: 0 };
      by[a.student_id][a.status] += 1;
      by[a.student_id].total += 1;
    }
    return Object.values(by).sort((x, y) => className(x.class_id).localeCompare(className(y.class_id)) || x.full_name.localeCompare(y.full_name));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const daily = useMemo(() => {
    if (!data) return [];
    const by = {};
    for (const a of data.att) {
      const k = a.att_date + '|' + a.class_id;
      by[k] ||= { att_date: a.att_date, class_id: a.class_id, present: 0, late: 0, absent: 0, excused: 0, total: 0 };
      by[k][a.status] += 1;
      by[k].total += 1;
    }
    return Object.values(by).sort((x, y) => y.att_date.localeCompare(x.att_date) || className(x.class_id).localeCompare(className(y.class_id)));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = classId !== 'all' ? className(classId)
    : teacherId !== 'all' ? `Teacher: ${teacherId === 'none' ? 'not assigned' : (person(teacherId)?.full_name || '')}`
    : ((profile.role === 'admin' || (profile.permissions || []).includes('reports')) ? 'All classes' : 'My classes');
  const period = `${formatDate(from)} – ${formatDate(to)}`;
  const fileBase = `class-report-${label.replace(/[^\w]+/g, '-').toLowerCase()}-${from}-to-${to}`;

  const summaryRows = summary.map((s) => ({
    'Student ID': s.student_code, 'Adm No': s.admission_no || '', Name: s.full_name, Class: className(s.class_id), Group: groupOf(s.class_id),
    Gender: s.gender === 'female' ? 'Female' : s.gender === 'male' ? 'Male' : '', 'Date of birth': s.date_of_birth ? formatDate(s.date_of_birth) : '', Age: ageOf(s.date_of_birth) ?? '',
    Grade: s.school_grade || '', 'Quran level': s.quran_level || '', Guardian: s.guardian_name || '', 'Guardian phone': s.guardian_phone || '',
    WhatsApp: s.whatsapp || '', Email: s.email || '', 'City / area': s.address || '', Notes: s.notes || '',
    Status: s.status ? ({ approved: 'Enrolled', pending: 'Pending', inactive: 'Inactive', rejected: 'Rejected' }[s.status] || s.status) : '',
    Present: s.present, Late: s.late, Absent: s.absent, Excused: s.excused,
    'Sessions marked': s.total, 'Attendance %': pct(s.present + s.late, s.total),
  }));
  const dailyRows = daily.map((d) => ({
    Date: d.att_date, Class: className(d.class_id), Group: groupOf(d.class_id), Present: d.present, Late: d.late,
    Absent: d.absent, Excused: d.excused, Marked: d.total, 'Attendance %': pct(d.present + d.late, d.total),
  }));
  const detailRows = (data?.att || []).map((a) => ({
    Date: a.att_date, Class: className(a.class_id), Group: groupOf(a.class_id), Teacher: tName(a.class_id), 'Teacher ID': tCode(a.class_id), 'Student ID': a.students?.student_code || '', 'Adm No': a.students?.admission_no || '',
    Name: a.students?.full_name || '', Status: STATUS_LABELS[a.status], Method: a.method === 'qr' ? 'QR scan' : 'Manual',
  }));

  // Classes with their group, teacher and attendance in this period
  const classRows = classIds.map((id) => {
    const rows = (data?.att || []).filter((a) => a.class_id === id);
    const t = person(klassOf(id).teacher_id);
    return {
      Class: className(id), Group: groupOf(id), Teacher: t?.full_name || '—', 'Teacher ID': t?.staff_code || '', 'Teacher phone': t?.phone || '',
      Students: (data?.students || []).filter((s) => s.class_id === id).length,
      'Sessions': new Set(rows.map((r) => r.att_date)).size,
      'Attendance %': pct(rows.filter((r) => r.status === 'present' || r.status === 'late').length, rows.length),
    };
  });
  // Principal first, then admins, assistants and teachers
  const rank = (p) => (p.staff_title === 'principal' ? 0 : p.role === 'admin' ? 1 : p.staff_title === 'assistant' ? 2 : 3);
  const staffRows = (staff.data || []).slice().sort((a, b) => rank(a) - rank(b) || (a.full_name || '').localeCompare(b.full_name || '')).map((p) => ({
    Name: p.full_name || '', 'Staff ID': p.staff_code || '', Role: p.role === 'admin' ? 'Admin' : roleLabel(p), Phone: p.phone || '',
    Email: p.email && !/@noemail\.quranclass\.local$/.test(p.email) ? p.email : '',
    Classes: (classes.data || []).filter((c) => c.teacher_id === p.id).map((c) => c.name).join(', '),
  }));
  const single = classId !== 'all';
  const headerLine = [
    `Period: ${period}`,
    single && groupOf(classId) && `Group: ${groupOf(classId)}`,
    single && `Teacher: ${teacherOf(classId) || '—'}`,
    principal && `Principal: ${principal.full_name}`,
  ].filter(Boolean).join('   ·   ');

  // One group per teacher (classes without a teacher together)
  const teacherGroups = (() => {
    const m = new Map();
    for (const id of classIds) {
      const tid = klassOf(id).teacher_id || 'none';
      if (!m.has(tid)) m.set(tid, { id: tid, name: tid === 'none' ? 'No teacher assigned' : (person(tid)?.full_name || 'Teacher'), code: tid === 'none' ? '' : person(tid)?.staff_code || '', phone: tid === 'none' ? '' : person(tid)?.phone || '', classIds: [] });
      m.get(tid).classIds.push(id);
    }
    return [...m.values()].sort((a, b) => (a.id === 'none') - (b.id === 'none') || a.name.localeCompare(b.name));
  })();
  const teacherRows = teacherGroups.map((g) => {
    const rows = (data?.att || []).filter((a) => g.classIds.includes(a.class_id));
    return {
      Teacher: g.name, 'Teacher ID': g.code, Phone: g.phone,
      Classes: g.classIds.map((id) => className(id)).join(', '),
      Students: (data?.students || []).filter((x) => g.classIds.includes(x.class_id)).length,
      Sessions: new Set(rows.map((r) => r.att_date + r.class_id)).size,
      'Attendance %': pct(rows.filter((r) => r.status === 'present' || r.status === 'late').length, rows.length),
    };
  });
  const perClass = classId === 'all' && split === 'class' && classIds.length > 1;
  const perTeacher = classId === 'all' && split === 'teacher' && teacherGroups.length > 1;
  const stripT = (r) => { const { Teacher, 'Teacher ID': tid, ...rest } = r; return rest; }; // eslint-disable-line no-unused-vars
  const sheetName = (name, used) => { let n = (name || 'Class').replace(/[\\/?*[\]:]/g, ' ').slice(0, 28); let k = n, i = 2; while (used.has(k)) k = `${n.slice(0, 25)} ${i++}`; used.add(k); return k; };
  const strip = (r) => { const { Class, Group, Teacher, 'Teacher ID': tid, ...rest } = r; return rest; }; // eslint-disable-line no-unused-vars

  function excel() {
    if (perTeacher) {
      const used = new Set(['By teacher', 'Classes & teachers', 'Staff', 'All records', 'Daily summary']);
      downloadExcel(fileBase + '.xlsx', [
        { name: 'By teacher', rows: teacherRows },
        ...teacherGroups.map((g) => ({
          name: sheetName(g.name, used),
          rows: summaryRows.filter((r, i) => g.classIds.includes(summary[i].class_id)).map(stripT),
        })),
        { name: 'Classes & teachers', rows: classRows },
        { name: 'Daily summary', rows: dailyRows },
        { name: 'Staff', rows: staffRows },
        { name: 'All records', rows: detailRows },
      ]);
      return;
    }
    if (perClass) {
      const used = new Set(['Classes & teachers', 'Staff', 'All records', 'Daily summary']);
      downloadExcel(fileBase + '.xlsx', [
        { name: 'By teacher', rows: teacherRows },
        { name: 'Classes & teachers', rows: classRows },
        ...classIds.map((id) => ({
          name: sheetName(className(id), used),
          rows: summaryRows.filter((r, i) => summary[i].class_id === id).map(strip),
        })),
        { name: 'Daily summary', rows: dailyRows },
        { name: 'Staff', rows: staffRows },
        { name: 'All records', rows: detailRows },
      ]);
      return;
    }
    downloadExcel(fileBase + '.xlsx', [
      { name: 'Student summary', rows: summaryRows },
      { name: 'Daily summary', rows: dailyRows },
      { name: 'Classes & teachers', rows: classRows },
      { name: 'By teacher', rows: teacherRows },
      { name: 'Staff', rows: staffRows },
      { name: 'All records', rows: detailRows },
    ]);
  }

  // shorter headings in the PDF so every row fits on one line
  const SHORT = { 'Sessions marked': 'Sessions', 'Attendance %': 'Att. %', 'Teacher phone': 'Phone' };
  const toTable = (rows) => ({ columns: Object.keys(rows[0] || {}).map((k) => SHORT[k] || k), rows: rows.map((r) => Object.values(r)) });
  const tbl = (rows, empty) => (rows.length ? toTable(rows) : { columns: [empty], rows: [] });
  const studentsOf = (ids) => summaryRows.filter((r, i) => ids.includes(summary[i].class_id));
  // Each student's barcode (same as on the ID card) after Attendance % — scan it to mark attendance.
  const qrOf = (ids) => (withQr ? summary.filter((x) => !ids || ids.includes(x.class_id)).map((x) => x.student_code || '') : undefined);
  const classesOf = (ids) => classRows.filter((r) => ids.some((id) => className(id) === r.Class));
  const subtitleFor = () => [`Period: ${period}`, principal && `Principal: ${principal.full_name}`].filter(Boolean).join('   ·   ');

  // PDF = heading + "Classes, groups & teachers" + "Student summary" (nothing else)
  function pdf() {
    if (perTeacher) {
      downloadPdf(fileBase + '.pdf', {
        title: `Class report — ${label}`, subtitle: subtitleFor(),
        tables: teacherGroups.flatMap((g, k) => [
          { newPage: k > 0, section: `Teacher: ${g.name}${g.code ? ' (' + g.code + ')' : ''}`,
            heading: 'Classes, groups & teachers', ...tbl(classesOf(g.classIds), 'Class') },
          { heading: 'Student summary', ...tbl(pickCols(studentsOf(g.classIds)), 'Student'), barcode: qrOf(g.classIds), fitPage: true },
        ]),
      });
      return;
    }
    if (perClass) {
      downloadPdf(fileBase + '.pdf', {
        title: `Class report — ${label}`, subtitle: subtitleFor(),
        tables: classIds.flatMap((id, k) => [
          { newPage: k > 0, section: `${className(id)}${groupOf(id) ? ' · ' + groupOf(id) : ''}`,
            heading: 'Classes, groups & teachers', ...tbl(classesOf([id]), 'Class') },
          { heading: 'Student summary', ...tbl(pickCols(studentsOf([id])), 'Student'), barcode: qrOf([id]), fitPage: true },
        ]),
      });
      return;
    }
    downloadPdf(fileBase + '.pdf', {
      title: `Class report — ${label}`, subtitle: subtitleFor(),
      tables: [
        { heading: 'Classes, groups & teachers', ...tbl(classRows, 'Class') },
        { heading: 'Student summary', ...tbl(pickCols(summaryRows), 'Student'), barcode: qrOf(null) },
      ],
    });
  }

  // Class report: teacher at the top, then the students of that teacher's classes.
  const [eachBusy, setEachBusy] = useState('');
  const [picked, setPicked] = useState(null);      // null = all teachers
  const [oneFile, setOneFile] = useState(false);   // false = one PDF per teacher
  const [withQr, setWithQr] = useState(true);       // student QR codes in the PDF
  const [ready, setReady] = useState([]);          // the separate teacher PDFs, ready to save
  const chosen = teacherGroups.filter((g) => !picked || picked.includes(g.id));
  // Tick what goes in the class report (saved on this computer)
  const EXTRA = ['Gender', 'Date of birth', 'Age', 'Grade', 'Quran level', 'Guardian', 'Guardian phone', 'WhatsApp', 'Email', 'City / area', 'Notes', 'Status'];
  const COLS = ['Student ID', 'Adm No', 'Class', 'Group', ...EXTRA, 'Present', 'Late', 'Absent', 'Excused', 'Sessions marked', 'Attendance %'];
  const NEW_OFF = EXTRA; // student details start unticked
  const ATT = ['Present', 'Late', 'Absent', 'Excused', 'Sessions marked', 'Attendance %'];
  const PARTS = [['teacherLine', 'Teacher phone, classes & attendance line'], ['classesTable', 'Classes table']];
  const [include, setInclude] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('qc-class-report-cols') || 'null'); if (Array.isArray(v)) return new Set(v); } catch { /* ignore */ }
    return new Set([...COLS.filter((k) => !NEW_OFF.includes(k)), ...PARTS.map(([k]) => k)]);
  });
  const toggleInclude = (k, on) => {
    const n = new Set(include); if (on) n.add(k); else n.delete(k); setInclude(n);
    try { localStorage.setItem('qc-class-report-cols', JSON.stringify([...n])); } catch { /* ignore */ }
  };
  const pickCols = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k === 'Name' || include.has(k))));
  const teacherSection = (g, newPage) => {
    const tr = teacherRows.find((r) => r.Teacher === g.name) || {};
    const head = { newPage, section: `Teacher: ${g.name}${g.code ? '  (' + g.code + ')' : ''}`,
      sectionNote: include.has('teacherLine') ? [g.phone && `Phone: ${g.phone}`, `Classes: ${tr.Classes || '—'}`, `Students: ${tr.Students ?? 0}`, `Attendance: ${tr['Attendance %'] ?? 0}%`].filter(Boolean).join('   ·   ') : '' };
    return [
      include.has('classesTable')
        ? { ...head, heading: 'Classes', ...tbl(classesOf(g.classIds).map(({ Teacher, 'Teacher ID': a, 'Teacher phone': b, ...r }) => r), 'Class') } // eslint-disable-line no-unused-vars
        : head,
      { heading: 'Student details', ...tbl(pickCols(studentsOf(g.classIds)), 'Student'), barcode: qrOf(g.classIds), fitPage: true },
    ];
  };
  async function classReports() {
    if (!chosen.length) return;
    setReady([]);
    if (oneFile || chosen.length === 1) {
      const one = chosen.length === 1;
      await downloadPdf(`class-report-${one ? chosen[0].name.replace(/[^\w]+/g, '-').toLowerCase() : 'teachers'}-${from}-to-${to}.pdf`, {
        title: `Class report — ${one ? 'Teacher: ' + chosen[0].name : chosen.length + ' teachers'}`, subtitle: subtitleFor(),
        tables: chosen.flatMap((g, k) => teacherSection(g, k > 0)),
      });
      return;
    }
    const files = [];
    for (const [k, g] of chosen.entries()) {
      setEachBusy(`${k + 1}/${chosen.length}`);
      files.push({ teacher: g.name, ...(await downloadPdf(`class-report-${g.name.replace(/[^\w]+/g, '-').toLowerCase()}-${from}-to-${to}.pdf`, {
        title: `Class report — Teacher: ${g.name}`, subtitle: subtitleFor(),
        tables: teacherSection(g, false), asBlob: true,
      })) });
    }
    setEachBusy('');
    setReady(files);
    // Browsers allow only one automatic download, so all the teacher PDFs come in one .zip file.
    saveBlob(await makeZip(files), `class-reports-${files.length}-teachers-${from}-to-${to}.zip`);
  }

  if (classes.loading) return <div className="spinner" />;
  if (!classes.data?.length) return <section className="card"><h2>Reports</h2><p className="muted">No classes to report on yet.</p></section>;

  const totals = summary.reduce((a, s) => ({ att: a.att + s.present + s.late, all: a.all + s.total }), { att: 0, all: 0 });
  const low = summary.filter((s) => s.total >= 3 && pct(s.present + s.late, s.total) < 75).length;

  return (
    <>
      <section className="card">
        <h2>Class reports</h2>
        <div className="filters">
          <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
            <option value="all">{(profile.role === 'admin' || (profile.permissions || []).includes('reports')) ? 'All classes' : 'All my classes'}</option>
            {classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}{c.group_name ? ` · ${groupOf(c.id)}` : ''}</option>)}
          </select>
          {classId === 'all' && (classes.data || []).some((c) => c.teacher_id) && (
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Teacher">
              <option value="all">All teachers</option>
              {[...new Set(classes.data.map((c) => c.teacher_id).filter(Boolean))].map((tid) => person(tid) || { id: tid, full_name: 'Teacher' }).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}{p.staff_code ? ` (${p.staff_code})` : ''}</option>
              ))}
              {classes.data.some((c) => !c.teacher_id) && <option value="none">No teacher assigned</option>}
            </select>
          )}
          <label className="inline">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inline">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="actions">
          {classId === 'all' && classIds.length > 1 && (
            <select value={split} onChange={(e) => setSplit(e.target.value)} aria-label="Report layout" className="split-select">
              <option value="class">Each class separately (own page / sheet)</option>
              <option value="teacher">Each teacher separately (own page / sheet)</option>
              <option value="none">All together</option>
            </select>
          )}
          <button className="btn" onClick={excel} disabled={!data || loading}>Download Excel</button>
          <button className="btn ghost" onClick={pdf} disabled={!data || loading}>Download PDF</button>

        </div>
        {err && <p className="error">{err}</p>}
        {data && (
          <div className="stats compact">
            <div className="stat"><b>{pct(totals.att, totals.all)}%</b><span>Overall attendance</span></div>
            <div className="stat"><b>{daily.length}</b><span>Class sessions</span></div>
            <div className="stat"><b>{summary.length}</b><span>Students</span></div>
            <div className="stat"><b>{low}</b><span>Below 75%</span></div>
          </div>
        )}
      </section>

      {teacherGroups.length > 0 && (
        <section className="card">
          <div className="row-between">
            <div>
              <h2>Class report by teacher</h2>
              <p className="small muted">Teacher at the top, then the details of their students ({period}). Choose one teacher or several.</p>
            </div>
            <div className="actions small">
              <button className="link" onClick={() => setPicked(null)}>Select all</button>
              <button className="link" onClick={() => setPicked([])}>Select none</button>
            </div>
          </div>
          <div className="teacher-pick">
            {teacherGroups.map((g) => {
              const on = !picked || picked.includes(g.id);
              const tr = teacherRows.find((r) => r.Teacher === g.name) || {};
              return (
                <label key={g.id} className={`teacher-chip ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={(e) => {
                    const cur = picked || teacherGroups.map((x) => x.id);
                    setPicked(e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id));
                  }} />
                  <span><b>{g.name}</b>{g.code ? ` · ${g.code}` : ''}<small>{tr.Classes} · {tr.Students} students</small></span>
                </label>
              );
            })}
          </div>
          <details className="report-options" open>
            <summary><b>What to include</b> <span className="small muted">— tick what you need, untick what you don't (Name is always included)</span></summary>
            <div className="type-chips">
              {PARTS.map(([k, l]) => (
                <label key={k} className={`type-chip ${include.has(k) ? 'on' : ''}`}><input type="checkbox" checked={include.has(k)} onChange={(e) => toggleInclude(k, e.target.checked)} />{l}</label>
              ))}
            </div>
            <div className="type-chips">
              {COLS.filter((k) => !EXTRA.includes(k) && !ATT.includes(k)).map((k) => (
                <label key={k} className={`type-chip ${include.has(k) ? 'on' : ''}`}><input type="checkbox" checked={include.has(k)} onChange={(e) => toggleInclude(k, e.target.checked)} />{k}</label>
              ))}
            </div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>Student details (from the student form)</p>
            <div className="type-chips">
              {EXTRA.map((k) => (
                <label key={k} className={`type-chip ${include.has(k) ? 'on' : ''}`}><input type="checkbox" checked={include.has(k)} onChange={(e) => toggleInclude(k, e.target.checked)} />{k}</label>
              ))}
            </div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>Attendance</p>
            <div className="type-chips">
              {ATT.map((k) => (
                <label key={k} className={`type-chip ${include.has(k) ? 'on' : ''}`}><input type="checkbox" checked={include.has(k)} onChange={(e) => toggleInclude(k, e.target.checked)} />{k}</label>
              ))}
              <label className={`type-chip ${withQr ? 'on' : ''}`}><input type="checkbox" checked={withQr} onChange={(e) => setWithQr(e.target.checked)} />Barcode</label>
            </div>
          </details>
          <div className="actions">
            {chosen.length > 1 && (
              <select value={oneFile ? 'one' : 'each'} onChange={(e) => setOneFile(e.target.value === 'one')} aria-label="PDF files" className="split-select">
                <option value="each">A separate PDF for each teacher ({chosen.length} files)</option>
                <option value="one">One PDF — each teacher on a new page</option>
              </select>
            )}
            <button className="btn" onClick={classReports} disabled={!data || loading || !chosen.length || !!eachBusy}>
              {eachBusy ? `Preparing ${eachBusy}…` : chosen.length === 1 ? `Download class report — ${chosen[0].name}` : `Download class report${oneFile ? '' : 's'} (${chosen.length} teachers)`}
            </button>
          </div>
          {ready.length > 0 && (
            <div className="ready-files">
              <p className="small muted">The {ready.length} PDFs were saved together in one <b>.zip</b> file. You can also save each one here:</p>
              <div className="actions">
                {ready.map((f) => <button key={f.name} className="btn ghost" onClick={() => saveBlob(f.blob, f.name)}>⬇ {f.teacher}</button>)}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <div className="row-between">
          <div>
            <h2>{label} <span className="small muted">{period}</span></h2>
            <p className="small muted">{[single && groupOf(classId) && `Group: ${groupOf(classId)}`, single && `Teacher: ${teacherOf(classId) || 'not assigned'}`, principal && `Principal: ${principal.full_name}`].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="segmented">
            <button className={view === 'students' ? 'active' : ''} onClick={() => setView('students')}>By student</button>
            <button className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}>By date</button>
            <button className={view === 'teachers' ? 'active' : ''} onClick={() => setView('teachers')}>By teacher</button>
          </div>
        </div>
        {loading || !data ? <div className="spinner" /> : view === 'teachers' ? (
          teacherRows.length === 0 ? <p className="muted">No classes in this selection.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Teacher</th><th>Classes</th><th>Students</th><th>Sessions</th><th>%</th><th /></tr></thead>
                <tbody>
                  {teacherRows.map((t, i) => (
                    <tr key={t.Teacher + i}>
                      <td>{t.Teacher}<div className="small muted">{[t['Teacher ID'], t.Phone].filter(Boolean).join(' · ')}</div></td>
                      <td className="small">{t.Classes}</td><td>{t.Students}</td><td>{t.Sessions}</td>
                      <td><b className={t.Sessions && t['Attendance %'] < 75 ? 'low' : ''}>{t.Sessions ? t['Attendance %'] + '%' : '—'}</b></td>
                      <td>{teacherGroups[i].id !== 'none' && classId === 'all' && teacherId === 'all' && <button className="btn ghost small" onClick={() => { setTeacherId(teacherGroups[i].id); setView('students'); }}>Show only</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : view === 'students' ? (
          summary.length === 0 ? <p className="muted">No students in this selection.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Student</th>{classId === 'all' && <th>Class</th>}<th>P</th><th>L</th><th>A</th><th>E</th><th>%</th></tr></thead>
                <tbody>
                  {summary.map((s) => {
                    const p = pct(s.present + s.late, s.total);
                    return (
                      <tr key={s.id}>
                        <td>{s.full_name}<div className="small muted">{s.student_code}{s.admission_no ? ` · Adm ${s.admission_no}` : ''}</div></td>
                        {classId === 'all' && <td className="small">{className(s.class_id)}</td>}
                        <td>{s.present}</td><td>{s.late}</td><td>{s.absent}</td><td>{s.excused}</td>
                        <td><b className={s.total && p < 75 ? 'low' : ''}>{s.total ? p + '%' : '—'}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : daily.length === 0 ? <p className="muted">No attendance recorded in this period.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th>{classId === 'all' && <th>Class</th>}<th>P</th><th>L</th><th>A</th><th>E</th><th>%</th></tr></thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.att_date + d.class_id}>
                    <td className="nowrap">{formatDate(d.att_date)}</td>
                    {classId === 'all' && <td className="small">{className(d.class_id)}</td>}
                    <td>{d.present}</td><td>{d.late}</td><td>{d.absent}</td><td>{d.excused}</td>
                    <td><b>{pct(d.present + d.late, d.total)}%</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">P = present, L = late, A = absent, E = excused. Late counts as attended.</p>
      </section>
      {can(profile, 'users') && <UsersReport />}
    </>
  );
}
