import { useState } from 'react';

export const EMPTY_STUDENT = {
  full_name: '',
  gender: '',
  date_of_birth: '',
  admission_no: '',
  school_grade: '',
  quran_level: '',
  guardian_name: '',
  guardian_phone: '',
  whatsapp: '',
  email: '',
  address: '',
  notes: '',
  consent_given: false,
};

const FIELDS = Object.keys(EMPTY_STUDENT);

export function pickStudentFields(s) {
  const out = {};
  for (const k of FIELDS) out[k] = s?.[k] ?? EMPTY_STUDENT[k];
  return out;
}

// Shared admission / student details form.
// extra: optional admin-only fields (class, status) rendered at the end.
export default function StudentForm({ initial, onSubmit, submitLabel = 'Save', busy, extra, requireConsent = true }) {
  const [f, setF] = useState(() => pickStudentFields(initial));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function submit(e) {
    e.preventDefault();
    const clean = { ...f };
    for (const k of Object.keys(clean)) if (clean[k] === '') clean[k] = null;
    clean.full_name = f.full_name.trim();
    if (clean.email) clean.email = clean.email.trim().toLowerCase();
    onSubmit(clean);
  }

  return (
    <form onSubmit={submit} className="form-grid">
      <label className="span2">Student full name *<input required value={f.full_name} onChange={set('full_name')} /></label>
      <label>School admission number<input placeholder="e.g. 2024/1234" value={f.admission_no || ''} onChange={set('admission_no')} /></label>
      <label>Gender *
        <select required value={f.gender || ''} onChange={set('gender')}>
          <option value="">Select…</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </label>
      <label>Date of birth<input type="date" value={f.date_of_birth || ''} onChange={set('date_of_birth')} /></label>
      <label>School grade<input placeholder="e.g. Grade 5" value={f.school_grade || ''} onChange={set('school_grade')} /></label>
      <label>Current Quran level<input placeholder="e.g. Qaida, Juz 30, Hifz" value={f.quran_level || ''} onChange={set('quran_level')} /></label>
      <label>Parent / guardian name *<input required value={f.guardian_name || ''} onChange={set('guardian_name')} /></label>
      <label>Guardian phone *<input required inputMode="tel" placeholder="05xxxxxxxx" value={f.guardian_phone || ''} onChange={set('guardian_phone')} /></label>
      <label>WhatsApp number (for notices)<input inputMode="tel" placeholder="Same as guardian phone if empty" value={f.whatsapp || ''} onChange={set('whatsapp')} /></label>
      <label>Email address<input type="email" autoComplete="email" placeholder="parent or student email" value={f.email || ''} onChange={set('email')} /></label>
      <label>Area / address<input value={f.address || ''} onChange={set('address')} /></label>
      <label className="span2">Notes (health, special needs, etc.)<textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></label>
      {extra}
      <label className="check span2">
        <input type="checkbox" required={requireConsent} checked={!!f.consent_given} onChange={set('consent_given')} />
        <span>I am the parent/guardian (or have their permission) and agree that these details may be stored and used to manage the Quran class.</span>
      </label>
      <div className="span2">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}
