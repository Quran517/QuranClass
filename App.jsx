import { useEffect, useState } from 'react';
import { supabase, configured } from './supabase.js';
import Auth, { NewPassword } from './Auth.jsx';
import Layout from './Layout.jsx';
import StudentHome from './StudentHome.jsx';
import Dashboard from './Dashboard.jsx';
import Admissions from './Admissions.jsx';
import Students from './Students.jsx';
import Classes from './Classes.jsx';
import Users from './Users.jsx';
import Attendance from './Attendance.jsx';
import Reports from './Reports.jsx';
import MyClasses from './MyClasses.jsx';
import Account from './Account.jsx';
import IdCards from './IdCards.jsx';
import Activity from './Activity.jsx';
import Settings from './Settings.jsx';
import Messages from './Messages.jsx';
import Team from './Team.jsx';
import StaffAttendance from './StaffAttendance.jsx';
import { loadSettings } from './settings.js';
import { AREAS } from './perms.js';

const TABS = {
  student: [
    ['home', 'My Admission'],
    ['team', 'QTC Team'],
    ['account', 'Account'],
  ],
  teacher: [
    ['myclasses', 'My Classes'],
    ['attendance', 'Attendance'],
    ['reports', 'Reports'],
    ['idcards', 'ID Cards'],
    ['messages', 'Messages'],
    ['team', 'QTC Team'],
    ['account', 'Account'],
  ],
  admin: [
    ['dashboard', 'Dashboard'],
    ['admissions', 'Admissions'],
    ['students', 'Students'],
    ['classes', 'Classes'],
    ['users', 'Users'],
    ['attendance', 'Attendance'],
    ['staffatt', 'Staff Attendance'],
    ['reports', 'Reports'],
    ['idcards', 'ID Cards'],
    ['messages', 'Messages'],
    ['team', 'QTC Team'],
    ['activity', 'Activity'],
    ['settings', 'Settings'],
    ['account', 'Account'],
  ],
};

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [tab, setTab] = useState(null);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    loadSettings();
    if (!configured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
      if (!s) {
        setProfile(null);
        setTab(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function loadProfile(quiet = false) {
    if (!quiet) setLoading(true);
    setProfileError('');
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) setProfileError(error.message);
    else if (!data) setProfileError('Your profile was not found. Ask the admin to run the database setup (supabase/schema.sql).');
    setProfile(data || null);
    setLoading(false);
  }

  if (!configured) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>Setup needed</h2>
          <p>
            The app is not connected to Supabase yet. In Netlify, open <b>Site configuration → Environment
            variables</b> and add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then
            redeploy.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="center-page"><div className="spinner" aria-label="Loading" /></div>;
  if (recovery && session) return <NewPassword onDone={() => setRecovery(false)} />;
  if (!session) return <Auth />;

  if (!profile) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>Something is not set up</h2>
          <p className="error">{profileError}</p>
          <button className="btn" onClick={loadProfile}>Try again</button>{' '}
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  let tabs = TABS[profile.role] || TABS.student;
  if (profile.role === 'teacher' && (profile.permissions || []).length) {
    // own-class tabs plus the areas the admin has ticked, in the admin menu order
    const granted = new Set(profile.permissions);
    const own = new Set(TABS.teacher.map(([k]) => k));
    tabs = [
      ...TABS.admin.filter(([k]) => granted.has(k) && !own.has(k) && AREAS.some(([a]) => a === k)),
      ...TABS.teacher,
    ];
    if (granted.has('dashboard')) tabs = [tabs.find(([k]) => k === 'dashboard'), ...tabs.filter(([k]) => k !== 'dashboard')];
  }
  const current = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];

  const pages = {
    home: <StudentHome profile={profile} />,
    dashboard: <Dashboard go={setTab} />,
    admissions: <Admissions />,
    students: <Students />,
    classes: <Classes />,
    users: <Users me={profile} />,
    attendance: <Attendance profile={profile} />,
    reports: <Reports profile={profile} />,
    myclasses: <MyClasses profile={profile} go={setTab} />,
    account: <Account profile={profile} onSaved={() => loadProfile(true)} />,
    idcards: <IdCards profile={profile} />,
    activity: <Activity />,
    settings: <Settings />,
    messages: <Messages profile={profile} />,
    team: <Team profile={profile} />,
    staffatt: <StaffAttendance />,
  };

  return (
    <Layout profile={profile} tabs={tabs} current={current} onTab={setTab}>
      {pages[current]}
    </Layout>
  );
}
