import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { fetchMyClasses, fetchAllRows } from './data.js';
import { formatDate, today, classTag } from './util.js';
import { can } from './perms.js';
import { downloadExcel, downloadPdf } from './exports.js';
import { fetchSetup, EXAM_STATUS, gradeOf, pctOf, reportCards, reportCardPdf, gradeRemark } from './results.js';
import Modal from './Modal.jsx';

export const examArea = (profile) => (can(profile, 'exams') ? 'exams' : can(profile, 'results') ? 'results' : can(profile, 'certificates') ? 'certificates' : null);

export function useSetup() {
  const [setup, setSetup] = useState(null);
  const [err, setErr] = useState('');
  const load = () => fetchSetup().then(setSetup).catch((e) => { setErr(e.message); setSetup(null); });
  useEffect(() => { load(); }, []);
  return { setup, err, reload: load };
}

export function StatusBadge({ exam }) {
  const [label, cls] = EXAM_STATUS[exam.status] || [exam.status, ''];
  return (
    <>
      <span className={`badge ${cls}`}>{label}</span>{' '}
      {exam.published_at ? <span className="badge present">Published</span> : <span className="badge inactive">Not published</span>}
    </>
  );
}

export default function Exams({ profile }) {
  const { setup, err, reload } = useSetup();
  const [view, setView] = useState('exams');
  const [classes, setClasses] = useState(null);

  useEffect(() => {
    fetchMyClasses(profile, examArea(profile)).then(({ data }) => setClasses(data || []));
  }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <section className="card"><h2>Exams</h2><p className="error">{err}</p></section>;
  if (!setup || !classes) return <div className="spinner" aria-label="Loading" />;

  return (
    <>
      <div className="segmented page-tabs">
        <button className={view === 'exams' ? 'active' : ''} onClick={() => setView('exams')}>Exams &amp; marks</button>
        <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>Results &amp; report cards</button>
        {can(profile, 'settings') && <button className={view === 'setup' ? 'active' : ''} onClick={() => setView('setup')}>Exam setup</button>}
      </div>
      {view === 'exams' && <ExamList profile={profile} setup={setup} classes={classes} />}
      {view === 'cards' && <ResultsView setup={setup} classes={classes} />}
      {view === 'setup' && <ExamSetup setup={setup} reload={reload} />}
    </>
  );
}

// ---------------------------------------------------------------------
function ExamList({ profile, setup, classes }) {
  const [f, setF] = useState({ year: setup.currentYear, class_id: '', subject_id: '', exam_type: '', status: '' });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);

  async function load() {
    setErr('');
    let q = supabase.from('exams').select('*, exam_marks(count)').order('exam_date', { ascending: false });
    if (f.year) q = q.eq('academic_year', f.year);
    if (f.class_id) q = q.eq('class_id', f.class_id);
    if (f.subject_id) q = q.eq('subject_id', f.subject_id);
    if (f.exam_type) q = q.eq('exam_type', f.exam_type);
    if (f.status === 'published') q = q.not('published_at', 'is', null);
    else if (f.status) q = q.eq('status', f.status);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  const cls = (id) => classes.find((c) => c.id === id);
  const subj = (id) => setup.subjects.find((s) => s.id === id)?.name || '—';
  const typ = (code) => setup.types.find((t) => t.code === code)?.name || code;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const canCreate = classes.length > 0 && (can(profile, 'exams') || classes.some((c) => c.teacher_id === profile.id));

  if (openId) {
    return <ExamDetail id={openId} profile={profile} setup={setup} classes={classes} onBack={() => { setOpenId(null); load(); }} />;
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Exams</h2>
        {canCreate && (
          <div className="actions">
            <button className="btn ghost" onClick={() => setEditing({ individual: true })}>+ Individual exam</button>
            <button className="btn" onClick={() => setEditing({})}>+ New class exam</button>
          </div>
        )}
      </div>
      <p className="small muted">Teacher creates the exam → enters marks → <b>Submit</b>. The results manager <b>Finalizes</b> and <b>Publishes</b>. Students and parents see results only after publishing.</p>
      <div className="filters">
        <select value={f.year} onChange={set('year')} aria-label="Academic year">
          <option value="">All years</option>
          {setup.years.map((y) => <option key={y.name} value={y.name}>{y.name}</option>)}
        </select>
        <select value={f.class_id} onChange={set('class_id')} aria-label="Class">
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}
        </select>
        <select value={f.subject_id} onChange={set('subject_id')} aria-label="Subject">
          <option value="">All subjects</option>
          {setup.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={f.exam_type} onChange={set('exam_type')} aria-label="Exam type">
          <option value="">All exam types</option>
          {setup.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        <select value={f.status} onChange={set('status')} aria-label="Status">
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="finalized">Finalized</option>
          <option value="published">Published</option>
        </select>
      </div>
      {err && <p className="error">{err}</p>}
      {classes.length === 0 && <p className="muted">You have no classes. The admin assigns teachers to classes under Classes.</p>}
      {rows === null ? <div className="spinner" /> : rows.length === 0 ? <p className="muted">No exams found for these filters.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Exam</th><th>Class</th><th className="hide-sm">Subject</th><th className="hide-sm">Date</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="clickable-row" onClick={() => setOpenId(e.id)}>
                  <td><button className="link">{e.title}</button>{e.exam_marks?.[0]?.count === 1 && <span className="badge inactive">Individual</span>}<div className="small muted">{typ(e.exam_type)}{e.term ? ` · ${e.term}` : ''} · {e.academic_year} · {e.exam_marks?.[0]?.count ?? 0} student{e.exam_marks?.[0]?.count === 1 ? '' : 's'}</div></td>
                  <td className="small">{cls(e.class_id)?.name || '—'}</td>
                  <td className="small hide-sm">{subj(e.subject_id)}</td>
                  <td className="small hide-sm nowrap">{formatDate(e.exam_date)}</td>
                  <td><StatusBadge exam={e} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ExamForm exam={editing} setup={setup} profile={profile} classes={classes.filter((c) => can(profile, 'exams') || c.teacher_id === profile.id)}
          onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); load(); if (id) setOpenId(id); }} />
      )}
    </section>
  );
}

