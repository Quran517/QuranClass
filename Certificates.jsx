import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { fetchMyClasses } from './data.js';
import { formatDate, classTag } from './util.js';
import { can } from './perms.js';
import { useSettings, logoOf } from './settings.js';
import { downloadExcel } from './exports.js';
import { CERT_STATUS, certificatePdf, certificateValues } from './results.js';
import { useSetup, StudentResults } from './Exams.jsx';
import Modal from './Modal.jsx';

const SELECT = '*, students(full_name, student_code, admission_no), classes(name, group_name)';

export function CertBadge({ status }) {
  const [label, cls] = CERT_STATUS[status] || [status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function Certificates({ profile }) {
  const { setup, err } = useSetup();
  const principal = can(profile, 'certificates');
  const [classes, setClasses] = useState(null);
  const [view, setView] = useState(principal ? 'review' : 'request');

  useEffect(() => {
    const area = can(profile, 'exams') ? 'exams' : principal ? 'certificates' : null;
    fetchMyClasses(profile, area).then(({ data }) => setClasses(data || []));
  }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <section className="card"><h2>Certificates</h2><p className="error">{err}</p></section>;
  if (!setup || !classes) return <div className="spinner" aria-label="Loading" />;
  const canRequest = can(profile, 'exams') || principal || classes.some((c) => c.teacher_id === profile.id);

  return (
    <>
      <div className="segmented page-tabs">
        {canRequest && <button className={view === 'request' ? 'active' : ''} onClick={() => setView('request')}>Request certificates</button>}
        {principal && <button className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>Principal review</button>}
        <button className={view === 'track' ? 'active' : ''} onClick={() => setView('track')}>All requests</button>
      </div>
      {view === 'request' && <RequestView setup={setup} classes={classes} />}
      {view === 'review' && principal && <ReviewView setup={setup} />}
      {view === 'track' && <TrackView setup={setup} classes={classes} />}
    </>
  );
}

// ---------------------------------------------------------------------
function RequestView({ setup, classes }) {
  const certTypes = setup.types.filter((t) => t.allow_certificate);
  const [f, setF] = useState({ year: setup.currentYear, exam_type: certTypes[0]?.code || '', class_id: classes[0]?.id || '' });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const templates = setup.templates.filter((t) => t.active);

  async function load() {
    if (!f.class_id || !f.exam_type) { setRows([]); return; }
    setRows(null); setErr('');
    const { data: st, error } = await supabase.from('students').select('id, full_name, student_code').eq('class_id', f.class_id).eq('status', 'approved').order('full_name');
    if (error) { setErr(error.message); setRows([]); return; }
    const ids = (st || []).map((s) => s.id);
    const [{ data: reqs }, eligs] = await Promise.all([
      ids.length ? supabase.from('certificate_requests').select('*').in('student_id', ids).eq('academic_year', f.year).eq('exam_type', f.exam_type) : { data: [] },
      Promise.all(ids.map((id) => supabase.rpc('certificate_eligibility', { p_student: id, p_year: f.year, p_type: f.exam_type }).then((r) => r.data))),
    ]);
    setRows((st || []).map((s, i) => ({ s, elig: eligs[i] || { eligible: false, reason: '—' }, reqs: (reqs || []).filter((r) => r.student_id === s.id) })));
  }
  useEffect(() => { load(); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitAll() {
    const todo = (rows || []).filter((r) => r.elig.eligible && !r.reqs.length);
    if (!todo.length || !window.confirm(`Submit ${templates[0]?.title || 'certificate'} requests for ${todo.length} eligible student(s)?`)) return;
    setBusy(true); setErr(''); setMsg('');
    const results = [];
    for (const r of todo) {
      const { error } = await supabase.rpc('cert_save', { p_student: r.s.id, p_year: f.year, p_type: f.exam_type, p_cert_type: templates[0].code, p_note: '', p_submit: true });
      if (error) results.push(`${r.s.full_name}: ${error.message}`);
    }
    setBusy(false);
    if (results.length) setErr(results.join(' · ')); else setMsg(`${todo.length} request(s) sent to the Principal.`);
    load();
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!certTypes.length) return <section className="card"><h2>Request certificates</h2><p className="muted">No exam type gives certificates. The admin can switch this on under Exams → Exam setup.</p></section>;

  return (
    <section className="card">
      <div className="row-between">
        <h2>Request certificates</h2>
        {rows?.some((r) => r.elig.eligible && !r.reqs.length) && <button className="btn" disabled={busy} onClick={submitAll}>{busy ? 'Sending…' : 'Request for all eligible'}</button>}
      </div>
      <p className="small muted">Only students whose <b>final results are finalized</b> and passed can be requested. The Principal approves each request; then it is issued with a certificate number.</p>
      <div className="filters">
        <select value={f.class_id} onChange={set('class_id')} aria-label="Class">{classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}</select>
        <select value={f.year} onChange={set('year')} aria-label="Academic year">{setup.years.map((y) => <option key={y.name} value={y.name}>{y.name}</option>)}</select>
        <select value={f.exam_type} onChange={set('exam_type')} aria-label="Exam type">{certTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
      </div>
      {err && <p className="error">{err}</p>}
      {msg && <p className="success">{msg}</p>}
      {rows === null ? <div className="spinner" /> : rows.length === 0 ? <p className="muted">No students in this class.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Student</th><th>Result</th><th>Certificate</th><th /></tr></thead>
            <tbody>
              {rows.map(({ s, elig, reqs }) => (
                <tr key={s.id}>
                  <td>{s.full_name}<div className="small muted">{s.student_code}</div></td>
                  <td>{elig.pct != null && <b>{elig.pct}% {elig.grade}</b>}<div className={`small ${elig.eligible ? 'ok-text' : 'muted'}`}>{elig.eligible ? '✓ Eligible' : elig.reason}</div></td>
                  <td>
                    {reqs.length === 0 ? <span className="muted small">No request</span> : reqs.map((r) => (
                      <div key={r.id} className="small">
                        {setup.templates.find((t) => t.code === r.certificate_type)?.name}: <CertBadge status={r.status} />
                        {r.certificate_no && <> · {r.certificate_no}</>}
                        {r.status === 'rejected' && <div className="error small">Reason: {r.rejection_reason}</div>}
                      </div>
                    ))}
                  </td>
                  <td className="nowrap">
                    {reqs.filter((r) => ['draft', 'rejected'].includes(r.status)).map((r) => (
                      <button key={r.id} className="btn small" onClick={() => setEditing({ s, req: r, elig })}>{r.status === 'rejected' ? 'Correct & resubmit' : 'Open draft'}</button>
                    ))}
                    {elig.eligible && <button className="btn ghost small" onClick={() => setEditing({ s, req: null, elig })}>+ Request</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RequestForm {...editing} year={f.year} examType={f.exam_type} templates={templates}
          onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); setMsg(m); load(); }} />
      )}
    </section>
  );
}

function RequestForm({ s, req, elig, year, examType, templates, onClose, onDone }) {
  const [type, setType] = useState(req?.certificate_type || templates[0]?.code || '');
  const [note, setNote] = useState(req?.teacher_note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save(submit) {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('cert_save', { p_student: s.id, p_year: year, p_type: examType, p_cert_type: type, p_note: note, p_submit: submit });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone(submit ? `Request for ${s.full_name} sent to the Principal.` : 'Draft saved.');
  }
  async function remove() {
    if (!window.confirm('Delete this request?')) return;
    const { error } = await supabase.rpc('cert_delete', { p_id: req.id });
    if (error) setErr(error.message); else onDone('Request deleted.');
  }
  return (
    <Modal title={`Certificate request — ${s.full_name}`} onClose={onClose}>
      <p className="small">{year} · Result <b>{elig.pct ?? '—'}% {elig.grade || ''}</b> · {elig.eligible ? <span className="ok-text">eligible</span> : <span className="error">{elig.reason}</span>}</p>
      {req?.status === 'rejected' && <p className="notice-line">Rejected by {req.reviewed_by_name} on {formatDate(req.reviewed_at)}: <b>{req.rejection_reason}</b>. Correct it and submit again.</p>}
      <div className="form-grid">
        <label className="span2">Certificate type
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={!!req}>{templates.map((t) => <option key={t.code} value={t.code}>{t.title}</option>)}</select>
        </label>
        <label className="span2">Note to the Principal<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="actions">
        <button className="btn" disabled={busy || !elig.eligible} onClick={() => save(true)}>{busy ? 'Sending…' : 'Submit for approval'}</button>
        <button className="btn ghost" disabled={busy} onClick={() => save(false)}>Save draft</button>
        {req && <button className="btn danger ghost" disabled={busy} onClick={remove}>Delete</button>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
function ReviewView({ setup }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('certificate_requests').select(SELECT)
      .in('status', ['submitted', 'pending_approval', 'approved']).order('submitted_at');
    if (error) setErr(error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function issue(list) {
    if (!window.confirm(`Issue ${list.length} certificate(s)? Each gets a unique certificate number and becomes visible to the student and parents.`)) return;
    setBusy(true); setErr(''); setMsg('');
    const bad = [];
    for (const r of list) {
      const { error } = await supabase.rpc('cert_issue', { p_id: r.id });
      if (error) bad.push(`${r.students?.full_name}: ${error.message}`);
    }
    setBusy(false);
    if (bad.length) setErr(bad.join(' · ')); else setMsg(`${list.length} certificate(s) issued.`);
    load();
  }

  const waiting = (rows || []).filter((r) => r.status !== 'approved');
  const approved = (rows || []).filter((r) => r.status === 'approved');
  const tname = (c) => setup.templates.find((t) => t.code === c)?.title || c;

  return (
    <section className="card">
      <h2>Principal review</h2>
      {err && <p className="error">{err}</p>}
      {msg && <p className="success">{msg}</p>}
      {rows === null ? <div className="spinner" /> : (
        <>
          <h3>Waiting for approval ({waiting.length})</h3>
          {waiting.length === 0 ? <p className="muted">Nothing to review. Alhamdulillah.</p> : (
            <ul className="req-list">
              {waiting.map((r) => (
                <li key={r.id} className="row-between">
                  <div>
                    <b>{r.students?.full_name}</b> <span className="small muted">{r.students?.student_code} · {r.classes?.name}</span>
                    <div className="small">{tname(r.certificate_type)} · {r.academic_year} · {r.result_pct}% {r.result_grade} · by {r.requested_by_name} · {formatDate(r.submitted_at)}</div>
                    {r.teacher_note && <div className="small muted">💬 {r.teacher_note}</div>}
                    {r.rejection_reason && <div className="small muted">Earlier rejected: {r.rejection_reason}</div>}
                  </div>
                  <div className="actions"><CertBadge status={r.status} /><button className="btn small" onClick={() => setOpen(r)}>Review</button></div>
                </li>
              ))}
            </ul>
          )}
          <div className="row-between">
            <h3>Approved — ready to issue ({approved.length})</h3>
            {approved.length > 1 && <button className="btn small" disabled={busy} onClick={() => issue(approved)}>Issue all</button>}
          </div>
          {approved.length === 0 ? <p className="muted">No approved certificates waiting.</p> : (
            <ul className="req-list">
              {approved.map((r) => (
                <li key={r.id} className="row-between">
                  <div><b>{r.students?.full_name}</b> <span className="small muted">{tname(r.certificate_type)} · {r.academic_year} · approved {formatDate(r.reviewed_at)}</span></div>
                  <button className="btn small" disabled={busy} onClick={() => issue([r])}>Issue</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {open && <ReviewModal req={open} setup={setup} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setMsg(m); load(); }} />}
    </section>
  );
}

function ReviewModal({ req, setup, onClose, onDone }) {
  const [elig, setElig] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.rpc('certificate_eligibility', { p_student: req.student_id, p_year: req.academic_year, p_type: req.exam_type }).then(({ data }) => setElig(data));
  }, [req.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(action) {
    if (action === 'reject' && comment.trim().length < 3) { setErr('Please write the reason for rejecting.'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('cert_review', { p_id: req.id, p_action: action, p_comment: comment });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone({ approve: `Approved — ${req.students?.full_name}. Issue it when ready.`, reject: 'Rejected. The teacher has been notified.', hold: 'Put on hold (pending approval).' }[action]);
  }
  const student = { id: req.student_id, full_name: req.students?.full_name, student_code: req.students?.student_code, admission_no: req.students?.admission_no };
  return (
    <Modal title={`Review — ${req.students?.full_name}`} onClose={onClose}>
      <p className="small">{setup.templates.find((t) => t.code === req.certificate_type)?.title} · {req.academic_year} · requested by {req.requested_by_name}</p>
      {elig && <p className={elig.eligible ? 'success' : 'error'}>{elig.eligible ? `Eligible — ${elig.pct}% (${elig.grade}) over ${elig.exams} exam(s).` : `Not eligible: ${elig.reason}`}</p>}
      {req.teacher_note && <p className="small">Teacher's note: {req.teacher_note}</p>}
      <h3>Results</h3>
      <StudentResults student={student} setup={setup} staff />
      <label>Comment (required when rejecting)
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      {err && <p className="error">{err}</p>}
      <div className="actions">
        <button className="btn" disabled={busy || (elig && !elig.eligible)} onClick={() => act('approve')}>Approve</button>
        <button className="btn danger ghost" disabled={busy} onClick={() => act('reject')}>Reject</button>
        {req.status === 'submitted' && <button className="btn ghost" disabled={busy} onClick={() => act('hold')}>Hold (pending)</button>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
function TrackView({ setup, classes }) {
  const [f, setF] = useState({ year: setup.currentYear, status: '', class_id: '' });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState(null);
  useEffect(() => {
    (async () => {
      setRows(null);
      let q = supabase.from('certificate_requests').select(SELECT).order('updated_at', { ascending: false });
      if (f.year) q = q.eq('academic_year', f.year);
      if (f.status) q = q.eq('status', f.status);
      if (f.class_id) q = q.eq('class_id', f.class_id);
      const { data, error } = await q;
      if (error) setErr(error.message);
      setRows(data || []);
    })();
  }, [f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tname = (c) => setup.templates.find((t) => t.code === c)?.name || c;
  return (
    <section className="card">
      <div className="row-between">
        <h2>All certificate requests</h2>
        {rows?.length > 0 && <button className="btn ghost small" onClick={() => downloadExcel(`certificates-${f.year || 'all'}.xlsx`, [{
          name: 'Certificates', rows: rows.map((r) => ({
            Student: r.students?.full_name, 'Student ID': r.students?.student_code, Class: r.classes?.name, Year: r.academic_year, Type: tname(r.certificate_type),
            Status: CERT_STATUS[r.status]?.[0], '%': r.result_pct, Grade: r.result_grade, 'Requested by': r.requested_by_name, Submitted: r.submitted_at ? formatDate(r.submitted_at) : '',
            'Reviewed by': r.reviewed_by_name || '', Reviewed: r.reviewed_at ? formatDate(r.reviewed_at) : '', 'Rejection reason': r.rejection_reason || '',
            'Certificate No': r.certificate_no || '', Issued: r.issued_at ? formatDate(r.issued_at) : '',
          })),
        }])}>Download Excel</button>}
      </div>
      <div className="filters">
        <select value={f.year} onChange={set('year')} aria-label="Academic year"><option value="">All years</option>{setup.years.map((y) => <option key={y.name} value={y.name}>{y.name}</option>)}</select>
        <select value={f.class_id} onChange={set('class_id')} aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}</select>
        <select value={f.status} onChange={set('status')} aria-label="Status"><option value="">Any status</option>{Object.entries(CERT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {err && <p className="error">{err}</p>}
      {rows === null ? <div className="spinner" /> : rows.length === 0 ? <p className="muted">No certificate requests.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Student</th><th>Certificate</th><th>Status</th><th className="hide-sm">Approval</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.students?.full_name}<div className="small muted">{r.students?.student_code} · {r.classes?.name}</div></td>
                  <td className="small">{tname(r.certificate_type)} · {r.academic_year}{r.certificate_no && <div><b>{r.certificate_no}</b></div>}</td>
                  <td><CertBadge status={r.status} />{r.status === 'rejected' && <div className="small error">{r.rejection_reason}</div>}</td>
                  <td className="small hide-sm">{r.reviewed_by_name ? `${r.reviewed_by_name} · ${formatDate(r.reviewed_at)}` : '—'}</td>
                  <td>{['approved', 'issued'].includes(r.status) && <button className="btn ghost small" onClick={() => setView(r)}>View</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view && (
        <Modal title={view.certificate_no || 'Certificate preview'} onClose={() => setView(null)}>
          <CertificateCard cert={view} student={view.students} className={view.classes?.name} setup={setup} />
        </Modal>
      )}
    </section>
  );
}

// On-screen certificate with Print / PDF (only issued ones get a number).
export function CertificateCard({ cert, student, className, setup }) {
  const settings = useSettings();
  const ctx = { student, className, types: setup.types, templates: setup.templates };
  const { t, v, body } = certificateValues(cert, ctx);
  return (
    <div>
      <div className="certificate">
        <img src={logoOf(settings)} alt="" className="cert-logo" />
        <div className="cert-school">{settings.school_name}</div>
        <div className="cert-title">{t.title}</div>
        <div className="small muted">This certificate is proudly presented to</div>
        <div className="cert-name">{v.student}</div>
        <p className="cert-body">{body}</p>
        <div className="cert-foot">
          <span>{t.signature_left}</span>
          <span className="center"><b>{cert.certificate_no || 'NOT ISSUED'}</b><br />{cert.issued_at ? formatDate(cert.issued_at) : 'Preview'}</span>
          <span>{t.signature_right}{cert.reviewed_by_name ? <><br /><small>Approved by {cert.reviewed_by_name}</small></> : null}</span>
        </div>
        {!cert.certificate_no && <div className="cert-watermark">PREVIEW</div>}
      </div>
      <div className="actions" style={{ justifyContent: 'center', marginTop: 10 }}>
        <button className="btn ghost small" onClick={() => certificatePdf(cert, ctx, true)}>🖨 Print</button>
        <button className="btn small" onClick={() => certificatePdf(cert, ctx)}>⬇ Download PDF</button>
      </div>
    </div>
  );
}
