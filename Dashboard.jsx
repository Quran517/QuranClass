import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { today } from './util.js';

export default function Dashboard({ go }) {
  const [s, setS] = useState(null);

  useEffect(() => {
    (async () => {
      const count = (q) => q.then(({ count }) => count || 0);
      const [pending, approved, classes, teachers, todayRows] = await Promise.all([
        count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
        count(supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'approved')),
        count(supabase.from('classes').select('id', { count: 'exact', head: true })),
        count(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'teacher')),
        supabase.from('attendance').select('status').eq('att_date', today()).then(({ data }) => data || []),
      ]);
      const present = todayRows.filter((r) => r.status === 'present' || r.status === 'late').length;
      setS({ pending, approved, classes, teachers, marked: todayRows.length, present });
    })();
  }, []);

  if (!s) return <div className="spinner" aria-label="Loading" />;

  return (
    <>
      <section className="card hero">
        <h2>Assalamu Alaikum</h2>
        <p className="muted">Overview of the Quran class today.</p>
        <div className="stats">
          <button className="stat clickable" onClick={() => go('admissions')}><b>{s.pending}</b><span>Pending admissions</span></button>
          <button className="stat clickable" onClick={() => go('students')}><b>{s.approved}</b><span>Enrolled students</span></button>
          <button className="stat clickable" onClick={() => go('classes')}><b>{s.classes}</b><span>Classes</span></button>
          <button className="stat clickable" onClick={() => go('users')}><b>{s.teachers}</b><span>Teachers</span></button>
        </div>
      </section>
      <section className="card">
        <h2>Today's attendance</h2>
        {s.marked === 0 ? <p className="muted">No attendance has been marked today.</p> : (
          <p><b>{s.present}</b> of <b>{s.marked}</b> marked students attended today.</p>
        )}
        <button className="btn" onClick={() => go('attendance')}>Take attendance</button>{' '}
        <button className="btn ghost" onClick={() => go('reports')}>View reports</button>
      </section>
      {s.classes === 0 && (
        <section className="card notice">
          <b>Getting started:</b> 1) Create classes under <i>Classes</i>. 2) Create teacher logins under <i>Users</i>.
          3) Approve applications under <i>Admissions</i> and assign each student a class.
        </section>
      )}
    </>
  );
}
