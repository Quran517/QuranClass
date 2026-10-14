import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { formatDate, STATUS_LABELS, classTag } from './util.js';
import { KIND_LABEL, GRADE_LABEL } from './progress.js';
import { useSetup, StudentResults } from './Exams.jsx';
import { CertificateCard } from './Certificates.jsx';
import { ProgressList } from './Progress.jsx';
import { studentToCard, DigitalCard } from './IdCards.jsx';
import Modal from './Modal.jsx';

const SCORE = { excellent: 5, very_good: 4, good: 3, fair: 2, needs_work: 1 };

// Grade of each progress entry over time (read only).
export function ProgressChart({ entries }) {
  const pts = entries.filter((e) => e.grade).slice(0, 16).reverse();
  if (pts.length < 2) return null;
  const W = 640, H = 150, l = 86, r = 10, t = 10, b = 24;
  const x = (i) => l + (i * (W - l - r)) / (pts.length - 1);
  const y = (v) => t + ((5 - v) * (H - t - b)) / 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="Progress grades over time">
      {[5, 4, 3, 2, 1].map((v) => (
        <g key={v}>
          <line x1={l} x2={W - r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={l - 6} y={y(v) + 3} className="axis" textAnchor="end">{GRADE_LABEL[Object.keys(SCORE).find((k) => SCORE[k] === v)]}</text>
        </g>
      ))}
      <polyline fill="none" stroke="var(--navy)" strokeWidth="2.5" points={pts.map((p, i) => `${x(i)},${y(SCORE[p.grade])}`).join(' ')} />
      {pts.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(SCORE[p.grade])} r="4.5" fill={SCORE[p.grade] >= 3 ? 'var(--green)' : 'var(--orange)'}><title>{`${formatDate(p.entry_date)} · ${p.lesson || KIND_LABEL[p.kind]} · ${GRADE_LABEL[p.grade]}`}</title></circle>
          {(i === 0 || i === pts.length - 1 || pts.length <= 8) && <text x={x(i)} y={H - 6} className="axis" textAnchor="middle">{new Date(p.entry_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>}
        </g>
      ))}
    </svg>
  );
}

