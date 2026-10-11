import { useState } from 'react';
import { supabase } from '../supabase.js';

export function Brand() {
  return (
    <div className="brand-block">
      <div className="logo" aria-hidden="true">۞</div>
      <h1>SLIS-Jeddah Quran Class</h1>
      <p>Quran Learning • Character • Knowledge</p>
    </div>
  );
}

export default function Auth() {
  const [mode, setMode] = useState('signin'); // signin | signup | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, phone },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setMsg('Account created. Please check your email and click the confirmation link, then sign in.');
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMsg('If that email has an account, a password reset link has been sent.');
      }
    } catch (e2) {
      setErr(e2.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header"><Brand /></header>
      <main className="auth-main">
        <form className="card narrow" onSubmit={submit}>
          <h2>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create an account' : 'Reset password'}</h2>
          {mode === 'signup' && (
            <p className="muted small">
              New students (or parents on their behalf) create an account, then fill in the admission form.
              Teachers: create an account and ask the admin to give you teacher access.
            </p>
          )}

          {mode === 'signup' && (
            <>
              <label>Full name<input required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
              <label>Mobile / WhatsApp<input required inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            </>
          )}
          <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {mode !== 'forgot' && (
            <label>Password
              <input required type="password" minLength={6}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}

          {err && <p className="error">{err}</p>}
          {msg && <p className="success">{msg}</p>}

          <button className="btn full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </button>

          <div className="auth-links">
            {mode !== 'signin' && <button type="button" className="link" onClick={() => setMode('signin')}>Back to sign in</button>}
            {mode === 'signin' && <button type="button" className="link" onClick={() => setMode('signup')}>New here? Create an account</button>}
            {mode === 'signin' && <button type="button" className="link" onClick={() => setMode('forgot')}>Forgot password?</button>}
          </div>
        </form>
      </main>
    </div>
  );
}

export function NewPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  }

  return (
    <div className="auth-page">
      <header className="auth-header"><Brand /></header>
      <main className="auth-main">
        <form className="card narrow" onSubmit={save}>
          <h2>Choose a new password</h2>
          <label>New password<input required type="password" minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {err && <p className="error">{err}</p>}
          <button className="btn full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      </main>
    </div>
  );
}
