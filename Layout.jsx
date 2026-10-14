import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { useSettings, logoOf } from './settings.js';
import { roleLabel } from './perms.js';
import Notifications from './Notifications.jsx';

// Icons and menu sections for every page.
const ICON = {
  dashboard: '🏠', home: '🏠', myclasses: '🏠', children: '👨‍👩‍👧', results: '🏅',
  admissions: '📥', students: '🎓', classes: '🏫', users: '👥',
  attendance: '📷', staffatt: '🧑‍🏫', progress: '📖', exams: '📝', certificates: '🏅', reports: '📊', idcards: '🪪',
  messages: '💬', team: '🤝', activity: '🕘', settings: '⚙️', account: '👤',
};
const SECTIONS = [
  ['Overview', ['dashboard', 'myclasses', 'home', 'children', 'results']],
  ['Students', ['admissions', 'students', 'classes']],
  ['Teaching', ['attendance', 'progress', 'exams', 'certificates', 'reports', 'idcards']],
  ['People', ['users', 'staffatt', 'team', 'messages']],
  ['System', ['activity', 'settings', 'account']],
];
const SUBTITLE = {
  dashboard: 'Overview of the whole Quran class', myclasses: 'Your classes, students and tasks', home: 'Your admission, ID card, progress and attendance',
  children: 'Attendance, results, progress and certificates', results: 'Published results, report cards and certificates',
  admissions: 'Review and approve new applications', students: 'All enrolled students', classes: 'Groups, classes and places',
  users: 'Logins, roles and access', attendance: 'Scan cards or mark the register', staffatt: 'Teacher and staff attendance',
  progress: 'Lessons, grades and teacher remarks', exams: 'Exams, marks, results and report cards', certificates: 'Requests, approval and issuing',
  reports: 'Attendance reports and downloads', idcards: 'Print student and staff ID cards', messages: 'WhatsApp and email to parents',
  team: 'QTC team members and responsibilities', activity: 'Everything that changed, and who changed it', settings: 'School details, logo, class days and backups',
  account: 'Your name, phone, username and password',
};

const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Layout({ profile, tabs, current, onTab, children }) {
  const [open, setOpen] = useState(false);
  const settings = useSettings();
  const label = Object.fromEntries(tabs);
  const have = new Set(tabs.map(([k]) => k));
  const groups = SECTIONS.map(([name, keys]) => [name, keys.filter((k) => have.has(k))]).filter(([, keys]) => keys.length);
  const listed = new Set(groups.flatMap(([, k]) => k));
  const extra = tabs.map(([k]) => k).filter((k) => !listed.has(k));
  if (extra.length) groups.push(['More', extra]);

  useEffect(() => { document.title = `${label[current] || ''} · ${settings.school_name}`; }, [current, settings.school_name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.scrollTo(0, 0); }, [current]);

  const go = (k) => { onTab(k); setOpen(false); };

  return (
    <div className={`shell ${open ? 'menu-open' : ''}`}>
      <aside className="sidebar" aria-label="Main menu">
        <div className="side-brand">
          <img src={logoOf(settings)} alt="" />
          <div>
            <b>{settings.school_name}</b>
            <span>{settings.academic_year}</span>
          </div>
        </div>
        <nav className="side-nav">
          {groups.map(([name, keys]) => (
            <div key={name} className="side-group">
              <div className="side-title">{name}</div>
              {keys.map((k) => (
                <button key={k} className={`side-item ${k === current ? 'active' : ''}`} aria-current={k === current ? 'page' : undefined} onClick={() => go(k)}>
                  <span className="side-ico" aria-hidden="true">{ICON[k] || '•'}</span>{label[k]}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-user">
          <span className="avatar">{initials(profile.full_name || profile.email)}</span>
          <div className="side-user-text">
            <b>{profile.full_name || 'My account'}</b>
            <span>{roleLabel(profile)}{profile.staff_code ? ` · ${profile.staff_code}` : ''}</span>
          </div>
          <button className="side-signout" title="Sign out" aria-label="Sign out" onClick={() => supabase.auth.signOut()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />

      <div className="main">
        <header className="appbar">
          <button className="menu-toggle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
          <img className="appbar-logo" src={logoOf(settings)} alt="" />
          <div className="appbar-title">
            <h1>{label[current]}</h1>
            <span>{SUBTITLE[current] || settings.school_name}</span>
          </div>
          <div className="appbar-tools">
            <span className="appbar-date">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <Notifications onTab={(t) => onTab(have.has(t) ? t : tabs[0][0])} />
            <button className="appbar-user" onClick={() => go('account')} title="My account">
              <span className="avatar sm">{initials(profile.full_name || profile.email)}</span>
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="footer">{settings.school_name} · {settings.academic_year}{settings.contact_phone ? ` · ☎ ${settings.contact_phone}` : ''}</footer>
      </div>
    </div>
  );
}
