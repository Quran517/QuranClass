import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { whatsappLink, formatDate, classTag, lastClassDay } from './util.js';
import { useSettings } from './settings.js';
import CheckIn from './CheckIn.jsx';
import { HomeHero, Tile } from './HomeHero.jsx';

const safe = (p) => p.then((r) => (r.error ? null : r.data)).catch(() => null);

// Numbers for the teacher's own classes.
function useTeacherStats(profile, classIds) {
  const settings = useSettings();
  const [st, setSt] = useState(null);
  const key = classIds.join();
  useEffect(() => {
    if (!classIds.length) { setSt(null); return; }
    const day = lastClassDay(settings.class_days);
    (async () => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA');
      const [att, exams, certs, prog] = await Promise.all([
        safe(supabase.from('attendance').select('status, att_date').in('class_id', classIds).gte('att_date', day)),
        safe(supabase.from('exams').select('id, status').in('class_id', classIds)),
        safe(supabase.from('certificate_requests').select('status').eq('requested_by', profile.id)),
        safe(supabase.from('student_progress').select('id').eq('teacher_id', profile.id).gte('entry_date', weekAgo)),
      ]);
      const a = att || [];
      setSt({
        day, marked: a.length, came: a.filter((r) => r.status === 'present' || r.status === 'late').length,
        drafts: exams ? exams.filter((e) => e.status === 'draft').length : null,
        certsWaiting: certs ? certs.filter((c) => ['submitted', 'pending_approval'].includes(c.status)).length : null,
        certsRejected: certs ? certs.filter((c) => c.status === 'rejected').length : 0,
        progressWeek: prog ? prog.length : null,
      });
    })();
  }, [key, profile.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

export default function MyClasses({ profile, go }) {
  const classes = useQuery(() => fetchMyClasses(profile, 'myclasses'), [profile.id]);
  const students = useQuery(() =>
    supabase.from('students').select('id, full_name, student_code, class_id, guardian_name, guardian_phone, whatsapp, quran_level')
      .eq('status', 'approved').order('full_name'), [profile.id]);

  const ids = (classes.data || []).map((c) => c.id);
  const st = useTeacherStats(profile, ids);
  if (classes.loading || students.loading) return <div className="spinner" />;
  const first = (profile.full_name || '').split(' ')[0];
  const hero = (
    <HomeHero name={first} subtitle={classes.data.length ? `My class${classes.data.length > 1 ? 'es' : ''}: ${classes.data.map((c) => classTag(c)).join(' · ')}` : 'No class assigned yet'}
      actions={<>
        <button className="btn" onClick={() => go('attendance')}>📷 Take attendance</button>
        <button className="btn light" onClick={() => go('progress')}>📖 Record progress</button>
        <button className="btn light" onClick={() => go('exams')}>📝 Exams</button>
      </>} />
  );
  if (!classes.data.length) {
    return <div className="dash">{hero}<CheckIn profile={profile} /><section className="card"><h2>My classes</h2><p className="muted">You have not been assigned a class yet. Please ask the admin.</p></section></div>;
  }
  const mine = students.data.filter((s) => ids.includes(s.class_id));

  return (
    <div className="dash">
      {hero}
      <div className="kpis">
        <Tile icon="🎓" tone="navy" value={mine.length} label="My students" sub={`${classes.data.length} class${classes.data.length === 1 ? '' : 'es'}`} />
        <Tile icon="✅" tone="green" value={st?.marked ? `${Math.round((st.came * 100) / st.marked)}%` : '—'} label="Last class attendance" sub={st ? `${formatDate(st.day)} · ${st.came}/${st.marked}` : ''} onClick={() => go('attendance')} />
        {st?.progressWeek != null && <Tile icon="📖" tone="teal" value={st.progressWeek} label="Progress notes" sub="this week" onClick={() => go('progress')} />}
        {st?.drafts != null && <Tile icon="📝" tone="purple" value={st.drafts} label="Exams in draft" sub="enter marks & submit" onClick={() => go('exams')} attention={st.drafts > 0} />}
        {st?.certsWaiting != null && <Tile icon="🏅" tone="gold" value={st.certsWaiting} label="My certificate requests" sub={st.certsRejected ? `${st.certsRejected} rejected — please correct` : 'waiting for the Principal'} onClick={() => go('certificates')} attention={st.certsRejected > 0} />}
      </div>
      <CheckIn profile={profile} />
      {classes.data.map((c) => {
        const list = students.data.filter((s) => s.class_id === c.id);
        return (
          <section key={c.id} className="card">
            <div className="row-between">
              <div>
                <h2>{c.name}</h2>
                <div className="small muted">{[c.level, c.schedule].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn" onClick={() => go('attendance')}>Take attendance</button>
            </div>
            <p className="small muted">{list.length} student{list.length === 1 ? '' : 's'}</p>
            {list.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Quran level</th><th>Guardian</th></tr></thead>
                  <tbody>
                    {list.map((s) => {
                      const wa = whatsappLink(s.whatsapp || s.guardian_phone, `Assalamu Alaikum ${s.guardian_name || ''}, regarding ${s.full_name}:`);
                      return (
                        <tr key={s.id}>
                          <td>{s.full_name}<div className="small muted">{s.student_code}</div></td>
                          <td className="small">{s.quran_level || '—'}</td>
                          <td className="small">{s.guardian_name}<br />{s.guardian_phone}{wa && <> · <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a></>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
