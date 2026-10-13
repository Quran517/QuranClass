import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { whatsappLink } from './util.js';

export default function MyClasses({ profile, go }) {
  const classes = useQuery(() => fetchMyClasses(profile, 'myclasses'), [profile.id]);
  const students = useQuery(() =>
    supabase.from('students').select('id, full_name, student_code, class_id, guardian_name, guardian_phone, whatsapp, quran_level')
      .eq('status', 'approved').order('full_name'), [profile.id]);

  if (classes.loading || students.loading) return <div className="spinner" />;
  if (!classes.data.length) {
    return <section className="card"><h2>My classes</h2><p className="muted">You have not been assigned a class yet. Please ask the admin.</p></section>;
  }

  return (
    <>
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
    </>
  );
}
