import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery } from './data.js';
import { whatsappLink, realEmail } from './util.js';
import { can } from './perms.js';
import { downloadExcel } from './exports.js';
import Modal from './Modal.jsx';

const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Team({ profile }) {
  const editor = can(profile, 'team');
  const list = useQuery(() => supabase.from('team_members').select('*').order('sort_order').order('full_name'));
  const staff = useQuery(() => editor
    ? supabase.from('profiles').select('id, full_name, phone, email, role, staff_code').in('role', ['teacher', 'admin']).order('full_name')
    : Promise.resolve({ data: [] }), [editor]);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const f = new FormData(e.target);
    const row = {
      full_name: f.get('full_name').trim(),
      responsibility: f.get('responsibility').trim() || null,
      phone: f.get('phone').trim() || null,
      email: f.get('email').trim().toLowerCase() || null,
      sort_order: Number(f.get('sort_order')) || 100,
      show_to_parents: f.get('show_to_parents') === 'on',
      profile_id: f.get('profile_id') || null,
    };
    const { error } = editing.id
      ? await supabase.from('team_members').update(row).eq('id', editing.id)
      : await supabase.from('team_members').insert(row);
    setBusy(false);
    if (error) setErr(error.message);
    else { setEditing(null); list.reload(); }
  }

  async function remove() {
    if (!window.confirm(`Remove ${editing.full_name} from the team list?`)) return;
    const { error } = await supabase.from('team_members').delete().eq('id', editing.id);
    if (error) setErr(error.message); else { setEditing(null); list.reload(); }
  }

  function pickStaff(id) {
    const p = (staff.data || []).find((x) => x.id === id);
    if (!p) return;
    setEditing({ ...editing, profile_id: id, full_name: editing.full_name || p.full_name, phone: editing.phone || p.phone, email: editing.email || realEmail(p.email), _k: Date.now() });
  }

  function exportList() {
    downloadExcel('qtc-team.xlsx', [{ name: 'QTC Team', rows: (list.data || []).map((m) => ({
      Name: m.full_name, Responsibility: m.responsibility || '', Phone: m.phone || '', Email: m.email || '', 'Shown to parents': m.show_to_parents ? 'Yes' : 'No',
    })) }]);
  }

  if (list.error && /team_members/.test(list.error)) {
    return <section className="card"><h2>QTC Team</h2><p className="error">The team list is not installed yet. Run update-11.sql in Supabase → SQL Editor.</p></section>;
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>QTC Team</h2>
        {editor && (
          <div className="actions">
            <button className="btn ghost" onClick={exportList} disabled={!(list.data || []).length}>Export Excel</button>
            <button className="btn" onClick={() => setEditing({ show_to_parents: true, sort_order: ((list.data || []).length + 1) * 10 })}>+ Add member</button>
          </div>
        )}
      </div>
      <p className="muted small">The people who run the Quran class and how to reach them.</p>
      {list.loading ? <div className="spinner" /> : (list.data || []).length === 0 ? (
        <p className="muted">{editor ? 'No team members yet. Click + Add member.' : 'The team list has not been added yet.'}</p>
      ) : (
        <div className="team-grid">
          {list.data.map((m) => {
            const wa = whatsappLink(m.phone, `Assalamu Alaikum ${m.full_name},`);
            return (
              <div key={m.id} className="team-card">
                <div className="team-top">
                  <div className="team-avatar">{initials(m.full_name)}</div>
                  <div>
                    <b>{m.full_name}</b>
                    {m.responsibility && <div className="team-role">{m.responsibility}</div>}
                    {!m.show_to_parents && <div className="small muted">Staff only</div>}
                  </div>
                </div>
                <div className="team-contacts">
                  {m.phone && <a href={`tel:${m.phone.replace(/\s+/g, '')}`}>📞 {m.phone}</a>}
                  {wa && <a href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
                  {m.email && <a href={`mailto:${m.email}`}>✉️ {m.email}</a>}
                </div>
                {editor && <button className="btn small ghost" onClick={() => { setErr(''); setEditing(m); }}>Edit</button>}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? `Edit ${editing.full_name}` : 'Add team member'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save} key={editing._k || editing.id || 'new'}>
            {(staff.data || []).length > 0 && (
              <label className="span2">Link to a staff login (optional — fills in name & contacts)
                <select name="profile_id" defaultValue={editing.profile_id || ''} onChange={(e) => pickStaff(e.target.value)}>
                  <option value="">— not linked —</option>
                  {staff.data.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}{p.staff_code ? ` (${p.staff_code})` : ''}</option>)}
                </select>
              </label>
            )}
            <label>Name *<input name="full_name" required defaultValue={editing.full_name || ''} /></label>
            <label>Responsibility<input name="responsibility" defaultValue={editing.responsibility || ''} placeholder="e.g. Coordinator, Hifz teacher, Accounts" /></label>
            <label>Phone / WhatsApp<input name="phone" inputMode="tel" defaultValue={editing.phone || ''} placeholder="05xxxxxxxx" /></label>
            <label>Email<input name="email" type="email" defaultValue={editing.email || ''} /></label>
            <label>Order in list<input name="sort_order" type="number" defaultValue={editing.sort_order ?? 100} /></label>
            <label className="check"><input type="checkbox" name="show_to_parents" defaultChecked={editing.show_to_parents !== false} /><span>Show to parents and students</span></label>
            {err && <p className="error span2">{err}</p>}
            <div className="span2 actions">
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              {editing.id && <button type="button" className="btn danger ghost" onClick={remove}>Remove</button>}
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