// Everything about one child — used by the parent portal (read only).
export function ChildDashboard({ student, setup }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [cert, setCert] = useState(null);
  const [showId, setShowId] = useState(false);

  useEffect(() => {
    setData(null); setTab('overview');
    (async () => {
      const [klass, att, prog, certs, res, photo] = await Promise.all([
        student.class_id ? supabase.from('classes').select('name, group_name, schedule').eq('id', student.class_id).maybeSingle().then((r) => r.data) : null,
        supabase.from('attendance').select('att_date, status').eq('student_id', student.id).order('att_date', { ascending: false }).limit(200).then((r) => r.data || []),
        supabase.from('student_progress').select('*').eq('student_id', student.id).order('entry_date', { ascending: false }).limit(300).then((r) => r.data || []),
        supabase.from('certificate_requests').select('*').eq('student_id', student.id).eq('status', 'issued').order('issued_at', { ascending: false }).then((r) => r.data || []),
        supabase.from('exam_results').select('pct, grade, passed, exam_date, title, published_at').eq('student_id', student.id).order('exam_date', { ascending: false }).limit(1).then((r) => r.data || []),
        supabase.from('card_photos').select('data').eq('student_id', student.id).maybeSingle().then((r) => r.data?.data || null),
      ]);
      setData({ klass, att, prog, certs, last: res[0], photo });
    })();
  }, [student.id]);

  if (!data) return <div className="spinner" />;
  const counts = data.att.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  const came = (counts.present || 0) + (counts.late || 0);
  const attPct = data.att.length ? Math.round((came * 100) / data.att.length) : null;
  const byKind = (k) => data.prog.filter((p) => p.kind === k);
  const lastOf = (k) => byKind(k)[0];
  const className = data.klass?.name || '';

  return (
    <>
      <section className="card">
        <div className="row-between">
          <div>
            <h2>{student.full_name}</h2>
            <p className="small muted">{student.student_code}{data.klass ? ` · ${classTag(data.klass)}` : ''}{data.klass?.schedule ? ` · ${data.klass.schedule}` : ''}</p>
          </div>
          {student.status === 'approved' && <button className="btn ghost small" onClick={() => setShowId(true)}>📱 Digital ID</button>}
        </div>
        <div className="segmented child-tabs">
          {[['overview', 'Overview'], ['results', 'Results'], ['progress', 'Quran progress'], ['attendance', 'Attendance'], ['certificates', `Certificates${data.certs.length ? ` (${data.certs.length})` : ''}`]].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <div className="stats">
              <div className="stat"><b>{attPct ?? '—'}{attPct != null ? '%' : ''}</b><span>Attendance ({came}/{data.att.length})</span></div>
              <div className="stat"><b>{data.last?.pct != null ? `${data.last.pct}%` : '—'}</b><span>Latest result{data.last ? ` · ${data.last.title}` : ''}</span></div>
              <div className="stat"><b className="stat-text">{lastOf('hifz')?.lesson || '—'}</b><span>Memorisation (Hifz)</span></div>
              <div className="stat"><b className="stat-text">{lastOf('revision')?.lesson || '—'}</b><span>Revision (Muraja'ah)</span></div>
              <div className="stat"><b className="stat-text">{lastOf('reading')?.lesson || lastOf('qaida')?.lesson || '—'}</b><span>Recitation</span></div>
              <div className="stat"><b>{data.prog.filter((p) => p.completed).length}</b><span>Lessons completed</span></div>
            </div>
            <h3>Progress over time</h3>
            {data.prog.filter((p) => p.grade).length >= 2 ? <ProgressChart entries={data.prog} /> : <p className="muted small">The chart appears after a few graded lessons.</p>}
            <h3>Latest teacher remarks</h3>
            <ProgressList entries={data.prog.filter((p) => p.comment).slice(0, 3)} />
          </>
        )}
        {tab === 'results' && <StudentResults student={student} setup={setup} />}
        {tab === 'progress' && (
          <>
            <ProgressChart entries={data.prog} />
            <ProgressList entries={data.prog} />
          </>
        )}
        {tab === 'attendance' && (
          data.att.length === 0 ? <p className="muted">No attendance recorded yet.</p> : (
            <>
              <div className="stats">
                <div className="stat"><b>{counts.present || 0}</b><span>Present</span></div>
                <div className="stat"><b>{counts.late || 0}</b><span>Late</span></div>
                <div className="stat"><b>{counts.absent || 0}</b><span>Absent</span></div>
                <div className="stat"><b>{counts.excused || 0}</b><span>Excused</span></div>
              </div>
              <div className="table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
                {data.att.map((r) => <tr key={r.att_date + r.status}><td>{formatDate(r.att_date)}</td><td><span className={`badge ${r.status}`}>{STATUS_LABELS[r.status]}</span></td></tr>)}
              </tbody></table></div>
            </>
          )
        )}
        {tab === 'certificates' && <CertificateList certs={data.certs} student={student} className={className} setup={setup} onOpen={setCert} />}
      </section>
      {cert && <Modal title={cert.certificate_no} onClose={() => setCert(null)}><CertificateCard cert={cert} student={student} className={className} setup={setup} /></Modal>}
      {showId && <DigitalCard person={studentToCard(student, data.klass, data.photo)} onClose={() => setShowId(false)} />}
    </>
  );
}

function CertificateList({ certs, setup, onOpen }) {
  if (!certs.length) return <p className="muted">No certificates yet. Certificates appear here after the Principal approves and issues them.</p>;
  return (
    <ul className="req-list">
      {certs.map((c) => (
        <li key={c.id} className="row-between">
          <div>
            <b>{setup.templates.find((t) => t.code === c.certificate_type)?.title || c.certificate_type}</b>
            <div className="small muted">{c.certificate_no} · {c.academic_year} · issued {formatDate(c.issued_at)}</div>
          </div>
          <button className="btn small" onClick={() => onOpen(c)}>View / download</button>
        </li>
      ))}
    </ul>
  );
}

