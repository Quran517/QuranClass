import { useState } from 'react';
import { supabase } from './supabase.js';
import { fetchAllRows } from './data.js';
import { useSettings, saveSettings, setLastBackup, logoOf } from './settings.js';
import { formatDate } from './util.js';
import { downloadExcel } from './exports.js';

const FIELDS = [
  ['school_name', 'School / programme name', 'text', true],
  ['tagline', 'Tagline (shown under the name)', 'text'],
  ['academic_year', 'Academic year', 'text'],
  ['contact_phone', 'Contact phone', 'tel'],
  ['contact_whatsapp', 'Admin WhatsApp number', 'tel'],
  ['contact_email', 'Contact email', 'email'],
  ['address', 'Address', 'text'],
  ['card_note', 'Note printed on the back of ID cards', 'text'],
];

function stamp() {
  const d = new Date();
  return d.toLocaleDateString('en-CA') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
}

function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function collectBackup() {
  const [settings, classes, students, attendance, profiles] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => data),
    fetchAllRows(() => supabase.from('classes').select('*').order('created_at')),
    fetchAllRows(() => supabase.from('students').select('*').order('created_at')),
    fetchAllRows(() => supabase.from('attendance').select('*').order('att_date')),
    fetchAllRows(() => supabase.from('profiles').select('id, email, full_name, phone, role, staff_code, created_at').order('created_at')),
  ]);
  return { app: 'SLIS-Jeddah Quran Class', version: 3, created_at: new Date().toISOString(), settings, classes, students, attendance, profiles };
}

// Shrink an uploaded picture to a small square PNG so it loads fast everywhere.
function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const r = Math.min(size / img.width, size / img.height);
      ctx.drawImage(img, (size - img.width * r) / 2, (size - img.height * r) / 2, img.width * r, img.height * r);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('This file is not a picture the browser can open. Use PNG or JPG.'));
    img.src = URL.createObjectURL(file);
  });
}

