import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery } from './data.js';
import { formatDate, whatsappLink, realEmail, cleanUsername, USERNAME_RULE, usernameError, classTag } from './util.js';
import { downloadExcel, downloadPdf } from './exports.js';
import Modal from './Modal.jsx';
import { getSettings } from './settings.js';
import { AREAS, ASSISTANT_PERMS, PRINCIPAL_PERMS, roleLabel } from './perms.js';

// 0551234567 style: digits only, Saudi numbers start with 0
function localPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966') && d.length === 12) d = '0' + d.slice(3);
  if (d.length === 9 && d.startsWith('5')) d = '0' + d;
  return d.length >= 7 ? d : '';
}

function makePassword() {
  const words = ['Noor', 'Huda', 'Iqra', 'Sabr', 'Ilm', 'Amal', 'Rahma', 'Taqwa'];
  return words[Math.floor(Math.random() * words.length)] + (1000 + Math.floor(Math.random() * 9000));
}

function loginMessage({ full_name, email, password, role, staff_code, student_code, phone, username }) {
  const id = staff_code || student_code;
  return (
    `Assalamu Alaikum ${full_name || ''},\n\n` +
    `Your ${getSettings().school_name} ${role === "assistant" ? "Admin assistant" : role} login is ready.\n` +
    `Website: ${window.location.origin}\n` +
    (username ? `Username: ${username}\n` : '') +
    (id ? `User ID: ${id}\n` : '') +
    (realEmail(email) ? `Email: ${email}\n` : '') +
    `Sign in with your ${[username && 'username', id && 'User ID', phone && 'phone number', realEmail(email) && 'email'].filter(Boolean).join(' or ')}.\n` +
    `Password: ${password}\n\n` +
    `Please sign in and change your password under "Account".`
  );
}

