import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { useSettings } from './settings.js';
import { QR_PREFIX } from './StudentQR.jsx';
import { code128Bars } from './barcode.js';

function Barcode({ value }) {
  const { bars, width } = code128Bars(value);
  return (
    <svg className="idcard-barcode" viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`}>
      {bars.map(([x, w], i) => <rect key={i} x={x} y="0" width={w} height="40" fill="#000" />)}
    </svg>
  );
}

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
          {(person.lines || []).filter(Boolean).map((l, i) => <div key={i} className="idcard-line">{l}</div>)}
        </div>
        {qrSrc && <img className="idcard-qr" src={qrSrc} alt="" />}
      </div>
      {person.barcode && (
        <div className="idcard-foot">
          <Barcode value={person.barcode} />
          <div className="idcard-barcode-text">{person.barcode}</div>
        </div>
      )}
    </div>
  );
}

export const PAPER = {
  a4: { label: 'A4 sheet (cut out the cards)', css: '@page { size: A4 portrait; margin: 6mm 10mm; }' },
  card: { label: 'ID card printer (CR80, 1 card per page)', css: '@page { size: 85.6mm 54mm; margin: 0; }' },
};

export function printCards(paper = 'a4') {
  let tag = document.getElementById('card-page-size');
  if (!tag) { tag = document.createElement('style'); tag.id = 'card-page-size'; document.head.appendChild(tag); }
  tag.textContent = `@media print { ${(PAPER[paper] || PAPER.a4).css} }`;
  // copy the cards into a clean top-level container so nothing else prints
  const src = document.querySelector('.print-area');
  if (!src) return;
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = src.outerHTML;
  document.body.classList.add('printing-cards');
  const done = () => { document.body.classList.remove('printing-cards'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 80);
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// A4: 10 card faces per page (2 across × 5 down). With back side, each row is front + back of one person.
// Card printer: one face per page.
export function PrintCards({ people, withBack, paper = 'a4' }) {
  const settings = useSettings();
  const imgs = useQrImages(people);
  if (paper === 'card') {
    return (
      <div className={`print-area paper-card`}>
        {people.map((p) => (
          <div key={p.id} className="card-pair">
            <div className="card-page"><IdCard person={p} qrSrc={imgs[p.id]} settings={settings} /></div>
            {withBack && <div className="card-page"><IdCard person={p} settings={settings} back /></div>}
          </div>
        ))}
      </div>
    );
  }
  const pages = chunk(people, withBack ? 5 : 10);
  return (
    <div className="print-area paper-a4">
      {pages.map((pg, i) => (
        <div key={i} className="a4-page">
          {withBack
            ? pg.map((p) => (
                <div key={p.id} className="a4-row">
                  <IdCard person={p} qrSrc={imgs[p.id]} settings={settings} />
                  <IdCard person={p} settings={settings} back />
                </div>
              ))
            : chunk(pg, 2).map((row, j) => (
                <div key={j} className="a4-row">
                  {row.map((p) => <IdCard key={p.id} person={p} qrSrc={imgs[p.id]} settings={settings} />)}
                </div>
              ))}
        </div>
      ))}
    </div>
  );
}

export function studentToCard(s, klass) {
  const c = typeof klass === 'string' ? { name: klass } : klass || {};
  return {
    id: s.id, kind: 'student', name: s.full_name, code: s.student_code,
    lines: [
      `Adm. No: ${s.admission_no || '—'}`,
      c.name ? `Class: ${c.name}` : '',
      c.group_name ? `Group: ${c.group_name}` : '',
      s.quran_level ? `Level: ${s.quran_level}` : '',
    ],
    summary: [s.admission_no && `Adm ${s.admission_no}`, c.name, c.group_name].filter(Boolean).join(' · '),
    barcode: s.student_code,
    guardian: [s.guardian_name, s.guardian_phone].filter(Boolean).join(' · '),
    qr: QR_PREFIX + s.qr_token,
  };
}

export default function IdCards({ profile }) {
  const isAdmin = profile.role === 'admin';
  const classes = useQuery(() => fetchMyClasses(profile), [profile.id]);
  const students = useQuery(() =>
    supabase.from('students').select('*')
      .eq('status', 'approved').order('full_name'), [profile.id]);
  const staff = useQuery(() =>
    supabase.from('profiles').select('id, full_name, email, phone, role, staff_code').in('role', ['teacher', 'admin']).order('full_name'), [profile.id]);

  const [kind, setKind] = useState('student');
  const [classId, setClassId] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null); // null = all shown
  const [withBack, setWithBack] = useState(true);
  const [paper, setPaper] = useState('a4');

  const classOf = (id) => (classes.data || []).find((c) => c.id === id);
  const teachesWhat = (pid) => (classes.data || []).filter((c) => c.teacher_id === pid).map((c) => c.name).join(', ');

  const people = useMemo(() => {
    if (kind === 'student') {
      return (students.data || [])
        .filter((s) => classId === 'all' || (classId === 'none' ? !s.class_id : s.class_id === classId))
        .map((s) => studentToCard(s, classOf(s.class_id)));
    }
    return (staff.data || []).map((p) => ({
      id: p.id, kind: 'teacher', name: p.full_name || p.email, code: p.staff_code || '—',
      lines: [p.role === 'admin' ? 'Administrator' : 'Teacher', teachesWhat(p.id)],
      summary: p.role === 'admin' ? 'Administrator' : 'Teacher',
      barcode: p.staff_code || '',
      qr: `QCSLISJ-STAFF:${p.staff_code || p.id}`,
    }));
  }, [kind, classId, students.data, staff.data, classes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = people.filter((p) => !q || `${p.name} ${p.code} ${(p.lines || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const selected = picked ? shown.filter((p) => picked[p.id]) : shown;

  useEffect(() => { setPicked(null); }, [kind, classId]);

  return (
    <>
      <section className="card no-print">
        <h2>ID cards</h2>
        <p className="muted small">
          Standard card size (85.6 × 54 mm). <b>A4</b>: 10 cards per page (5 with back side). <b>Card printer</b>: 1 card per page. Click <b>Print</b>, then choose your printer or <b>Save as PDF</b>.
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
          <select value={paper} onChange={(e) => setPaper(e.target.value)} aria-label="Paper size">
            {Object.entries(PAPER).map(([k, v]) => <option key={k} value={k}>Paper: {v.label}</option>)}
          </select>
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
                  <span className="small muted">{p.summary}</span>
                </label>
              ))}
            </div>
            <button className="btn" disabled={!selected.length} onClick={() => printCards(paper)}>
              Print {selected.length} card{selected.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </section>

      {selected.length > 0 && (
        <section className="card card-preview">
          <h2 className="no-print">Preview</h2>
          <PrintCards people={selected} withBack={withBack} paper={paper} />
        </section>
      )}
    </>
  );
}
