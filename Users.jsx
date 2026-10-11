import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery } from './data.js';
import { formatDate, whatsappLink } from './util.js';
import Modal from './Modal.jsx';
import { getSettings } from './settings.js';

function makePassword() {
  const words = ['Noor', 'Huda', 'Iqra', 'Sabr', 'Ilm', 'Amal', 'Rahma', 'Taqwa'];
  return words[Math.floor(Math.random() * words.length)] + (1000 + Math.floor(Math.random() * 9000));
}

function loginMessage({ full_name, email, password, role, staff_code }) {
  return (
    `Assalamu Alaikum ${full_name || ''},\n\n` +
    `Your ${getSettings().school_name} ${role} login is ready.\n` +
    (staff_code ? `Teacher ID: ${staff_code}\n` : '') +
    `Website: ${window.location.origin}\n` +
    `Email: ${email}\n` +
    `Password: ${password}\n\n` +
    `Please sign in and change your password under "Account".`
  );
}

export default function Users({ me }) {
  const list = useQuery(() => supabase.from('profiles').select('*').order('created_at', { ascending: false }));
  const freeStudents = useQuery(() =>
    supabase.from('students').select('id, full_name, student_code, email, guardian_phone, whatsapp')
      .is('profile_id', null).neq('status', 'rejected').order('full_name'));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [creating, setCreating] = useState(null);   // form state or null
  const [created, setCreated] = useState(null);     // result to show
  const [resetting, setResetting] = useState(null); // profile
  const [busy, setBusy] = useState(false);

  async function changeRole(p, newRole) {
    setErr(''); setSaved('');
    if (p.id === me.id && newRole !== 'admin' && !window.confirm('You are removing your own admin access. Continue?')) return;
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', p.id);
    if (error) setErr(error.message);
    else { setSaved(`${p.full_name || p.email} is now ${newRole}.`); list.reload(); }
  }

  async function removeLogin(p) {
    if (!window.confirm(`Delete the login for ${p.full_name || p.email}? They will no longer be able to sign in. Student records and attendance are kept.`)) return;
    const { error } = await supabase.rpc('admin_delete_user', { p_user: p.id });
    if (error) setErr(error.message); else { setResetting(null); list.reload(); freeStudents.reload(); }
  }

  function openCreate(roleDefault = 'teacher') {
    setCreated(null); setErr('');
    setCreating({ full_name: '', email: '', phone: '', role: roleDefault, password: makePassword(), student_id: '' });
  }

  function pickStudent(id) {
    const s = (freeStudents.data || []).find((x) => x.id === id);
    setCreating({
      ...creating,
      student_id: id,
      full_name: s ? s.full_name : creating.full_name,
      email: s?.email || creating.email,
      phone: s ? (s.whatsapp || s.guardian_phone || '') : creating.phone,
    });
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const c = creating;
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_email: c.email, p_password: c.password, p_full_name: c.full_name, p_phone: c.phone || null,
      p_role: c.role, p_student_id: c.role === 'student' && c.student_id ? c.student_id : null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message.includes('admin_create_user')
        ? 'The database update has not been installed yet. Run update-2.sql in Supabase → SQL Editor.'
        : error.message);
      return;
    }
    setCreated({ ...c, email: data.email, staff_code: data.staff_code });
    setCreating(null);
    list.reload(); freeStudents.reload();
  }

  async function resetPassword(e) {
    e.preventDefault();
    const password = new FormData(e.target).get('password');
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_set_password', { p_user: resetting.id, p_password: password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setCreated({ full_name: resetting.full_name, email: resetting.email, password, role: resetting.role, staff_code: resetting.staff_code, reset: true, phone: resetting.phone });
    setResetting(null);
  }

  const rows = (list.data || []).filter((p) =>
    (!role || p.role === role) &&
    (!q || `${p.full_name} ${p.email} ${p.phone} ${p.staff_code || ''}`.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <section className="card">
      <div className="row-between">
        <h2>Users &amp; logins</h2>
        <div className="actions">
          <button className="btn" onClick={() => openCreate('teacher')}>+ Create teacher login</button>
          <button className="btn ghost" onClick={() => openCreate('student')}>+ Create student login</button>
        </div>
      </div>
      <p className="muted small">
        Create logins here: they work straight away and no email is sent. Teachers get a Teacher ID automatically.
        Then assign each teacher a class under <b>Classes</b>.
      </p>
      <div className="filters">
        <input placeholder="Search name, email, phone, ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
          <option value="admin">Admins</option>
        </select>
      </div>
      {(err || list.error) && !creating && !resetting && <p className="error">{err || list.error}</p>}
      {saved && <p className="success">{saved}</p>}

      {list.loading ? <div className="spinner" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>ID</th><th>Contact</th><th>Joined</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const wa = whatsappLink(p.phone, `Assalamu Alaikum ${p.full_name || ''},`);
                return (
                  <tr key={p.id}>
                    <td>{p.full_name || <span className="muted">—</span>}{p.id === me.id && <span className="small muted"> (you)</span>}</td>
                    <td className="nowrap">{p.staff_code || <span className="muted">—</span>}</td>
                    <td className="small">{p.email}<br />{p.phone}{wa && <> · <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a></>}</td>
                    <td className="small nowrap">{formatDate(p.created_at)}</td>
                    <td>
                      <select value={p.role} onChange={(e) => changeRole(p, e.target.value)} aria-label={`Role for ${p.full_name || p.email}`}>
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="nowrap">
                      <button className="btn small ghost" onClick={() => { setErr(''); setResetting(p); }}>Password</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title={creating.role === 'student' ? 'Create student login' : creating.role === 'admin' ? 'Create admin login' : 'Create teacher login'} onClose={() => setCreating(null)}>
          <form className="form-grid" onSubmit={create}>
            <label>Login type
              <select value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value })}>
                <option value="teacher">Teacher</option>
                <option value="student">Student / parent</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {creating.role === 'student' ? (
              <label>Link to student record
                <select value={creating.student_id} onChange={(e) => pickStudent(e.target.value)}>
                  <option value="">— none (they will fill the admission form) —</option>
                  {(freeStudents.data || []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.student_code})</option>)}
                </select>
              </label>
            ) : <div />}
            <label>Full name *<input required value={creating.full_name} onChange={(e) => setCreating({ ...creating, full_name: e.target.value })} /></label>
            <label>Mobile / WhatsApp<input inputMode="tel" placeholder="05xxxxxxxx" value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} /></label>
            <label>Email (used to sign in) *<input required type="email" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} /></label>
            <label>Starting password *
              <div className="input-row">
                <input required minLength={6} value={creating.password} onChange={(e) => setCreating({ ...creating, password: e.target.value })} />
                <button type="button" className="btn small ghost" onClick={() => setCreating({ ...creating, password: makePassword() })}>New</button>
              </div>
            </label>
            {err && <p className="error span2">{err}</p>}
            <div className="span2"><button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button></div>
          </form>
        </Modal>
      )}

      {resetting && (
        <Modal title={`Password for ${resetting.full_name || resetting.email}`} onClose={() => setResetting(null)}>
          <form className="form-grid" onSubmit={resetPassword}>
            <p className="span2 small muted">Sign-in email: <b>{resetting.email}</b>. Set a new password and share it with them. No email is sent.</p>
            <label className="span2">New password *<input name="password" required minLength={6} defaultValue={makePassword()} /></label>
            {err && <p className="error span2">{err}</p>}
            <div className="span2 actions">
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
              {resetting.id !== me.id && <button type="button" className="btn danger ghost" onClick={() => removeLogin(resetting)}>Delete this login</button>}
            </div>
          </form>
        </Modal>
      )}

      {created && (
        <Modal title={created.reset ? 'Password changed' : 'Login created'} onClose={() => setCreated(null)}>
          <dl className="details">
            <dt>Name</dt><dd>{created.full_name}</dd>
            {created.staff_code && <><dt>Teacher ID</dt><dd><b>{created.staff_code}</b></dd></>}
            <dt>Website</dt><dd>{window.location.origin}</dd>
            <dt>Email</dt><dd>{created.email}</dd>
            <dt>Password</dt><dd><code>{created.password}</code></dd>
          </dl>
          <p className="small muted">Share these details with them now. The password is not shown again.</p>
          <div className="actions">
            {whatsappLink(created.phone, 'x') && (
              <a className="btn whatsapp" target="_blank" rel="noreferrer" href={whatsappLink(created.phone, loginMessage(created))}>Send on WhatsApp</a>
            )}
            <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(loginMessage(created))}>Copy details</button>
            {!created.reset && <button className="btn ghost" onClick={() => openCreate(created.role)}>Create another</button>}
          </div>
        </Modal>
      )}
    </section>
  );
}
