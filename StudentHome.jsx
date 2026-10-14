import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import StudentForm from './StudentForm.jsx';
import StudentQR from './StudentQR.jsx';
import { PrintCards, studentToCard, printCards, DigitalCard } from './IdCards.jsx';
import { ProgressList } from './Progress.jsx';
import { KIND_LABEL, GRADE_LABEL } from './progress.js';
import { formatDate, STATUS_LABELS } from './util.js';

const STATUS_TEXT = {
  pending: 'Your application has been received and is waiting for review. You will be contacted on WhatsApp once it is approved.',
  approved: 'Your admission is approved. Show the QR code below to your teacher at the start of each class.',
  rejected: 'Your application was not accepted this time. Please contact the class administration for details.',
  inactive: 'Your enrolment is currently inactive. Please contact the class administration.',
};

export default function StudentHome({ profile }) {
  const [student, setStudent] = useState(undefined);
  const [klass, setKlass] = useState(null);
  const [records, setRecords] = useState([]);
  const [progress, setProgress] = useState([]);
  const [showId, setShowId] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const { data, error } = await supabase.from('students').select('*').eq('profile_id', profile.id).maybeSingle();
    if (error) { setErr(error.message); return; }
    setStudent(data);
    if (data?.class_id) {
      const { data: c } = await supabase.from('classes').select('name, schedule, level, group_name').eq('id', data.class_id).maybeSingle();
      setKlass(c);
    } else setKlass(null);
    if (data) {
      const { data: a } = await supabase.from('attendance')
        .select('att_date, status, method').eq('student_id', data.id)
        .order('att_date', { ascending: false }).limit(60);
      setRecords(a || []);
      const { data: pr } = await supabase.from('student_progress').select('*').eq('student_id', data.id)
        .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(200);
      setProgress(pr || []);
      const { data: ph } = await supabase.from('card_photos').select('data').eq('student_id', data.id).maybeSingle();
      setPhoto(ph?.data || null);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply(values) {
    setBusy(true); setErr('');
    const { error } = student
      ? await supabase.from('students').update(values).eq('id', student.id)
      : await supabase.from('students').insert({ ...values, profile_id: profile.id });
    setBusy(false);
    if (error) setErr(error.message);
    else { setEditing(false); load(); }
  }

  if (student === undefined) return <div className="spinner" aria-label="Loading" />;

  if (!student || editing) {
    return (
      <section className="card">
        <h2>{student ? 'Edit application' : 'Admission application'}</h2>
        <p className="muted">Fill in the student's details. The class administration will review the application.</p>
        {err && <p className="error">{err}</p>}
        <StudentForm
          initial={student || { full_name: profile.full_name, guardian_phone: profile.phone, whatsapp: profile.phone, email: profile.email }}
          onSubmit={apply}
          busy={busy}
          submitLabel={student ? 'Save changes' : 'Submit application'}
        />
        {student && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
      </section>
    );
  }

  const counts = records.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const total = records.length;
  const attended = (counts.present || 0) + (counts.late || 0);

  return (
    <>
      <section className="card">
        <div className="row-between">
          <h2>{student.full_name}</h2>
          <span className={`badge ${student.status}`}>{student.status}</span>
        </div>
        <p>{STATUS_TEXT[student.status]}</p>
        <dl className="details">
          <dt>Student ID</dt><dd>{student.student_code}</dd>
          <dt>Class</dt><dd>{klass ? `${klass.name}${klass.schedule ? ' · ' + klass.schedule : ''}` : 'Not assigned yet'}</dd>
          <dt>Guardian</dt><dd>{student.guardian_name} · {student.guardian_phone}</dd>
          {student.email && <><dt>Email</dt><dd>{student.email}</dd></>}
          <dt>Applied</dt><dd>{formatDate(student.created_at)}</dd>
        </dl>
        {student.status === 'pending' && <button className="btn ghost" onClick={() => setEditing(true)}>Edit application</button>}
      </section>

      {student.status === 'approved' && (
        <section className="card center">
          <h2>My attendance QR code</h2>
          <p className="muted small">Save this to your phone or print it. Keep it private: it marks you present.</p>
          <StudentQR student={student} />
          <h3>My ID card</h3>
          <div className="card-preview"><PrintCards people={[studentToCard(student, klass, photo)]} withBack /></div>
          <p className="actions" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => setShowId(true)}>📱 Show digital ID</button>
            <button className="btn ghost" onClick={() => printCards('a4')}>Print my ID card</button>
          </p>
          {showId && <DigitalCard person={studentToCard(student, klass, photo)} onClose={() => setShowId(false)} />}
        </section>
      )}

      {student.status === 'approved' && (
        <section className="card">
          <h2>My progress</h2>
          {progress.length > 0 && (
            <div className="stats">
              <div className="stat"><b className="stat-text">{progress[0].lesson || KIND_LABEL[progress[0].kind]}</b><span>Latest lesson · {formatDate(progress[0].entry_date)}</span></div>
              <div className="stat"><b>{progress.length}</b><span>Lessons recorded</span></div>
              {progress[0].grade && <div className="stat"><b className="stat-text">{GRADE_LABEL[progress[0].grade]}</b><span>Latest grade</span></div>}
            </div>
          )}
          <ProgressList entries={progress} />
        </section>
      )}

      {student.status === 'approved' && (
        <section className="card">
          <h2>My attendance</h2>
          <div className="stats">
            <div className="stat"><b>{total ? Math.round((attended / total) * 100) : 0}%</b><span>Attendance</span></div>
            <div className="stat"><b>{counts.present || 0}</b><span>Present</span></div>
            <div className="stat"><b>{counts.late || 0}</b><span>Late</span></div>
            <div className="stat"><b>{counts.absent || 0}</b><span>Absent</span></div>
          </div>
          {records.length === 0 ? <p className="muted">No attendance recorded yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.att_date}><td>{formatDate(r.att_date)}</td><td><span className={`badge ${r.status}`}>{STATUS_LABELS[r.status]}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
