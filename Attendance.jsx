import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { today, formatDate, whatsappLink, STATUS_LABELS } from './util.js';
import QrScanner from './QrScanner.jsx';
import { QR_PREFIX } from './StudentQR.jsx';
import { unlockSound, scanSound, scanVibrate } from './sound.js';

const STATUSES = ['present', 'late', 'absent', 'excused'];

export default function Attendance({ profile }) {
  const classes = useQuery(() => fetchMyClasses(profile), [profile.id]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(today());
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({});      // student_id -> status (unsaved edits included)
  const [saved, setSaved] = useState({});      // student_id -> status as stored
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [feed, setFeed] = useState([]);
  const [typedId, setTypedId] = useState('');
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('qc-scan-sound') !== 'off'; } catch { return true; } });        // recent scan results
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!classId && classes.data?.length) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  async function load() {
    if (!classId) return;
    setLoading(true); setErr(''); setMsg('');
    const [{ data: st, error: e1 }, { data: at, error: e2 }] = await Promise.all([
      supabase.from('students').select('id, full_name, student_code, guardian_name, guardian_phone, whatsapp')
        .eq('class_id', classId).eq('status', 'approved').order('full_name'),
      supabase.from('attendance').select('student_id, status').eq('class_id', classId).eq('att_date', date),
    ]);
    if (e1 || e2) setErr((e1 || e2).message);
    const m = Object.fromEntries((at || []).map((a) => [a.student_id, a.status]));
    setStudents(st || []);
    setSaved(m);
    setMarks(m);
    setLoading(false);
  }

  useEffect(() => { load(); }, [classId, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const klass = (classes.data || []).find((c) => c.id === classId);
  const dirty = students.filter((s) => marks[s.id] && marks[s.id] !== saved[s.id]);

  async function saveAll() {
    if (!dirty.length) return;
    setBusy(true); setErr(''); setMsg('');
    const rows = dirty.map((s) => ({
      student_id: s.id, class_id: classId, att_date: date, status: marks[s.id],
      method: 'manual', marked_by: profile.id, marked_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,class_id,att_date' });
    setBusy(false);
    if (error) setErr(error.message);
    else { setSaved({ ...saved, ...Object.fromEntries(dirty.map((s) => [s.id, marks[s.id]])) }); setMsg(`Saved ${rows.length} record${rows.length > 1 ? 's' : ''}.`); }
  }

  async function clearMark(s) {
    setErr(''); setMsg('');
    if (saved[s.id]) {
      const { error } = await supabase.from('attendance').delete()
        .eq('student_id', s.id).eq('class_id', classId).eq('att_date', date);
      if (error) { setErr(error.message); return; }
    }
    const m = { ...marks }; delete m[s.id]; setMarks(m);
    const sv = { ...saved }; delete sv[s.id]; setSaved(sv);
  }

  function markRest(status) {
    const next = { ...marks };
    for (const s of students) if (!next[s.id]) next[s.id] = status;
    setMarks(next);
  }

  function signal(kind, text) {
    if (sound) scanSound(kind);
    scanVibrate(kind);
    setFeed((f) => [{ ok: kind !== 'error', kind, text, at: Date.now() }, ...f].slice(0, 8));
  }

  function toggleScanner() {
    unlockSound(); // the tap lets the phone play beeps
    setScanning(!scanning);
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem('qc-scan-sound', next ? 'on' : 'off'); } catch { /* ignore */ }
    if (next) { unlockSound(); scanSound('ok'); }
  }

  // Accepts the QR code, the barcode (QC number) or a typed ID / admission number.
  async function onScan(text, addToClass = false) {
    const value = String(text || '').trim();
    if (!value) return;
    let { data, error } = await supabase.rpc('mark_attendance_scan', {
      p_value: value, p_class: classId, p_date: date, p_add_to_class: addToClass,
    });
    if (error && /mark_attendance_scan/.test(error.message)) {
      // Database update 7 not installed yet: fall back to QR-only scanning.
      const token = value.startsWith(QR_PREFIX) ? value.slice(QR_PREFIX.length) : value;
      if (!/^[0-9a-f-]{36}$/i.test(token)) {
        signal('error', 'Only the QR code works until update-7.sql is run in Supabase.');
        return;
      }
      ({ data, error } = await supabase.rpc('mark_attendance_qr', { p_token: token, p_class: classId, p_date: date }));
    }
    if (error) {
      const m = error.message.match(/NO_CLASS\|([^|]+)\|([^|]*)\|(.*)$/);
      if (m) {
        if (sound) scanSound('error');
        scanVibrate('error');
        setFeed((f) => [{ ok: false, kind: 'noclass', text: m[3], value, at: Date.now() }, ...f].slice(0, 8));
      } else {
        signal('error', error.message.replace(/^.*?ERROR:\s*/, ''));
      }
      return;
    }
    const already = data.already || saved[data.student_id] === 'present';
    if (data.added_to_class) await load();
    setMarks((m) => ({ ...m, [data.student_id]: 'present' }));
    setSaved((m) => ({ ...m, [data.student_id]: 'present' }));
    signal(already ? 'repeat' : 'ok',
      already ? `${data.full_name} — already marked present`
        : `${data.full_name} — present${data.added_to_class ? ' (added to this class)' : ''}`);
  }

  async function typed(e) {
    e.preventDefault();
    unlockSound();
    const v = typedId;
    setTypedId('');
    await onScan(v);
  }

  if (classes.loading) return <div className="spinner" />;
  if (!classes.data?.length) {
    return (
      <section className="card">
        <h2>Attendance</h2>
        <p className="muted">{profile.role === 'admin' ? 'Create a class first under Classes.' : 'You have not been assigned a class yet. Please ask the admin.'}</p>
      </section>
    );
  }

  const counts = STATUSES.reduce((a, k) => ({ ...a, [k]: students.filter((s) => saved[s.id] === k).length }), {});
  const unmarked = students.filter((s) => !marks[s.id]).length;

  return (
    <>
      <section className="card">
        <h2>Take attendance</h2>
        <div className="filters">
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setScanning(false); }} aria-label="Class">
            {classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <button className={sound ? 'btn ghost' : 'btn ghost muted-btn'} onClick={toggleSound} aria-pressed={sound} title="Beep when a code is scanned">
            {sound ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
          <button className={scanning ? 'btn danger' : 'btn'} onClick={toggleScanner}>
            {scanning ? 'Stop scanner' : 'Scan cards'}
          </button>
        </div>
        {klass?.schedule && <p className="small muted">{klass.schedule}</p>}

        <form className="filters typed-id" onSubmit={typed}>
          <input value={typedId} onChange={(e) => setTypedId(e.target.value)} autoComplete="off" autoCapitalize="characters"
            placeholder="Type or scan ID (e.g. QC1070) and press Enter" aria-label="Student ID" />
          <button className="btn ghost" disabled={!typedId.trim()}>Mark present</button>
        </form>

        {(scanning || feed.length > 0) && (
          <div className={scanning ? 'scan-area' : ''}>
            {scanning && <QrScanner onScan={(t) => onScan(t)} />}
            <ul className="feed">
              {feed.map((f, i) => (
                <li key={f.at} className={`${f.kind === 'repeat' ? 'repeat' : f.ok ? 'ok' : 'bad'}${i === 0 ? ' latest' : ''}`}>
                  {f.ok ? '✓' : '✕'} {f.text}
                  {f.kind === 'noclass' && (
                    <button className="btn small add-class" onClick={() => {
                      setFeed((x) => x.filter((y) => y.at !== f.at));
                      onScan(f.value, true);
                    }}>Add to this class &amp; mark present</button>
                  )}
                </li>
              ))}
              {feed.length === 0 && <li className="muted">Point the camera at the QR code or barcode on the student's card.</li>}
            </ul>
          </div>
        )}

        <div className="stats compact">
          <div className="stat"><b>{students.length}</b><span>Students</span></div>
          <div className="stat"><b>{counts.present}</b><span>Present</span></div>
          <div className="stat"><b>{counts.late}</b><span>Late</span></div>
          <div className="stat"><b>{counts.absent}</b><span>Absent</span></div>
          <div className="stat"><b>{counts.excused}</b><span>Excused</span></div>
        </div>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>{formatDate(date)}</h2>
          {unmarked > 0 && (
            <div className="actions">
              <button className="btn small ghost" onClick={() => markRest('present')}>Mark rest present</button>
              <button className="btn small ghost" onClick={() => markRest('absent')}>Mark rest absent</button>
            </div>
          )}
        </div>
        {err && <p className="error">{err}</p>}
        {msg && <p className="success">{msg}</p>}
        {loading ? <div className="spinner" /> : students.length === 0 ? (
          <p className="muted">No enrolled students in this class yet.</p>
        ) : (
          <div className="att-list">
            {students.map((s) => {
              const st = marks[s.id];
              const wa = saved[s.id] === 'absent' && whatsappLink(s.whatsapp || s.guardian_phone,
                `Assalamu Alaikum ${s.guardian_name || ''}. ${s.full_name} was absent from Quran class (${klass?.name}) on ${formatDate(date)}. Please let us know if there is a reason. JazakAllahu khairan.`);
              return (
                <div key={s.id} className={`att-row ${st || ''}`}>
                  <div className="att-name">
                    <b>{s.full_name}</b>
                    <span className="small muted">{s.student_code}{st && st !== saved[s.id] && ' · unsaved'}</span>
                  </div>
                  <div className="att-buttons" role="group" aria-label={`Status for ${s.full_name}`}>
                    {STATUSES.map((k) => (
                      <button key={k} className={st === k ? `pill ${k} on` : `pill ${k}`} aria-pressed={st === k}
                        onClick={() => setMarks({ ...marks, [s.id]: k })}>
                        {STATUS_LABELS[k]}
                      </button>
                    ))}
                    {st && <button className="pill clear" title="Clear this mark" aria-label={`Clear mark for ${s.full_name}`} onClick={() => clearMark(s)}>✕</button>}
                    {wa && <a className="pill whatsapp" href={wa} target="_blank" rel="noreferrer" title="Notify guardian on WhatsApp">WhatsApp</a>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="sticky-save">
          <button className="btn" disabled={!dirty.length || busy} onClick={saveAll}>
            {busy ? 'Saving…' : dirty.length ? `Save ${dirty.length} change${dirty.length > 1 ? 's' : ''}` : 'All saved'}
          </button>
        </div>
      </section>
    </>
  );
}
