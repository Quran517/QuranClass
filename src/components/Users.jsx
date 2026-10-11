import { useState } from 'react';
import { supabase } from '../supabase.js';
import { useQuery } from '../lib/data.js';
import { formatDate, whatsappLink } from '../lib/util.js';

export default function Users({ me }) {
  const list = useQuery(() => supabase.from('profiles').select('*').order('created_at', { ascending: false }));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');

  async function changeRole(p, newRole) {
    setErr(''); setSaved('');
    if (p.id === me.id && newRole !== 'admin' && !window.confirm('You are removing your own admin access. Continue?')) return;
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', p.id);
    if (error) setErr(error.message);
    else { setSaved(`${p.full_name || p.email} is now ${newRole}.`); list.reload(); }
  }

  const rows = (list.data || []).filter((p) =>
    (!role || p.role === role) &&
    (!q || `${p.full_name} ${p.email} ${p.phone}`.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <section className="card">
      <h2>Users &amp; roles</h2>
      <p className="muted small">
        Everyone who signs up starts as a <b>student</b>. To add a teacher, ask them to create an account,
        then change their role to <b>teacher</b> here and assign them a class under Classes.
      </p>
      <div className="filters">
        <input placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
          <option value="admin">Admins</option>
        </select>
      </div>
      {(err || list.error) && <p className="error">{err || list.error}</p>}
      {saved && <p className="success">{saved}</p>}
      {list.loading ? <div className="spinner" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Contact</th><th>Joined</th><th>Role</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const wa = whatsappLink(p.phone, `Assalamu Alaikum ${p.full_name || ''},`);
                return (
                  <tr key={p.id}>
                    <td>{p.full_name || <span className="muted">—</span>}{p.id === me.id && <span className="small muted"> (you)</span>}</td>
                    <td className="small">{p.email}<br />{p.phone}{wa && <> · <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a></>}</td>
                    <td className="small nowrap">{formatDate(p.created_at)}</td>
                    <td>
                      <select value={p.role} onChange={(e) => changeRole(p, e.target.value)} aria-label={`Role for ${p.full_name || p.email}`}>
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
