import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { classTag, resizePhoto } from './util.js';
import { roleLabel } from './perms.js';
import Modal from './Modal.jsx';
import { supabase } from './supabase.js';
import { useQuery, fetchMyClasses } from './data.js';
import { useSettings, logoOf } from './settings.js';
import { QR_PREFIX } from './StudentQR.jsx';
import { code128Bars } from './barcode.js';
import avatarBoy from './avatar-boy.png';
import avatarGirl from './avatar-girl.png';

function Barcode({ value }) {
  const { bars, width } = code128Bars(value);
  return (
    <svg className="idcard-barcode" viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`}>
      {bars.map(([x, w], i) => <rect key={i} x={x} y="0" width={w} height="40" fill="#000" />)}
    </svg>
  );
}

// Picture shown until a photo is added: boy, girl (hijab) or staff.
export function Avatar({ variant }) {
  return <img className="idcard-avatar" src={variant === 'girl' ? avatarGirl : avatarBoy} alt="" />;
}


function useQrImages(items) {
  const [imgs, setImgs] = useState({});
  const key = items.map((i) => i.qr).join('|');
  useEffect(() => {
    let alive = true;
    Promise.all(items.map((i) =>
      QRCode.toDataURL(i.qr, { width: 220, margin: 0, color: { dark: '#1c2f55' } }).then((u) => [i.id, u]).catch(() => [i.id, ''])
    )).then((pairs) => alive && setImgs(Object.fromEntries(pairs)));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return imgs;
}

export function IdCard({ person, qrSrc, settings, back }) {
  if (back) {
    const staffCard = person.kind !== 'student';
    const office = [settings.contact_phone || settings.contact_whatsapp, settings.address].filter(Boolean);
    return (
      <div className={`idcard back ${person.variant || ''}`}>
        <div className="idcard-band back-band">
          <img className="idcard-logo sm" src={logoOf(settings)} alt="" />
          <div className="idcard-school">
            <b>{settings.school_name}</b>
            <span>{staffCard ? 'Staff' : person.variant === 'girl' ? 'Student · Girls' : 'Student · Boys'} · {settings.academic_year}</span>
          </div>
          <span className="back-ar" lang="ar" dir="rtl">{settings.school_name_ar || 'حلقة القرآن الكريم والتجويد'}</span>
        </div>
        <div className="back-main">
          <div className="back-rules">
            <h4>Card rules</h4>
            <ol>
              {(staffCard
                ? ['Wear this card during every class.', 'Scan the barcode at the door to mark your attendance.', 'Do not lend this card to anyone.', 'If lost, tell the admin office.']
                : [`Bring this card to every class${(settings.class_days || []).length === 1 ? ` (every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][settings.class_days[0]]})` : ''}.`, 'Show the barcode at the door to mark attendance.', 'Do not lend this card to anyone.', 'If lost, tell your class teacher.']
              ).map((r) => <li key={r}>{r}</li>)}
            </ol>
          </div>
          <div className="back-side">
            {staffCard ? (
              <>
                {office.length > 0 && <div className="back-box"><b>School office</b>{office.map((o, k) => <span key={k}>{k === 0 && (settings.contact_phone || settings.contact_whatsapp) ? '☎ ' : ''}{o}</span>)}</div>}
                <div className="back-box"><b>If found</b><span>{settings.card_note || `Please return to ${settings.school_name}.`}</span></div>
              </>
            ) : (
              <>
                <div className="back-box"><b>Emergency contact</b>
                  <span>{person.guardianName || '—'}</span>
                  {person.guardianPhone && <span>☎ {person.guardianPhone}</span>}
                </div>
                <div className="back-box">
                  <span><b>Class</b> {person.className || '—'}</span>
                  {person.teacher && <span><b>Teacher</b> {person.teacher}</span>}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="back-foot">
          <div className="back-verse"><span lang="ar" dir="rtl">خيركم من تعلّم القرآن وعلّمه</span><small>“The best of you are those who learn the Qur’an and teach it.”</small></div>
          <span className="back-valid">Valid {settings.academic_year}</span>
          <span className="back-sig">Principal</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`idcard ${person.kind} ${person.variant || ''} ${settings.show_card_photos === false ? 'no-photo' : ''}`}>
      <div className="idcard-band">
        <img className="idcard-logo" src={logoOf(settings)} alt="" />
        <div>
          <div className="idcard-school">{settings.school_name}</div>
          <div className="idcard-year">{person.kind === 'teacher' ? 'STAFF' : person.variant === 'girl' ? 'STUDENT · GIRLS' : person.variant === 'boy' ? 'STUDENT · BOYS' : 'STUDENT'} · {settings.academic_year}</div>
        </div>
      </div>
      <div className="idcard-body">
        {settings.show_card_photos !== false && (
          person.photo
            ? <img className="idcard-photo has-photo" src={person.photo} alt={`Photo of ${person.name}`} />
            : <div className="idcard-photo icon" aria-label="No photo yet"><Avatar variant={person.variant} /></div>
        )}
        <div className="idcard-info">
          <div className="idcard-name">{person.name}</div>
          <div className="idcard-id">{person.code}</div>
          {person.tag && <div className="idcard-tag">{person.tag}</div>}
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
  a4: { label: 'A4 sheet (cut out the cards)', css: '@page { size: A4 portrait; margin: 8mm 0; }' },
  card: { label: 'ID card printer (CR80, 1 card per page)', css: '@page { size: 85.6mm 54mm; margin: 0; }' },
};

// Full-screen digital ID for a phone (front / back).
export function DigitalCard({ person, onClose }) {
  const settings = useSettings();
  const imgs = useQrImages([person]);
  const [back, setBack] = useState(false);
  return (
    <div className="digital-id" role="dialog" aria-label="Digital ID card" onClick={onClose}>
      <div className="digital-card" onClick={(e) => { e.stopPropagation(); setBack(!back); }} title="Tap to turn the card">
        <IdCard person={person} qrSrc={imgs[person.id]} settings={settings} back={back} />
      </div>
      <p className="small" style={{ color: '#fff' }}>Tap the card to see the {back ? 'front' : 'back'} · tap outside to close</p>
      <button className="btn" onClick={onClose}>Close</button>
    </div>
  );
}

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

// Corner cut marks, drawn just outside the card so they are never on the card itself.
function CutMarks({ tight }) {
  const L = tight ? 1 : 3, G = tight ? 0.25 : 0.8; // mark length and gap from the card (mm)
  const W = 85.6, H = 54, o = L + G;
  const lines = [];
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const dx = x === 0 ? -1 : 1, dy = y === 0 ? -1 : 1;
    lines.push([x + dx * G, y, x + dx * o, y], [x, y + dy * G, x, y + dy * o]);
  }
  return (
    <svg className="cut-marks" style={{ left: `-${o}mm`, top: `-${o}mm`, width: `${W + 2 * o}mm`, height: `${H + 2 * o}mm` }} viewBox={`${-o} ${-o} ${W + 2 * o} ${H + 2 * o}`} aria-hidden="true">
      {lines.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth="0.15" />)}
    </svg>
  );
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
  const per = withBack ? 8 : 10;
  const pages = chunk(people, per);
  // each card sits in a frame with corner cut marks (outside the card) and a thin grey cut line
  const slot = (p, k, back) => (p
    ? <div key={p.id + (back ? '-b' : '')} className="cut-frame"><IdCard person={p} qrSrc={back ? undefined : imgs[p.id]} settings={settings} back={back} /><CutMarks tight={!withBack} /></div>
    : <div key={'e' + k} className="idcard-slot" />);
  return (
    <div className={`print-area paper-a4 ${withBack ? 'eight' : 'ten'}`}>
      {pages.map((pg, i) => {
        const rows = chunk(pg, 2).map((r) => (r.length === 2 ? r : [r[0], null]));
        return [
          <div key={'f' + i} className="a4-page" data-label={withBack ? `Sheet ${i + 1} — front` : ''}>
            {rows.map((r, j) => <div key={j} className="a4-row">{r.map((p, k) => slot(p, k, false))}</div>)}
          </div>,
          withBack && (
            // back of the same sheet: each row is mirrored, so after turning the paper
            // (flip on long edge) every back lands exactly behind its own front
            <div key={'b' + i} className="a4-page back-page" data-label={`Sheet ${i + 1} — back`}>
              {rows.map((r, j) => <div key={j} className="a4-row">{[...r].reverse().map((p, k) => slot(p, k, true))}</div>)}
            </div>
          ),
        ];
      })}
    </div>
  );
}

export function studentToCard(s, klass, photo, teacher) {
  const c = typeof klass === 'string' ? { name: klass } : klass || {};
  return {
    id: s.id, kind: 'student', variant: s.gender === 'female' ? 'girl' : 'boy', photo: photo || null, gender: s.gender, name: s.full_name, code: s.student_code,
    tag: classTag(c) || 'No class yet',
    lines: [
      `Adm. No: ${s.admission_no || '—'}`,
      s.quran_level ? `Level: ${s.quran_level}` : '',
    ],
    summary: [s.admission_no && `Adm ${s.admission_no}`, classTag(c)].filter(Boolean).join(' · '),
    barcode: s.student_code,
    guardian: [s.guardian_name, s.guardian_phone].filter(Boolean).join(' · '),
    guardianName: s.guardian_name || '', guardianPhone: s.guardian_phone || s.whatsapp || '',
    className: c.name ? classTag(c) : '', teacher: teacher || '',
    qr: QR_PREFIX + s.qr_token,
  };
}

export default function IdCards({ profile }) {
  const isAdmin = profile.role === 'admin' || (profile.permissions || []).includes('idcards');
  const classes = useQuery(() => fetchMyClasses(profile, 'idcards'), [profile.id]);
  const students = useQuery(() =>
    supabase.from('students').select('*')
      .eq('status', 'approved').order('full_name'), [profile.id]);
  const staff = useQuery(() =>
    supabase.from('profiles').select('id, full_name, email, phone, role, staff_code, staff_title').in('role', ['teacher', 'admin']).order('full_name'), [profile.id]);
  const photos = useQuery(() => supabase.from('card_photos').select('student_id, profile_id, data')
    .then((r) => (r.error && /card_photos/.test(r.error.message) ? { data: [], error: null } : r)), [profile.id]);
  const [design, setDesign] = useState('all');
  const [photoFor, setPhotoFor] = useState(null);

  const [kind, setKind] = useState('student');
  const [classId, setClassId] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null); // null = all shown
  const [withBack, setWithBack] = useState(true);
  const [paper, setPaper] = useState('a4');

  const classOf = (id) => (classes.data || []).find((c) => c.id === id);
  const teachesWhat = (pid) => (classes.data || []).filter((c) => c.teacher_id === pid).map((c) => c.name).join(', ');

  const photoOf = useMemo(() => {
    const m = {};
    for (const p of photos.data || []) m[p.student_id || p.profile_id] = p.data;
    return m;
  }, [photos.data]);

  const people = useMemo(() => {
    if (kind === 'student') {
      return (students.data || [])
        .filter((s) => classId === 'all' || (classId === 'none' ? !s.class_id : s.class_id === classId))
        .filter((s) => design === 'all' || (design === 'girl' ? s.gender === 'female' : s.gender !== 'female'))
        .map((s) => studentToCard(s, classOf(s.class_id), photoOf[s.id], (staff.data || []).find((t) => t.id === classOf(s.class_id)?.teacher_id)?.full_name));
    }
    return (staff.data || []).map((p) => ({
      id: p.id, kind: 'teacher', variant: 'staff', photo: photoOf[p.id] || null, name: p.full_name || p.email, code: p.staff_code || '—',
      lines: [p.role === 'admin' ? 'Administrator' : roleLabel(p), teachesWhat(p.id)],
      summary: p.role === 'admin' ? 'Administrator' : roleLabel(p),
      barcode: p.staff_code || '',
      qr: `QCSLISJ-STAFF:${p.staff_code || p.id}`,
    }));
  }, [kind, classId, design, students.data, staff.data, classes.data, photoOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = people.filter((p) => !q || `${p.name} ${p.code} ${(p.lines || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const selected = picked ? shown.filter((p) => picked[p.id]) : shown;

  useEffect(() => { setPicked(null); }, [kind, classId]);

  return (
    <>
      <section className="card no-print">
        <h2>ID cards</h2>
        <p className="muted small">
          Standard card size (85.6 × 54 mm). <b>A4</b>: 10 cards per page, or 8 with the back side — the back of the same 8 cards prints on the next page (choose <b>Print on both sides · Flip on long edge</b>). <b>Card printer</b>: 1 card per page. Click <b>Print</b>, then choose your printer or <b>Save as PDF</b>.
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
          {kind === 'student' && (
            <select value={design} onChange={(e) => setDesign(e.target.value)} aria-label="Card design">
              <option value="all">Boys &amp; girls cards</option>
              <option value="boy">Boys cards only (blue)</option>
              <option value="girl">Girls cards only (maroon)</option>
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
              <div className="pick-tools small">
                <button type="button" className="link" onClick={() => setPicked({})}>Select none</button>
                <span className="muted">{selected.length} of {shown.length} selected</span>
              </div>
              {shown.map((p) => (
                <label key={p.id} className="pick-row">
                  <input type="checkbox" checked={!picked || !!picked[p.id]}
                    onChange={(e) => {
                      const base = picked || Object.fromEntries(shown.map((x) => [x.id, true]));
                      setPicked({ ...base, [p.id]: e.target.checked });
                    }} />
                  <span>{p.name} <span className="small muted">{p.code}</span></span>
                  <span className="small muted">{p.summary}</span>
                  <span className={`design-dot ${p.variant}`} title={p.variant === 'girl' ? 'Girls design' : p.variant === 'staff' ? 'Staff design' : 'Boys design'} />
                  <button type="button" className="btn ghost small photo-btn" onClick={(e) => { e.preventDefault(); setPhotoFor(p); }}>{p.photo ? '📷 Change' : '📷 Photo'}</button>
                </label>
              ))}
            </div>
            <button className="btn" disabled={!selected.length} onClick={() => printCards(paper)}>
              Print {selected.length} card{selected.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </section>

      {photoFor && <PhotoModal person={photoFor} onClose={() => setPhotoFor(null)} onSaved={() => { setPhotoFor(null); photos.reload(); }} />}

      {selected.length > 0 && (
        <section className="card card-preview">
          <h2 className="no-print">Preview</h2>
          <PrintCards people={selected} withBack={withBack} paper={paper} />
        </section>
      )}
    </>
  );
}

// Optional card photo: chosen from the phone / computer, shrunk, stored privately.
function PhotoModal({ person, onClose, onSaved }) {
  const [img, setImg] = useState(person.photo || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function pick(e) {
    setErr('');
    try { setImg(await resizePhoto(e.target.files?.[0])); } catch (x) { setErr(x.message); }
  }
  async function save(data) {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('set_photo', { p_kind: person.kind === 'teacher' ? 'staff' : 'student', p_id: person.id, p_photo: data });
    setBusy(false);
    if (error) setErr(/set_photo/.test(error.message) ? 'Photos are not installed yet. Run update-18.sql in Supabase.' : error.message);
    else onSaved();
  }
  return (
    <Modal title={`Photo — ${person.name}`} onClose={onClose}>
      <p className="small muted">Optional. Use a clear, front-facing photo with a plain background. It is shrunk to a small size and shown only on ID cards. Ask parents' permission first.</p>
      <div className="photo-edit">
        {img ? <img src={img} alt="" /> : <div className="idcard-photo big icon"><Avatar variant={person.variant} /></div>}
        <div className="actions">
          <label className="btn ghost file-btn">Choose photo<input type="file" accept="image/*" capture="user" hidden onChange={pick} /></label>
          {img && img !== person.photo && <button className="btn" disabled={busy} onClick={() => save(img)}>{busy ? 'Saving…' : 'Save photo'}</button>}
          {person.photo && <button className="btn danger ghost" disabled={busy} onClick={() => save(null)}>Remove photo</button>}
        </div>
      </div>
      {err && <p className="error">{err}</p>}
    </Modal>
  );
}
