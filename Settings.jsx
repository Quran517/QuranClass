import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { fetchAllRows } from './data.js';
import { useSettings, saveSettings, setLastBackup, logoOf } from './settings.js';
import { formatDate, WEEKDAYS } from './util.js';
import { downloadExcel } from './exports.js';

const FIELDS = [
  ['school_name', 'School / programme name', 'text', true],
  ['school_name_ar', 'School name in Arabic (for certificates)', 'text'],
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
      if ((f.school_name_ar || '') === (s.school_name_ar || '')) delete values.school_name_ar; // only send when changed (needs update-20)
      values.allow_signup = false;
      if (s.show_card_photos !== f.show_card_photos) values.show_card_photos = f.show_card_photos !== false; // logins are made by the admin; new students use the admission form
      const cd = Array.isArray(f.class_days) ? f.class_days : [6];
      if (!cd.length) throw new Error('Tick at least one class day.');
      values.class_days = cd;
      try {
        await saveSettings(values);
      } catch (e3) {
        if (/class_days/.test(e3.message)) throw new Error('Class days need update-15.sql. Run it in Supabase → SQL Editor, then save again.');
        throw e3;
      }
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
          <fieldset className="span2 class-days">
            <legend>Class days <span className="small muted">— attendance, dashboard and reports follow these days</span></legend>
            {[6, 0, 1, 2, 3, 4, 5].map((i) => {
              const cur = Array.isArray(f.class_days) ? f.class_days : [6];
              return (
                <label key={i} className="check inline">
                  <input type="checkbox" checked={cur.includes(i)}
                    onChange={(e) => setF({ ...f, class_days: e.target.checked ? [...cur, i].sort() : cur.filter((x) => x !== i) })} />
                  <span>{WEEKDAYS[i]}</span>
                </label>
              );
            })}
          </fieldset>
          <label className="check span2">
            <input type="checkbox" checked={f.show_card_photos !== false} onChange={(e) => setF({ ...f, show_card_photos: e.target.checked })} />
            <span><b>Show photos on ID cards.</b> Photos are optional — add them under ID Cards → 📷. Untick to print all cards without a photo box.</span>
          </label>
          <label>Low attendance warning below (%)
            <input type="number" min="1" max="100" value={f.low_attendance_pct} onChange={(e) => setF({ ...f, low_attendance_pct: e.target.value })} />
          </label>
          <label>Remind me to back up every (days)
            <input type="number" min="1" max="90" value={f.backup_every_days} onChange={(e) => setF({ ...f, backup_every_days: e.target.value })} />
          </label>
          <div className="span2"><button className="btn" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button></div>
        </form>
      </section>

      <LogoSettings />
      <StudentIdSettings />

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

// Student IDs: show gaps and renumber everyone QC1001, QC1002, … (admin only).
function StudentIdSettings() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  async function load() {
    try {
      setRows(await fetchAllRows(() => supabase.from('students').select('id, full_name, student_code, created_at').order('created_at').order('id')));
    } catch (e) { setErr(e.message); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  const nums = (rows || []).map((r) => Number((r.student_code || '').replace(/^QC/, ''))).filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 1000;
  const gaps = nums.length ? max - 1000 - nums.length : 0;
  const outOfOrder = (rows || []).some((r, i) => r.student_code !== `QC${1001 + i}`);

  async function renumber() {
    if (!window.confirm(`Give all ${rows.length} students new IDs QC1001 to QC${1000 + rows.length}, in the order they joined?\n\nAttendance, marks, progress, certificates and logins stay linked.\nPrinted cards show the OLD ID: print new cards and collect the old ones. Students sign in with their new ID.`)) return;
    if (!window.confirm('Are you sure? This cannot be undone automatically (a list of old and new IDs will be downloaded).')) return;
    setBusy(true); setErr(''); setDone(null);
    const { data, error } = await supabase.rpc('renumber_student_codes');
    setBusy(false);
    if (error) { setErr(/renumber_student_codes/.test(error.message) ? 'Run update-23.sql in Supabase → SQL Editor first.' : error.message); return; }
    setDone(data);
    if (data.changed?.length) {
      downloadExcel(`student-id-changes-${new Date().toLocaleDateString('en-CA')}.xlsx`, [{
        name: 'Old and new IDs', rows: data.changed.map((c) => ({ Student: c.name, 'Old ID': c.old, 'New ID': c.new })),
      }]);
    }
    load();
  }

  return (
    <section className="card">
      <h2>Student IDs</h2>
      <p className="small muted">New students always get the next number (QC1001, QC1002, QC1003 …). A cancelled or failed save no longer skips a number.</p>
      {rows === null ? <div className="spinner" /> : (
        <div className="stats">
          <div className="stat"><b>{rows.length}</b><span>Students (all statuses)</span></div>
          <div className="stat"><b>{rows.length ? `QC1001–QC${max}` : '—'}</b><span>Current range</span></div>
          <div className="stat"><b>{Math.max(0, gaps)}</b><span>Missing numbers</span></div>
          <div className="stat"><b>{outOfOrder ? 'No' : 'Yes'}</b><span>In joining order</span></div>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      {done && <p className="success">Done — {done.total} students now have IDs QC1001 to QC{1000 + done.total}. {done.changed?.length || 0} IDs changed; the list of old and new IDs was downloaded. Please print new ID cards (ID Cards page) and tell students their new ID.</p>}
      {rows && rows.length > 0 && outOfOrder && (
        <>
          <p className="notice-line small">Renumbering changes Student IDs. <b>Print new ID cards afterwards and collect the old ones</b> — the barcode on an old card would show the old number, which may now belong to another student (the QR code on old cards still works). Students and parents use the new ID to sign in or check the application.</p>
          <button className="btn" disabled={busy} onClick={renumber}>{busy ? 'Renumbering…' : `Renumber all IDs QC1001–QC${1000 + rows.length} (no gaps)`}</button>
        </>
      )}
      {rows && rows.length > 0 && !outOfOrder && <p className="success small">All Student IDs are in order with no gaps. ✓</p>}
    </section>
  );
}
