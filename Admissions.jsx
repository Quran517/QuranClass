import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchClasses } from './data.js';
import { formatDate, whatsappLink } from './util.js';
import { getSettings } from './settings.js';
import StudentForm from './StudentForm.jsx';
import Modal from './Modal.jsx';

function approvalMessage(s, klass) {
  return (
    `Assalamu Alaikum ${s.guardian_name || ''},\n\n` +
    `We are pleased to confirm that ${s.full_name} has been admitted to the ${getSettings().school_name}.\n` +
    `Student ID: ${s.student_code}\n` +
    (klass ? `Class: ${klass.name}${klass.schedule ? ' (' + klass.schedule + ')' : ''}\n` : '') +
    `\nPlease sign in to the Quran class portal to view the attendance QR code.\n\nJazakAllahu khairan.`
  );
}

function rejectionMessage(s) {
  return (
    `Assalamu Alaikum ${s.guardian_name || ''},\n\n` +
    `Thank you for applying for ${s.full_name} to the ${getSettings().school_name}. ` +
    `Unfortunately we are unable to offer a place at this time. Please contact us for more details.\n\nJazakAllahu khairan.`
  );
}

export default function Admissions() {
  const [filter, setFilter] = useState('pending');
  const classes = useQuery(fetchClasses);
  const list = useQuery(
    () => supabase.from('students').select('*').eq('status', filter).order('created_at', { ascending: filter === 'pending' }),
    [filter]
  );
  const [choice, setChoice] = useState({});
  const [done, setDone] = useState({});
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  async function decide(s, status) {
    setErr('');
    const class_id = status === 'approved' ? choice[s.id] || s.class_id || null : s.class_id;
    if (status === 'approved' && !class_id && !window.confirm('No class selected. Approve without a class?')) return;
    const { error } = await supabase.from('students').update({ status, class_id }).eq('id', s.id);
    if (error) { setErr(error.message); return; }
    const klass = (classes.data || []).find((c) => c.id === class_id);
    setDone({ ...done, [s.id]: { status, link: whatsappLink(s.whatsapp || s.guardian_phone, status === 'approved' ? approvalMessage({ ...s }, klass) : rejectionMessage(s)) } });
  }

  async function saveEdit(values) {
    setBusy(true); setErr('');
    const { error } = await supabase.from('students').update(values).eq('id', editing.id);
    setBusy(false);
    if (error) setErr(error.message); else { setEditing(null); list.reload(); }
  }

  async function remove(s) {
    if (!window.confirm(`Delete the application for ${s.full_name}? This cannot be undone (but it is kept in the Activity log and your backups).`)) return;
    const { error } = await supabase.from('students').delete().eq('id', s.id);
    if (error) setErr(error.message); else list.reload();
  }

  const rows = list.data || [];

  return (
    <section className="card">
      <div className="row-between">
        <h2>Admissions</h2>
        <div className="segmented">
          {['pending', 'approved', 'rejected'].map((k) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => { setFilter(k); setDone({}); }}>{k}</button>
          ))}
        </div>
      </div>
      {(err || list.error) && <p className="error">{err || list.error}</p>}
      {list.loading ? <div className="spinner" /> : rows.length === 0 ? (
        <p className="muted">No {filter} applications.</p>
      ) : (
        <div className="list">
          {rows.map((s) => {
            const d = done[s.id];
            return (
              <div key={s.id} className="list-item">
                <div className="row-between">
                  <div>
                    <b>{s.full_name}</b> <span className="muted small">{s.student_code}</span>
                    <div className="small muted">
                      {s.gender && <span className="cap">{s.gender}</span>}
                      {s.date_of_birth && <> · born {formatDate(s.date_of_birth)}</>}
                      {s.school_grade && <> · {s.school_grade}</>}
                      {s.quran_level && <> · Quran: {s.quran_level}</>}
                    </div>
                    <div className="small">Guardian: {s.guardian_name} · {s.guardian_phone}{s.whatsapp && s.whatsapp !== s.guardian_phone ? ` · WA ${s.whatsapp}` : ''}</div>
                    {s.email && <div className="small">Email: <a href={`mailto:${s.email}`}>{s.email}</a></div>}
                    {s.notes && <div className="small muted">Notes: {s.notes}</div>}
                    <div className="small muted">Applied {formatDate(s.created_at)}</div>
                  </div>
                </div>

                {d ? (
                  <div className="decision">
                    <span className={`badge ${d.status}`}>{d.status}</span>
                    {d.link
                      ? <a className="btn whatsapp" href={d.link} target="_blank" rel="noreferrer">Send WhatsApp {d.status === 'approved' ? 'confirmation' : 'message'}</a>
                      : <span className="small muted">No phone number to message.</span>}
                  </div>
                ) : filter === 'pending' ? (
                  <div className="decision">
                    <select value={choice[s.id] || ''} onChange={(e) => setChoice({ ...choice, [s.id]: e.target.value })}>
                      <option value="">Assign class…</option>
                      {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button className="btn" onClick={() => decide(s, 'approved')}>Approve</button>
                    <button className="btn danger ghost" onClick={() => decide(s, 'rejected')}>Reject</button>
                    <button className="btn ghost small" onClick={() => setEditing(s)}>Edit</button>
                  </div>
                ) : filter === 'rejected' ? (
                  <div className="decision">
                    <button className="btn ghost" onClick={() => decide(s, 'pending')}>Move back to pending</button>
                    <button className="btn danger ghost small" onClick={() => remove(s)}>Delete</button>
                  </div>
                ) : (
                  <div className="decision">
                    {(() => {
                      const link = whatsappLink(s.whatsapp || s.guardian_phone, approvalMessage(s, (classes.data || []).find((c) => c.id === s.class_id)));
                      return link && <a className="btn whatsapp ghost" href={link} target="_blank" rel="noreferrer">Resend WhatsApp confirmation</a>;
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <Modal title={`Edit application: ${editing.full_name}`} onClose={() => setEditing(null)}>
          <StudentForm initial={editing} onSubmit={saveEdit} busy={busy} requireConsent={false} submitLabel="Save changes" />
          {err && <p className="error">{err}</p>}
          <p><button className="btn danger ghost small" onClick={() => { const s = editing; setEditing(null); remove(s); }}>Delete application</button></p>
        </Modal>
      )}
    </section>
  );
}
