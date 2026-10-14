import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';

const ago = (ts) => {
  const m = Math.round((Date.now() - new Date(ts)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

// In-app notifications (bell). Nothing is sent by email or WhatsApp automatically.
export default function Notifications({ onTab }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(true);
  const box = useRef(null);

  async function load() {
    const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30);
    if (error) { setOk(false); return; }
    setOk(true); setItems(data || []);
  }
  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!ok) return null;
  const unread = items.filter((n) => !n.read_at).length;

  async function markRead(ids) {
    if (!ids.length) return;
    const at = new Date().toISOString();
    setItems(items.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at || at } : n)));
    await supabase.from('notifications').update({ read_at: at }).in('id', ids);
  }

  return (
    <div className="notif" ref={box}>
      <button className="notif-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        🔔{unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="row-between notif-head">
            <b>Notifications</b>
            {unread > 0 && <button className="link small" onClick={() => markRead(items.filter((n) => !n.read_at).map((n) => n.id))}>Mark all read</button>}
          </div>
          {items.length === 0 ? <p className="small muted notif-empty">No notifications yet.</p> : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className={n.read_at ? 'read' : 'unread'}>
                  <button onClick={() => { markRead([n.id]); if (n.tab) onTab(n.tab); setOpen(false); }}>
                    <span className="notif-title">{!n.read_at && <span className="dot-unread" aria-label="unread" />}{n.title}</span>
                    {n.body && <span className="small">{n.body}</span>}
                    <span className="small muted">{ago(n.created_at)}{n.read_at ? ' · read' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
