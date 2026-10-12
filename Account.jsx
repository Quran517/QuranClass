import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { realEmail } from './util.js';

export default function Account({ profile, onSaved }) {
  const [name, setName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [pw, setPw] = useState('');
  const [studentCode, setStudentCode] = useState('');

  useEffect(() => {
    if (profile.role !== 'student') return;
    supabase.from('students').select('student_code').eq('profile_id', profile.id).maybeSingle()
      .then(({ data }) => setStudentCode(data?.student_code || ''));
  }, [profile.id, profile.role]);
  const userId = profile.staff_code || studentCode;
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

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
          <dt>Role</dt><dd className="cap">{profile.role}</dd>
          <dt>Email</dt><dd>{realEmail(profile.email) || <span className="muted">none — sign in with your User ID or phone</span>}</dd>
        </dl>
        <p className="small muted">You can sign in with {[userId && `your User ID (${userId})`, 'your phone number', realEmail(profile.email) && 'your email'].filter(Boolean).join(', ')}.</p>
        {err && <p className="error">{err}</p>}
        {msg && <p className="success">{msg}</p>}
        <form className="form-grid" onSubmit={saveProfile}>
          <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Mobile / WhatsApp<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <div className="span2"><button className="btn">Save details</button></div>
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
