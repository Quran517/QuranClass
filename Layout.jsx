import { useState } from 'react';
import { supabase } from './supabase.js';
import { useSettings, logoOf } from './settings.js';
import { roleLabel } from './perms.js';
import Notifications from './Notifications.jsx';


export default function Layout({ profile, tabs, current, onTab, children }) {
  const [open, setOpen] = useState(false);
  const settings = useSettings();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img className="brand-logo" src={logoOf(settings)} alt="" />
            <div>
              <div className="brand-name">{settings.school_name}</div>
              <div className="brand-sub">{profile.full_name || profile.email} · {roleLabel(profile)}{profile.staff_code ? ` · ${profile.staff_code}` : ''}</div>
            </div>
          </div>
          <div className="topbar-tools">
            <Notifications onTab={(t) => onTab(tabs.some(([k]) => k === t) ? t : tabs[0][0])} />
            <button className="menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
          </div>
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
