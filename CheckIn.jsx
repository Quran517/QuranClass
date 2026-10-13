import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { today } from './util.js';

const LABEL = { present: 'Present', late: 'Late', absent: 'Absent', leave: 'On leave' };

// Teacher's own check-in for today (shown on My Classes).
export default function CheckIn({ profile }) {
  const [row, setRow] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const { data, error } = await supabase.from('staff_attendance').select('status, check_in')
      .eq('profile_id', profile.id).eq('att_date', today()).maybeSingle();
    if (error) { setRow(null); if (!/staff_attendance/.test(error.message)) setErr(error.message); return; }
    setRow(data);
  }
  useEffect(() => { load(); }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkIn() {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('staff_check_in');
    setBusy(false);
    if (error) setErr(/staff_check_in/.test(error.message) ? 'Check-in is not installed yet (update-11.sql).' : error.message);
    else load();
  }

  if (row === undefined) return null;
  const t = row?.check_in && new Date(row.check_in).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <section className="card checkin">
      <div className="row-between">
        <div>
          <h2>My attendance today</h2>
          {row ? <p className="small"><span className={`badge ${row.status === 'leave' ? 'excused' : row.status}`}>{LABEL[row.status]}</span>{t && <> · checked in at <b>{t}</b></>}</p>
               : <p className="small muted">You have not checked in yet.</p>}
        </div>
        {!row && <button className="btn" disabled={busy} onClick={checkIn}>{busy ? 'Checking in…' : '✓ Check in now'}</button>}
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
