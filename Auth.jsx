import { useState } from 'react';
import { supabase } from './supabase.js';
import { useSettings, logoOf } from './settings.js';
import { whatsappLink, formatDate, classTag } from './util.js';
import StudentForm from './StudentForm.jsx';

export function Brand() {
  const s = useSettings();
  return (
    <div className="brand-block">
      <img className="auth-logo" src={logoOf(s)} alt={`${s.school_name} logo`} />
      <h1>{s.school_name}</h1>
      <p>{s.tagline}</p>
      {s.academic_year && <p className="small">Academic Year {s.academic_year}</p>}
    </div>
  );
}

export default function Auth() {
  const [mode, setMode] = useState('signin'); // signin | forgot | apply | status
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function go(m) { setMode(m); setErr(''); setMsg(''); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      if (mode === 'signin') {
        let loginEmail = email.trim();
        if (!loginEmail.includes('@')) {
          const { data, error: e1 } = await supabase.rpc('login_email', { p_login: loginEmail });
          if (e1) throw new Error(e1.message.includes('login_email') ? 'Sign in with ID or phone is not set up yet. Please use your email.' : e1.message);
          if (!data) throw new Error('No login found for that ID or phone number. New students: apply for admission below — the class admin gives you a login after approval.');
          loginEmail = data;
        }
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
        if (error) throw error;
      } else {
        if (!email.includes('@')) throw new Error('Password reset by email needs an email address. If you sign in with an ID or phone number, ask the class admin to reset your password.');
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMsg('If that email has an account, a password reset link has been sent.');
      }
    } catch (e2) {
      setErr(e2.message === 'Invalid login credentials' ? 'Login or password is incorrect.' : e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header"><Brand /></header>
      <main className="auth-main">
        {mode === 'apply' ? <ApplyForm onBack={() => go('signin')} onStatus={() => go('status')} />
          : mode === 'status' ? <StatusCheck onBack={() => go('signin')} />
          : (
          <>
            <form className="card narrow" onSubmit={submit}>
              <h2>{mode === 'signin' ? 'Sign in' : 'Reset password'}</h2>
              {mode === 'signin' ? (
                <label>Username, User ID, phone or email
                  <input required autoComplete="username" autoCapitalize="none" placeholder="e.g. QC1001, TC1001, 0551234567 or email"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              ) : (
                <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              )}
              {mode === 'signin' && (
                <label>Password
                  <input required type="password" minLength={6} autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}

              {err && <p className="error">{err}</p>}
              {msg && <p className="success">{msg}</p>}

              <button className="btn full" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
              </button>

              <div className="auth-links">
                {mode !== 'signin' && <button type="button" className="link" onClick={() => go('signin')}>Back to sign in</button>}
                {mode === 'signin' && <button type="button" className="link" onClick={() => go('forgot')}>Forgot password?</button>}
              </div>
            </form>

            {mode === 'signin' && (
              <div className="card narrow auth-extra">
                <h3>New student?</h3>
                <p className="small muted">Parents fill in the admission form — no account needed. You will get a Student ID to check the progress of the application.</p>
                <div className="auth-actions">
                  <button type="button" className="btn" onClick={() => go('apply')}>📝 Apply for admission</button>
                  <button type="button" className="btn ghost" onClick={() => go('status')}>🔎 Check admission status</button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ApplyForm({ onBack, onStatus }) {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  async function send(values) {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('submit_admission', { p: values });
    setBusy(false);
    if (error) setErr(/submit_admission/.test(error.message) ? 'Online admission is not switched on yet. Please contact the class admin.' : error.message);
    else { setDone({ ...data, phone: values.guardian_phone }); window.scrollTo(0, 0); }
  }

  if (done) {
    const wa = whatsappLink(settings.contact_whatsapp || settings.contact_phone,
      `Assalamu Alaikum. I have applied for admission to the ${settings.school_name} for ${done.full_name}. Student ID: ${done.student_code}.`);
    return (
      <div className="card narrow center">
        <h2>{done.duplicate ? 'Application already received' : 'Application received'} ✅</h2>
        <p>{done.duplicate ? 'We already have an application for' : 'JazakAllahu khairan. We have received the application for'} <b>{done.full_name}</b>.</p>
        <p className="muted small">Please save this Student ID. You need it, with the guardian phone number, to check the application.</p>
        <div className="big-code">{done.student_code}</div>
        <p className="small">Status: <span className={`badge ${done.status}`}>{done.status}</span></p>
        <p className="small muted">The class admin will review it and contact you on WhatsApp. After approval you will receive a login to see attendance, progress and the digital ID card.</p>
        <div className="auth-actions">
          {wa && <a className="btn whatsapp" href={wa} target="_blank" rel="noreferrer">Tell the admin on WhatsApp</a>}
          <button className="btn ghost" onClick={onStatus}>Check status</button>
          <button className="btn ghost" onClick={onBack}>Back to sign in</button>
        </div>
      </div>
    );
  }

  return (
    <section className="card wide-form">
      <div className="row-between">
        <h2>Admission application</h2>
        <button className="link" onClick={onBack}>Back to sign in</button>
      </div>
      <p className="muted small">Fill in all details marked *. Classes are arranged by age and gender (up to 12 students per class). {settings.school_name}.</p>
      {err && <p className="error">{err}</p>}
      <StudentForm initial={{}} onSubmit={send} busy={busy} requireDob submitLabel="Submit application" />
      {err && <p className="error">{err}</p>}
    </section>
  );
}

function StatusCheck({ onBack }) {
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(undefined);
  const [err, setErr] = useState('');

  async function check(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setRes(undefined);
    const { data, error } = await supabase.rpc('admission_status', { p_code: code.trim(), p_phone: phone });
    setBusy(false);
    if (error) setErr(/admission_status/.test(error.message) ? 'Status check is not switched on yet. Please contact the class admin.' : error.message);
    else setRes(data || null);
  }

  const STEPS = [['pending', 'Application received'], ['approved', 'Approved & class given'], ['login', 'Login ready']];
  const reached = (k) => res && (k === 'pending' || (k === 'approved' && res.status === 'approved') || (k === 'login' && res.status === 'approved' && res.has_login));

  return (
    <form className="card narrow" onSubmit={check}>
      <h2>Check admission status</h2>
      <label>Student ID or school admission number
        <input required autoCapitalize="characters" placeholder="e.g. QC1022" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label>Guardian phone number (as on the form)
        <input required inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {err && <p className="error">{err}</p>}
      <button className="btn full" disabled={busy}>{busy ? 'Checking…' : 'Check status'}</button>
      {res === null && <p className="error">No application found with that ID and phone number. Please check both and try again.</p>}
      {res && (
        <div className="status-box">
          <div className="row-between"><b>{res.full_name}</b><span className={`badge ${res.status}`}>{res.status}</span></div>
          <p className="small muted">{res.student_code} · applied {formatDate(res.applied)}</p>
          {['rejected', 'inactive'].includes(res.status) ? (
            <p>{res.status === 'rejected' ? 'The application was not accepted this time.' : 'The enrolment is inactive.'} Please contact the class admin.</p>
          ) : (
            <ol className="steps">
              {STEPS.map(([k, label]) => <li key={k} className={reached(k) ? 'done' : ''}>{label}</li>)}
            </ol>
          )}
          {res.class_name && <p className="small">Class: <b>{classTag({ name: res.class_name, group_name: res.group_name })}</b>{res.schedule ? ` · ${res.schedule}` : ''}</p>}
          {res.status === 'approved' && !res.has_login && <p className="small muted">The login has not been created yet. The admin will send it on WhatsApp.</p>}
          {res.status === 'approved' && res.has_login && <p className="small">Sign in with the Student ID <b>{res.student_code}</b> and your password.</p>}
        </div>
      )}
      <div className="auth-links"><button type="button" className="link" onClick={onBack}>Back to sign in</button></div>
    </form>
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
