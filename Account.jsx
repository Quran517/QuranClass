import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { realEmail, cleanUsername, USERNAME_RULE, usernameError } from './util.js';

export default function Account({ profile, onSaved }) {
  const [name, setName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [pw, setPw] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [username, setUsername] = useState(profile.username || '');

  useEffect(() => {
    if (profile.role !== 'student') return;
    supabase.from('students').select('student_code').eq('profile_id', profile.id).maybeSingle()
      .then(({ data }) => setStudentCode(data?.student_code || ''));
  }, [profile.id, profile.role]);
  const userId = profile.staff_code || studentCode;
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function saveUsername(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    const u = cleanUsername(username);
    if (u && !USERNAME_RULE.test(u)) { setErr('Username can only use letters, numbers and . _ + - (3 to 40 characters, no spaces).'); return; }
    const { error } = await supabase.from('profiles').update({ username: u || null }).eq('id', profile.id);
    if (error) setErr(usernameError(error));
    else { setUsername(u); setMsg(u ? `Username saved. You can now sign in with "${u}".` : 'Username removed.'); onSaved(); }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    const { error } = await supabase.from('profiles').update({ full_name: name, phone }).eq('id', profile.id);
    if (error) setErr(error.message); else { setMsg('Details saved.'); onSaved(); }
  }

  async function savePassword(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setErr(error.message); else { setPw(''); setMsg('Password changed.'); }
  }

  return (
    <>
      <section className="card">
        <h2>My account</h2>
        <dl className="details">
          {userId && <><dt>User ID</dt><dd><b>{userId}</b></dd></>}
          {profile.username && <><dt>Username</dt><dd><b>{profile.username}</b></dd></>}
          <dt>Role</dt><dd className="cap">{profile.role}</dd>
          <dt>Email</dt><dd>{realEmail(profile.email) || <span className="muted">none — sign in with your User ID or phone</span>}</dd>
        </dl>
        <p className="small muted">You can sign in with {[profile.username && `your username (${profile.username})`, userId && `your User ID (${userId})`, 'your phone number', realEmail(profile.email) && 'your email'].filter(Boolean).join(', ')}.</p>
        {err && <p className="error">{err}</p>}
        {msg && <p className="success">{msg}</p>}
        <form className="form-grid" onSubmit={saveProfile}>
          <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Mobile / WhatsApp<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <div className="span2"><button className="btn">Save details</button></div>
        </form>
      </section>
      {profile.role === 'student' && <MyStudentDetails profile={profile} />}
      <section className="card">
        <h2>Username</h2>
        <p className="small muted">Choose a name to sign in with — for example your phone number (0551234567) or a short name (ahmed.k). Letters, numbers and . _ + - only.</p>
        <form className="form-grid" onSubmit={saveUsername}>
          <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" placeholder="e.g. 0551234567" /></label>
          <div className="span2"><button className="btn ghost">Save username</button></div>
        </form>
      </section>
      <section className="card">
        <h2>Change password</h2>
        <form className="form-grid" onSubmit={savePassword}>
          <label>New password<input type="password" minLength={6} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <div className="span2"><button className="btn ghost">Change password</button></div>
        </form>
      </section>
    </>
  );
}

// Students keep their own contact details up to date.
function MyStudentDetails({ profile }) {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('students').select('full_name, student_code, admission_no, guardian_name, guardian_phone, whatsapp, email, address, school_grade, date_of_birth, gender, status')
      .eq('profile_id', profile.id).maybeSingle().then(({ data }) => setS(data || false));
  }, [profile.id]);
  if (s === null) return null;
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setMsg(''); setErr(''); setBusy(true);
    const { error } = await supabase.rpc('update_my_details', {
      p_guardian_name: s.guardian_name || '', p_guardian_phone: s.guardian_phone || '', p_whatsapp: s.whatsapp || '',
      p_email: s.email || '', p_address: s.address || '', p_school_grade: s.school_grade || '',
    });
    setBusy(false);
    if (error) setErr(/update_my_details/.test(error.message) ? 'This needs a database update — please ask the admin to run update-24.sql.' : error.message);
    else setMsg('Your details were updated.');
  }
  return (
    <section className="card">
      <h2>My student details</h2>
      <dl className="details">
        <dt>Name</dt><dd>{s.full_name}</dd>
        <dt>Student ID</dt><dd><b>{s.student_code}</b></dd>
        {s.admission_no && <><dt>Admission no.</dt><dd>{s.admission_no}</dd></>}
      </dl>
      <p className="small muted">Keep your contact details up to date. Your name, class and Student ID can only be changed by the school.</p>
      {err && <p className="error">{err}</p>}
      {msg && <p className="success">{msg}</p>}
      <form className="form-grid" onSubmit={save}>
        <label>Parent / guardian name<input value={s.guardian_name || ''} onChange={set('guardian_name')} /></label>
        <label>Parent / guardian phone<input inputMode="tel" value={s.guardian_phone || ''} onChange={set('guardian_phone')} /></label>
        <label>WhatsApp number<input inputMode="tel" value={s.whatsapp || ''} onChange={set('whatsapp')} /></label>
        <label>Email<input type="email" value={s.email || ''} onChange={set('email')} /></label>
        <label>School grade<input value={s.school_grade || ''} onChange={set('school_grade')} /></label>
        <label className="span2">Address<input value={s.address || ''} onChange={set('address')} /></label>
        <div className="span2"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Update my details'}</button></div>
      </form>
    </section>
  );
}