export default function Users({ me }) {
  const list = useQuery(() => supabase.from('profiles').select('*').order('created_at', { ascending: false }));
  const linked = useQuery(() => supabase.from('students').select('profile_id, student_code, full_name, guardian_phone, whatsapp').not('profile_id', 'is', null));
  const studentCode = Object.fromEntries((linked.data || []).map((s) => [s.profile_id, s.student_code]));
  const freeStudents = useQuery(() =>
    supabase.from('students').select('id, full_name, student_code, email, guardian_phone, whatsapp, class_id, status')
      .is('profile_id', null).neq('status', 'rejected').order('full_name'));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [creating, setCreating] = useState(null);   // form state or null
  const [created, setCreated] = useState(null);     // result to show
  const [resetting, setResetting] = useState(null); // profile
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(null); // { profile, picked: Set }
  const [kids, setKids] = useState(null);     // parent profile whose children are shown
  const [bulk, setBulk] = useState(false);    // create many student logins
  const allStudents = useQuery(() => supabase.from('students').select('id, full_name, student_code, guardian_name, guardian_phone, whatsapp, email').neq('status', 'rejected').order('full_name'));
  const classList = useQuery(() => supabase.from('classes').select('id, name, group_name').order('name'));
  const pendingLinks = useQuery(() => supabase.from('parent_links').select('id, parent_id').eq('verified', false));
  const meAdmin = me.role === 'admin';

  async function saveAccess() {
    setBusy(true); setErr(''); setSaved('');
    const permissions = AREAS.map(([k]) => k).filter((k) => access.picked.has(k));
    const { error } = await supabase.from('profiles').update({ permissions }).eq('id', access.profile.id);
    setBusy(false);
    if (error) {
      setErr(/permissions/.test(error.message) ? 'Access settings are not installed yet. Run update-8.sql in Supabase → SQL Editor.' : error.message);
      return;
    }
    setSaved(`Access updated for ${access.profile.full_name || access.profile.email}.`);
    setAccess(null);
    list.reload();
  }

  async function changeRole(p, choice) {
    setErr(''); setSaved('');
    if (p.id === me.id && choice !== 'admin' && !window.confirm('You are removing your own admin access. Continue?')) return;
    const newRole = choice === 'assistant' || choice === 'principal' ? 'teacher' : choice;
    const update = { role: newRole };
    if (meAdmin && newRole === 'teacher') {
      update.staff_title = choice === 'assistant' || choice === 'principal' ? choice : null;
      if (choice === 'assistant') update.permissions = ASSISTANT_PERMS;
      else if (choice === 'principal') update.permissions = PRINCIPAL_PERMS;
      else if (p.staff_title) update.permissions = [];
    }
    let { error } = await supabase.from('profiles').update(update).eq('id', p.id);
    if (error && /staff_title/.test(error.message)) {
      setErr('The Admin assistant type is not installed yet. Run update-10.sql in Supabase → SQL Editor.');
      return;
    }
    if (error) setErr(/last admin/.test(error.message) ? 'This is the last admin — make someone else admin first.' : error.message);
    else { setSaved(`${p.full_name || p.email} is now ${choice === 'assistant' ? 'an Admin assistant' : choice === 'principal' ? 'the Principal' : newRole}.`); list.reload(); }
  }

  // Existing student logins without a username: let them sign in with the parent's mobile number.
  const studentProfiles = new Map((list.data || []).filter((p) => p.role === 'student').map((p) => [p.id, p]));
  const noPhoneLogin = (linked.data || []).filter((s) => studentProfiles.get(s.profile_id) && !studentProfiles.get(s.profile_id).username && localPhone(s.guardian_phone || s.whatsapp));
  async function phoneUsernames() {
    if (!window.confirm(`Let ${noPhoneLogin.length} students sign in with their parent's mobile number? Brothers and sisters get -2, -3 after the number. Their passwords do not change.`)) return;
    setBusy(true); setErr(''); setSaved('');
    let ok = 0;
    for (const s of noPhoneLogin) {
      const mobile = localPhone(s.guardian_phone || s.whatsapp);
      for (let n = 1; n <= 9; n++) {
        const { error } = await supabase.from('profiles').update({ username: n === 1 ? mobile : `${mobile}-${n}` }).eq('id', s.profile_id);
        if (!error) { ok++; break; }
        if (!/unique|duplicate|already/i.test(error.message)) { setErr(error.message); break; }
      }
    }
    setBusy(false); setSaved(`${ok} students can now sign in with their parent's mobile number (see the Username column).`); list.reload();
  }

  async function removeLogin(p) {
    if (!window.confirm(`Delete the login for ${p.full_name || p.email}? They will no longer be able to sign in. Student records and attendance are kept.`)) return;
    const { error } = await supabase.rpc('admin_delete_user', { p_user: p.id });
    if (error) setErr(error.message); else { setResetting(null); list.reload(); freeStudents.reload(); }
  }

  function openCreate(roleDefault = 'teacher') {
    setCreated(null); setErr('');
    setCreating({ full_name: '', email: '', phone: '', role: roleDefault, password: makePassword(), student_id: '', children: [] });
  }

  function pickChild(id, on) {
    const s = (allStudents.data || []).find((x) => x.id === id);
    const children = on ? [...creating.children, id] : creating.children.filter((x) => x !== id);
    const first = !creating.children.length && on && s;
    setCreating({
      ...creating, children,
      full_name: first && !creating.full_name ? s.guardian_name || '' : creating.full_name,
      phone: first && !creating.phone ? s.guardian_phone || s.whatsapp || '' : creating.phone,
    });
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
    let { data, error } = await supabase.rpc('admin_create_user', {
      p_email: c.email, p_password: c.password, p_full_name: c.full_name, p_phone: c.phone || null,
      p_role: c.role === 'assistant' || c.role === 'principal' ? 'teacher' : c.role,
      p_student_id: c.role === 'student' && c.student_id ? c.student_id : c.role === 'parent' && c.children[0] ? c.children[0] : null,
    });
    if (!error && c.role === 'parent' && c.children.length > 1) {
      const { error: e4 } = await supabase.from('parent_links').insert(c.children.slice(1).map((sid) => ({ parent_id: data.id, student_id: sid, verified: true })));
      if (e4) error = { message: `Login created, but not all children were linked: ${e4.message}` };
    }
    if (!error && c.role === 'principal') {
      const { error: e5 } = await supabase.from('profiles').update({ staff_title: 'principal', permissions: PRINCIPAL_PERMS }).eq('id', data.id);
      if (e5) error = { message: e5.message };
    }
    if (!error && cleanUsername(c.username)) {
      const u = cleanUsername(c.username);
      const { error: e3 } = USERNAME_RULE.test(u)
        ? await supabase.from('profiles').update({ username: u }).eq('id', data.id)
        : { error: { message: 'profiles_username_format' } };
      if (e3) error = { message: `Login created, but the username was not saved: ${usernameError(e3)} Set it with the Login button.` };
    }
    if (!error && c.role === 'assistant') {
      const { error: e2 } = await supabase.from('profiles').update({ staff_title: 'assistant', permissions: ASSISTANT_PERMS }).eq('id', data.id);
      if (e2) error = { message: /staff_title/.test(e2.message) ? 'Login created as Teacher. Run update-10.sql in Supabase to enable Admin assistants, then change the type under Users.' : e2.message };
    }
    setBusy(false);
    if (error) {
      setErr(error.message.includes('admin_create_user')
        ? 'The database update has not been installed yet. Run update-5.sql in Supabase → SQL Editor.'
        : error.message);
      return;
    }
    setCreated({ ...c, username: cleanUsername(c.username) || null, email: data.email, staff_code: data.staff_code, student_code: data.student_code });
    linked.reload();
    setCreating(null);
    list.reload(); freeStudents.reload();
  }

  async function saveDetails(e) {
    e.preventDefault();
    setErr(''); setSaved('');
    const f = new FormData(e.target);
    const u = cleanUsername(f.get('username'));
    if (u && !USERNAME_RULE.test(u)) { setErr('Username can only use letters, numbers and . _ + - (3 to 40 characters, no spaces).'); return; }
    const values = {
      p_user: resetting.id,
      p_full_name: (f.get('full_name') || '').trim(),
      p_phone: (f.get('phone') || '').trim(),
      p_email: (f.get('email') || '').trim(),
      p_username: u,
      p_staff_code: (f.get('staff_code') || '').trim(),
    };
    setBusy(true);
    let { error } = await supabase.rpc('admin_update_user', values);
    let note = '';
    if (error && /admin_update_user/.test(error.message)) {
      // update-13 not installed yet: save what we can directly
      ({ error } = await supabase.from('profiles').update({ full_name: values.p_full_name, phone: values.p_phone || null, username: u || null }).eq('id', resetting.id));
      note = ' (Name, phone and username only — run update-13.sql in Supabase to also change email and ID.)';
    }
    setBusy(false);
    if (error) { setErr(usernameError(error)); return; }
    setSaved('Details saved.' + note);
    setResetting({ ...resetting, full_name: values.p_full_name || resetting.full_name, phone: values.p_phone, email: values.p_email || resetting.email, username: u || null, staff_code: values.p_staff_code.toUpperCase() || resetting.staff_code });
    list.reload();
  }

  async function resetPassword(e) {
    e.preventDefault();
    const password = new FormData(e.target).get('password');
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_set_password', { p_user: resetting.id, p_password: password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setCreated({ full_name: resetting.full_name, username: resetting.username, email: resetting.email, password, role: resetting.role, staff_code: resetting.staff_code, student_code: studentCode[resetting.id], reset: true, phone: resetting.phone });
    setResetting(null);
  }

  const rows = (list.data || []).filter((p) =>
    (!role || p.role === role) &&
    (!q || `${p.full_name} ${p.email} ${p.phone} ${p.username || ''} ${p.staff_code || ''} ${studentCode[p.id] || ''}`.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <section className="card">
      <div className="row-between">
        <h2>Users &amp; logins</h2>
        <div className="actions">
          <button className="btn" onClick={() => openCreate('teacher')}>+ Create teacher login</button>
          <button className="btn ghost" onClick={() => openCreate('student')}>+ Create student login</button>
          <button className="btn ghost" onClick={() => openCreate('parent')}>+ Create parent login</button>
          {noPhoneLogin.length > 0 && (
            <button className="btn ghost" onClick={phoneUsernames} disabled={busy}>Parent mobile as sign-in for {noPhoneLogin.length} student login{noPhoneLogin.length === 1 ? '' : 's'}</button>
          )}
          {(freeStudents.data || []).length > 0 && (
            <button className="btn ghost" onClick={() => setBulk(true)}>+ Student logins for many ({freeStudents.data.length} without a login)</button>
          )}
        </div>
      </div>
      <p className="muted small">
        Create logins here: they work straight away and no email is sent. Email is optional — people can sign in with their User ID (TC… / QC…) or phone number. Teachers get a Teacher ID automatically.
        Then assign each teacher a class under <b>Classes</b>.
      </p>
      <div className="filters">
        <input placeholder="Search name, email, phone, ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
          <option value="parent">Parents</option>
          <option value="admin">Admins</option>
        </select>
      </div>
      {(pendingLinks.data || []).length > 0 && (
        <p className="notice-line"><b>{pendingLinks.data.length}</b> parent link request(s) to verify. Open the parent's <b>Children</b> button below (filter: Parents).</p>
      )}
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
                    <td>{p.full_name || <span className="muted">—</span>}{p.id === me.id && <span className="small muted"> (you)</span>}<div className="small muted">{roleLabel(p)}{p.username ? ` · @${p.username}` : ''}</div></td>
                    <td className="nowrap"><b>{p.staff_code || studentCode[p.id] || <span className="muted">—</span>}</b></td>
                    <td className="small">{realEmail(p.email) || <span className="muted">no email</span>}<br />{p.phone}{wa && <> · <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a></>}</td>
                    <td className="small nowrap">{formatDate(p.created_at)}</td>
                    <td>
                      <select value={p.role === 'teacher' && p.staff_title ? p.staff_title : p.role} disabled={!meAdmin && (p.role === 'admin' || p.id === me.id)}
                        onChange={(e) => changeRole(p, e.target.value)} aria-label={`Role for ${p.full_name || p.email}`}>
                        <option value="student">Student</option>
                        <option value="parent">Parent</option>
                        <option value="teacher">Teacher</option>
                        {(meAdmin || p.staff_title === 'principal') && <option value="principal">Principal</option>}
                        {(meAdmin || p.staff_title === 'assistant') && <option value="assistant">Admin assistant</option>}
                        {(meAdmin || p.role === 'admin') && <option value="admin">Admin</option>}
                      </select>
                      {p.role === 'teacher' && (p.permissions || []).length > 0 && (
                        <div className="small muted">+ {p.permissions.map((k) => AREAS.find(([a]) => a === k)?.[1] || k).join(', ')}</div>
                      )}
                    </td>
                    <td className="nowrap">
                      {p.role === 'parent' && (
                        <button className="btn small ghost" onClick={() => { setErr(''); setKids(p); }}>
                          Children{(pendingLinks.data || []).some((l) => l.parent_id === p.id) ? ' •' : ''}
                        </button>
                      )}{' '}
                      {meAdmin && p.role === 'teacher' && (
                        <button className="btn small ghost" onClick={() => { setErr(''); setAccess({ profile: p, picked: new Set(p.permissions || []) }); }}>Access</button>
                      )}{' '}
                      {(meAdmin || p.role !== 'admin') && (
                        <button className="btn small ghost" onClick={() => { setErr(''); setSaved(''); setResetting(p); }}>Edit</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title={{ student: 'Create student login', parent: 'Create parent login', admin: 'Create admin login', assistant: 'Create Admin assistant login', principal: 'Create Principal login' }[creating.role] || 'Create teacher login'} onClose={() => setCreating(null)}>
          <form className="form-grid" onSubmit={create}>
            <label>Login type
              <select value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value })}>
                <option value="teacher">Teacher</option>
                {meAdmin && <option value="principal">Principal</option>}
                {meAdmin && <option value="assistant">Admin assistant</option>}
                <option value="student">Student</option>
                <option value="parent">Parent</option>
                {meAdmin && <option value="admin">Admin</option>}
              </select>
            </label>
            {creating.role === 'principal' && (
              <p className="span2 small notice-inline">The <b>Principal</b> reviews, approves, rejects and issues certificates, and finalizes and publishes results. Adjust later with <b>Access</b>.</p>
            )}
            {creating.role === 'parent' && (
              <div className="span2 field">
                <span className="field-label">Children of this parent ({creating.children.length}) — tick one or more</span>
                <div className="pick-list short">
                  {(allStudents.data || []).map((s) => (
                    <label key={s.id} className="pick-row">
                      <input type="checkbox" checked={creating.children.includes(s.id)} onChange={(e) => pickChild(s.id, e.target.checked)} />
                      <span>{s.full_name} <span className="small muted">{s.student_code}{s.guardian_name ? ` · guardian ${s.guardian_name}` : ''}</span></span>
                    </label>
                  ))}
                </div>
                <span className="small muted">Links made here are verified. The parent signs in with their Parent ID (PR…) or phone.</span>
              </div>
            )}
            {creating.role === 'assistant' && (
              <p className="span2 small notice-inline">An <b>Admin assistant</b> can use everything except <b>Users</b> and <b>Settings</b>. You can adjust this later with the <b>Access</b> button.</p>
            )}
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
            <label>Username (optional)<input autoCapitalize="none" placeholder="e.g. their phone number" value={creating.username || ''} onChange={(e) => setCreating({ ...creating, username: e.target.value })} /></label>
            <label>Email (optional)<input type="email" placeholder="leave empty to sign in with ID / phone" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} /></label>
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
        <Modal title={`Edit ${resetting.full_name || 'user'}`} onClose={() => setResetting(null)}>
          <form className="form-grid" onSubmit={saveDetails} key={resetting.id + (resetting.username || '') + (resetting.staff_code || '')}>
            <label>Full name *<input name="full_name" required defaultValue={resetting.full_name || ''} /></label>
            <label>Mobile / WhatsApp<input name="phone" inputMode="tel" defaultValue={resetting.phone || ''} placeholder="05xxxxxxxx" /></label>
            <label>Username (can be their phone number)
              <div className="input-row">
                <input name="username" defaultValue={resetting.username || ''} autoCapitalize="none" placeholder="e.g. 0551234567" />
                <button type="button" className="btn ghost small" onClick={(ev) => { const fm = ev.currentTarget.form; fm.username.value = (fm.phone.value || '').replace(/\s+/g, ''); }}>Use phone</button>
              </div>
            </label>
            <label>Email (optional)<input name="email" type="email" defaultValue={realEmail(resetting.email)} placeholder="leave empty for ID / phone sign-in" /></label>
            {(resetting.role === 'teacher' || resetting.role === 'admin') && (
              <label>Staff ID<input name="staff_code" defaultValue={resetting.staff_code || ''} placeholder="TC1001" style={{ textTransform: 'uppercase' }} /></label>
            )}
            <label>User type
              <select value={resetting.role === 'teacher' && resetting.staff_title ? resetting.staff_title : resetting.role}
                disabled={!meAdmin && (resetting.role === 'admin' || resetting.id === me.id)}
                onChange={async (e) => { await changeRole(resetting, e.target.value); setResetting(null); }}>
                <option value="student">Student</option>
                <option value="parent">Parent</option>
                <option value="teacher">Teacher</option>
                {(meAdmin || resetting.staff_title === 'principal') && <option value="principal">Principal</option>}
                {(meAdmin || resetting.staff_title === 'assistant') && <option value="assistant">Admin assistant</option>}
                {(meAdmin || resetting.role === 'admin') && <option value="admin">Admin</option>}
              </select>
            </label>
            {saved && <p className="success span2">{saved}</p>}
            <div className="span2"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button></div>
          </form>
          <hr className="sep" />
          <form className="form-grid" onSubmit={resetPassword}>
            <p className="span2 small muted">Signs in with: <b>{[resetting.username, resetting.staff_code || studentCode[resetting.id], resetting.phone, realEmail(resetting.email)].filter(Boolean).join(' / ')}</b>. To reset their password, type a new one and share it with them. No email is sent.</p>
            <label className="span2">New password *<input name="password" required minLength={6} defaultValue={makePassword()} /></label>
            {err && <p className="error span2">{err}</p>}
            <div className="span2 actions">
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
              {resetting.id !== me.id && <button type="button" className="btn danger ghost" onClick={() => removeLogin(resetting)}>Delete this login</button>}
            </div>
          </form>
        </Modal>
      )}

      {kids && <ParentLinks parent={kids} students={allStudents.data || []} onClose={() => { setKids(null); pendingLinks.reload(); }} />}

      {access && (
        <Modal title={`Access for ${access.profile.full_name || access.profile.email}`} onClose={() => setAccess(null)}>
          <p className="small muted">
            Every teacher can always use <b>My Classes, Attendance, Reports and ID Cards for their own class</b>.
            Tick extra areas below to give more access. Only you (the admin) can change this.
          </p>
          <div className="access-list">
            {AREAS.map(([k, label, hint]) => (
              <label key={k} className="pick-row">
                <input type="checkbox" checked={access.picked.has(k)} onChange={(e) => {
                  const next = new Set(access.picked);
                  if (e.target.checked) next.add(k); else next.delete(k);
                  setAccess({ ...access, picked: next });
                }} />
                <span><b>{label}</b><br /><span className="small muted">{hint}</span></span>
              </label>
            ))}
          </div>
          {err && <p className="error">{err}</p>}
          <div className="actions">
            <button className="btn" disabled={busy} onClick={saveAccess}>{busy ? 'Saving…' : 'Save access'}</button>
            <button className="btn ghost" onClick={() => setAccess({ ...access, picked: new Set() })}>Untick all (own class only)</button>
          </div>
        </Modal>
      )}

      {bulk && (
        <BulkStudentLogins students={freeStudents.data || []} classes={classList.data || []}
          onClose={() => { setBulk(false); list.reload(); linked.reload(); freeStudents.reload(); }} />
      )}
      {created && (
        <Modal title={created.reset ? 'Password changed' : 'Login created'} onClose={() => setCreated(null)}>
          <dl className="details">
            <dt>Name</dt><dd>{created.full_name}</dd>
            {created.username && <><dt>Username</dt><dd><b>{created.username}</b></dd></>}
            {(created.staff_code || created.student_code) && <><dt>User ID</dt><dd><b>{created.staff_code || created.student_code}</b></dd></>}
            <dt>Website</dt><dd>{window.location.origin}</dd>
            {created.phone && <><dt>Phone</dt><dd>{created.phone}</dd></>}
            {realEmail(created.email) && <><dt>Email</dt><dd>{created.email}</dd></>}
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

// Verify / add / remove the children of a parent login.
function ParentLinks({ parent, students, onClose }) {
  const [links, setLinks] = useState(null);
  const [add, setAdd] = useState('');
  const [err, setErr] = useState('');
  const name = (id) => students.find((s) => s.id === id);
  async function load() {
    const { data, error } = await supabase.from('parent_links').select('*').eq('parent_id', parent.id).order('created_at');
    if (error) setErr(/parent_links/.test(error.message) ? 'Parent links are not installed yet. Run update-18.sql in Supabase.' : error.message);
    setLinks(data || []);
  }
  useEffect(() => { load(); }, [parent.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(p) { setErr(''); const { error } = await p; if (error) setErr(error.message); else load(); }
  return (
    <Modal title={`Children of ${parent.full_name || 'parent'} (${parent.staff_code || ''})`} onClose={onClose}>
      <p className="small muted">A parent sees a child's attendance, progress, published results and issued certificates only when the link is <b>verified</b>. Check the request with the admission details before verifying.</p>
      {err && <p className="error">{err}</p>}
      {links === null ? <div className="spinner" /> : links.length === 0 ? <p className="muted">No children linked yet.</p> : (
        <ul className="req-list">
          {links.map((l) => {
            const s = name(l.student_id);
            return (
              <li key={l.id} className="row-between">
                <div>
                  <b>{s?.full_name || 'Student'}</b> <span className="small muted">{s?.student_code}</span>
                  <div className="small">{l.verified ? <span className="ok-text">✓ Verified {l.verified_at ? formatDate(l.verified_at) : ''}</span> : <span className="error">Waiting for verification{l.requested_by_parent ? ' (requested by parent)' : ''}</span>}
                    {s && <span className="muted"> · guardian {s.guardian_name || '—'} {s.guardian_phone || ''} · parent phone {parent.phone || '—'}</span>}</div>
                </div>
                <div className="actions">
                  {l.verified
                    ? <button className="btn ghost small" onClick={() => run(supabase.from('parent_links').update({ verified: false }).eq('id', l.id))}>Unverify</button>
                    : <button className="btn small" onClick={() => run(supabase.from('parent_links').update({ verified: true }).eq('id', l.id))}>Verify</button>}
                  <button className="btn danger ghost small" onClick={() => window.confirm('Remove this link?') && run(supabase.from('parent_links').delete().eq('id', l.id))}>Remove</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="filters">
        <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Add child">
          <option value="">Add a child…</option>
          {students.filter((s) => !(links || []).some((l) => l.student_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.student_code})</option>)}
        </select>
        <button className="btn" disabled={!add} onClick={() => { run(supabase.from('parent_links').insert({ parent_id: parent.id, student_id: add, verified: true })); setAdd(''); }}>Link (verified)</button>
      </div>
    </Modal>
  );
}

// Create logins for many students at once. Each student signs in with their
// Student ID (e.g. QC1001) and the password shown here.
function BulkStudentLogins({ students, classes, onClose }) {
  const [classId, setClassId] = useState('all');
  const [off, setOff] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(null); // [{ student, password, username, error }]
  const [signIn, setSignIn] = useState('phone'); // 'phone' = parent's mobile number, 'id' = Student ID only
  const [pwMode, setPwMode] = useState('random'); // 'random' or 'phone'
  const cls = (id) => classes.find((c) => c.id === id);
  const parentPhone = (s) => s.guardian_phone || s.whatsapp || '';
  const shown = students.filter((s) => classId === 'all' || (classId === 'none' ? !s.class_id : s.class_id === classId));
  const picked = shown.filter((s) => !off.has(s.id));

  async function run() {
    const out = [];
    for (const [k, s] of picked.entries()) {
      setBusy(`${k + 1} of ${picked.length}`);
      const mobile = localPhone(parentPhone(s));
      const password = pwMode === 'phone' && mobile.length >= 6 ? mobile : makePassword();
      const args = { p_email: s.email || '', p_password: password, p_full_name: s.full_name, p_phone: parentPhone(s) || null, p_role: 'student', p_student_id: s.id };
      let { data, error } = await supabase.rpc('admin_create_user', args);
      if (error && /already exists/i.test(error.message) && args.p_email) ({ data, error } = await supabase.rpc('admin_create_user', { ...args, p_email: '' }));
      let username = '', note = '';
      if (!error && signIn === 'phone' && mobile && data?.id) {
        // brothers and sisters share the parent's number: the 2nd gets 0551234567-2, the 3rd -3 …
        for (let n = 1; n <= 9 && !username; n++) {
          const u = n === 1 ? mobile : `${mobile}-${n}`;
          const { error: e2 } = await supabase.from('profiles').update({ username: u }).eq('id', data.id);
          if (!e2) username = u;
          else if (!/unique|duplicate|already/i.test(e2.message)) { note = e2.message; break; }
        }
      } else if (!error && signIn === 'phone' && !mobile) note = 'no parent mobile number — sign in with the Student ID';
      out.push({ s, password, username, note, error: error?.message || '' });
    }
    setBusy(''); setDone(out);
  }
  const ok = (done || []).filter((r) => !r.error);
  const rows = () => ok.map(({ s, password, username }) => ({ 'Sign in with': username || s.student_code, 'Student ID': s.student_code, Name: s.full_name, Class: s.class_id ? classTag(cls(s.class_id)) : '', Password: password, 'Parent mobile': parentPhone(s) }));
  const msg = (s, password, username) => loginMessage({ full_name: s.full_name, email: '', password, role: 'student', student_code: s.student_code, username, phone: parentPhone(s) });
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Modal title={done ? `Student logins created (${ok.length})` : 'Create student logins'} onClose={busy ? () => {} : onClose}>
      {!done ? (
        <>
          <p className="small muted">Choose how students sign in. They can always also use their <b>Student ID</b> (for example QC1001). You'll see every login at the end to send on WhatsApp or print.</p>
          <div className="filters">
            <select value={signIn} onChange={(e) => setSignIn(e.target.value)} aria-label="Sign in with">
              <option value="phone">Sign in with the parent's mobile number</option>
              <option value="id">Sign in with the Student ID only</option>
            </select>
            <select value={pwMode} onChange={(e) => setPwMode(e.target.value)} aria-label="Password">
              <option value="random">Password: a new password for each student</option>
              <option value="phone">Password: the parent's mobile number</option>
            </select>
            <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
              <option value="all">All classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}
              <option value="none">No class yet</option>
            </select>
          </div>
          <div className="pick-list">
            <div className="pick-head"><label><input type="checkbox" checked={picked.length === shown.length && shown.length > 0}
              onChange={(e) => { const n = new Set(off); shown.forEach((s) => (e.target.checked ? n.delete(s.id) : n.add(s.id))); setOff(n); }} />
              <b>{picked.length} of {shown.length} selected</b></label></div>
            <div className="pick-body">
              {shown.map((s) => (
                <label key={s.id} className="pick-row">
                  <input type="checkbox" checked={!off.has(s.id)} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(s.id); else n.add(s.id); setOff(n); }} />
                  <span className="pick-name"><b>{s.full_name}</b> <span className="muted">{s.student_code}</span></span>
                  <span className="pick-meta small muted">{s.class_id ? classTag(cls(s.class_id)) : 'No class'}{s.status === 'pending' ? ' · pending admission' : ''} · {localPhone(parentPhone(s)) || <b className="low">no parent mobile</b>}</span>
                </label>
              ))}
              {!shown.length && <p className="muted small" style={{ padding: 12 }}>Every student here already has a login.</p>}
            </div>
          </div>
          {signIn === 'phone' && <p className="small muted">Brothers and sisters share the parent's number: the second child signs in with <b>0551234567-2</b>, the third with <b>-3</b>. A parent who also has a parent login should sign in with their Parent ID (PR…).</p>}
          <div className="actions">
            <button className="btn" onClick={run} disabled={!picked.length || !!busy}>{busy ? `Creating ${busy}…` : `Create ${picked.length} login${picked.length === 1 ? '' : 's'}`}</button>
            <button className="btn ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">Send each student their details now — the passwords are not shown again. They sign in with the Student ID and can change the password under "Account".</p>
          <div className="actions">
            <button className="btn" disabled={!ok.length} onClick={() => downloadPdf(`student-logins-${stamp}.pdf`, { title: 'Student logins', subtitle: `Website: ${window.location.origin}   ·   Sign in with the Student ID and password`, orientation: 'portrait', tables: [{ heading: `${ok.length} students`, columns: Object.keys(rows()[0] || {}), rows: rows().map((r) => Object.values(r)) }] })}>Download PDF</button>
            <button className="btn ghost" disabled={!ok.length} onClick={() => downloadExcel(`student-logins-${stamp}.xlsx`, [{ name: 'Student logins', rows: rows() }])}>Excel</button>
          </div>
          <div className="pick-list">
            <div className="pick-body">
              {done.map(({ s, password, username, note, error }) => (
                <div key={s.id} className="pick-row">
                  <span className="pick-name"><b>{s.full_name}</b> <span className="muted">{s.student_code}</span></span>
                  {error ? <span className="pick-meta small low">Not created: {error}</span> : (
                    <span className="pick-meta small">Sign in: <b>{username || s.student_code}</b> · Password: <code>{password}</code>{note ? <span className="muted"> ({note})</span> : null}{' '}
                      {whatsappLink(s.whatsapp || s.guardian_phone, 'x')
                        ? <a className="btn whatsapp small" target="_blank" rel="noreferrer" href={whatsappLink(s.whatsapp || s.guardian_phone, msg(s, password, username))}>WhatsApp</a>
                        : <span className="muted">no phone</span>}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="actions"><button className="btn ghost" onClick={onClose}>Close</button></div>
        </>
      )}
    </Modal>
  );
}
