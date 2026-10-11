import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { useSettings } from './settings.js';
import { QR_PREFIX } from './StudentQR.jsx';

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function useQrImages(items) {
  const [imgs, setImgs] = useState({});
  const key = items.map((i) => i.qr).join('|');
  useEffect(() => {
    let alive = true;
    Promise.all(items.map((i) =>
      QRCode.toDataURL(i.qr, { width: 220, margin: 0, color: { dark: '#092F6B' } }).then((u) => [i.id, u]).catch(() => [i.id, ''])
    )).then((pairs) => alive && setImgs(Object.fromEntries(pairs)));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return imgs;
}

export function IdCard({ person, qrSrc, settings, back }) {
  if (back) {
    return (
      <div className="idcard back">
        <div className="idcard-band small-band">{settings.school_name}</div>
        <div className="idcard-back-body">
          <p>{settings.card_note}</p>
          {settings.address && <p>{settings.address}</p>}
          {(settings.contact_phone || settings.contact_whatsapp) && <p>☎ {settings.contact_phone || settings.contact_whatsapp}</p>}
          {settings.contact_email && <p>{settings.contact_email}</p>}
          {person.kind === 'student' && person.guardian && <p className="emergency">Emergency: {person.guardian}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className={`idcard ${person.kind}`}>
      <div className="idcard-band">
        <span className="idcard-logo">۞</span>
        <div>
          <div className="idcard-school">{settings.school_name}</div>
          <div className="idcard-year">{person.kind === 'teacher' ? 'STAFF' : 'STUDENT'} · {settings.academic_year}</div>
        </div>
      </div>
      <div className="idcard-body">
        <div className="idcard-photo" aria-label="Photo">
          <span>{initials(person.name)}</span>
          <small>photo</small>
        </div>
        <div className="idcard-info">
          <div className="idcard-name">{person.name}</div>
          <div className="idcard-id">{person.code}</div>
          {person.line1 && <div className="idcard-line">{person.line1}</div>}
          {person.line2 && <div className="idcard-line">{person.line2}</div>}
        </div>
        {qrSrc && <img className="idcard-qr" src={qrSrc} alt="" />}
      </div>
    </div>
  );
}

export function printCards() {
  document.body.classList.add('printing-cards');
  const done = () => { document.body.classList.remove('printing-cards'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

export function PrintCards({ people, withBack }) {
  const settings = useSettings();
  const imgs = useQrImages(people);
  return (
    <div className="print-area">
      <div className="card-sheet">
        {people.map((p) => (
          <div key={p.id} className="card-pair">
            <IdCard person={p} qrSrc={imgs[p.id]} settings={settings} />
            {withBack && <IdCard person={p} settings={settings} back />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function studentToCard(s, className) {
  return {
    id: s.id, kind: 'student', name: s.full_name, code: s.student_code,
    line1: className ? `Class: ${className}` : '', line2: s.quran_level ? `Level: ${s.quran_level}` : '',
    guardian: [s.guardian_name, s.guardian_phone].filter(Boolean).join(' · '),
    qr: QR_PREFIX + s.qr_token,
  };
}

export default function IdCards({ profile }) {
  const isAdmin = profile.role === 'admin';
  const classes = useQuery(() => fetchMyClasses(profile), [profile.id]);
  const students = useQuery(() =>
    supabase.from('students').select('id, full_name, student_code, class_id, quran_level, guardian_name, guardian_phone, qr_token')
      .eq('status', 'approved').order('full_name'), [profile.id]);
  const staff = useQuery(() =>
    supabase.from('profiles').select('id, full_name, email, phone, role, staff_code').in('role', ['teacher', 'admin']).order('full_name'), [profile.id]);

  const [kind, setKind] = useState('student');
  const [classId, setClassId] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null); // null = all shown
  const [withBack, setWithBack] = useState(true);

  const className = (id) => (classes.data || []).find((c) => c.id === id)?.name;
  const teachesWhat = (pid) => (classes.data || []).filter((c) => c.teacher_id === pid).map((c) => c.name).join(', ');

  const people = useMemo(() => {
    if (kind === 'student') {
      return (students.data || [])
        .filter((s) => classId === 'all' || (classId === 'none' ? !s.class_id : s.class_id === classId))
        .map((s) => studentToCard(s, className(s.class_id)));
    }
    return (staff.data || []).map((p) => ({
      id: p.id, kind: 'teacher', name: p.full_name || p.email, code: p.staff_code || '—',
      line1: p.role === 'admin' ? 'Administrator' : 'Teacher', line2: teachesWhat(p.id),
      qr: `QCSLISJ-STAFF:${p.staff_code || p.id}`,
    }));
  }, [kind, classId, students.data, staff.data, classes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = people.filter((p) => !q || `${p.name} ${p.code}`.toLowerCase().includes(q.toLowerCase()));
  const selected = picked ? shown.filter((p) => picked[p.id]) : shown;

  useEffect(() => { setPicked(null); }, [kind, classId]);

  return (
    <>
      <section className="card no-print">
        <h2>ID cards</h2>
        <p className="muted small">
          Standard card size (85.6 × 54 mm), up to 10 per A4 page. Click <b>Print</b>, then choose your printer or <b>Save as PDF</b>.
          For best results set margins to <i>None/Minimum</i> and turn on <i>Background graphics</i>.
        </p>
        <div className="filters">
          <div className="segmented">
            <button className={kind === 'student' ? 'active' : ''} onClick={() => setKind('student')}>Students</button>
            <button className={kind === 'teacher' ? 'active' : ''} onClick={() => setKind('teacher')}>{isAdmin ? 'Teachers & staff' : 'My staff card'}</button>
          </div>
          {kind === 'student' && (
            <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
              <option value="all">{isAdmin ? 'All classes' : 'All my classes'}</option>
              {isAdmin && <option value="none">No class yet</option>}
              {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input placeholder="Search name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="inline small"><input type="checkbox" checked={withBack} onChange={(e) => setWithBack(e.target.checked)} /> Print back side</label>
        </div>

        {(students.loading || staff.loading) ? <div className="spinner" /> : shown.length === 0 ? (
          <p className="muted">No {kind === 'student' ? 'enrolled students' : 'staff'} to show.</p>
        ) : (
          <>
            <div className="pick-list">
              <label className="pick-all small">
                <input type="checkbox" checked={!picked || shown.every((p) => picked[p.id])}
                  onChange={(e) => setPicked(e.target.checked ? null : {})} />
                All ({shown.length}) — or tick only the cards you need
              </label>
              {shown.map((p) => (
                <label key={p.id} className="pick-row">
                  <input type="checkbox" checked={!picked || !!picked[p.id]}
                    onChange={(e) => {
                      const base = picked || Object.fromEntries(shown.map((x) => [x.id, true]));
                      setPicked({ ...base, [p.id]: e.target.checked });
                    }} />
                  <span>{p.name} <span className="small muted">{p.code}</span></span>
                  <span className="small muted">{p.line1}</span>
                </label>
              ))}
            </div>
            <button className="btn" disabled={!selected.length} onClick={printCards}>
              Print {selected.length} card{selected.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </section>

      {selected.length > 0 && (
        <section className="card card-preview">
          <h2 className="no-print">Preview</h2>
          <PrintCards people={selected} withBack={withBack} />
        </section>
      )}
    </>
  );
}
