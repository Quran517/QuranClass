import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { roleLabel } from './perms.js';
import { today, formatDate, STATUS_LABELS, classDates } from './util.js';
import { getSettings } from './settings.js';
import { downloadExcel, downloadPdf } from './exports.js';

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
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const classIds = useMemo(
    () => (classId === 'all' ? (classes.data || []).map((c) => c.id) : [classId]),
    [classId, classes.data]
  );
  const className = (id) => (classes.data || []).find((c) => c.id === id)?.name || '';
  const staff = useQuery(() => supabase.from('profiles').select('id, full_name, staff_code, role, staff_title, phone, email').in('role', ['teacher', 'admin']).order('full_name'), [profile.id]);
  const person = (id) => (staff.data || []).find((p) => p.id === id);
  const klassOf = (id) => (classes.data || []).find((c) => c.id === id) || {};
  const groupOf = (id) => { const c = klassOf(id); const g = (c.group_name || '').split(' · '); return c.group_name ? (c.name && c.name.startsWith(g[0]) ? g.slice(1).join(' · ') || c.group_name : c.group_name) : ''; };
  const teacherOf = (id) => { const t = person(klassOf(id).teacher_id); return t ? `${t.full_name || ''}${t.staff_code ? ' (' + t.staff_code + ')' : ''}` : ''; };
  const principal = (staff.data || []).find((p) => p.staff_title === 'principal');

  async function run() {
    if (!classIds.length) { setData({ students: [], att: [] }); return; }
    setLoading(true); setErr('');
    try {
      const [students, att] = await Promise.all([
        fetchAll(() => supabase.from('students').select('id, full_name, student_code, class_id')
          .in('class_id', classIds).eq('status', 'approved').order('full_name')),
        fetchAll(() => supabase.from('attendance')
          .select('id, student_id, class_id, att_date, status, method, students(full_name, student_code)')
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
      if (!by[a.student_id]) by[a.student_id] = { id: a.student_id, full_name: a.students?.full_name || '?', student_code: a.students?.student_code || '', class_id: a.class_id, present: 0, late: 0, absent: 0, excused: 0, total: 0 };
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

  const label = classId === 'all' ? ((profile.role === 'admin' || (profile.permissions || []).includes('reports')) ? 'All classes' : 'My classes') : className(classId);
  const period = `${formatDate(from)} – ${formatDate(to)}`;
  const fileBase = `attendance-${label.replace(/[^\w]+/g, '-').toLowerCase()}-${from}-to-${to}`;

  const summaryRows = summary.map((s) => ({
    'Student ID': s.student_code, Name: s.full_name, Class: className(s.class_id), Group: groupOf(s.class_id), Teacher: teacherOf(s.class_id),
    Present: s.present, Late: s.late, Absent: s.absent, Excused: s.excused,
    'Sessions marked': s.total, 'Attendance %': pct(s.present + s.late, s.total),
  }));
  const dailyRows = daily.map((d) => ({
    Date: d.att_date, Class: className(d.class_id), Group: groupOf(d.class_id), Teacher: teacherOf(d.class_id), Present: d.present, Late: d.late,
    Absent: d.absent, Excused: d.excused, Marked: d.total, 'Attendance %': pct(d.present + d.late, d.total),
  }));
  const detailRows = (data?.att || []).map((a) => ({
    Date: a.att_date, Class: className(a.class_id), Group: groupOf(a.class_id), Teacher: teacherOf(a.class_id), 'Student ID': a.students?.student_code || '',
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

  function excel() {
    downloadExcel(fileBase + '.xlsx', [
      { name: 'Student summary', rows: summaryRows },
      { name: 'Daily summary', rows: dailyRows },
      { name: 'Classes & teachers', rows: classRows },
      { name: 'Staff', rows: staffRows },
      { name: 'All records', rows: detailRows },
    ]);
  }

  function pdf() {
    const toTable = (rows) => ({ columns: Object.keys(rows[0] || {}), rows: rows.map((r) => Object.values(r)) });
    const s = summaryRows.length ? toTable(summaryRows) : { columns: ['Student'], rows: [] };
    const d = dailyRows.length ? toTable(dailyRows) : { columns: ['Date'], rows: [] };
    const c = classRows.length ? toTable(classRows) : { columns: ['Class'], rows: [] };
    const st = staffRows.length ? toTable(staffRows) : { columns: ['Name'], rows: [] };
    downloadPdf(fileBase + '.pdf', {
      title: `Attendance report — ${label}`,
      subtitle: headerLine,
      tables: [
        { heading: 'Classes, groups & teachers', ...c },
        ...(view === 'daily'
          ? [{ heading: 'Daily summary', ...d }, { heading: 'Student summary', ...s }]
          : [{ heading: 'Student summary', ...s }, { heading: 'Daily summary', ...d }]),
        { heading: 'Principal & staff', ...st },
      ],
      signatures: [
        `Class Teacher${single && teacherOf(classId) ? ': ' + teacherOf(classId) : ''}`,
        `Principal${principal ? ': ' + principal.full_name : ''}`,
        'Admin / Date',
      ],
    });
  }

  if (classes.loading) return <div className="spinner" />;
  if (!classes.data?.length) return <section className="card"><h2>Reports</h2><p className="muted">No classes to report on yet.</p></section>;

  const totals = summary.reduce((a, s) => ({ att: a.att + s.present + s.late, all: a.all + s.total }), { att: 0, all: 0 });
  const low = summary.filter((s) => s.total >= 3 && pct(s.present + s.late, s.total) < 75).length;

  return (
    <>
      <section className="card">
        <h2>Attendance reports</h2>
        <div className="filters">
          <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
            <option value="all">{(profile.role === 'admin' || (profile.permissions || []).includes('reports')) ? 'All classes' : 'All my classes'}</option>
            {classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}{c.group_name ? ` · ${groupOf(c.id)}` : ''}</option>)}
          </select>
          <label className="inline">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inline">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="actions">
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

      <section className="card">
        <div className="row-between">
          <div>
            <h2>{label} <span className="small muted">{period}</span></h2>
            <p className="small muted">{[single && groupOf(classId) && `Group: ${groupOf(classId)}`, single && `Teacher: ${teacherOf(classId) || 'not assigned'}`, principal && `Principal: ${principal.full_name}`].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="segmented">
            <button className={view === 'students' ? 'active' : ''} onClick={() => setView('students')}>By student</button>
            <button className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}>By date</button>
          </div>
        </div>
        {loading || !data ? <div className="spinner" /> : view === 'students' ? (
          summary.length === 0 ? <p className="muted">No students in this selection.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Student</th>{classId === 'all' && <th>Class</th>}<th>P</th><th>L</th><th>A</th><th>E</th><th>%</th></tr></thead>
                <tbody>
                  {summary.map((s) => {
                    const p = pct(s.present + s.late, s.total);
                    return (
                      <tr key={s.id}>
                        <td>{s.full_name}<div className="small muted">{s.student_code}</div></td>
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
    </>
  );
}
