import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses, fetchAllRows } from './data.js';
import { formatDate, lastClassDay, today, classTag } from './util.js';
import { getSettings } from './settings.js';
import { can } from './perms.js';
import { downloadExcel } from './exports.js';
import { KINDS, KIND_LABEL, GRADES, GRADE_LABEL } from './progress.js';
import Modal from './Modal.jsx';

export default function Progress({ profile }) {
  const all = can(profile, 'progress') || can(profile, 'students');
  const classes = useQuery(() => fetchMyClasses(profile, all ? 'progress' : null), [profile.id]);
  const [classId, setClassId] = useState('');
  const [students, setStudents] = useState(null);
  const [entries, setEntries] = useState([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);   // { student, entry? }
  const [history, setHistory] = useState(null); // student

  useEffect(() => {
    if (!classId && classes.data?.length) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  async function load() {
    if (!classId) return;
    setErr('');
    try {
      const st = await fetchAllRows(() => {
        let x = supabase.from('students').select('id, full_name, student_code, class_id, quran_level').eq('status', 'approved').order('full_name');
        return classId === 'all' ? x : x.eq('class_id', classId);
      });
      setStudents(st);
      const ids = st.map((s) => s.id);
      const en = ids.length ? await fetchAllRows(() => {
        const x = supabase.from('student_progress').select('*')
          .order('entry_date', { ascending: false }).order('created_at', { ascending: false });
        return classId === 'all' ? x : x.in('student_id', ids);
      }) : [];
      setEntries(en);
    } catch (e) {
      setErr(/student_progress/.test(e.message) ? 'Progress is not installed yet. Run update-17.sql in Supabase → SQL Editor.' : e.message);
      setStudents([]);
    }
  }
  useEffect(() => { load(); }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byStudent = useMemo(() => {
    const m = {};
    for (const e of entries) (m[e.student_id] ||= []).push(e);
    return m;
  }, [entries]);

  const klass = (classes.data || []).find((c) => c.id === classId);
  const rows = (students || []).filter((s) => !q || `${s.full_name} ${s.student_code}`.toLowerCase().includes(q.toLowerCase()));

  function exportXlsx() {
    const name = (id) => (students || []).find((s) => s.id === id);
    downloadExcel(`progress-${klass ? klass.name.replace(/[^\w-]+/g, '_') : 'all'}-${today()}.xlsx`, [{
      name: 'Progress',
      rows: entries.map((e) => ({
        Date: e.entry_date,
        'Student ID': name(e.student_id)?.student_code || '',
        Student: name(e.student_id)?.full_name || '',
        Type: KIND_LABEL[e.kind] || e.kind,
        Lesson: e.lesson || '',
        Grade: GRADE_LABEL[e.grade] || '',
        'Teacher comment': e.comment || '',
        Teacher: e.teacher_name || '',
      })),
    }]);
  }

  function next(student) {
    const i = rows.findIndex((s) => s.id === student.id);
    return rows[i + 1] || null;
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Student progress</h2>
        {entries.length > 0 && <button className="btn ghost" onClick={exportXlsx}>Download Excel</button>}
      </div>
      <p className="small muted">Record each student's lesson, grade and a comment. Students (and parents) see only their own progress when they sign in.</p>
      <div className="filters">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          {all && <option value="all">All classes</option>}
          {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}
        </select>
        <input placeholder="Search student…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {(err || classes.error) && <p className="error">{err || classes.error}</p>}
      {classes.data && !classes.data.length && <p className="muted">You have no classes yet. The admin assigns teachers to classes under Classes.</p>}
      {students === null ? (classId && <div className="spinner" />) : rows.length === 0 ? <p className="muted">No students in this class.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Student</th><th>Latest</th><th>Grade</th><th className="hide-sm">Entries</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => {
                const list = byStudent[s.id] || [];
                const last = list[0];
                return (
                  <tr key={s.id}>
                    <td><button className="link" onClick={() => setHistory(s)}>{s.full_name}</button><div className="small muted">{s.student_code}</div></td>
                    <td>{last ? <><span className="small muted">{formatDate(last.entry_date)} · {KIND_LABEL[last.kind]}</span><div>{last.lesson || '—'}</div></> : <span className="muted small">No entries yet</span>}</td>
                    <td>{last?.grade ? <span className={`grade ${last.grade}`}>{GRADE_LABEL[last.grade]}</span> : ''}</td>
                    <td className="hide-sm">{list.length}</td>
                    <td><button className="btn small" onClick={() => setAdding({ student: s })}>+ Add</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <EntryForm
          student={adding.student}
          entry={adding.entry}
          last={(byStudent[adding.student.id] || [])[0]}
          hasNext={!adding.entry && !!next(adding.student)}
          onClose={() => setAdding(null)}
          onSaved={(goNext) => {
            const n = goNext ? next(adding.student) : null;
            setAdding(n ? { student: n } : null);
            load();
          }}
        />
      )}

      {history && (
        <Modal title={`${history.full_name} — progress`} onClose={() => setHistory(null)}>
          <p><button className="btn small" onClick={() => { setAdding({ student: history }); setHistory(null); }}>+ Add entry</button></p>
          <ProgressList entries={byStudent[history.id] || []}
            onEdit={(e) => { setAdding({ student: history, entry: e }); setHistory(null); }}
            onDelete={async (e) => {
              if (!window.confirm('Delete this progress entry?')) return;
              const { error } = await supabase.from('student_progress').delete().eq('id', e.id);
              if (error) setErr(error.message); else load();
            }} />
        </Modal>
      )}
    </section>
  );
}

function EntryForm({ student, entry, last, hasNext, onClose, onSaved }) {
  const [f, setF] = useState(() => entry
    ? { entry_date: entry.entry_date, kind: entry.kind, lesson: entry.lesson || '', grade: entry.grade || '', comment: entry.comment || '' }
    : { entry_date: lastClassDay(getSettings().class_days), kind: last?.kind || 'hifz', lesson: '', grade: '', comment: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(goNext) {
    if (!f.lesson.trim() && !f.comment.trim()) { setErr('Write the lesson or a comment.'); return; }
    setBusy(true); setErr('');
    const payload = { entry_date: f.entry_date, kind: f.kind, lesson: f.lesson.trim() || null, grade: f.grade || null, comment: f.comment.trim() || null };
    const { error } = entry
      ? await supabase.from('student_progress').update(payload).eq('id', entry.id)
      : await supabase.from('student_progress').insert({ ...payload, student_id: student.id });
    setBusy(false);
    if (error) setErr(error.message); else onSaved(goNext);
  }

  return (
    <Modal title={`${entry ? 'Edit' : 'Add'} progress — ${student.full_name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <label>Date<input type="date" required max={today()} value={f.entry_date} onChange={set('entry_date')} /></label>
        <label>Type
          <select value={f.kind} onChange={set('kind')}>{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="span2">Lesson / portion
          <input value={f.lesson} onChange={set('lesson')} placeholder="e.g. Surah Al-Mulk 1–15, Juz 30 page 3, Qaida lesson 7" />
        </label>
        <div className="span2 field">
          <span className="field-label">Grade</span>
          <div className="grade-pick" role="group" aria-label="Grade">
            {GRADES.map(([k, v]) => (
              <button type="button" key={k} className={`grade ${k} ${f.grade === k ? 'on' : ''}`} aria-pressed={f.grade === k}
                onClick={() => setF({ ...f, grade: f.grade === k ? '' : k })}>{v}</button>
            ))}
          </div>
        </div>
        <label className="span2">Teacher's comment
          <textarea rows={3} value={f.comment} onChange={set('comment')} placeholder="e.g. Good memorisation, practise the madd rules at home." />
        </label>
        {last && !entry && <p className="span2 small muted">Last time ({formatDate(last.entry_date)}): {last.lesson || '—'}{last.grade ? ` · ${GRADE_LABEL[last.grade]}` : ''}</p>}
        {err && <p className="error span2">{err}</p>}
        <div className="span2 actions">
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          {hasNext && <button type="button" className="btn ghost" disabled={busy} onClick={() => save(true)}>Save & next student</button>}
        </div>
      </form>
    </Modal>
  );
}

export function ProgressList({ entries, onEdit, onDelete }) {
  if (!entries.length) return <p className="muted">No progress recorded yet.</p>;
  return (
    <ul className="progress-list">
      {entries.map((e) => (
        <li key={e.id}>
          <div className="row-between">
            <span><b>{e.lesson || KIND_LABEL[e.kind]}</b> <span className="small muted">· {KIND_LABEL[e.kind]}</span></span>
            {e.grade && <span className={`grade ${e.grade}`}>{GRADE_LABEL[e.grade]}</span>}
          </div>
          <div className="small muted">{formatDate(e.entry_date)}{e.teacher_name ? ` · ${e.teacher_name}` : ''}</div>
          {e.comment && <p className="comment">💬 {e.comment}</p>}
          {(onEdit || onDelete) && (
            <div className="actions small">
              {onEdit && <button className="link" onClick={() => onEdit(e)}>Edit</button>}
              {onDelete && <button className="link danger" onClick={() => onDelete(e)}>Delete</button>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
