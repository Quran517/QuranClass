import { useState } from 'react';
import { supabase } from './supabase.js';
import { useSettings } from './settings.js';

const ROLE_LABEL = { student: 'Student', teacher: 'Teacher', admin: 'Admin' };

export default function Layout({ profile, tabs, current, onTab, children }) {
  const [open, setOpen] = useState(false);
  const settings = useSettings();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="logo small" aria-hidden="true">۞</span>
            <div>
              <div className="brand-name">{settings.school_name}</div>
              <div className="brand-sub">{profile.full_name || profile.email} · {ROLE_LABEL[profile.role]}{profile.staff_code ? ` · ${profile.staff_code}` : ''}</div>
            </div>
          </div>
          <button className="menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        </div>
        <nav className={open ? 'nav open' : 'nav'}>
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={key === current ? 'nav-item active' : 'nav-item'}
              onClick={() => { onTab(key); setOpen(false); }}
            >
              {label}
            </button>
          ))}
          <button className="nav-item signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </nav>
      </header>
      <main className="content">{children}</main>
      <footer className="footer">{settings.school_name} · {settings.academic_year}{settings.contact_phone ? ` · ☎ ${settings.contact_phone}` : ''}</footer>
    </div>
  );
}
