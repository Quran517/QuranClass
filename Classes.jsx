import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchClasses, fetchTeachers } from './data.js';
import Modal from './Modal.jsx';
import ImportStudents from './ImportStudents.jsx';

export default function Classes() {
  const classes = useQuery(fetchClasses);
  const teachers = useQuery(fetchTeachers);
  const students = useQuery(() =>
    supabase.from('students').select('id, full_name, student_code, class_id, gender, quran_level').eq('status', 'approved').order('full_name'));
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');

  const teacherName = (id) => {
    const t = (teachers.data || []).find((x) => x.id === id);
    return t ? `${t.full_name || t.email}${t.staff_code ? ' (' + t.staff_code + ')' : ''}` : null;
  };
  const countFor = (id) => (students.data || []).filter((s) => s.class_id === id).length;

  async function save(e) {
    e.preventDefault();
    setErr(''); setNotice('');
    const f = new FormData(e.target);
    const payload = {
      name: f.get('name').trim(),
      level: f.get('level') || null,
      group_name: (f.get('group_name') || '').trim() || null,
      schedule: f.get('schedule') || null,
      teacher_id: f.get('teacher_id') || null,
    };
    if (editing.id) {
      const { error } = await supabase.from('classes').update(payload).eq('id', editing.id);
      if (error) { setErr(error.message); return; }
      setEditing({ ...editing, ...payload });
      setNotice('Class details saved.');
    } else {
      const { data, error } = await supabase.from('classes').insert(payload).select().single();
      if (error) { setErr(error.message); return; }
      setEditing(data); // stay open so students can be added straight away
      setNotice('Class created. Now add students below.');
    }
    classes.reload();
  }

  async function remove() {
    if (!window.confirm(`Delete class "${editing.name}"? Its students will become unassigned and its attendance records will be deleted.`)) return;
    const { error } = await supabase.from('classes').delete().eq('id', editing.id);
    if (error) setErr(error.message);
    else { setEditing(null); classes.reload(); students.reload(); }
  }

  function close() {
    setEditing(null); setErr(''); setNotice('');
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Classes</h2>
        <button className="btn" onClick={() => setEditing({})}>+ New class</button>
      </div>
      {classes.error && <p className="error">{classes.error}</p>}
      {classes.loading ? <div className="spinner" /> : (classes.data || []).length === 0 ? (
        <p className="muted">No classes yet. Create one to start assigning students and teachers.</p>
      ) : (
        <div className="grid-cards">
          {classes.data.map((c) => (
            <button key={c.id} className="class-card" onClick={() => setEditing(c)}>
              <b>{c.name}</b>
              {(c.group_name || c.level) && <span className="small muted">{[c.group_name, c.level].filter(Boolean).join(' · ')}</span>}
              {c.schedule && <span className="small">{c.schedule}</span>}
              <span className="small">Teacher: {teacherName(c.teacher_id) || <i className="muted">not assigned</i>}</span>
              <span className="small muted">{countFor(c.id)} students · tap to manage</span>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? editing.name : 'New class'} onClose={close}>
          <form className="form-grid" onSubmit={save} key={editing.id || 'new'}>
            <label className="span2">Class name *<input name="name" required defaultValue={editing.name || ''} placeholder="e.g. Hifz Boys A" /></label>
            <label>Group<input name="group_name" defaultValue={editing.group_name || ''} placeholder="e.g. Boys · Group A · Morning" /></label>
            <label>Level<input name="level" defaultValue={editing.level || ''} placeholder="e.g. Beginners / Qaida" /></label>
            <label className="span2">Schedule<input name="schedule" defaultValue={editing.schedule || ''} placeholder="e.g. Sun–Thu 4:00–5:30 pm" /></label>
            <label className="span2">Teacher
              <select name="teacher_id" defaultValue={editing.teacher_id || ''}>
                <option value="">Not assigned</option>
                {(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}{t.staff_code ? ` · ${t.staff_code}` : ''}{t.role === 'admin' ? ' (admin)' : ''}</option>)}
              </select>
            </label>
            {(teachers.data || []).length === 0 && <p className="span2 small muted">No teachers yet. Create teacher logins under Users → Create teacher login.</p>}
            {err && <p className="error span2">{err}</p>}
            {notice && <p className="success span2">{notice}</p>}
            <div className="span2 actions">
              <button className="btn">{editing.id ? 'Save details' : 'Create class & add students'}</button>
              {editing.id && <button type="button" className="btn danger ghost" onClick={remove}>Delete class</button>}
            </div>
          </form>

          {editing.id && (
            <Roster
              klass={editing}
              classes={classes.data || []}
              students={students.data || []}
              onChanged={() => students.reload()}
            />
          )}
        </Modal>
      )}
    </section>
  );
}

function Roster({ klass, classes, students, onChanged }) {
  const [mode, setMode] = useState('pick'); // pick | upload
  const [q, setQ] = useState('');
  const [onlyFree, setOnlyFree] = useState(true);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const className = (id) => classes.find((c) => c.id === id)?.name;
  const inClass = students.filter((s) => s.class_id === klass.id);
  const candidates = students.filter((s) =>
    s.class_id !== klass.id &&
    (!onlyFree || !s.class_id) &&
    (!q || `${s.full_name} ${s.student_code}`.toLowerCase().includes(q.toLowerCase())));
  const pickedIds = Object.keys(picked).filter((k) => picked[k]);

  async function assign(ids, classId) {
    if (!ids.length) return;
    setBusy(true); setErr('');
    const { error } = await supabase.from('students').update({ class_id: classId }).in('id', ids);
    setBusy(false);
    if (error) setErr(error.message);
    else { setPicked({}); onChanged(); }
  }

  return (
    <div className="roster">
      <h3>Students in this class ({inClass.length})</h3>
      {inClass.length === 0 ? <p className="small muted">No students yet.</p> : (
        <ul className="chips">
          {inClass.map((s) => (
            <li key={s.id}>
              {s.full_name}
              <button className="chip-x" title={`Remove ${s.full_name} from this class`} aria-label={`Remove ${s.full_name}`}
                disabled={busy} onClick={() => assign([s.id], null)}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="segmented roster-tabs">
        <button className={mode === 'pick' ? 'active' : ''} onClick={() => setMode('pick')}>Add existing students</button>
        <button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}>Upload from Excel</button>
      </div>
      {err && <p className="error">{err}</p>}

      {mode === 'pick' ? (
        <>
          <div className="filters">
            <input placeholder="Search students…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="inline small"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> Only students without a class</label>
          </div>
          {candidates.length === 0 ? (
            <p className="small muted">{students.length === 0 ? 'No enrolled students yet. Approve admissions, add students on the Students page, or upload from Excel.' : 'No matching students.'}</p>
          ) : (
            <>
              <div className="pick-list">
                <label className="pick-all small">
                  <input type="checkbox"
                    checked={candidates.length > 0 && candidates.every((s) => picked[s.id])}
                    onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(candidates.map((s) => [s.id, true])) : {})} />
                  Select all ({candidates.length})
                </label>
                {candidates.map((s) => (
                  <label key={s.id} className="pick-row">
                    <input type="checkbox" checked={!!picked[s.id]} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.checked })} />
                    <span>{s.full_name} <span className="small muted">{s.student_code}{s.quran_level ? ' · ' + s.quran_level : ''}</span></span>
                    {s.class_id && <span className="small muted">now in {className(s.class_id)}</span>}
                  </label>
                ))}
              </div>
              <button className="btn" disabled={!pickedIds.length || busy} onClick={() => assign(pickedIds, klass.id)}>
                {busy ? 'Adding…' : `Add ${pickedIds.length || ''} selected to ${klass.name}`}
              </button>
            </>
          )}
        </>
      ) : (
        <ImportStudents classes={classes} fixedClassId={klass.id} onDone={onChanged} />
      )}
    </div>
  );
}
