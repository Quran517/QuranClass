import { useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchClasses } from './data.js';
import { formatDate, whatsappLink } from './util.js';
import { downloadExcel } from './exports.js';
import StudentForm from './StudentForm.jsx';
import StudentQR from './StudentQR.jsx';
import Modal from './Modal.jsx';
import ImportStudents from './ImportStudents.jsx';

export default function Students() {
  const classes = useQuery(fetchClasses);
  const list = useQuery(() => supabase.from('students').select('*').neq('status', 'pending').order('full_name'));
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('');
  const [status, setStatus] = useState('approved');
  const [editing, setEditing] = useState(null); // student object or {} for new
  const [qr, setQr] = useState(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const classById = useMemo(() => Object.fromEntries((classes.data || []).map((c) => [c.id, c])), [classes.data]);

  const rows = (list.data || []).filter((s) =>
    (!status || s.status === status) &&
    (!cls || (cls === 'none' ? !s.class_id : s.class_id === cls)) &&
    (!q || `${s.full_name} ${s.student_code} ${s.admission_no || ''} ${s.guardian_name} ${s.guardian_phone} ${s.email || ''}`.toLowerCase().includes(q.toLowerCase()))
  );

  async function save(values, extra) {
    setBusy(true); setErr('');
    const payload = { ...values, class_id: extra.class_id || null, status: extra.status };
    const { error } = editing.id
      ? await supabase.from('students').update(payload).eq('id', editing.id)
      : await supabase.from('students').insert(payload);
    setBusy(false);
    if (error) setErr(error.message);
    else { setEditing(null); list.reload(); }
  }

  async function remove(s) {
    if (!window.confirm(`Delete ${s.full_name} and all of their attendance records? This cannot be undone.`)) return;
    const { error } = await supabase.from('students').delete().eq('id', s.id);
    if (error) setErr(error.message); else { setEditing(null); list.reload(); }
  }

  function exportList() {
    downloadExcel(`students-${new Date().toLocaleDateString('en-CA')}.xlsx`, [{
      name: 'Students',
      rows: rows.map((s) => ({
        'Student ID': s.student_code,
        'Admission No': s.admission_no || '',
        Name: s.full_name,
        Gender: s.gender || '',
        'Date of birth': s.date_of_birth || '',
        'School grade': s.school_grade || '',
        'Quran level': s.quran_level || '',
        Class: classById[s.class_id]?.name || '',
        Group: classById[s.class_id]?.group_name || '',
        Guardian: s.guardian_name || '',
        'Guardian phone': s.guardian_phone || '',
        WhatsApp: s.whatsapp || '',
        Email: s.email || '',
        Status: s.status,
        Approved: s.approved_at ? formatDate(s.approved_at) : '',
      })),
    }]);
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Students</h2>
        <div className="actions">
          <button className="btn ghost" onClick={exportList}>Export Excel</button>
          <button className="btn ghost" onClick={() => setImporting(true)}>Upload from Excel</button>
          <button className="btn" onClick={() => setEditing({ status: 'approved' })}>+ Add student</button>
        </div>
      </div>

      <div className="filters">
        <input placeholder="Search name, ID, admission no, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="">All classes</option>
          <option value="none">No class</option>
          {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="approved">Enrolled</option>
          <option value="inactive">Inactive</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      {(err || list.error) && <p className="error">{err || list.error}</p>}
      {list.loading ? <div className="spinner" /> : (
        <>
          <p className="muted small">{rows.length} student{rows.length === 1 ? '' : 's'}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Guardian</th><th></th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap">{s.student_code}{s.admission_no && <div className="small muted">Adm {s.admission_no}</div>}</td>
                    <td>{s.full_name}{s.status !== 'approved' && <> <span className={`badge ${s.status}`}>{s.status}</span></>}</td>
                    <td>{classById[s.class_id]?.name || <span className="muted">—</span>}{classById[s.class_id]?.group_name && <div className="small muted">{classById[s.class_id].group_name}</div>}</td>
                    <td className="small">{s.guardian_name}<br />{s.guardian_phone}{s.email && <><br /><a href={`mailto:${s.email}`}>{s.email}</a></>}</td>
                    <td className="nowrap">
                      <button className="btn small ghost" onClick={() => setQr(s)}>QR</button>{' '}
                      <button className="btn small ghost" onClick={() => setEditing(s)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <Modal title={editing.id ? `Edit ${editing.full_name}` : 'Add student'} onClose={() => setEditing(null)}>
          <AdminStudentForm
            student={editing}
            classes={classes.data || []}
            busy={busy}
            onSave={save}
            onDelete={editing.id ? () => remove(editing) : null}
          />
          {err && <p className="error">{err}</p>}
        </Modal>
      )}

      {importing && (
        <Modal title="Upload students from Excel" onClose={() => setImporting(false)}>
          <ImportStudents classes={classes.data || []} onDone={() => { list.reload(); }} />
        </Modal>
      )}

      {qr && (
        <Modal title="Attendance QR code" onClose={() => setQr(null)}>
          <div className="center">
            <StudentQR student={qr} />
            {qr.status === 'approved' && (() => {
              const link = whatsappLink(qr.whatsapp || qr.guardian_phone,
                `Assalamu Alaikum. ${qr.full_name}'s attendance QR code (Student ID ${qr.student_code}) is available after signing in to the Quran class portal: ${window.location.origin}`);
              return link && <p><a className="btn whatsapp ghost" href={link} target="_blank" rel="noreferrer">Tell guardian on WhatsApp</a></p>;
            })()}
            {!qr.profile_id && <p className="muted small">This student has no login. Download the QR and print it for them.</p>}
          </div>
        </Modal>
      )}
    </section>
  );
}

function AdminStudentForm({ student, classes, busy, onSave, onDelete }) {
  const [classId, setClassId] = useState(student.class_id || '');
  const [status, setStatus] = useState(student.status || 'approved');

  return (
    <>
      <StudentForm
        initial={student}
        busy={busy}
        requireConsent={false}
        submitLabel={student.id ? 'Save changes' : 'Add student'}
        onSubmit={(values) => onSave(values, { class_id: classId, status })}
        extra={
          <>
            <label>Class
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">No class</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="approved">Enrolled (approved)</option>
                <option value="pending">Pending</option>
                <option value="inactive">Inactive</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </>
        }
      />
      {onDelete && <p><button className="btn danger ghost small" onClick={onDelete}>Delete student</button></p>}
    </>
  );
}
