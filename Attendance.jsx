import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { today, formatDate, whatsappLink, STATUS_LABELS, classTag, lastClassDay, isClassDay, classDaysLabel } from './util.js';
import { getSettings, useSettings } from './settings.js';
import QrScanner from './QrScanner.jsx';
import { QR_PREFIX } from './StudentQR.jsx';
import { unlockSound, scanSound, scanVibrate } from './sound.js';
import { useHardwareScanner, normalizeScan, useKeyLog } from './scanner.js';

const STATUSES = ['present', 'late', 'absent', 'excused'];
const AUTO = 'auto'; // scan any card: class & group found automatically

export default function Attendance({ profile }) {
  const classes = useQuery(() => fetchMyClasses(profile, 'attendance'), [profile.id]);
  const [classId, setClassId] = useState('');
  const settings = useSettings();
  const [date, setDate] = useState(() => lastClassDay(getSettings().class_days));
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({});      // student_id -> status (unsaved edits included)
  const [saved, setSaved] = useState({});      // student_id -> status as stored
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [feed, setFeed] = useState([]);
  const [typedId, setTypedId] = useState('');
  const [autoRows, setAutoRows] = useState([]);
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('qc-scan-sound') !== 'off'; } catch { return true; } });        // recent scan results
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!classId && classes.data?.length) setClassId(AUTO);
  }, [classes.data, classId]);

  async function load() {
    if (!classId) return;
    if (classId === AUTO) {
      setLoading(true); setErr('');
      const ids = (classes.data || []).map((c) => c.id);
      const { data, error } = ids.length
        ? await supabase.from('attendance').select('student_id, class_id, status, marked_at, students(full_name, student_code)')
            .in('class_id', ids).eq('att_date', date).order('marked_at', { ascending: false })
        : { data: [] };
      if (error) setErr(error.message);
      setAutoRows(data || []);
      setStudents([]); setSaved({}); setMarks({});
      setLoading(false);
      return;
    }
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

  const auto = classId === AUTO;
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
      p_value: value, p_class: auto ? null : classId, p_date: date, p_add_to_class: addToClass,
    });
    if (error && auto && /mark_attendance_scan|null value|invalid input/.test(error.message)) {
      signal('error', 'Automatic class needs update-14.sql in Supabase. For now, choose the class first.');
      return;
    }
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
    if (data.added_to_class || auto) await load();
    setMarks((m) => ({ ...m, [data.student_id]: 'present' }));
    setSaved((m) => ({ ...m, [data.student_id]: 'present' }));
    const where = data.class_name ? ` · ${classTag({ name: data.class_name, group_name: data.group_name })}` : '';
    signal(already ? 'repeat' : 'ok',
      (already ? `${data.full_name} — already marked present`
        : `${data.full_name} — present${data.added_to_class ? ' (added to this class)' : ''}`) + where);
  }

  async function typed(e) {
    e.preventDefault();
    unlockSound();
    const v = normalizeScan(typedId);
    setTypedId('');
    await onScan(v);
  }

  const [test, setTest] = useState(false);
  const [keyLog, clearLog] = useKeyLog(test);
  const lastHw = useHardwareScanner((v) => { unlockSound(); setTypedId(''); onScan(v); }, { enabled: !!classId });
  if (classes.loading) return <div className="spinner" />;
  if (!classes.data?.length) {
    return (
      <section className="card">
        <h2>Attendance</h2>
        <p className="muted">{profile.role === 'admin' ? 'Create a class first under Classes.' : 'You have not been assigned a class yet. Please ask the admin.'}</p>
      </section>
    );
  }

  const counts = auto
    ? STATUSES.reduce((a, k) => ({ ...a, [k]: autoRows.filter((r) => r.status === k).length }), {})
    : STATUSES.reduce((a, k) => ({ ...a, [k]: students.filter((s) => saved[s.id] === k).length }), {});
  const unmarked = students.filter((s) => !marks[s.id]).length;

  return (
    <>
      <section className="card">
        <h2>Take attendance</h2>
        <div className="filters">
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setScanning(false); }} aria-label="Class">
            <option value={AUTO}>🔍 Automatic — any class (scan cards)</option>
            {classes.data.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}
          </select>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <button className={sound ? 'btn ghost' : 'btn ghost muted-btn'} onClick={toggleSound} aria-pressed={sound} title="Beep when a code is scanned">
            {sound ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
          <button className={scanning ? 'btn danger' : 'btn'} onClick={toggleScanner}>
            {scanning ? 'Stop scanner' : 'Scan cards'}
          </button>
        </div>
        {!isClassDay(date, settings.class_days) && <p className="notice-line small">⚠ {formatDate(date)} is not a class day (class is on {classDaysLabel(settings.class_days)}). <button className="link" onClick={() => setDate(lastClassDay(settings.class_days))}>Go to last class — {formatDate(lastClassDay(settings.class_days))}</button></p>}
        {auto ? <p className="small muted">Automatic mode: each scanned student is marked present in <b>their own class and group</b>.</p> : klass?.schedule && <p className="small muted">{klass.schedule}</p>}

        <div className="scanner-row">
          <p className="small scanner-ready"><span className="dot" /> USB / Bluetooth scanner ready — just scan a card's barcode (any keyboard language).{lastHw ? ` Last scan: ${lastHw.value} at ${new Date(lastHw.at).toLocaleTimeString('en-GB')}.` : ''}</p>
          <button type="button" className="btn ghost small" onClick={() => { setTest(!test); clearLog(); }}>{test ? 'Close test' : '🔧 Scanner test'}</button>
        </div>
        {test && <ScannerTest log={keyLog} last={lastHw} />}
        <form className="filters typed-id" onSubmit={typed}>
          <input data-scan="" value={typedId} onChange={(e) => setTypedId(e.target.value)} autoComplete="off" autoCapitalize="characters"
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
          <div className="stat"><b>{auto ? classes.data.length : students.length}</b><span>{auto ? 'Classes' : 'Students'}</span></div>
          <div className="stat"><b>{counts.present}</b><span>Present</span></div>
          <div className="stat"><b>{counts.late}</b><span>Late</span></div>
          <div className="stat"><b>{counts.absent}</b><span>Absent</span></div>
          <div className="stat"><b>{counts.excused}</b><span>Excused</span></div>
        </div>
      </section>

      {auto ? (
        <section className="card">
          <h2>{formatDate(date)} — scanned by class</h2>
          <p className="small muted">Scan any student card: the system finds their class and group by itself. To mark absent / late / excused, choose a class above.</p>
          {err && <p className="error">{err}</p>}
          {loading ? <div className="spinner" /> : (
            <div className="auto-classes">
              {classes.data.map((c) => {
                const rows = autoRows.filter((a) => a.class_id === c.id);
                const came = rows.filter((a) => a.status === 'present' || a.status === 'late');
                return (
                  <div key={c.id} className="auto-class">
                    <div className="row-between">
                      <div><b>{c.name}</b>{c.group_name && <span className="small muted"> · {classTag(c).slice(c.name.length + 3)}</span>}</div>
                      <span className="badge present">{came.length} present</span>
                    </div>
                    {came.length > 0 && (
                      <div className="small muted names">{came.map((a) => a.students?.full_name).filter(Boolean).join(', ')}</div>
                    )}
                    <button className="link small" onClick={() => setClassId(c.id)}>Open this class</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
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
      )}
    </>
  );
}

// Shows what the scanner sends, to find set-up problems quickly.
function ScannerTest({ log, last }) {
  const keys = log.filter((k) => k.key !== 'Shift');
  const text = keys.filter((k) => k.key.length === 1).map((k) => k.key).join('');
  const gaps = keys.slice(1).map((k) => k.gap).filter((g) => g > 0 && g < 1000);
  const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const enter = keys.some((k) => k.key === 'Enter');
  return (
    <div className="scanner-test">
      <p className="small"><b>Scan a printed card now.</b> Below you see exactly what the computer receives from the scanner.</p>
      {keys.length === 0 ? <p className="error small">Nothing received yet. If you scanned and nothing appears: the scanner is not in <b>USB keyboard (HID)</b> mode — see the steps below.</p> : (
        <dl className="details small">
          <dt>Received</dt><dd><code>{text || '—'}</code></dd>
          <dt>Speed</dt><dd>{avg != null ? `${avg} ms per character ${avg <= 60 ? '✓ scanner speed' : '— slower than a scanner (typed by hand?)'}` : '—'}</dd>
          <dt>Enter at the end</dt><dd>{enter ? '✓ yes' : 'no (that is fine)'}</dd>
          <dt>Read as</dt><dd>{last ? <b>{last.value}</b> : <span className="muted">not recognised as a scan yet</span>}</dd>
        </dl>
      )}
      <details className="small">
        <summary>Scanner set-up tips (Symbol / Zebra LS2208 and similar)</summary>
        <ol>
          <li>Scan the <b>barcode</b> (black lines) on a <b>printed</b> card. Laser scanners cannot read phone or computer screens, and cannot read the square QR code.</li>
          <li>Open Notepad and scan: you should see <code>QC1001</code>. If nothing appears, scan the <b>"USB Keyboard (HID)"</b> set-up barcode in the scanner's quick-start guide, then unplug and plug it in again.</li>
          <li>If Notepad shows strange letters, scan the <b>"North American / US English keyboard"</b> set-up barcode in the guide.</li>
          <li>Optional: scan the <b>"Add Enter key (CR suffix)"</b> set-up barcode so every scan ends with Enter.</li>
        </ol>
      </details>
    </div>
  );
}
