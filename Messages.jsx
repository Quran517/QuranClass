import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { fetchAllRows, fetchMyClasses } from './data.js';
import { useSettings } from './settings.js';
import { waNumber, whatsappLink, realEmail, formatDate } from './util.js';

const TEMPLATES = [
  ['Blank', ''],
  ['Class cancelled', 'Assalamu Alaikum {guardian},\n\nPlease note there will be no Quran class on __________.\n\nJazakAllahu khairan,\n{school}'],
  ['Holiday', 'Assalamu Alaikum {guardian},\n\nThe Quran class will be closed from ________ to ________ for the holiday. Classes resume on ________, in shaa Allah.\n\n{school}'],
  ['Reminder', 'Assalamu Alaikum {guardian},\n\nA kind reminder that {student} has Quran class ({class}). Please make sure {student} attends on time.\n\nJazakAllahu khairan,\n{school}'],
  ['Low attendance', 'Assalamu Alaikum {guardian},\n\n{student}\'s attendance in the Quran class has been low recently. Please contact us if there is any difficulty.\n\nJazakAllahu khairan,\n{school}'],
];

const fill = (text, r, school) =>
  text
    .replaceAll('{guardian}', r.guardian || 'Parent')
    .replaceAll('{student}', r.name)
    .replaceAll('{class}', r.className || 'Quran class')
    .replaceAll('{code}', r.code || '')
    .replaceAll('{school}', school);

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function Messages({ profile }) {
  const settings = useSettings();
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState(null);
  const [absentToday, setAbsentToday] = useState(new Set());
  const [lastClass, setLastClass] = useState(null);
  const [err, setErr] = useState('');
  const [group, setGroup] = useState('all');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [sent, setSent] = useState({});
  const [copied, setCopied] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data: cls } = await fetchMyClasses(profile, 'messages');
        setClasses(cls || []);
        const ids = (cls || []).map((c) => c.id);
        const all = profile.role === 'admin' || (profile.permissions || []).includes('messages');
        const rows = await fetchAllRows(() => {
          let q = supabase.from('students')
            .select('id, full_name, student_code, class_id, guardian_name, guardian_phone, whatsapp, email')
            .eq('status', 'approved').order('full_name');
          if (!all) q = q.in('class_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
          return q;
        });
        setStudents(rows);
        // students absent at the most recent class that has attendance marked
        const { data: last } = await supabase.from('attendance').select('att_date').order('att_date', { ascending: false }).limit(1);
        const lastDate = last?.[0]?.att_date || null;
        setLastClass(lastDate);
        if (lastDate) {
          const { data: abs } = await supabase.from('attendance').select('student_id').eq('att_date', lastDate).eq('status', 'absent');
          setAbsentToday(new Set((abs || []).map((a) => a.student_id)));
        }
      } catch (e) {
        setErr(e.message);
        setStudents([]);
      }
    })();
  }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const classById = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c])), [classes]);

  const recipients = useMemo(() => {
    if (!students) return [];
    return students
      .filter((s) => group === 'all' || (group === 'absent' ? absentToday.has(s.id) : group === 'none' ? !s.class_id : s.class_id === group))
      .map((s) => ({
        id: s.id, name: s.full_name, code: s.student_code, guardian: s.guardian_name,
        className: classById[s.class_id]?.name || '',
        phone: waNumber(s.whatsapp || s.guardian_phone),
        email: realEmail(s.email || ''),
      }));
  }, [students, group, absentToday, classById]);

  const withPhone = recipients.filter((r) => r.phone);
  const emails = [...new Set(recipients.map((r) => r.email).filter(Boolean))];
  const school = settings.school_name;
  const sample = recipients[0] || { name: 'Abdullah', guardian: 'Ahmed', className: 'Hifz A', code: 'QC1001' };
  const emailBody = text.replaceAll('{guardian}', 'Parent').replaceAll('{student}', 'your child')
    .replaceAll('{class}', 'the Quran class').replaceAll('{code}', '').replaceAll('{school}', school);

  // Some email apps can't open very long links, so emails are sent in groups of 40 (BCC = private).
  const emailGroups = [];
  for (let i = 0; i < emails.length; i += 40) emailGroups.push(emails.slice(i, i + 40));
  const mailto = (list) =>
    `mailto:${encodeURIComponent(settings.contact_email || '')}?bcc=${list.map(encodeURIComponent).join(',')}` +
    `&subject=${encodeURIComponent(subject || school)}&body=${encodeURIComponent(emailBody)}`;

  function copy(label, value) {
    navigator.clipboard?.writeText(value).then(() => { setCopied(label); setTimeout(() => setCopied(''), 2500); });
  }

  function contactsFile() {
    const vcf = withPhone.map((r) => [
      'BEGIN:VCARD', 'VERSION:3.0',
      `FN:${(r.guardian || 'Parent')} (${r.name} ${r.code})`,
      `N:${r.name} ${r.code};${r.guardian || 'Parent'};;;`,
      `TEL;TYPE=CELL:+${r.phone}`,
      `NOTE:${school}${r.className ? ' · ' + r.className : ''}`,
      'END:VCARD',
    ].join('\r\n')).join('\r\n');
    download(`parents-${group === 'all' ? 'all' : (classById[group]?.name || group)}.vcf`.replace(/\s+/g, '-'), vcf, 'text/vcard');
  }

  const sentCount = withPhone.filter((r) => sent[r.id]).length;

  return (
    <>
      <section className="card">
        <h2>Message parents</h2>
        <p className="muted small">Write one message and send it to every parent in a group, by email and WhatsApp. Free, using your own email and WhatsApp.</p>
        {err && <p className="error">{err}</p>}
        <div className="form-grid">
          <label>Send to
            <select value={group} onChange={(e) => { setGroup(e.target.value); setSent({}); }}>
              <option value="all">All parents</option>
              {classes.map((c) => <option key={c.id} value={c.id}>Class: {c.name}{c.group_name ? ` (${c.group_name})` : ''}</option>)}
              <option value="absent">Parents of students absent at last class{lastClass ? ` (${formatDate(lastClass)})` : ''}</option>
              {(profile.role === 'admin' || (profile.permissions || []).includes('messages')) && <option value="none">Students with no class</option>}
            </select>
          </label>
          <label>Template
            <select onChange={(e) => { const t = TEMPLATES[e.target.value]; setText(t[1]); if (!subject) setSubject(t[0] === 'Blank' ? '' : t[0]); }} defaultValue="0">
              {TEMPLATES.map(([n], i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
          <label className="span2">Email subject<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={school} /></label>
          <label className="span2">Message
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Assalamu Alaikum {guardian}, …" />
          </label>
        </div>
        <p className="small muted">
          Personal words (WhatsApp): <code>{'{guardian}'}</code> parent's name · <code>{'{student}'}</code> student · <code>{'{class}'}</code> class · <code>{'{code}'}</code> student ID · <code>{'{school}'}</code> school name.
        </p>
        {text && (
          <div className="msg-preview">
            <div className="small muted">Preview for {sample.guardian || 'Parent'} ({sample.name}):</div>
            <pre>{fill(text, sample, school)}</pre>
          </div>
        )}
        <div className="stats compact">
          <div className="stat"><b>{recipients.length}</b><span>Students in group</span></div>
          <div className="stat"><b>{withPhone.length}</b><span>WhatsApp numbers</span></div>
          <div className="stat"><b>{emails.length}</b><span>Email addresses</span></div>
        </div>
      </section>

      <section className="card">
        <h2>📧 Email — everyone at once</h2>
        {emails.length === 0 ? <p className="muted">No parent email addresses in this group. Add emails under Students → Edit.</p> : (
          <>
            <p className="small muted">Opens your email app with all parents in <b>BCC</b> (they can't see each other's addresses). Check, then press Send.</p>
            <div className="actions">
              {emailGroups.map((g, i) => (
                <a key={i} className={`btn ${text ? '' : 'disabled'}`} href={text ? mailto(g) : undefined}>
                  {emailGroups.length > 1 ? `Open email ${i + 1} of ${emailGroups.length} (${g.length})` : `Open email to ${g.length} parents`}
                </a>
              ))}
              <button className="btn ghost" onClick={() => copy('emails', emails.join(', '))}>{copied === 'emails' ? 'Copied ✓' : 'Copy all emails'}</button>
            </div>
            {!text && <p className="small muted">Write a message first.</p>}
          </>
        )}
      </section>

      <section className="card">
        <h2>💬 WhatsApp</h2>
        {withPhone.length === 0 ? <p className="muted">No WhatsApp numbers in this group.</p> : (
          <>
            <h3>Option 1 — WhatsApp broadcast (fastest for everyone at once)</h3>
            <ol className="small steps">
              <li><button className="link" onClick={contactsFile}>Download parents' contacts</button> ({withPhone.length}) and open the file on your phone to save them. Do this once (and again when new students join).</li>
              <li>In WhatsApp: <b>⋮ / Chats → New broadcast</b>, select the parents, and create the list. Name it e.g. "{school} parents".</li>
              <li><button className="link" onClick={() => copy('msg', emailBody)} disabled={!text}>{copied === 'msg' ? 'Message copied ✓' : 'Copy the message'}</button>, paste it into the broadcast list and send. Each parent receives it privately.</li>
            </ol>
            <p className="small muted">WhatsApp only delivers broadcasts to parents who have <b>your number saved</b> too. Up to 256 people per list.</p>

            <h3>Option 2 — one by one, personalised ({sentCount}/{withPhone.length} sent)</h3>
            <p className="small muted">Each button opens WhatsApp with the parent's own message ready. Press send in WhatsApp, come back, and tap the next one.</p>
            {!text ? <p className="small muted">Write a message first.</p> : (
              <div className="pick-list msg-list">
                {withPhone.map((r) => (
                  <div key={r.id} className={`pick-row ${sent[r.id] ? 'done' : ''}`}>
                    <span>{r.guardian || 'Parent'} <span className="small muted">· {r.name} {r.code}{r.className ? ` · ${r.className}` : ''}</span></span>
                    <a className={`btn small ${sent[r.id] ? 'ghost' : 'whatsapp'}`} target="_blank" rel="noreferrer"
                      href={whatsappLink(r.phone, fill(text, r, school))}
                      onClick={() => setSent((x) => ({ ...x, [r.id]: true }))}>
                      {sent[r.id] ? 'Sent ✓' : 'Send'}
                    </a>
                  </div>
                ))}
              </div>
            )}
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn ghost small" onClick={() => copy('nums', withPhone.map((r) => '+' + r.phone).join('\n'))}>{copied === 'nums' ? 'Copied ✓' : 'Copy all numbers'}</button>
              {sentCount > 0 && <button className="btn ghost small" onClick={() => setSent({})}>Reset ticks</button>}
            </div>
          </>
        )}
      </section>
    </>
  );
}
