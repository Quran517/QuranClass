import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { fetchAllRows } from './data.js';
import { today, formatDate, lastClassDay, isClassDay, classDaysLabel, classDates } from './util.js';
import { getSettings, useSettings } from './settings.js';
import { downloadExcel } from './exports.js';
import { roleLabel } from './perms.js';
import { unlockSound, scanSound, scanVibrate } from './sound.js';
import QrScanner from './QrScanner.jsx';

const STATUSES = [['present', 'Present'], ['late', 'Late'], ['absent', 'Absent'], ['leave', 'Leave']];
const time = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

export default function StaffAttendance() {
  const settings = useSettings();
  const [date, setDate] = useState(() => lastClassDay(getSettings().class_days));
  const [staff, setStaff] = useState([]);
  const [rows, setRows] = useState({});     // profile_id -> saved row
  const [marks, setMarks] = useState({});   // profile_id -> status (incl. unsaved)
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState('');
  const [feed, setFeed] = useState([]);
  const [from, setFrom] = useState(() => classDates(getSettings().class_days, 8)[0] || today()); // last 8 class days
  const [to, setTo] = useState(today());

  async function load() {
    setLoading(true); setErr(''); setMsg('');
    const [{ data: st, error: e1 }, { data: at, error: e2 }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, staff_code, role, staff_title').in('role', ['teacher', 'admin']).order('full_name'),
      supabase.from('staff_attendance').select('*').eq('att_date', date),
    ]);
    const e = e1 || e2;
    if (e) setErr(/staff_attendance/.test(e.message) ? 'Staff attendance is not installed yet. Run update-11.sql in Supabase → SQL Editor.' : e.message);
    const byId = Object.fromEntries((at || []).map((r) => [r.profile_id, r]));
    setStaff(st || []);
    setRows(byId);
    setMarks(Object.fromEntries(Object.entries(byId).map(([k, r]) => [k, r.status])));
    setLoading(false);
  }

  useEffect(() => { load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = staff.filter((p) => marks[p.id] && marks[p.id] !== rows[p.id]?.status);

  async function saveAll() {
    setBusy(true); setErr(''); setMsg('');
    const { data: me } = await supabase.auth.getUser();
    const payload = dirty.map((p) => ({
      profile_id: p.id, att_date: date, status: marks[p.id], method: rows[p.id]?.method || 'manual',
      check_in: rows[p.id]?.check_in || (['present', 'late'].includes(marks[p.id]) ? new Date().toISOString() : null),
      marked_by: me?.user?.id, marked_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('staff_attendance').upsert(payload, { onConflict: 'profile_id,att_date' });
    setBusy(false);
    if (error) setErr(error.message);
    else { setMsg(`Saved ${payload.length} record${payload.length > 1 ? 's' : ''}.`); load(); }
  }

  async function clear(p) {
    if (rows[p.id]) {
      const { error } = await supabase.from('staff_attendance').delete().eq('id', rows[p.id].id);
      if (error) { setErr(error.message); return; }
    }
    load();
  }

  async function onScan(value) {
    const v = String(value || '').trim();
    if (!v) return;
    const { data, error } = await supabase.rpc('mark_staff_scan', { p_value: v, p_date: date });
    const kind = error ? 'error' : data.already ? 'repeat' : 'ok';
    scanSound(kind); scanVibrate(kind);
    setFeed((f) => [{ at: Date.now(), kind, text: error ? error.message : `${data.full_name} (${data.staff_code}) — ${data.already ? 'already present' : 'present'}` }, ...f].slice(0, 6));
    if (!error) load();
  }

  async function exportRange() {
    setErr('');
    try {
      const recs = await fetchAllRows(() => supabase.from('staff_attendance').select('*').gte('att_date', from).lte('att_date', to).order('att_date'));
      const name = Object.fromEntries(staff.map((p) => [p.id, p]));
      const summary = staff.map((p) => {
        const mine = recs.filter((r) => r.profile_id === p.id);
        const c = (s) => mine.filter((r) => r.status === s).length;
        const total = mine.length;
        return {
          'Staff ID': p.staff_code || '', Name: p.full_name || p.email, Role: roleLabel(p),
          Present: c('present'), Late: c('late'), Absent: c('absent'), Leave: c('leave'), Marked: total,
          'Attendance %': total ? Math.round(((c('present') + c('late')) / total) * 100) : '',
        };
      });
      const detail = recs.map((r) => ({
        Date: r.att_date, 'Staff ID': name[r.profile_id]?.staff_code || '', Name: name[r.profile_id]?.full_name || '',
        Status: r.status, 'Check-in': time(r.check_in), Method: r.method, Note: r.note || '',
      }));
      await downloadExcel(`staff-attendance-${from}-to-${to}.xlsx`, [{ name: 'Summary', rows: summary }, { name: 'All records', rows: detail }]);
    } catch (e) {
      setErr(e.message);
    }
  }

  const count = (s) => staff.filter((p) => rows[p.id]?.status === s).length;

  return (
    <>
      <section className="card">
        <h2>Staff attendance</h2>
        <div className="filters">
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <button className={scanning ? 'btn danger' : 'btn'} onClick={() => { unlockSound(); setScanning(!scanning); }}>{scanning ? 'Stop scanner' : 'Scan staff cards'}</button>
        </div>
        {!isClassDay(date, settings.class_days) && <p className="notice-line small">⚠ {formatDate(date)} is not a class day (class is on {classDaysLabel(settings.class_days)}). <button className="link" onClick={() => setDate(lastClassDay(settings.class_days))}>Go to last class — {formatDate(lastClassDay(settings.class_days))}</button></p>}
        <form className="filters typed-id" onSubmit={(e) => { e.preventDefault(); unlockSound(); onScan(typed); setTyped(''); }}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type or scan teacher ID (e.g. TC1002) and press Enter" aria-label="Staff ID" />
          <button className="btn ghost" disabled={!typed.trim()}>Mark present</button>
        </form>
        {(scanning || feed.length > 0) && (
          <div className={scanning ? 'scan-area' : ''}>
            {scanning && <QrScanner onScan={onScan} />}
            <ul className="feed">
              {feed.map((f, i) => <li key={f.at} className={`${f.kind === 'repeat' ? 'repeat' : f.kind === 'ok' ? 'ok' : 'bad'}${i === 0 ? ' latest' : ''}`}>{f.kind === 'error' ? '✕' : '✓'} {f.text}</li>)}
              {feed.length === 0 && <li className="muted">Scan the barcode on a teacher's ID card.</li>}
            </ul>
          </div>
        )}
        <div className="stats compact">
          <div className="stat"><b>{staff.length}</b><span>Staff</span></div>
          <div className="stat"><b>{count('present')}</b><span>Present</span></div>
          <div className="stat"><b>{count('late')}</b><span>Late</span></div>
          <div className="stat"><b>{count('absent')}</b><span>Absent</span></div>
          <div className="stat"><b>{count('leave')}</b><span>Leave</span></div>
        </div>
      </section>

      <section className="card">
        <h2>{formatDate(date)}</h2>
        {err && <p className="error">{err}</p>}
        {msg && <p className="success">{msg}</p>}
        {loading ? <div className="spinner" /> : (
          <div className="att-list">
            {staff.map((p) => {
              const st = marks[p.id];
              const r = rows[p.id];
              return (
                <div key={p.id} className={`att-row ${st === 'leave' ? 'excused' : st || ''}`}>
                  <div className="att-name">
                    <b>{p.full_name || p.email}</b>
                    <span className="small muted">
                      {p.staff_code} · {roleLabel(p)}
                      {r?.check_in && ` · in ${time(r.check_in)}`}
                      {r?.method === 'self' && ' (self check-in)'}
                      {st && st !== r?.status && ' · unsaved'}
                    </span>
                  </div>
                  <div className="att-buttons">
                    {STATUSES.map(([k, label]) => (
                      <button key={k} className={st === k ? `pill ${k === 'leave' ? 'excused' : k} on` : `pill ${k === 'leave' ? 'excused' : k}`}
                        aria-pressed={st === k} onClick={() => setMarks({ ...marks, [p.id]: k })}>{label}</button>
                    ))}
                    {st && <button className="pill clear" title="Clear" onClick={() => clear(p)}>✕</button>}
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

      <section className="card">
        <h2>Staff attendance report</h2>
        <div className="filters">
          <label className="inline">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inline">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn" onClick={exportRange}>Download Excel</button>
        </div>
        <p className="small muted">Summary per teacher (present, late, absent, leave, %) and every record with check-in times.</p>
      </section>
    </>
  );
}
