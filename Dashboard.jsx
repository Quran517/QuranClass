import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { fetchAllRows } from './data.js';
import { useSettings } from './settings.js';
import { today, daysAgo, formatDate } from './util.js';
import { useActivity } from './Activity.jsx';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const attended = (s) => s === 'present' || s === 'late';

function TrendChart({ days, limit }) {
  // days: [{ date, pct, marked }]
  const W = 640, H = 170, pad = { l: 30, r: 8, t: 12, b: 26 };
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="Attendance percentage for the last 14 days">
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="grid" />
          <text x={pad.l - 4} y={y(g) + 3} className="axis" textAnchor="end">{g}%</text>
        </g>
      ))}
      {days.map((d, i) => {
        const x = pad.l + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const label = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        return (
          <g key={d.date}>
            {d.marked > 0 ? (
              <rect x={x} y={y(d.pct)} width={w} height={y(0) - y(d.pct)} rx="3" className={d.pct < limit ? 'bar low' : 'bar'}>
                <title>{`${label}: ${d.pct}% (${d.marked} marked)`}</title>
              </rect>
            ) : (
              <rect x={x} y={y(0) - 2} width={w} height="2" className="bar empty"><title>{`${label}: no class`}</title></rect>
            )}
            {d.marked > 0 && bw > 34 && <text x={x + w / 2} y={y(d.pct) - 3} textAnchor="middle" className="val">{d.pct}</text>}
            {(i % 2 === 0 || bw > 50) && <text x={x + w / 2} y={H - 8} textAnchor="middle" className="axis">{label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard({ go }) {
  const settings = useSettings();
  const [d, setD] = useState(null);
  const [updated, setUpdated] = useState(null);
  const activity = useActivity(8);

  async function load() {
    const count = (q) => q.then(({ count: c }) => c || 0);
    const since = daysAgo(29);
    const [pending, approved, unassigned, teachers, classes, students, att] = await Promise.all([
      count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'approved')),
      count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'approved').is('class_id', null)),
      count(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'teacher')),
      supabase.from('classes').select('id, name').order('name').then(({ data }) => data || []),
      fetchAllRows(() => supabase.from('students').select('id, full_name, student_code, class_id, guardian_phone, whatsapp').eq('status', 'approved')),
      fetchAllRows(() => supabase.from('attendance').select('student_id, class_id, att_date, status').gte('att_date', since)),
    ]);

    // last 14 days trend
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const date = daysAgo(i);
      const rows = att.filter((a) => a.att_date === date);
      days.push({ date, marked: rows.length, pct: pct(rows.filter((a) => attended(a.status)).length, rows.length) });
    }

    // today by class
    const t = today();
    const byClass = classes.map((c) => {
      const enrolled = students.filter((s) => s.class_id === c.id).length;
      const rows = att.filter((a) => a.class_id === c.id && a.att_date === t);
      return { ...c, enrolled, marked: rows.length, came: rows.filter((a) => attended(a.status)).length };
    });

    // low attendance over the last 30 days (at least 3 sessions marked)
    const per = {};
    for (const a of att) {
      per[a.student_id] ||= { total: 0, came: 0 };
      per[a.student_id].total += 1;
      if (attended(a.status)) per[a.student_id].came += 1;
    }
    const low = students
      .map((s) => ({ ...s, ...(per[s.id] || { total: 0, came: 0 }) }))
      .filter((s) => s.total >= 3 && pct(s.came, s.total) < settings.low_attendance_pct)
      .map((s) => ({ ...s, p: pct(s.came, s.total) }))
      .sort((a, b) => a.p - b.p);

    const todayRows = att.filter((a) => a.att_date === t);
    setD({
      pending, approved, unassigned, teachers, classes: classes.length, days, byClass, low,
      todayMarked: todayRows.length, todayCame: todayRows.filter((a) => attended(a.status)).length,
      month: pct(att.filter((a) => attended(a.status)).length, att.length),
    });
    setUpdated(new Date());
  }

  useEffect(() => {
    load();
    activity.reload();
    const id = setInterval(() => { load(); activity.reload(); }, 60000);
    return () => clearInterval(id);
  }, [settings.low_attendance_pct]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <div className="spinner" aria-label="Loading" />;

  const backupDue = !settings.last_backup_at || (Date.now() - new Date(settings.last_backup_at)) / 86400000 >= settings.backup_every_days;

  return (
    <>
      <section className="card hero">
        <div className="row-between">
          <div>
            <h2>Assalamu Alaikum</h2>
            <p className="muted small">{settings.school_name} · {settings.academic_year}</p>
          </div>
          <span className="small muted live"><span className="dot" /> Live · updated {updated?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="stats">
          <button className="stat clickable" onClick={() => go('attendance')}>
            <b>{d.todayMarked ? pct(d.todayCame, d.todayMarked) + '%' : '—'}</b><span>Today ({d.todayCame}/{d.todayMarked} marked)</span>
          </button>
          <button className="stat clickable" onClick={() => go('reports')}><b>{d.month}%</b><span>Last 30 days</span></button>
          <button className={`stat clickable ${d.pending ? 'attention' : ''}`} onClick={() => go('admissions')}><b>{d.pending}</b><span>Pending admissions</span></button>
          <button className="stat clickable" onClick={() => go('students')}><b>{d.approved}</b><span>Enrolled students</span></button>
          <button className="stat clickable" onClick={() => go('classes')}><b>{d.classes}</b><span>Classes</span></button>
          <button className="stat clickable" onClick={() => go('users')}><b>{d.teachers}</b><span>Teachers</span></button>
        </div>
      </section>

      {(backupDue || d.unassigned > 0 || d.classes === 0) && (
        <section className="card notice">
          {d.classes === 0 && <p><b>Getting started:</b> create classes under <i>Classes</i>, create teacher logins under <i>Users</i>, then approve admissions.</p>}
          {d.unassigned > 0 && <p><b>{d.unassigned}</b> enrolled student{d.unassigned > 1 ? 's have' : ' has'} no class. <button className="link" onClick={() => go('classes')}>Assign in Classes</button></p>}
          {backupDue && <p><b>Backup due:</b> {settings.last_backup_at ? `last backup ${formatDate(settings.last_backup_at)}.` : 'no backup made yet.'} <button className="link" onClick={() => go('settings')}>Download one in Settings</button></p>}
        </section>
      )}

      <section className="card">
        <h2>Attendance — last 14 days</h2>
        <TrendChart days={d.days} limit={settings.low_attendance_pct} />
        <p className="small muted">Bars show the share of marked students who attended (present or late). Orange = below {settings.low_attendance_pct}%.</p>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="row-between"><h2>Today by class</h2><button className="btn small" onClick={() => go('attendance')}>Take attendance</button></div>
          {d.byClass.length === 0 ? <p className="muted">No classes yet.</p> : (
            <ul className="class-today">
              {d.byClass.map((c) => (
                <li key={c.id}>
                  <div className="row-between"><b>{c.name}</b><span className="small">{c.marked ? `${c.came}/${c.marked}` : <span className="muted">not marked</span>}</span></div>
                  <div className="meter" aria-hidden="true"><span style={{ width: `${c.enrolled ? Math.round((c.came / c.enrolled) * 100) : 0}%` }} /></div>
                  <div className="small muted">{c.enrolled} enrolled</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Low attendance <span className="small muted">below {settings.low_attendance_pct}% · 30 days</span></h2>
          {d.low.length === 0 ? <p className="muted">No students below the limit. Alhamdulillah.</p> : (
            <ul className="low-list">
              {d.low.slice(0, 8).map((s) => (
                <li key={s.id} className="row-between">
                  <span>{s.full_name} <span className="small muted">{s.student_code}</span></span>
                  <b className="low">{s.p}%</b>
                </li>
              ))}
              {d.low.length > 8 && <li className="small muted">and {d.low.length - 8} more — see Reports.</li>}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="row-between"><h2>Recent activity</h2><button className="btn small ghost" onClick={() => go('activity')}>See all</button></div>
        {activity.error ? <p className="small muted">{activity.error}</p> : !activity.rows ? <div className="spinner" /> : activity.rows.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="activity compact">
            {activity.rows.map((r) => (
              <li key={r.id} className="act">
                <span className={`badge ${r.action === 'added' ? 'approved' : r.action === 'deleted' ? 'rejected' : 'pending'}`}>{r.action}</span>
                <div className="act-body"><div>{r.summary}</div><div className="small muted">{r.actor_name} · {new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