function ExamForm({ exam, setup, classes, onClose, onSaved }) {
  const isNew = !exam.id;
  const [f, setF] = useState({
    title: exam.title || '', exam_type: exam.exam_type || setup.types[0]?.code || '',
    academic_year: exam.academic_year || setup.currentYear, term: exam.term || '',
    class_id: exam.class_id || classes[0]?.id || '', subject_id: exam.subject_id || setup.subjects.find((s) => s.active)?.id || '',
    exam_date: exam.exam_date || today(), max_marks: exam.max_marks ?? 100, pass_marks: exam.pass_marks ?? 50,
  });
  const [students, setStudents] = useState([]);
  const [picked, setPicked] = useState({});
  const [who, setWho] = useState(exam.individual ? 'one' : 'class');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!isNew || !f.class_id) return;
    supabase.from('students').select('id, full_name, student_code').eq('class_id', f.class_id).eq('status', 'approved').order('full_name')
      .then(({ data }) => { setStudents(data || []); setPicked(who === 'one' ? {} : Object.fromEntries((data || []).map((s) => [s.id, true]))); });
  }, [f.class_id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  function switchWho(w) {
    setWho(w);
    setPicked(w === 'one' ? {} : Object.fromEntries(students.map((s) => [s.id, true])));
  }

  async function save(e) {
    e.preventDefault();
    const max = Number(f.max_marks), pass = Number(f.pass_marks);
    if (!(max > 0)) { setErr('Maximum marks must be more than 0.'); return; }
    if (pass < 0 || pass > max) { setErr('Pass marks must be between 0 and the maximum marks.'); return; }
    const ids = Object.keys(picked).filter((k) => picked[k]);
    if (isNew && !ids.length) { setErr('Tick at least one student.'); return; }
    setBusy(true); setErr('');
    const payload = { ...f, title: f.title.trim(), term: f.term.trim() || null, subject_id: f.subject_id || null, max_marks: max, pass_marks: pass };
    if (isNew) {
      const { data, error } = await supabase.from('exams').insert(payload).select().single();
      if (error) { setBusy(false); setErr(error.message); return; }
      const { error: e2 } = await supabase.from('exam_marks').insert(ids.map((sid) => ({ exam_id: data.id, student_id: sid })));
      setBusy(false);
      if (e2) { setErr(e2.message); return; }
      onSaved(data.id);
    } else {
      const { class_id, ...rest } = payload; // class stays the same once marks exist
      const { error } = await supabase.from('exams').update(rest).eq('id', exam.id);
      setBusy(false);
      if (error) setErr(error.message); else onSaved(null);
    }
  }

  const termHint = setup.types.find((t) => t.code === f.exam_type)?.is_final ? 'e.g. Final' : 'e.g. October, Quarter 1';
  return (
    <Modal title={isNew ? (exam.individual ? 'New individual exam' : 'New class exam') : `Edit ${exam.title}`} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label className="span2">Exam title *<input required value={f.title} onChange={set('title')} placeholder="e.g. Hifz – Juz 30 test" /></label>
        <label>Exam type *
          <select required value={f.exam_type} onChange={set('exam_type')}>{setup.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
        </label>
        <label>Term / month<input value={f.term} onChange={set('term')} placeholder={termHint} /></label>
        <label>Academic year *
          <select required value={f.academic_year} onChange={set('academic_year')}>{setup.years.map((y) => <option key={y.name} value={y.name}>{y.name}</option>)}</select>
        </label>
        <label>Exam date *<input type="date" required value={f.exam_date} onChange={set('exam_date')} /></label>
        <label>Class *
          <select required value={f.class_id} onChange={set('class_id')} disabled={!isNew}>
            {classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}
          </select>
        </label>
        <label>Subject *
          <select required value={f.subject_id} onChange={set('subject_id')}>
            {setup.subjects.filter((s) => s.active || s.id === f.subject_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Maximum marks *<input type="number" min="1" max="1000" step="0.5" required value={f.max_marks} onChange={set('max_marks')} /></label>
        <label>Pass marks *<input type="number" min="0" max="1000" step="0.5" required value={f.pass_marks} onChange={set('pass_marks')} /></label>
        {isNew && (
          <div className="span2 field">
            <div className="row-between">
              <span className="field-label">Students taking this exam ({Object.values(picked).filter(Boolean).length} of {students.length})</span>
              <div className="segmented" role="group" aria-label="Who takes the exam">
                <button type="button" className={who === 'class' ? 'active' : ''} onClick={() => switchWho('class')}>Whole class</button>
                <button type="button" className={who === 'one' ? 'active' : ''} onClick={() => switchWho('one')}>Individual student</button>
              </div>
            </div>
            {who === 'one' && <input className="find-student" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search the student's name or ID, then tick" aria-label="Search student" />}
            {students.length === 0 ? <p className="small muted">No enrolled students in this class.</p> : (
              <div className="pick-list">
                {who === 'class' && <label className="pick-all small"><input type="checkbox" checked={students.every((s) => picked[s.id])}
                  onChange={(e) => setPicked(Object.fromEntries(students.map((s) => [s.id, e.target.checked])))} /> All students</label>}
                {students.filter((s) => who === 'class' || !find || `${s.full_name} ${s.student_code}`.toLowerCase().includes(find.toLowerCase())).map((s) => (
                  <label key={s.id} className="pick-row"><input type="checkbox" checked={!!picked[s.id]} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.checked })} />
                    <span>{s.full_name} <span className="small muted">{s.student_code}</span></span></label>
                ))}
              </div>
            )}
          </div>
        )}
        {err && <p className="error span2">{err}</p>}
        <div className="span2"><button className="btn" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create exam & enter marks' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
function ExamDetail({ id, profile, setup, classes, onBack }) {
  const [exam, setExam] = useState(null);
  const [marks, setMarks] = useState([]);
  const [edit, setEdit] = useState({});   // student_id -> { marks, absent, remark }
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  async function load() {
    const [{ data: e, error: e1 }, { data: m, error: e2 }] = await Promise.all([
      supabase.from('exams').select('*').eq('id', id).maybeSingle(),
      supabase.from('exam_marks').select('*, students(full_name, student_code)').eq('exam_id', id),
    ]);
    if (e1 || e2) { setErr((e1 || e2).message); return; }
    if (!e) { setErr('This exam was not found, or you do not have access to it.'); return; }
    setExam(e);
    setMarks((m || []).sort((a, b) => (a.students?.full_name || '').localeCompare(b.students?.full_name || '')));
    setEdit({});
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !exam) return <section className="card"><button className="link" onClick={onBack}>← Back to exams</button><p className="error">{err}</p></section>;
  if (!exam) return <div className="spinner" />;

  const klass = classes.find((c) => c.id === exam.class_id);
  const mine = can(profile, 'exams') || klass?.teacher_id === profile.id;
  const results = can(profile, 'results');
  const editable = (exam.status === 'draft' && (mine || results)) || (exam.status === 'submitted' && results);
  const max = Number(exam.max_marks);

  const val = (m) => ({ marks: m.marks, absent: m.absent, remark: m.remark || '', ...(edit[m.student_id] || {}) });
  const invalid = (v) => !v.absent && v.marks !== null && v.marks !== '' && (Number.isNaN(Number(v.marks)) || Number(v.marks) < 0 || Number(v.marks) > max);
  const rows = marks.map((m) => {
    const v = val(m);
    const n = v.absent || v.marks === null || v.marks === '' ? null : Number(v.marks);
    const pct = n == null ? null : pctOf(n, max);
    return { m, v, n, pct, grade: n == null ? '' : gradeOf(pct, setup.grades), passed: !v.absent && n != null && n >= Number(exam.pass_marks), bad: invalid(v) };
  });
  const dirty = Object.keys(edit).length > 0;
  const anyBad = rows.some((r) => r.bad);
  const scored = rows.filter((r) => r.n != null);
  const stats = {
    entered: rows.filter((r) => r.n != null || r.v.absent).length,
    avg: scored.length ? Math.round((scored.reduce((a, r) => a + r.pct, 0) / scored.length) * 10) / 10 : null,
    hi: scored.length ? Math.max(...scored.map((r) => r.n)) : null,
    lo: scored.length ? Math.min(...scored.map((r) => r.n)) : null,
    passed: rows.filter((r) => r.passed).length,
  };

  const change = (sid, k, value) => setEdit({ ...edit, [sid]: { ...val(marks.find((x) => x.student_id === sid)), ...(edit[sid] || {}), [k]: value } });

  async function saveMarks(silent) {
    if (anyBad) { setErr(`Marks must be between 0 and ${max}. Fix the boxes shown in red.`); return false; }
    if (!dirty) return true;
    setBusy('save'); setErr(''); setMsg('');
    const payload = Object.entries(edit).map(([sid, v]) => ({
      exam_id: exam.id, student_id: sid, absent: !!v.absent,
      marks: v.absent || v.marks === '' || v.marks === null ? null : Number(v.marks), remark: (v.remark || '').trim() || null,
    }));
    const { error } = await supabase.from('exam_marks').upsert(payload, { onConflict: 'exam_id,student_id' });
    setBusy('');
    if (error) { setErr(error.message); return false; }
    if (!silent) setMsg('Marks saved.');
    await load();
    return true;
  }

  async function act(action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    if (!(await saveMarks(true))) return;
    setBusy(action); setErr(''); setMsg('');
    const { error } = await supabase.rpc('set_exam_status', { p_exam: exam.id, p_action: action });
    setBusy('');
    if (error) setErr(error.message);
    else { setMsg({ submit: 'Submitted for finalizing.', return: 'Returned to draft.', finalize: 'Results finalized and locked.', publish: 'Published. Students and parents have been notified in the app.', unpublish: 'Unpublished — hidden from students and parents.', reopen: 'Reopened for corrections.' }[action]); load(); }
  }

  async function removeStudent(m) {
    if (!window.confirm(`Remove ${m.students?.full_name} from this exam?`)) return;
    const { error } = await supabase.from('exam_marks').delete().eq('id', m.id);
    if (error) setErr(error.message); else load();
  }

  async function deleteExam() {
    if (!window.confirm(`Delete the exam "${exam.title}" and all its marks?`)) return;
    const { error } = await supabase.from('exams').delete().eq('id', exam.id);
    if (error) setErr(error.message); else onBack();
  }

  const subject = setup.subjects.find((s) => s.id === exam.subject_id)?.name || '';
  const typeName = setup.types.find((t) => t.code === exam.exam_type)?.name || exam.exam_type;
  const exportRows = rows.map((r) => ({
    'Student ID': r.m.students?.student_code, Student: r.m.students?.full_name,
    Marks: r.v.absent ? 'Absent' : r.n ?? '', 'Max marks': max, '%': r.pct ?? '', Grade: r.grade, Result: r.passed ? 'Pass' : 'Fail', Remark: r.v.remark,
  }));

  return (
    <section className="card">
      <button className="link" onClick={onBack}>← Back to exams</button>
      <div className="row-between">
        <div>
          <h2>{exam.title}</h2>
          <p className="small muted">{typeName}{exam.term ? ` · ${exam.term}` : ''} · {exam.academic_year} · {klass ? classTag(klass) : ''}{subject ? ` · ${subject}` : ''} · {formatDate(exam.exam_date)}</p>
          <p className="small">Max <b>{max}</b> · Pass <b>{exam.pass_marks}</b> · <StatusBadge exam={exam} /></p>
        </div>
        <div className="actions">
          <button className="btn ghost small" onClick={() => downloadExcel(`results-${exam.title}.xlsx`.replace(/[^\w.-]+/g, '_'), [{ name: 'Results', rows: exportRows }])}>Excel</button>
          <button className="btn ghost small" onClick={() => downloadPdf(`results-${exam.title}.pdf`.replace(/[^\w.-]+/g, '_'), {
            title: `${exam.title} · ${typeName} · ${exam.academic_year}`, subtitle: `${klass?.name || ''} · ${subject} · Max ${max}, pass ${exam.pass_marks}${exam.published_at ? '' : ' · NOT PUBLISHED'}`,
            tables: [{ columns: Object.keys(exportRows[0] || { Student: '' }), rows: exportRows.map((r) => Object.values(r)) }],
          })}>PDF</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{stats.entered}/{rows.length}</b><span>Marks entered</span></div>
        <div className="stat"><b>{stats.avg ?? '—'}{stats.avg != null ? '%' : ''}</b><span>Class average</span></div>
        <div className="stat"><b>{stats.hi ?? '—'} / {stats.lo ?? '—'}</b><span>Highest / lowest</span></div>
        <div className="stat"><b>{stats.passed}/{rows.length}</b><span>Passed</span></div>
      </div>

      {exam.status === 'submitted' && !results && <p className="notice-line">Submitted on {formatDate(exam.submitted_at)}. Waiting for the results manager to finalize. Marks are locked.</p>}
      {exam.status === 'finalized' && <p className="notice-line">Finalized on {formatDate(exam.finalized_at)} — marks are locked.{exam.published_at ? ` Published ${formatDate(exam.published_at)}.` : ' Not yet visible to students and parents.'}</p>}
      {err && <p className="error">{err}</p>}
      {msg && <p className="success">{msg}</p>}

      {rows.length === 0 ? <p className="muted">No students in this exam yet.</p> : (
        <div className="table-wrap">
          <table className="marks-table">
            <thead><tr><th>Student</th><th>Marks /{max}</th><th>Absent</th><th>%</th><th>Grade</th><th>Result</th><th className="hide-sm">Remark</th>{editable && exam.status === 'draft' && <th />}</tr></thead>
            <tbody>
              {rows.map(({ m, v, pct, grade, passed, bad, n }) => (
                <tr key={m.student_id}>
                  <td>{m.students?.full_name || 'Student'}<div className="small muted">{m.students?.student_code}</div></td>
                  <td>
                    {editable ? (
                      <input className={`mark-input ${bad ? 'bad' : ''}`} type="number" inputMode="decimal" min="0" max={max} step="0.5"
                        value={v.absent ? '' : v.marks ?? ''} disabled={v.absent} aria-label={`Marks for ${m.students?.full_name}`}
                        onChange={(e) => change(m.student_id, 'marks', e.target.value)} />
                    ) : (v.absent ? '—' : n ?? '—')}
                    {bad && <div className="error small">0 – {max}</div>}
                  </td>
                  <td>{editable ? <input type="checkbox" checked={!!v.absent} onChange={(e) => change(m.student_id, 'absent', e.target.checked)} aria-label="Absent" /> : v.absent ? 'Absent' : ''}</td>
                  <td>{pct ?? '—'}</td>
                  <td>{grade || '—'}</td>
                  <td>{n == null && !v.absent ? <span className="muted small">—</span> : <span className={`badge ${passed ? 'present' : 'absent'}`}>{passed ? 'Pass' : 'Fail'}</span>}</td>
                  <td className="hide-sm">{editable ? <input value={v.remark} onChange={(e) => change(m.student_id, 'remark', e.target.value)} placeholder="optional" aria-label="Remark" /> : v.remark}</td>
                  {editable && exam.status === 'draft' && <td><button className="link danger small" onClick={() => removeStudent(m)} title="Remove from exam">✕</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions sticky-actions">
        {editable && <button className="btn" disabled={!dirty || !!busy} onClick={() => saveMarks(false)}>{busy === 'save' ? 'Saving…' : dirty ? 'Save marks' : 'Saved'}</button>}
        {exam.status === 'draft' && (mine || results) && <button className="btn ghost" disabled={!!busy} onClick={() => act('submit', 'Submit these results? You cannot change marks after submitting unless the exam is returned to you.')}>Submit results</button>}
        {exam.status === 'draft' && (mine || results) && <button className="btn ghost small" onClick={() => setEditing(true)}>Edit details</button>}
        {exam.status === 'draft' && (mine || results) && <button className="btn ghost small" onClick={() => setAdding(true)}>+ Students</button>}
        {exam.status === 'draft' && (mine || results) && <button className="btn danger ghost small" onClick={deleteExam}>Delete exam</button>}
        {results && exam.status === 'submitted' && <button className="btn" disabled={!!busy} onClick={() => act('finalize', 'Finalize these results? Marks will be locked.')}>Finalize</button>}
        {results && exam.status === 'submitted' && <button className="btn ghost" disabled={!!busy} onClick={() => act('return')}>Return to teacher</button>}
        {results && exam.status === 'finalized' && !exam.published_at && <button className="btn" disabled={!!busy} onClick={() => act('publish', 'Publish to students and parents? They will be notified in the app.')}>Publish results</button>}
        {results && exam.published_at && <button className="btn ghost" disabled={!!busy} onClick={() => act('unpublish', 'Hide these results from students and parents?')}>Unpublish</button>}
        {results && exam.status === 'finalized' && <button className="btn ghost small" disabled={!!busy} onClick={() => act('reopen', 'Reopen for corrections? This also unpublishes the results.')}>Reopen</button>}
      </div>

      {editing && <ExamForm exam={exam} setup={setup} classes={classes} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {adding && <AddStudents exam={exam} have={marks.map((m) => m.student_id)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </section>
  );
}

function AddStudents({ exam, have, onClose, onDone }) {
  const [list, setList] = useState(null);
  const [picked, setPicked] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('students').select('id, full_name, student_code').eq('class_id', exam.class_id).eq('status', 'approved').order('full_name')
      .then(({ data }) => setList((data || []).filter((s) => !have.includes(s.id))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function add() {
    const ids = Object.keys(picked).filter((k) => picked[k]);
    const { error } = await supabase.from('exam_marks').insert(ids.map((sid) => ({ exam_id: exam.id, student_id: sid })));
    if (error) setErr(error.message); else onDone();
  }
  return (
    <Modal title="Add students to this exam" onClose={onClose}>
      {list === null ? <div className="spinner" /> : list.length === 0 ? <p className="muted">Everyone in the class is already in this exam.</p> : (
        <>
          <div className="pick-list">
            {list.map((s) => <label key={s.id} className="pick-row"><input type="checkbox" checked={!!picked[s.id]} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.checked })} /><span>{s.full_name} <span className="small muted">{s.student_code}</span></span></label>)}
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn" disabled={!Object.values(picked).some(Boolean)} onClick={add}>Add selected</button>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Class results summary and report cards
function ResultsView({ setup, classes }) {
  const [f, setF] = useState({ year: setup.currentYear, exam_type: '', term: '', class_id: classes[0]?.id || '' });
  const [rows, setRows] = useState(null);
  const [students, setStudents] = useState([]);
  const [err, setErr] = useState('');
  const [card, setCard] = useState(null); // { student }

  useEffect(() => {
    if (!f.class_id) { setRows([]); return; }
    (async () => {
      setErr(''); setRows(null);
      try {
        let rs = await fetchAllRows(() => {
          let q = supabase.from('exam_results').select('*').eq('class_id', f.class_id);
          if (f.year) q = q.eq('academic_year', f.year);
          if (f.exam_type) q = q.eq('exam_type', f.exam_type);
          return q;
        });
        if (f.term) rs = rs.filter((r) => (r.term || '') === f.term);
        const ids = [...new Set(rs.map((r) => r.student_id))];
        const { data } = ids.length ? await supabase.from('students').select('id, full_name, student_code, admission_no, class_id').in('id', ids).order('full_name') : { data: [] };
        setStudents(data || []);
        setRows(rs);
      } catch (e) { setErr(e.message); setRows([]); }
    })();
  }, [f]);

  const terms = useMemo(() => [...new Set((rows || []).map((r) => r.term || ''))].filter(Boolean), [rows]);
  const exams = useMemo(() => {
    const m = {};
    for (const r of rows || []) m[r.exam_id] ||= { id: r.exam_id, title: r.title, exam_type: r.exam_type, term: r.term, max: r.max_marks, published: !!r.published_at, status: r.status, subject: setup.subjects.find((s) => s.id === r.subject_id)?.name || '' };
    return Object.values(m);
  }, [rows, setup.subjects]);
  const klass = classes.find((c) => c.id === f.class_id);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const table = students.map((s) => {
    const mine = (rows || []).filter((r) => r.student_id === s.id);
    const total = mine.reduce((a, r) => a + Number(r.marks || 0), 0);
    const max = mine.reduce((a, r) => a + Number(r.max_marks), 0);
    const pct = max ? Math.round((total * 1000) / max) / 10 : null;
    return { s, by: Object.fromEntries(mine.map((r) => [r.exam_id, r])), total, max, pct, grade: gradeOf(pct, setup.grades), passed: mine.length > 0 && mine.every((r) => r.passed) };
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const unpublished = exams.filter((e) => !e.published).length;

  function exportXlsx() {
    downloadExcel(`class-results-${klass?.name || ''}-${f.year}.xlsx`.replace(/[^\w.-]+/g, '_'), [{
      name: 'Class results',
      rows: table.map((t, i) => ({
        Rank: i + 1, 'Student ID': t.s.student_code, Student: t.s.full_name,
        ...Object.fromEntries(exams.map((e) => [`${e.title} (/${e.max})`, t.by[e.id] ? (t.by[e.id].absent ? 'Absent' : t.by[e.id].marks ?? '') : ''])),
        Total: t.total, Max: t.max, '%': t.pct ?? '', Grade: t.grade, Result: t.passed ? 'Pass' : 'Fail',
      })),
    }]);
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Results &amp; report cards</h2>
        {table.length > 0 && <button className="btn ghost small" onClick={exportXlsx}>Download Excel</button>}
      </div>
      <div className="filters">
        <select value={f.class_id} onChange={set('class_id')} aria-label="Class">{classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}</select>
        <select value={f.year} onChange={set('year')} aria-label="Academic year"><option value="">All years</option>{setup.years.map((y) => <option key={y.name} value={y.name}>{y.name}</option>)}</select>
        <select value={f.exam_type} onChange={set('exam_type')} aria-label="Exam type"><option value="">All exam types</option>{setup.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
        <select value={f.term} onChange={set('term')} aria-label="Term"><option value="">All terms</option>{terms.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      </div>
      {err && <p className="error">{err}</p>}
      {unpublished > 0 && <p className="notice-line">{unpublished} of {exams.length} exam(s) below are <b>not published</b> — students and parents cannot see them yet.</p>}
      {rows === null ? <div className="spinner" /> : table.length === 0 ? <p className="muted">No results for these filters yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Student</th>{exams.map((e) => <th key={e.id} className="small" title={e.title}>{e.subject || e.title}<div className="muted">/{e.max}{!e.published ? ' · unpublished' : ''}</div></th>)}<th>Total</th><th>%</th><th>Grade</th><th>Result</th></tr>
            </thead>
            <tbody>
              {table.map((t, i) => (
                <tr key={t.s.id}>
                  <td>{i + 1}</td>
                  <td><button className="link" onClick={() => setCard({ student: t.s })}>{t.s.full_name}</button><div className="small muted">{t.s.student_code}</div></td>
                  {exams.map((e) => <td key={e.id}>{t.by[e.id] ? (t.by[e.id].absent ? <span className="muted">Abs</span> : t.by[e.id].marks ?? '—') : ''}</td>)}
                  <td>{t.total}/{t.max}</td><td>{t.pct ?? '—'}</td><td>{t.grade}</td>
                  <td><span className={`badge ${t.passed ? 'present' : 'absent'}`}>{t.passed ? 'Pass' : 'Fail'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Tap a student for their report cards and full history.</p>
      {card && (
        <Modal title={`${card.student.full_name} — results`} onClose={() => setCard(null)}>
          <StudentResults student={card.student} setup={setup} staff />
        </Modal>
      )}
    </section>
  );
}

// All report cards of one student (used by staff, students and parents).
export function StudentResults({ student, setup, staff }) {
  const [rows, setRows] = useState(null);
  const [classes, setClasses] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('exam_results').select('*').eq('student_id', student.id).order('exam_date');
      if (error) { setErr(/exam_results/.test(error.message) ? 'Exam results are not installed yet.' : error.message); setRows([]); return; }
      const ids = [...new Set((data || []).map((r) => r.class_id))];
      const { data: cl } = ids.length ? await supabase.from('classes').select('id, name, group_name').in('id', ids) : { data: [] };
      setClasses(cl || []);
      setRows(data || []);
    })();
  }, [student.id]);

  if (err) return <p className="error">{err}</p>;
  if (rows === null) return <div className="spinner" />;
  const cards = reportCards(rows, setup);
  if (!cards.length) return <p className="muted">{staff ? 'No results yet.' : 'No published results yet. Results appear here after the school publishes them.'}</p>;
  const className = (r) => classes.find((c) => c.id === r.rows[0]?.class_id)?.name || '';
  return (
    <div className="report-cards">
      {cards.map((c) => (
        <div key={c.key} className="report-card">
          <div className="row-between">
            <div>
              <h3>{c.typeName}{c.term ? ` · ${c.term}` : ''}</h3>
              <span className="small muted">{c.academic_year}{className(c) ? ` · ${className(c)}` : ''}</span>
            </div>
            <div className="right">
              {!c.published && <span className="badge inactive">Not published</span>}{' '}
              <span className={`badge ${c.passed ? 'present' : 'absent'}`}>{c.passed ? 'Pass' : 'Fail'}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Subject</th><th>Marks</th><th>%</th><th>Grade</th><th>Result</th></tr></thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{c.subjectName(r.subject_id) || r.title}<div className="small muted">{r.title} · {formatDate(r.exam_date)}</div>{r.remark && <div className="small">💬 {r.remark}</div>}</td>
                    <td>{r.absent ? 'Absent' : `${r.marks ?? '—'}/${r.max_marks}`}</td>
                    <td>{r.pct ?? '—'}</td><td>{r.grade || '—'}</td>
                    <td><span className={`badge ${r.passed ? 'present' : 'absent'}`}>{r.passed ? 'Pass' : 'Fail'}</span></td>
                  </tr>
                ))}
                <tr className="total-row"><td><b>Total</b></td><td><b>{c.total}/{c.max}</b></td><td><b>{c.pct ?? '—'}</b></td><td><b>{c.grade}</b></td><td>{gradeRemark(c.grade, setup.grades)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button className="btn ghost small" onClick={() => reportCardPdf({ student, className: className(c), card: c, subjects: setup.subjects, grades: setup.grades }, true)}>🖨 Print</button>
            <button className="btn ghost small" onClick={() => reportCardPdf({ student, className: className(c), card: c, subjects: setup.subjects, grades: setup.grades })}>⬇ PDF</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Admin: academic years, subjects, exam types, grading rules, certificate templates
function ExamSetup({ setup, reload }) {
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  async function run(p, ok) {
    setErr(''); setMsg('');
    const { error } = await p;
    if (error) setErr(/foreign key|violates/.test(error.message) ? 'This is already used by exams or certificates, so it cannot be deleted.' : error.message);
    else { setMsg(ok || 'Saved.'); reload(); }
  }
  const add = (e, table, build) => { e.preventDefault(); const f = new FormData(e.target); run(supabase.from(table).insert(build(f))); e.target.reset(); };

  return (
    <section className="card">
      <h2>Exam setup</h2>
      {err && <p className="error">{err}</p>}
      {msg && <p className="success">{msg}</p>}

      <h3>Academic years</h3>
      <ul className="setup-list">
        {setup.years.map((y) => (
          <li key={y.name} className="row-between">
            <span><b>{y.name}</b> {y.is_current && <span className="badge approved">Current</span>}</span>
            <span className="actions">
              {!y.is_current && <button className="link" onClick={async () => { await supabase.from('academic_years').update({ is_current: false }).neq('name', y.name); run(supabase.from('academic_years').update({ is_current: true }).eq('name', y.name)); }}>Make current</button>}
              <button className="link danger" onClick={() => window.confirm(`Delete ${y.name}?`) && run(supabase.from('academic_years').delete().eq('name', y.name))}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      <form className="filters" onSubmit={(e) => add(e, 'academic_years', (f) => ({ name: f.get('name').trim() }))}>
        <input name="name" required placeholder="e.g. 2027–2028" /><button className="btn small">Add year</button>
      </form>

      <h3>Subjects</h3>
      <ul className="setup-list">
        {setup.subjects.map((s) => (
          <li key={s.id} className="row-between">
            <span className={s.active ? '' : 'muted'}>{s.name}{!s.active && ' (hidden)'}</span>
            <span className="actions">
              <button className="link" onClick={() => { const n = window.prompt('Subject name', s.name); if (n && n.trim()) run(supabase.from('subjects').update({ name: n.trim() }).eq('id', s.id)); }}>Rename</button>
              <button className="link" onClick={() => run(supabase.from('subjects').update({ active: !s.active }).eq('id', s.id))}>{s.active ? 'Hide' : 'Show'}</button>
              <button className="link danger" onClick={() => window.confirm(`Delete ${s.name}?`) && run(supabase.from('subjects').delete().eq('id', s.id))}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      <form className="filters" onSubmit={(e) => add(e, 'subjects', (f) => ({ name: f.get('name').trim(), sort: setup.subjects.length + 1 }))}>
        <input name="name" required placeholder="New subject" /><button className="btn small">Add subject</button>
      </form>

      <h3>Exam types</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Final exam</th><th>Gives certificates</th></tr></thead>
          <tbody>
            {setup.types.map((t) => (
              <tr key={t.code}>
                <td><button className="link" onClick={() => { const n = window.prompt('Exam type name', t.name); if (n && n.trim()) run(supabase.from('exam_types').update({ name: n.trim() }).eq('code', t.code)); }}>{t.name}</button> <span className="small muted">{t.code}</span></td>
                <td><input type="checkbox" checked={t.is_final} onChange={(e) => run(supabase.from('exam_types').update({ is_final: e.target.checked }).eq('code', t.code))} aria-label="Final exam" /></td>
                <td><input type="checkbox" checked={t.allow_certificate} onChange={(e) => {
                  if (e.target.checked && !t.is_final && !window.confirm(`Allow certificates for ${t.name}? Normally only final exams give certificates.`)) return;
                  run(supabase.from('exam_types').update({ allow_certificate: e.target.checked }).eq('code', t.code));
                }} aria-label="Gives certificates" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="filters" onSubmit={(e) => add(e, 'exam_types', (f) => ({ code: f.get('name').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20), name: f.get('name').trim(), sort: setup.types.length + 1 }))}>
        <input name="name" required placeholder="e.g. Half-yearly exam" /><button className="btn small">Add exam type</button>
      </form>

      <h3>Grading rules</h3>
      <p className="small muted">A student gets the grade of the highest row their percentage reaches. Pass / fail comes from each exam's pass marks.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>From %</th><th>Grade</th><th>Remark</th><th /></tr></thead>
          <tbody>
            {setup.grades.map((g) => (
              <tr key={g.id}>
                <td>{g.min_pct}</td><td><b>{g.grade}</b></td><td>{g.remark}</td>
                <td><button className="link danger" onClick={() => window.confirm(`Delete grade ${g.grade}?`) && run(supabase.from('grade_rules').delete().eq('id', g.id))}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="filters" onSubmit={(e) => add(e, 'grade_rules', (f) => ({ min_pct: Number(f.get('min')), grade: f.get('grade').trim(), remark: f.get('remark').trim() || null }))}>
        <input name="min" type="number" min="0" max="100" step="0.5" required placeholder="From %" style={{ maxWidth: 110 }} />
        <input name="grade" required placeholder="Grade e.g. A" style={{ maxWidth: 110 }} />
        <input name="remark" placeholder="Remark e.g. Very good" />
        <button className="btn small">Add grade</button>
      </form>

      <h3>Certificate templates</h3>
      <p className="small muted">You can use {'{student}'}, {'{class}'}, {'{year}'}, {'{exam}'}, {'{grade}'}, {'{percent}'} in the text.</p>
      {setup.templates.map((t) => (
        <form key={t.code} className="form-grid template-form" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.target);
          const values = { name: f.get('name'), title: f.get('title'), body: f.get('body'), signature_left: f.get('sl'), signature_right: f.get('sr'), active: f.get('active') === 'on' };
          if ('title_ar' in t) Object.assign(values, { title_ar: f.get('title_ar') || null, body_ar: f.get('body_ar') || null, signature_left_ar: f.get('sl_ar') || 'معلم الحلقة', signature_right_ar: f.get('sr_ar') || 'المدير' });
          run(supabase.from('certificate_templates').update(values).eq('code', t.code), `${t.name} template saved.`);
        }}>
          <label>Type name<input name="name" defaultValue={t.name} required /></label>
          <label>Title<input name="title" defaultValue={t.title} required /></label>
          <label className="span2">Text<textarea name="body" rows={3} defaultValue={t.body} required /></label>
          {'title_ar' in t && <label className="span2">Title in Arabic<input name="title_ar" dir="rtl" lang="ar" defaultValue={t.title_ar || ''} /></label>}
          {'title_ar' in t && <label className="span2">Text in Arabic<textarea name="body_ar" rows={3} dir="rtl" lang="ar" defaultValue={t.body_ar || ''} /></label>}
          <label>Left signature<input name="sl" defaultValue={t.signature_left} /></label>
          <label>Right signature<input name="sr" defaultValue={t.signature_right} /></label>
          {'title_ar' in t && <label>Left signature (Arabic)<input name="sl_ar" dir="rtl" defaultValue={t.signature_left_ar || ''} /></label>}
          {'title_ar' in t && <label>Right signature (Arabic)<input name="sr_ar" dir="rtl" defaultValue={t.signature_right_ar || ''} /></label>}
          <label className="check span2"><input type="checkbox" name="active" defaultChecked={t.active} /><span>Available for requests</span></label>
          <div className="span2"><button className="btn small">Save template</button></div>
        </form>
      ))}
      <form className="filters" onSubmit={(e) => add(e, 'certificate_templates', (f) => ({
        code: f.get('name').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20), name: f.get('name').trim(),
        title: `Certificate of ${f.get('name').trim()}`, body: 'This is to certify that {student} of {class} has successfully completed the {exam} of the academic year {year}.', sort: setup.templates.length + 1,
      }))}>
        <input name="name" required placeholder="New certificate type e.g. Tajweed" /><button className="btn small">Add template</button>
      </form>
    </section>
  );
}