// Student login → "Results & Certificates"
export function StudentResultsPage({ profile }) {
  const { setup, err } = useSetup();
  const [student, setStudent] = useState(undefined);
  const [certs, setCerts] = useState([]);
  const [klass, setKlass] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('students').select('*').eq('profile_id', profile.id).maybeSingle();
      setStudent(data || null);
      if (data) {
        const [{ data: c }, { data: k }] = await Promise.all([
          supabase.from('certificate_requests').select('*').eq('student_id', data.id).eq('status', 'issued').order('issued_at', { ascending: false }),
          data.class_id ? supabase.from('classes').select('name').eq('id', data.class_id).maybeSingle() : { data: null },
        ]);
        setCerts(c || []); setKlass(k);
      }
    })();
  }, [profile.id]);
  if (err) return <section className="card"><p className="error">{err}</p></section>;
  if (!setup || student === undefined) return <div className="spinner" />;
  if (!student) return <section className="card"><p className="muted">Your login is not linked to a student record yet. Please contact the class admin.</p></section>;
  return (
    <>
      <section className="card">
        <h2>My exam results &amp; report cards</h2>
        <StudentResults student={student} setup={setup} />
      </section>
      <section className="card">
        <h2>My certificates</h2>
        <CertificateList certs={certs} setup={setup} onOpen={setOpen} />
      </section>
      {open && <Modal title={open.certificate_no} onClose={() => setOpen(null)}><CertificateCard cert={open} student={student} className={klass?.name} setup={setup} /></Modal>}
    </>
  );
}

// Parent login → "My Children"
export function ParentHome({ profile }) {
  const { setup, err } = useSetup();
  const [links, setLinks] = useState(null);
  const [pick, setPick] = useState(null);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [lerr, setLerr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('parent_links').select('*, students(*)').eq('parent_id', profile.id).order('created_at');
    if (error) setLerr(/parent_links/.test(error.message) ? 'The parent portal is not installed yet. Please ask the admin to run update-18.sql.' : error.message);
    setLinks(data || []);
    const kids = (data || []).filter((l) => l.verified && l.students);
    if (kids.length && !kids.some((k) => k.student_id === pick)) setPick(kids[0].student_id);
  }
  useEffect(() => { load(); }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function request(e) {
    e.preventDefault();
    setBusy(true); setLerr(''); setMsg('');
    const { data, error } = await supabase.rpc('parent_request_link', { p_code: code, p_phone: phone });
    setBusy(false);
    if (error) setLerr(error.message);
    else { setMsg(`Request sent for ${data.student}. The admin will verify it — then the child appears here.`); setCode(''); setPhone(''); load(); }
  }

  if (err) return <section className="card"><p className="error">{err}</p></section>;
  if (!setup || links === null) return <div className="spinner" />;
  const kids = links.filter((l) => l.verified && l.students);
  const pending = links.filter((l) => !l.verified);
  const child = kids.find((k) => k.student_id === pick)?.students;

  return (
    <>
      <section className="card">
        <div className="row-between">
          <h2>My children</h2>
          <span className="small muted">Parent ID {profile.staff_code}</span>
        </div>
        {kids.length === 0 ? <p className="muted">No verified children yet. Link your child below — the admin verifies each link to keep children's records private.</p> : (
          <div className="child-switch" role="tablist" aria-label="Choose child">
            {kids.map((k) => (
              <button key={k.id} role="tab" aria-selected={k.student_id === pick} className={`child-chip ${k.student_id === pick ? 'active' : ''}`} onClick={() => setPick(k.student_id)}>
                <span className="avatar">{(k.students.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <span>{k.students.full_name}<small>{k.students.student_code}</small></span>
              </button>
            ))}
          </div>
        )}
        {pending.length > 0 && <p className="small notice-line">{pending.length} link request(s) waiting for the admin to verify.</p>}
        {lerr && <p className="error">{lerr}</p>}
      </section>

      {child && <ChildDashboard key={child.id} student={child} setup={setup} />}

      <section className="card">
        <h3>Link another child</h3>
        <p className="small muted">Enter your child's Student ID and the guardian phone number given on the admission form.</p>
        <form className="filters" onSubmit={request}>
          <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="Student ID e.g. QC1001" aria-label="Student ID" />
          <input required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Guardian phone" aria-label="Guardian phone" />
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Request link'}</button>
        </form>
        {msg && <p className="success">{msg}</p>}
      </section>
    </>
  );
}
