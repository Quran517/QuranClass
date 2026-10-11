import { useState } from 'react';
import { supabase } from '../supabase.js';
import { useQuery, fetchClasses, fetchTeachers } from '../lib/data.js';
import Modal from './Modal.jsx';

export default function Classes() {
  const classes = useQuery(fetchClasses);
  const teachers = useQuery(fetchTeachers);
  const counts = useQuery(() => supabase.from('students').select('class_id').eq('status', 'approved'));
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');

  const teacherName = (id) => {
    const t = (teachers.data || []).find((x) => x.id === id);
    return t ? t.full_name || t.email : null;
  };
  const countFor = (id) => (counts.data || []).filter((s) => s.class_id === id).length;

  async function save(e) {
    e.preventDefault();
    setErr('');
    const f = new FormData(e.target);
    const payload = {
      name: f.get('name').trim(),
      level: f.get('level') || null,
      schedule: f.get('schedule') || null,
      teacher_id: f.get('teacher_id') || null,
    };
    const { error } = editing.id
      ? await supabase.from('classes').update(payload).eq('id', editing.id)
      : await supabase.from('classes').insert(payload);
    if (error) setErr(error.message);
    else { setEditing(null); classes.reload(); }
  }

  async function remove() {
    if (!window.confirm(`Delete class "${editing.name}"? Its students will become unassigned and its attendance records will be deleted.`)) return;
    const { error } = await supabase.from('classes').delete().eq('id', editing.id);
    if (error) setErr(error.message);
    else { setEditing(null); classes.reload(); counts.reload(); }
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Classes</h2>
        <button className="btn" onClick={() => setEditing({})}>+ New class</button>
      </div>
      {(classes.error || err) && <p className="error">{classes.error || err}</p>}
      {classes.loading ? <div className="spinner" /> : (classes.data || []).length === 0 ? (
        <p className="muted">No classes yet. Create one to start assigning students and teachers.</p>
      ) : (
        <div className="grid-cards">
          {classes.data.map((c) => (
            <button key={c.id} className="class-card" onClick={() => setEditing(c)}>
              <b>{c.name}</b>
              {c.level && <span className="small muted">{c.level}</span>}
              {c.schedule && <span className="small">{c.schedule}</span>}
              <span className="small">Teacher: {teacherName(c.teacher_id) || <i className="muted">not assigned</i>}</span>
              <span className="small muted">{countFor(c.id)} students</span>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit class' : 'New class'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="span2">Class name *<input name="name" required defaultValue={editing.name || ''} placeholder="e.g. Hifz Boys A" /></label>
            <label>Level<input name="level" defaultValue={editing.level || ''} placeholder="e.g. Beginners / Qaida" /></label>
            <label>Schedule<input name="schedule" defaultValue={editing.schedule || ''} placeholder="e.g. Sun–Thu 4:00–5:30 pm" /></label>
            <label className="span2">Teacher
              <select name="teacher_id" defaultValue={editing.teacher_id || ''}>
                <option value="">Not assigned</option>
                {(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}{t.role === 'admin' ? ' (admin)' : ''}</option>)}
              </select>
            </label>
            {(teachers.data || []).length === 0 && <p className="span2 small muted">No teachers yet. Teachers create an account, then you give them the Teacher role under Users.</p>}
            {err && <p className="error span2">{err}</p>}
            <div className="span2 actions">
              <button className="btn">Save</button>
              {editing.id && <button type="button" className="btn danger ghost" onClick={remove}>Delete class</button>}
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
