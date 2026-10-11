import { useState } from 'react';
import { supabase } from './supabase.js';

export default function Account({ profile, onSaved }) {
  const [name, setName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [pw, setPw] = useState('');
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
        <p className="muted small">{profile.email} · {profile.role}</p>
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