function LogoSettings() {
  const s = useSettings();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(''); setErr(''); setBusy(true);
    try {
      const url = await fileToLogo(file);
      await saveSettings({ logo_url: url });
      setMsg('New logo saved. It now shows everywhere.');
    } catch (e2) {
      setErr(/logo_url/.test(e2.message) ? 'Logo upload is not installed yet. Run update-9.sql in Supabase → SQL Editor.' : e2.message);
    }
    setBusy(false);
  }

  async function reset() {
    setMsg(''); setErr(''); setBusy(true);
    try {
      await saveSettings({ logo_url: null });
      setMsg('Back to the QTC logo.');
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  return (
    <section className="card">
      <h2>Logo</h2>
      <p className="small muted">Shown on the sign-in page, the top bar, ID cards, PDF reports and as the browser / phone icon. A square picture works best (PNG or JPG).</p>
      <div className="logo-row">
        <img className="logo-preview" src={logoOf(s)} alt="Current logo" />
        <div className="actions">
          <label className="file-btn btn">
            {busy ? 'Saving…' : 'Upload new logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={upload} hidden disabled={busy} />
          </label>
          {s.logo_url && <button className="btn ghost" onClick={reset} disabled={busy}>Use the QTC logo</button>}
        </div>
      </div>
      {!s.logo_url && <p className="small muted">Using the built-in QTC logo.</p>}
      {err && <p className="error">{err}</p>}
      {msg && <p className="success">{msg}</p>}
    </section>
  );
}

export default function Settings() {
  const s = useSettings();
  const [f, setF] = useState(s);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [restore, setRestore] = useState(null);

  async function save(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy('save');
    try {
      const values = {};
      for (const [k] of FIELDS) values[k] = (f[k] ?? '').toString().trim() || null;
      values.low_attendance_pct = Number(f.low_attendance_pct) || 75;
      values.backup_every_days = Number(f.backup_every_days) || 7;
      values.allow_signup = f.allow_signup !== false;
      await saveSettings(values);
      setMsg('Settings saved.');
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy('');
  }

  async function backup(kind) {
    setErr(''); setMsg(''); setBusy(kind);
    try {
      const b = await collectBackup();
      if (kind === 'json') {
        saveFile(`quranclass-backup-${stamp()}.json`, JSON.stringify(b, null, 1), 'application/json');
      } else {
        const cls = Object.fromEntries(b.classes.map((c) => [c.id, c.name]));
        const grp = Object.fromEntries(b.classes.map((c) => [c.id, c.group_name || '']));
        const stu = Object.fromEntries(b.students.map((x) => [x.id, x]));
        const ppl = Object.fromEntries(b.profiles.map((p) => [p.id, p]));
        await downloadExcel(`quranclass-backup-${stamp()}.xlsx`, [
          { name: 'Students', rows: b.students.map((x) => ({
            'Student ID': x.student_code, 'Admission No': x.admission_no || '', Name: x.full_name, Gender: x.gender || '', 'Date of birth': x.date_of_birth || '',
            'School grade': x.school_grade || '', 'Quran level': x.quran_level || '', Class: cls[x.class_id] || '', Group: grp[x.class_id] || '',
            Guardian: x.guardian_name || '', 'Guardian phone': x.guardian_phone || '', WhatsApp: x.whatsapp || '',
            Email: x.email || '', Address: x.address || '', Notes: x.notes || '', Status: x.status,
            Applied: x.created_at?.slice(0, 10) || '', Approved: x.approved_at?.slice(0, 10) || '',
          })) },
          { name: 'Classes', rows: b.classes.map((c) => ({ Name: c.name, Group: c.group_name || '', Level: c.level || '', Schedule: c.schedule || '', Teacher: ppl[c.teacher_id]?.full_name || '', 'Teacher ID': ppl[c.teacher_id]?.staff_code || '' })) },
          { name: 'Users', rows: b.profiles.map((p) => ({ Name: p.full_name, 'Teacher ID': p.staff_code || '', Email: p.email, Phone: p.phone || '', Role: p.role, Joined: p.created_at?.slice(0, 10) })) },
          { name: 'Attendance', rows: b.attendance.map((a) => ({ Date: a.att_date, Class: cls[a.class_id] || '', 'Student ID': stu[a.student_id]?.student_code || '', Name: stu[a.student_id]?.full_name || '', Status: a.status, Method: a.method })) },
        ]);
      }
      const { data } = await supabase.rpc('mark_backup_done');
      if (data) setLastBackup(data);
      setMsg(kind === 'json'
        ? 'Backup file downloaded. Keep it somewhere safe (e.g. Google Drive). You can restore from it below.'
        : 'Excel backup downloaded.');
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy('');
  }

  async function readRestore(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setMsg('');
    try {
      const b = JSON.parse(await file.text());
      if (!Array.isArray(b.students) || !Array.isArray(b.classes)) throw new Error('This is not a Quran class backup file.');
      setRestore(b);
    } catch (e2) {
      setErr('Could not read the backup: ' + e2.message);
    }
  }

  async function doRestore() {
    if (!window.confirm('Restore this backup? Records in the backup will be put back exactly as they were in the backup. Records added since then are kept.')) return;
    setBusy('restore'); setErr('');
    try {
      const people = new Set((await fetchAllRows(() => supabase.from('profiles').select('id'))).map((p) => p.id));
      const chunks = async (table, rows) => {
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await supabase.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'id' });
          if (error) throw new Error(`${table}: ${error.message}`);
        }
      };
      await chunks('classes', restore.classes.map((c) => ({ ...c, teacher_id: people.has(c.teacher_id) ? c.teacher_id : null })));
      await chunks('students', restore.students.map((x) => ({ ...x, profile_id: people.has(x.profile_id) ? x.profile_id : null })));
      await chunks('attendance', (restore.attendance || []).map((a) => ({ ...a, marked_by: people.has(a.marked_by) ? a.marked_by : null })));
      setMsg(`Restored ${restore.classes.length} classes, ${restore.students.length} students and ${(restore.attendance || []).length} attendance records.`);
      setRestore(null);
    } catch (e2) {
      setErr('Restore stopped: ' + e2.message);
    }
    setBusy('');
  }

  const due = !s.last_backup_at || (Date.now() - new Date(s.last_backup_at)) / 86400000 >= s.backup_every_days;

  return (
    <>
      <section className="card">
        <h2>Settings</h2>
        <p className="muted small">Used on ID cards, reports, WhatsApp messages and the top of every page.</p>
        {err && <p className="error">{err}</p>}
        {msg && <p className="success">{msg}</p>}
        <form className="form-grid" onSubmit={save}>
          {FIELDS.map(([k, label, type, req]) => (
            <label key={k} className={k === 'card_note' || k === 'school_name' ? 'span2' : ''}>{label}{req ? ' *' : ''}
              <input type={type} required={req} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </label>
          ))}
          <label>Low attendance warning below (%)
            <input type="number" min="1" max="100" value={f.low_attendance_pct} onChange={(e) => setF({ ...f, low_attendance_pct: e.target.value })} />
          </label>
          <label>Remind me to back up every (days)
            <input type="number" min="1" max="90" value={f.backup_every_days} onChange={(e) => setF({ ...f, backup_every_days: e.target.value })} />
          </label>
          <label className="check span2">
            <input type="checkbox" checked={f.allow_signup === false} onChange={(e) => setF({ ...f, allow_signup: !e.target.checked })} />
            <span><b>Only the admin can create users.</b> Hides "Create an account" on the sign-in page and blocks self sign-up. Create logins under <i>Users</i> instead.</span>
          </label>
          <div className="span2"><button className="btn" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button></div>
        </form>
      </section>

      <LogoSettings />

      <section className="card">
        <h2>Backups</h2>
        <p className={due ? 'notice-inline warn' : 'small muted'}>
          {s.last_backup_at ? <>Last backup: <b>{formatDate(s.last_backup_at)}</b>.</> : <>No backup has been made yet.</>}
          {due && ' A backup is due — please download one now.'}
        </p>
        <p className="small muted">
          The free database has no automatic backups you can download, so save a copy regularly (for example to Google Drive or a USB stick).
          The <b>backup file</b> can be restored here. The <b>Excel</b> copy is for reading and printing.
        </p>
        <div className="actions">
          <button className="btn" onClick={() => backup('json')} disabled={!!busy}>{busy === 'json' ? 'Preparing…' : 'Download backup file'}</button>
          <button className="btn ghost" onClick={() => backup('xlsx')} disabled={!!busy}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel copy'}</button>
        </div>

        <h3>Restore from a backup file</h3>
        <p className="small muted">Puts classes, students and attendance back as they were in the backup — useful if something was deleted by mistake. Logins are not changed.</p>
        <label className="file-btn btn ghost">
          Choose backup file (.json)
          <input type="file" accept=".json,application/json" onChange={readRestore} hidden />
        </label>
        {restore && (
          <div className="restore-box">
            <p>Backup from <b>{formatDate(restore.created_at)}</b>: {restore.classes.length} classes, {restore.students.length} students, {(restore.attendance || []).length} attendance records.</p>
            <div className="actions">
              <button className="btn danger" onClick={doRestore} disabled={busy === 'restore'}>{busy === 'restore' ? 'Restoring…' : 'Restore now'}</button>
              <button className="btn ghost" onClick={() => setRestore(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
