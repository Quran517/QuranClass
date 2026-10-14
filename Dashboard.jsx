import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { fetchAllRows } from './data.js';
import { useSettings } from './settings.js';
import { today, formatDate, classDates } from './util.js';
import { can } from './perms.js';
import { useActivity } from './Activity.jsx';
import { HomeHero, Tile } from './HomeHero.jsx';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const attended = (s) => s === 'present' || s === 'late';

function TrendChart({ days, limit }) {
  // days: [{ date, pct, marked }]
  const W = 640, H = 170, pad = { l: 30, r: 8, t: 12, b: 26 };
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="Attendance percentage for the last 10 classes">
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
              <rect x={x} y={y(0) - 2} width={w} height="2" className="bar empty"><title>{`${label}: not marked`}</title></rect>
            )}
            {d.marked > 0 && bw > 34 && <text x={x + w / 2} y={y(d.pct) - 3} textAnchor="middle" className="val">{d.pct}</text>}
            {(i % 2 === 0 || bw > 50) && <text x={x + w / 2} y={H - 8} textAnchor="middle" className="axis">{label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

const safe = (p) => p.then((r) => (r.error ? null : r.data)).catch(() => null);

export default function Dashboard({ go, profile }) {
  const settings = useSettings();
  const [d, setD] = useState(null);
  const [updated, setUpdated] = useState(null);
  const activity = useActivity(8);

  async function load() {
    const count = (q) => q.then(({ count: c }) => c || 0);
    const cdays = settings.class_days;
    const trendDates = classDates(cdays, 10);   // last 10 class days
    const lowDates = classDates(cdays, 8);      // last 8 class days
    const since = trendDates[0] || today();
    const [pending, approved, unassigned, teachers, classes, students, att, pendingList, groups, exams, certs] = await Promise.all([
      count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'approved')),
      count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'approved').is('class_id', null)),
      count(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'teacher')),
      supabase.from('classes').select('*').order('name').then(({ data }) => data || []),
      fetchAllRows(() => supabase.from('students').select('id, full_name, student_code, class_id, gender').eq('status', 'approved')),
      fetchAllRows(() => supabase.from('attendance').select('student_id, class_id, att_date, status').gte('att_date', since)),
      safe(supabase.from('students').select('id, full_name, gender, date_of_birth, created_at').eq('status', 'pending').order('created_at').limit(5)),
      safe(supabase.from('class_groups').select('*').order('sort')),
      safe(supabase.from('exams').select('id, title, status, published_at, class_id, exam_date, academic_year').order('exam_date', { ascending: false }).limit(300)),
      safe(supabase.from('certificate_requests').select('id, status, certificate_type, academic_year, submitted_at, issued_at, students(full_name)').order('updated_at', { ascending: false }).limit(500)),
    ]);

    const dateSet = new Set([...trendDates, ...att.map((a) => a.att_date)]);
    const days = [...dateSet].sort().slice(-10).map((date) => {
      const rows = att.filter((a) => a.att_date === date);
      return { date, marked: rows.length, pct: pct(rows.filter((a) => attended(a.status)).length, rows.length) };
    });
    const t = [trendDates[trendDates.length - 1] || today(), ...att.map((a) => a.att_date)].sort().pop();
    const byClass = classes.map((c) => {
      const enrolled = students.filter((s) => s.class_id === c.id).length;
      const rows = att.filter((a) => a.class_id === c.id && a.att_date === t);
      return { ...c, enrolled, marked: rows.length, came: rows.filter((a) => attended(a.status)).length };
    });
    const lowSince = lowDates[0] || since;
    const recent = att.filter((a) => a.att_date >= lowSince);
    const per = {};
    for (const a of recent) {
      per[a.student_id] ||= { total: 0, came: 0 };
      per[a.student_id].total += 1;
      if (attended(a.status)) per[a.student_id].came += 1;
    }
    const low = students
      .map((s) => ({ ...s, ...(per[s.id] || { total: 0, came: 0 }) }))
      .filter((s) => s.total >= 3 && pct(s.came, s.total) < settings.low_attendance_pct)
      .map((s) => ({ ...s, p: pct(s.came, s.total) }))
      .sort((a, b) => a.p - b.p);
    const lastRows = att.filter((a) => a.att_date === t);

    const ex = exams || [];
    const examCounts = {
      draft: ex.filter((e) => e.status === 'draft').length,
      submitted: ex.filter((e) => e.status === 'submitted').length,
      finalized: ex.filter((e) => e.status === 'finalized' && !e.published_at).length,
      published: ex.filter((e) => e.published_at).length,
    };
    const cr = certs || [];
    const certCounts = Object.fromEntries(['draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'issued'].map((k) => [k, cr.filter((c) => c.status === k).length]));

    setD({
      pending, approved, unassigned, teachers, classes: classes.length, classList: classes, days, byClass, low,
      todayMarked: lastRows.length, todayCame: lastRows.filter((a) => attended(a.status)).length, lastDate: t,
      month: pct(recent.filter((a) => attended(a.status)).length, recent.length),
      boys: students.filter((s) => s.gender !== 'female').length, girls: students.filter((s) => s.gender === 'female').length,
      studentsByClass: Object.fromEntries(classes.map((c) => [c.id, students.filter((s) => s.class_id === c.id).length])),
      pendingList: pendingList || [], groups: groups || null,
      exams: exams ? { counts: examCounts, waiting: ex.filter((e) => e.status === 'submitted').slice(0, 5), recent: ex.filter((e) => e.published_at).slice(0, 3) } : null,
      certs: certs ? { counts: certCounts, waiting: cr.filter((c) => ['submitted', 'pending_approval'].includes(c.status)).slice(0, 5), approvedReady: certCounts.approved } : null,
    });
    setUpdated(new Date());
  }

  useEffect(() => {
    load();
    activity.reload();
    const id = setInterval(() => { load(); activity.reload(); }, 60000);
    return () => clearInterval(id);
  }, [settings.low_attendance_pct, (settings.class_days || []).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <div className="spinner" aria-label="Loading" />;

  const backupDue = !settings.last_backup_at || (Date.now() - new Date(settings.last_backup_at)) / 86400000 >= settings.backup_every_days;
  const examsAction = d.exams ? d.exams.counts.submitted + d.exams.counts.finalized : 0;
  const certsAction = d.certs ? d.certs.counts.submitted + d.certs.counts.pending_approval : 0;
  const name = (profile?.full_name || '').split(' ')[0];
  const showCerts = d.certs && (can(profile, 'certificates') || can(profile, 'exams') || profile?.role === 'admin');

  return (
    <div className="dash">
      <HomeHero name={name}
        chips={[<><span className="dot" /> Live · {updated?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>]}
        actions={<>
          <button className="btn" onClick={() => go('attendance')}>📷 Take attendance</button>
          {d.exams && <button className="btn light" onClick={() => go('exams')}>📝 Exams</button>}
          {d.pending > 0 && <button className="btn light" onClick={() => go('admissions')}>📥 {d.pending} new application{d.pending === 1 ? '' : 's'}</button>}
        </>} />

      <div className="kpis">
        <Tile icon="🎓" tone="navy" value={d.approved} label="Enrolled students" sub={`${d.boys} boys · ${d.girls} girls`} onClick={() => go('students')} />
        <Tile icon="✅" tone="green" value={d.todayMarked ? `${pct(d.todayCame, d.todayMarked)}%` : '—'} label="Last class attendance" sub={`${formatDate(d.lastDate)} · ${d.todayCame}/${d.todayMarked}`} onClick={() => go('attendance')} />
        <Tile icon="📈" tone="teal" value={`${d.month}%`} label="Last 8 classes" sub="attendance rate" onClick={() => go('reports')} />
        <Tile icon="📥" tone="orange" value={d.pending} label="Pending admissions" sub="waiting for approval" onClick={() => go('admissions')} attention={d.pending > 0} />
        {d.exams && <Tile icon="📝" tone="purple" value={examsAction} label="Exams to finalize / publish" sub={`${d.exams.counts.published} published`} onClick={() => go('exams')} attention={examsAction > 0} />}
        {showCerts && <Tile icon="🏅" tone="gold" value={certsAction} label="Certificates to approve" sub={`${d.certs.counts.issued} issued`} onClick={() => go('certificates')} attention={certsAction > 0} />}
        <Tile icon="🏫" tone="slate" value={d.classes} label="Classes" sub={`${d.teachers} teachers`} onClick={() => go('classes')} />
      </div>

      {(backupDue || d.unassigned > 0 || d.classes === 0) && (
        <section className="card notice">
          {d.classes === 0 && <p><b>Getting started:</b> create classes under <i>Classes</i>, create teacher logins under <i>Users</i>, then approve admissions.</p>}
          {d.unassigned > 0 && <p><b>{d.unassigned}</b> enrolled student{d.unassigned > 1 ? 's have' : ' has'} no class. <button className="link" onClick={() => go('classes')}>Auto-place in Classes</button></p>}
          {backupDue && <p><b>Backup due:</b> {settings.last_backup_at ? `last backup ${formatDate(settings.last_backup_at)}.` : 'no backup made yet.'} <button className="link" onClick={() => go('settings')}>Download one in Settings</button></p>}
        </section>
      )}

      <div className="dash-grid">
        <section className="card span-2">
          <div className="row-between"><h2>Attendance — last 10 classes</h2><button className="btn small ghost" onClick={() => go('reports')}>Reports</button></div>
          <TrendChart days={d.days} limit={settings.low_attendance_pct} />
          <p className="small muted"><span className="key navy" /> share of marked students who attended (present or late) <span className="key orange" /> below {settings.low_attendance_pct}%</p>
        </section>

        {d.exams && (
          <section className="card">
            <div className="row-between"><h2>📝 Exams</h2><button className="btn small ghost" onClick={() => go('exams')}>Open</button></div>
            <div className="pipeline">
              {[['draft', 'Draft'], ['submitted', 'Submitted'], ['finalized', 'Finalized'], ['published', 'Published']].map(([k, l], i) => (
                <div key={k} className={`pipe ${k}`}><b>{d.exams.counts[k]}</b><span>{l}</span>{i < 3 && <i aria-hidden="true">›</i>}</div>
              ))}
            </div>
            <h3 className="mini">Waiting to be finalized</h3>
            {d.exams.waiting.length === 0 ? <p className="small muted">Nothing waiting.</p> : (
              <ul className="mini-list">{d.exams.waiting.map((e) => <li key={e.id}><span>{e.title}</span><small>{d.classList.find((c) => c.id === e.class_id)?.name} · {formatDate(e.exam_date)}</small></li>)}</ul>
            )}
            {d.exams.recent.length > 0 && <><h3 className="mini">Recently published</h3><ul className="mini-list">{d.exams.recent.map((e) => <li key={e.id}><span>{e.title}</span><small>{formatDate(e.published_at)}</small></li>)}</ul></>}
          </section>
        )}

        {showCerts && (
          <section className="card">
            <div className="row-between"><h2>🏅 Certificate requests</h2><button className="btn small ghost" onClick={() => go('certificates')}>Open</button></div>
            <div className="pipeline">
              {[['submitted', 'Submitted'], ['pending_approval', 'Pending'], ['approved', 'Approved'], ['issued', 'Issued']].map(([k, l], i) => (
                <div key={k} className={`pipe ${k}`}><b>{d.certs.counts[k]}</b><span>{l}</span>{i < 3 && <i aria-hidden="true">›</i>}</div>
              ))}
            </div>
            {d.certs.counts.rejected > 0 && <p className="small"><span className="badge rejected">{d.certs.counts.rejected} rejected</span> waiting for the teacher to correct</p>}
            <h3 className="mini">Waiting for the Principal</h3>
            {d.certs.waiting.length === 0 ? <p className="small muted">No requests waiting.</p> : (
              <ul className="mini-list">{d.certs.waiting.map((c) => <li key={c.id}><span>{c.students?.full_name}</span><small>{c.academic_year} · {formatDate(c.submitted_at)}</small></li>)}</ul>
            )}
            {d.certs.approvedReady > 0 && <p className="small notice-line">{d.certs.approvedReady} approved certificate{d.certs.approvedReady === 1 ? ' is' : 's are'} ready to issue.</p>}
          </section>
        )}

        <section className="card">
          <div className="row-between"><h2>Last class by class</h2><span className="small muted">{formatDate(d.lastDate)}</span></div>
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

        {d.groups && d.groups.length > 0 && (
          <section className="card">
            <div className="row-between"><h2>Groups &amp; places</h2><button className="btn small ghost" onClick={() => go('classes')}>Classes</button></div>
            <ul className="group-cap">
              {d.groups.map((g) => {
                const cls = d.classList.filter((c) => c.group_id === g.id);
                const n = cls.reduce((a, c) => a + (d.studentsByClass[c.id] || 0), 0);
                const cap = cls.reduce((a, c) => a + (c.capacity || g.capacity), 0);
                return (
                  <li key={g.id}>
                    <div className="row-between"><b>{g.name}</b><span className="small">{n}{cap ? ` / ${cap}` : ''} students</span></div>
                    <div className="small muted">{g.label} · {cls.length} class{cls.length === 1 ? '' : 'es'}</div>
                    <div className="meter" aria-hidden="true"><span className={cap && n >= cap ? 'full' : ''} style={{ width: `${cap ? Math.min(100, Math.round((n / cap) * 100)) : 0}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {d.pendingList.length > 0 && (
          <section className="card">
            <div className="row-between"><h2>📥 New applications</h2><button className="btn small" onClick={() => go('admissions')}>Review</button></div>
            <ul className="mini-list">{d.pendingList.map((s) => <li key={s.id}><span>{s.full_name}</span><small>{s.gender === 'female' ? 'Girl' : s.gender === 'male' ? 'Boy' : ''} · applied {formatDate(s.created_at)}</small></li>)}</ul>
          </section>
        )}

        <section className="card">
          <h2>Low attendance <span className="small muted">below {settings.low_attendance_pct}% · last 8 classes</span></h2>
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

        <section className="card span-2">
          <div className="row-between"><h2>Recent activity</h2><button className="btn small ghost" onClick={() => go('activity')}>See all</button></div>
          {activity.error ? <p className="small muted">{activity.error}</p> : !activity.rows ? <div className="spinner" /> : activity.rows.length === 0 ? <p className="muted">Nothing yet.</p> : (
            <ul className="activity compact">
              {activity.rows.map((r) => (
                <li key={r.id} className="act">
                  <span className={`badge ${['added', 'issued', 'approved', 'publish'].includes(r.action) ? 'approved' : ['deleted', 'rejected', 'cancelled'].includes(r.action) ? 'rejected' : 'pending'}`}>{r.action}</span>
                  <div className="act-body"><div>{r.summary}</div><div className="small muted">{r.actor_name} · {new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
