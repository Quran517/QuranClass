import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { downloadExcel } from './exports.js';

const TABLE_LABEL = { students: 'Student', classes: 'Class', attendance: 'Attendance', profiles: 'User', settings: 'Settings' };
const FIELD_LABEL = {
  full_name: 'name', class_id: 'class', teacher_id: 'teacher', guardian_name: 'guardian', guardian_phone: 'guardian phone',
  date_of_birth: 'date of birth', school_grade: 'school grade', quran_level: 'Quran level', att_date: 'date',
  approved_at: 'approved on', profile_id: 'login', staff_code: 'teacher ID', last_backup_at: 'backup',
};
const HIDE = ['id', 'created_at', 'student_id', 'consent_given'];

function when(ts) {
  const d = new Date(ts);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function describeChanges(row, names = {}) {
  if (!row.changes) return '';
  const nameOf = (k, v) => (k === 'class_id' || k === 'teacher_id' || k === 'profile_id') && names[v] ? names[v] : show(v);
  if (row.action === 'changed') {
    return Object.entries(row.changes)
      .map(([k, [a, b]]) => `${FIELD_LABEL[k] || k.replace(/_/g, ' ')}: ${nameOf(k, a)} → ${nameOf(k, b)}`)
      .join('; ');
  }
  return '';
}

export function useActivity(limit = 50, filters = {}) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(filters);

  useEffect(() => {
    let q = supabase.from('activity_log').select('*').order('at', { ascending: false }).limit(limit);
    if (filters.table) q = q.eq('table_name', filters.table);
    if (filters.action) q = q.eq('action', filters.action);
    if (filters.from) q = q.gte('at', filters.from + 'T00:00:00');
    if (filters.to) q = q.lte('at', filters.to + 'T23:59:59');
    if (filters.q) q = q.or(`summary.ilike.%${filters.q.replace(/[%,()]/g, '')}%,actor_name.ilike.%${filters.q.replace(/[%,()]/g, '')}%`);
    q.then(({ data, error: e }) => {
      setRows(data || []);
      setError(e ? (e.message.includes('activity_log') ? 'The activity log is not installed yet. Run update-3.sql in Supabase → SQL Editor.' : e.message) : '');
    });
  }, [limit, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, error, reload: () => setTick((t) => t + 1) };
}

export default function Activity() {
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const [names, setNames] = useState({});
  const { rows, error, reload } = useActivity(limit, { table, action, from, to, q });

  useEffect(() => {
    Promise.all([
      supabase.from('classes').select('id, name'),
      supabase.from('profiles').select('id, full_name, email'),
    ]).then(([c, p]) => setNames({
      ...Object.fromEntries((c.data || []).map((x) => [x.id, x.name])),
      ...Object.fromEntries((p.data || []).map((x) => [x.id, x.full_name || x.email])),
    }));
  }, []);

  function exportLog() {
    downloadExcel(`activity-log-${new Date().toLocaleDateString('en-CA')}.xlsx`, [{
      name: 'Activity',
      rows: (rows || []).map((r) => ({
        When: new Date(r.at).toLocaleString('en-GB'), Who: r.actor_name, Action: r.action,
        Type: TABLE_LABEL[r.table_name] || r.table_name, Item: r.summary, Details: describeChanges(r, names),
      })),
    }]);
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Activity log</h2>
        <div className="actions">
          <button className="btn ghost small" onClick={reload}>Refresh</button>
          <button className="btn ghost small" onClick={exportLog} disabled={!rows?.length}>Export Excel</button>
        </div>
      </div>
      <p className="muted small">Every addition, change and deletion, with who made it and when. Kept for 2 years.</p>
      <div className="filters">
        <input placeholder="Search name or person…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={table} onChange={(e) => setTable(e.target.value)} aria-label="Type">
          <option value="">Everything</option>
          <option value="students">Students</option>
          <option value="classes">Classes</option>
          <option value="attendance">Attendance</option>
          <option value="profiles">Users</option>
          <option value="settings">Settings</option>
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">Added, changed &amp; deleted</option>
          <option value="added">Added</option>
          <option value="changed">Changed</option>
          <option value="deleted">Deleted</option>
        </select>
        <label className="inline">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      {!rows ? <div className="spinner" /> : rows.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
        <>
          <ul className="activity">
            {rows.map((r) => (
              <li key={r.id} className={`act ${r.action}`}>
                <span className={`badge ${r.action === 'added' ? 'approved' : r.action === 'deleted' ? 'rejected' : 'pending'}`}>{r.action}</span>
                <div className="act-body">
                  <div><b>{TABLE_LABEL[r.table_name] || r.table_name}:</b> {r.summary}</div>
                  {r.action === 'changed' && <div className="small muted">{describeChanges(r, names)}</div>}
                  <div className="small muted">{r.actor_name} · {when(r.at)}</div>
                </div>
              </li>
            ))}
          </ul>
          {rows.length >= limit && <button className="btn ghost" onClick={() => setLimit(limit + 200)}>Show more</button>}
        </>
      )}
    </section>
  );
}
