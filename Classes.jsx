import { useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchClasses, fetchTeachers, fetchGroups } from './data.js';
import { classCounts, groupFor, ageOf } from './util.js';
import Modal from './Modal.jsx';
import ImportStudents from './ImportStudents.jsx';

export default function Classes() {
  const classes = useQuery(fetchClasses);
  const groups = useQuery(fetchGroups);
  const teachers = useQuery(fetchTeachers);
  const students = useQuery(() =>
    supabase.from('students').select('id, full_name, student_code, class_id, gender, date_of_birth, quran_level').eq('status', 'approved').order('full_name'));
  const [editing, setEditing] = useState(null);
  const [editGroup, setEditGroup] = useState(null);
  const [groupId, setGroupId] = useState('');
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const nameRef = useRef(null);

  const counts = classCounts(students.data);
  const teacherName = (id) => {
    const t = (teachers.data || []).find((x) => x.id === id);
    return t ? `${t.full_name || t.email}${t.staff_code ? ' (' + t.staff_code + ')' : ''}` : null;
  };
  const allClasses = classes.data || [];
  const allGroups = groups.data || [];
  const unassigned = (students.data || []).filter((s) => !s.class_id);

  function open(c) {
    setEditing(c); setGroupId(c.group_id || ''); setErr(''); setNotice('');
  }

  function newClassIn(g) {
    const taken = new Set(allClasses.map((c) => c.name.toLowerCase()));
    let k = allClasses.filter((c) => c.group_id === g.id).length, nm;
    do { nm = `${g.name} – Class ${String.fromCharCode(65 + k)}`; k += 1; } while (taken.has(nm.toLowerCase()));
    open({ name: nm, group_id: g.id, capacity: g.capacity });
  }

  function pickGroup(id) {
    setGroupId(id);
    const g = allGroups.find((x) => x.id === id);
    if (g && !editing.id && nameRef.current && !nameRef.current.value.trim()) {
      const k = allClasses.filter((c) => c.group_id === g.id).length;
      nameRef.current.value = `${g.name} – Class ${String.fromCharCode(65 + k)}`;
    }
  }

  async function save(e) {
    e.preventDefault();
    setErr(''); setNotice('');
    const f = new FormData(e.target);
    const payload = {
      name: f.get('name').trim(),
      level: f.get('level') || null,
      schedule: f.get('schedule') || null,
      teacher_id: f.get('teacher_id') || null,
    };
    if (allGroups.length) {
      payload.group_id = groupId || null;
      payload.capacity = Number(f.get('capacity')) || 12;
      if (!groupId) payload.group_name = (f.get('group_name') || '').trim() || null;
    } else {
      payload.group_name = (f.get('group_name') || '').trim() || null;
    }
    if (editing.id) {
      const { data, error } = await supabase.from('classes').update(payload).eq('id', editing.id).select().single();
      if (error) { setErr(error.message); return; }
      setEditing(data);
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

  async function autoPlace() {
    setPlacing(true); setPlaced(null);
    const { data, error } = await supabase.rpc('place_unassigned');
    setPlacing(false);
    if (error) setPlaced({ error: error.message });
    else setPlaced(data);
    classes.reload(); students.reload();
  }

  function close() {
    setEditing(null); setErr(''); setNotice('');
  }

  const card = (c) => {
    const n = counts[c.id] || 0, cap = c.capacity || 12;
    return (
      <button key={c.id} className={`class-card ${allGroups.length && n >= cap ? 'full' : ''}`} onClick={() => open(c)}>
        <div className="row-between"><b>{c.name}</b>{allGroups.length > 0 && <span className={`cap-badge ${n >= cap ? 'full' : ''}`}>{n}/{cap}{n >= cap ? ' full' : ''}</span>}</div>
        {(!c.group_id && (c.group_name || c.level)) && <span className="small muted">{[c.group_name, c.level].filter(Boolean).join(' · ')}</span>}
        {c.group_id && c.level && <span className="small muted">{c.level}</span>}
        {c.schedule && <span className="small">{c.schedule}</span>}
        <span className="small">Teacher: {teacherName(c.teacher_id) || <i className="muted">not assigned</i>}</span>
        {allGroups.length > 0 && <span className="meter" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((n / cap) * 100))}%` }} /></span>}
        {!allGroups.length && <span className="small muted">{n} students · tap to manage</span>}
      </button>
    );
  };

  const ungrouped = allClasses.filter((c) => !c.group_id || !allGroups.some((g) => g.id === c.group_id));

  return (
    <section className="card">
      <div className="row-between">
        <h2>Classes</h2>
        <div className="actions">
          {allGroups.length > 0 && (
            <button className="btn ghost" onClick={autoPlace} disabled={placing || !unassigned.length}
              title="Puts every enrolled student without a class into the right group by age and gender">
              {placing ? 'Placing…' : `⚡ Auto-place ${unassigned.length} without a class`}
            </button>
          )}
          <button className="btn ghost" onClick={() => setEditGroup({ gender: 'any', capacity: 12, sort: allGroups.length + 1 })}>+ New group</button>
          <button className="btn" onClick={() => open({ capacity: 12 })}>+ New class</button>
        </div>
      </div>
      {(classes.error || groups.error) && <p className="error">{classes.error || groups.error}</p>}
      {placed && (placed.error ? <p className="error">{placed.error}</p> : (
        <div className="notice-line">
          <b>{placed.placed}</b> student{placed.placed === 1 ? '' : 's'} placed{placed.new_classes ? <>, <b>{placed.new_classes}</b> new class{placed.new_classes === 1 ? '' : 'es'} created</> : ''}.
          {placed.skipped?.length > 0 && <> Not placed: {placed.skipped.map((x) => `${x.name} (${x.reason})`).join('; ')}. Fix their date of birth / gender under Students.</>}
        </div>
      ))}
      {!groups.loading && !allGroups.length && (
        <p className="small muted">No age groups yet. Add them with <b>+ New group</b> (run <i>update-16.sql</i> in Supabase first).</p>
      )}

      {classes.loading || groups.loading ? <div className="spinner" /> : (
        <>
          {allGroups.map((g) => {
            const list = allClasses.filter((c) => c.group_id === g.id);
            const total = list.reduce((a, c) => a + (counts[c.id] || 0), 0);
            return (
              <div key={g.id} className="group-block">
                <div className="row-between group-head">
                  <div>
                    <h3>{g.name} <span className="small muted">{g.label}</span></h3>
                    <span className="small muted">{total} student{total === 1 ? '' : 's'} · {list.length} class{list.length === 1 ? '' : 'es'} · up to {g.capacity} per class</span>
                  </div>
                  <div className="actions">
                    <button className="btn ghost small" onClick={() => setEditGroup(g)}>Edit group</button>
                    <button className="btn ghost small" onClick={() => newClassIn(g)}>+ Class</button>
                  </div>
                </div>
                {list.length === 0 ? <p className="small muted">No classes yet — one is created automatically when students are placed.</p> : (
                  <div className="grid-cards">{list.map(card)}</div>
                )}
              </div>
            );
          })}
          {(ungrouped.length > 0 || !allGroups.length) && (
            <div className="group-block">
              {allGroups.length > 0 && <h3>Other classes <span className="small muted">not in a group</span></h3>}
              {ungrouped.length === 0 ? <p className="muted">No classes yet. Create one to start assigning students and teachers.</p> : (
                <div className="grid-cards">{ungrouped.map(card)}</div>
              )}
            </div>
          )}
        </>
      )}

      {editing && (
        <Modal title={editing.id ? editing.name : 'New class'} onClose={close}>
          <form className="form-grid" onSubmit={save} key={editing.id || 'new' + (editing.name || '')}>
            <label className="span2">Class name *<input ref={nameRef} name="name" required defaultValue={editing.name || ''} placeholder="e.g. Group 2 – Class A" /></label>
            {allGroups.length > 0 && (
              <label>Group
                <select value={groupId} onChange={(e) => pickGroup(e.target.value)}>
                  <option value="">No group</option>
                  {allGroups.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.label}</option>)}
                </select>
              </label>
            )}
            {(!allGroups.length || !groupId) && (
              <label>Group name<input name="group_name" defaultValue={editing.group_id ? '' : editing.group_name || ''} placeholder="e.g. Boys · Morning" /></label>
            )}
            {allGroups.length > 0 && (
              <label>Max students<input name="capacity" type="number" min="1" max="100" defaultValue={editing.capacity || 12} /></label>
            )}
            <label>Level<input name="level" defaultValue={editing.level || ''} placeholder="e.g. Beginners / Qaida" /></label>
            <label className="span2">Schedule<input name="schedule" defaultValue={editing.schedule || ''} placeholder="e.g. Every Saturday 4:00–6:00 pm" /></label>
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
              classes={allClasses}
              groups={allGroups}
              students={students.data || []}
              limit={allGroups.length ? editing.capacity || 12 : null}
              onChanged={() => students.reload()}
            />
          )}
        </Modal>
      )}

      {editGroup && (
        <GroupForm group={editGroup} onClose={() => setEditGroup(null)}
          onSaved={() => { setEditGroup(null); groups.reload(); classes.reload(); }} />
      )}
    </section>
  );
}

function GroupForm({ group, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', min_age: 5, max_age: 12, gender: 'any', capacity: 12, sort: 1, ...group });
  const [applyAll, setApplyAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const payload = { name: f.name.trim(), min_age: Number(f.min_age), max_age: Number(f.max_age), gender: f.gender, capacity: Number(f.capacity) || 12, sort: Number(f.sort) || 0 };
    if (payload.min_age > payload.max_age) { setErr('The lowest age must not be above the highest age.'); setBusy(false); return; }
    const q = group.id
      ? supabase.from('class_groups').update(payload).eq('id', group.id)
      : supabase.from('class_groups').insert(payload);
    let { error } = await q;
    if (!error && group.id && applyAll && payload.capacity !== group.capacity) {
      ({ error } = await supabase.from('classes').update({ capacity: payload.capacity }).eq('group_id', group.id));
    }
    setBusy(false);
    if (error) setErr(/class_groups/.test(error.message) ? 'Groups are not installed yet. Run update-16.sql in Supabase → SQL Editor.' : error.message);
    else onSaved();
  }

  async function remove() {
    if (!window.confirm(`Delete ${group.name}? Its classes and students stay — the classes just won't belong to a group.`)) return;
    const { error } = await supabase.from('class_groups').delete().eq('id', group.id);
    if (error) setErr(error.message); else onSaved();
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={group.id ? `Edit ${group.name}` : 'New group'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>Group name *<input required value={f.name} onChange={set('name')} placeholder="e.g. Group 4" /></label>
        <label>Boys / girls
          <select value={f.gender} onChange={set('gender')}>
            <option value="any">Boys & Girls</option>
            <option value="male">Boys</option>
            <option value="female">Girls</option>
          </select>
        </label>
        <label>From age *<input type="number" min="2" max="30" required value={f.min_age} onChange={set('min_age')} /></label>
        <label>To age (including) *<input type="number" min="2" max="30" required value={f.max_age} onChange={set('max_age')} /></label>
        <label>Max students per class<input type="number" min="1" max="100" value={f.capacity} onChange={set('capacity')} /></label>
        <label>Order<input type="number" min="0" max="99" value={f.sort} onChange={set('sort')} /></label>
        {group.id && Number(f.capacity) !== group.capacity && (
          <label className="check span2"><input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} /><span>Also change the limit of this group's existing classes</span></label>
        )}
        <p className="span2 small muted">Age is counted in full years on the day the student is placed. A child who has turned 8 goes to the 8–12 groups.</p>
        {err && <p className="error span2">{err}</p>}
        <div className="span2 actions">
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save group'}</button>
          {group.id && <button type="button" className="btn danger ghost" onClick={remove}>Delete group</button>}
        </div>
      </form>
    </Modal>
  );
}

function Roster({ klass, classes, groups, students, limit, onChanged }) {
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
  const room = limit ? Math.max(0, limit - inClass.length) : Infinity;
  const tooMany = pickedIds.length > room;
  const hint = (s) => {
    if (!groups.length) return '';
    const a = ageOf(s.date_of_birth);
    const g = groupFor(s, groups);
    const bits = [a != null ? `age ${a}` : 'no birth date'];
    if (klass.group_id && g && g.id !== klass.group_id) bits.push(`belongs in ${g.name}`);
    return bits.join(' · ');
  };

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
      <h3>Students in this class ({inClass.length}{limit ? ` of ${limit}` : ''})</h3>
      {limit && inClass.length >= limit && <p className="small notice-line">This class is full. New students of this group go to the next class — use <b>⚡ Auto-place</b> or <b>+ Class</b>.</p>}
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
                    <span>{s.full_name} <span className="small muted">{s.student_code}{s.quran_level ? ' · ' + s.quran_level : ''}{hint(s) ? ' · ' + hint(s) : ''}</span></span>
                    {s.class_id && <span className="small muted">now in {className(s.class_id)}</span>}
                  </label>
                ))}
              </div>
              {tooMany && <p className="error small">Only {room} place{room === 1 ? '' : 's'} left in this class (limit {limit}).</p>}
              <button className="btn" disabled={!pickedIds.length || busy || tooMany} onClick={() => assign(pickedIds, klass.id)}>
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
