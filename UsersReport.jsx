import { useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery } from './data.js';
import { realEmail, formatDate, classTag } from './util.js';
import { roleLabel } from './perms.js';
import { downloadExcel, downloadPdf } from './exports.js';

// Users report (admin): choose which users, then download PDF or Excel.
const TYPES = [
  ['Student', 'Students'], ['Teacher', 'Teachers'], ['Principal', 'Principal'],
  ['Admin assistant', 'Admin assistants'], ['Parent', 'Parents'], ['Admin', 'Admins'],
];

export default function UsersReport() {
  const profiles = useQuery(() => supabase.from('profiles').select('id, full_name, email, phone, username, role, staff_code, staff_title, created_at').order('full_name'));
  const students = useQuery(() => supabase.from('students').select('id, full_name, student_code, admission_no, class_id, profile_id, guardian_name, guardian_phone, whatsapp, email, status').neq('status', 'rejected').order('full_name'));
  const classes = useQuery(() => supabase.from('classes').select('id, name, group_name, teacher_id').order('name'));
  const links = useQuery(() => supabase.from('parent_links').select('parent_id, student_id, verified'));

  const [types, setTypes] = useState(new Set(TYPES.map(([k]) => k)));
  const [classId, setClassId] = useState('all');
  const [login, setLogin] = useState('all'); // students: all | with | without
  const [q, setQ] = useState('');
  const [off, setOff] = useState(new Set()); // users un-ticked by hand
  const [busy, setBusy] = useState('');

  const klass = (id) => (classes.data || []).find((c) => c.id === id);
  const all = useMemo(() => {
    const ps = profiles.data || [], ss = students.data || [], ls = links.data || [];
    const byProfile = Object.fromEntries(ss.filter((s) => s.profile_id).map((s) => [s.profile_id, s]));
    const out = [];
    for (const p of ps) {
      const type = roleLabel(p);
      if (type === 'Student') continue; // students are added below (with or without a login)
      const kids = type === 'Parent'
        ? ls.filter((l) => l.parent_id === p.id).map((l) => ss.find((s) => s.id === l.student_id)).filter(Boolean)
        : [];
      if (type === 'Parent' && byProfile[p.id]) kids.unshift(byProfile[p.id]);
      const teaches = (classes.data || []).filter((c) => c.teacher_id === p.id);
      out.push({
        key: p.id, type, id: p.staff_code || '', name: p.full_name || '', username: p.username || '',
        phone: p.phone || '', email: realEmail(p.email), hasLogin: true, created: p.created_at,
        classIds: type === 'Parent' ? kids.map((k) => k.class_id) : teaches.map((c) => c.id),
        classes: type === 'Parent' ? '' : teaches.map((c) => classTag(c)).join(', '),
        children: kids.map((k) => `${k.full_name} (${k.student_code})`).join(', '),
      });
    }
    for (const s of ss) {
      const p = ps.find((x) => x.id === s.profile_id && x.role === 'student');
      out.push({
        key: 's-' + s.id, type: 'Student', id: s.student_code || '', adm: s.admission_no || '', name: s.full_name,
        username: p?.username || '', phone: p?.phone || s.whatsapp || s.guardian_phone || '', email: realEmail(p?.email) || s.email || '',
        hasLogin: !!p, created: p?.created_at, classIds: [s.class_id], classes: s.class_id ? classTag(klass(s.class_id)) : 'No class',
        children: '', guardian: s.guardian_name || '', status: s.status,
      });
    }
    return out;
  }, [profiles.data, students.data, links.data, classes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = all.filter((u) =>
    types.has(u.type) &&
    (classId === 'all' || u.classIds.includes(classId === 'none' ? null : classId)) &&
    (u.type !== 'Student' || login === 'all' || (login === 'with') === u.hasLogin) &&
    (!q || `${u.name} ${u.id} ${u.username} ${u.phone} ${u.email} ${u.adm || ''}`.toLowerCase().includes(q.toLowerCase())));
  const picked = shown.filter((u) => !off.has(u.key));
  const count = (t) => all.filter((u) => u.type === t).length;

  const rowsFor = (list) => list.map((u) => ({
    'User ID': u.id, ...(list.some((x) => x.adm) ? { 'Adm No': u.adm || '' } : {}), Name: u.name, Type: u.type,
    'Class / classes': u.classes || (u.type === 'Parent' ? '' : '—'),
    ...(list.some((x) => x.type === 'Parent') ? { Children: u.children } : {}),
    Username: u.username, 'Sign-in': u.hasLogin ? 'Yes' : 'No login', Phone: u.phone, Email: u.email,
    'Created': u.created ? formatDate(u.created) : '',
  }));

  const label = () => {
    const t = TYPES.filter(([k]) => types.has(k)).map(([, l]) => l);
    return t.length === TYPES.length ? 'All users' : t.join(', ');
  };
  const sub = () => [
    `${picked.length} user${picked.length === 1 ? '' : 's'}`,
    classId !== 'all' && (classId === 'none' ? 'No class' : `Class: ${classTag(klass(classId))}`),
    types.has('Student') && login !== 'all' && (login === 'with' ? 'Students with a login' : 'Students without a login'),
  ].filter(Boolean).join('   ·   ');
  const file = (ext) => `users-report-${label().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.${ext}`;

  async function pdf() {
    setBusy('pdf');
    const groups = TYPES.map(([k, l]) => [l, picked.filter((u) => u.type === k)]).filter(([, g]) => g.length);
    const toTable = (rows) => ({ columns: Object.keys(rows[0]), rows: rows.map((r) => Object.values(r)) });
    await downloadPdf(file('pdf'), {
      title: `Users report — ${label()}`, subtitle: sub(),
      tables: groups.map(([l, g]) => ({ heading: `${l} (${g.length})`, ...toTable(rowsFor(g).map(({ Email, Created, ...r }) => ({ ...r, Email }))) })), // eslint-disable-line no-unused-vars
    });
    setBusy('');
  }
  async function excel() {
    setBusy('xlsx');
    const groups = TYPES.map(([k, l]) => [l, picked.filter((u) => u.type === k)]).filter(([, g]) => g.length);
    await downloadExcel(file('xlsx'), [{ name: 'All selected', rows: rowsFor(picked) }, ...groups.map(([l, g]) => ({ name: l, rows: rowsFor(g) }))]);
    setBusy('');
  }

  if (profiles.loading || students.loading) return <section className="card"><h2>Users report</h2><div className="spinner" /></section>;
  if (profiles.error) return null;

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2>Users report</h2>
          <p className="small muted">Choose the users, then download a PDF or Excel list with their IDs, usernames, phone numbers and classes.</p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={excel} disabled={!picked.length || !!busy}>{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
          <button className="btn" onClick={pdf} disabled={!picked.length || !!busy}>{busy === 'pdf' ? 'Preparing…' : `Download PDF (${picked.length})`}</button>
        </div>
      </div>

      <div className="type-chips">
        {TYPES.map(([k, l]) => (
          <label key={k} className={`type-chip ${types.has(k) ? 'on' : ''}`}>
            <input type="checkbox" checked={types.has(k)} onChange={(e) => { const n = new Set(types); if (e.target.checked) n.add(k); else n.delete(k); setTypes(n); }} />
            {l} <small>{count(k)}</small>
          </label>
        ))}
        <button className="link small" onClick={() => setTypes(new Set(TYPES.map(([k]) => k)))}>All types</button>
      </div>

      <div className="filters">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          <option value="all">All classes</option>
          {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}
          <option value="none">Students with no class</option>
        </select>
        {types.has('Student') && (
          <select value={login} onChange={(e) => setLogin(e.target.value)} aria-label="Student login">
            <option value="all">Students: with or without a login</option>
            <option value="with">Students with a login</option>
            <option value="without">Students without a login</option>
          </select>
        )}
        <input type="search" placeholder="Search name, ID, username, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="pick-list">
        <div className="pick-head">
          <label><input type="checkbox" checked={picked.length === shown.length && shown.length > 0}
            onChange={(e) => { const n = new Set(off); shown.forEach((u) => (e.target.checked ? n.delete(u.key) : n.add(u.key))); setOff(n); }} />
            <b>{picked.length} of {shown.length} selected</b> — untick anyone you don't want in the report</label>
        </div>
        <div className="pick-body">
          {shown.map((u) => (
            <label key={u.key} className="pick-row">
              <input type="checkbox" checked={!off.has(u.key)} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(u.key); else n.add(u.key); setOff(n); }} />
              <span className="pick-name"><b>{u.name || '—'}</b> <span className="muted">{u.id}</span></span>
              <span className="pick-meta small muted">
                {u.type}{u.classes ? ` · ${u.classes}` : ''}{u.children ? ` · ${u.children}` : ''}
                {u.username ? ` · @${u.username}` : ''}{!u.hasLogin ? ' · ' : ''}{!u.hasLogin && <b className="low">No login</b>}
              </span>
            </label>
          ))}
          {!shown.length && <p className="muted small" style={{ padding: 12 }}>No users match these choices.</p>}
        </div>
      </div>
    </section>
  );
}
