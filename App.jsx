import { useEffect, useState } from 'react';
import { supabase, configured } from './supabase.js';
import Auth, { NewPassword } from './components/Auth.jsx';
import Layout from './components/Layout.jsx';
import StudentHome from './components/StudentHome.jsx';
import Dashboard from './components/Dashboard.jsx';
import Admissions from './components/Admissions.jsx';
import Students from './components/Students.jsx';
import Classes from './components/Classes.jsx';
import Users from './components/Users.jsx';
import Attendance from './components/Attendance.jsx';
import Reports from './components/Reports.jsx';
import MyClasses from './components/MyClasses.jsx';
import Account from './components/Account.jsx';

const TABS = {
  student: [
    ['home', 'My Admission'],
    ['account', 'Account'],
  ],
  teacher: [
    ['myclasses', 'My Classes'],
    ['attendance', 'Attendance'],
    ['reports', 'Reports'],
    ['account', 'Account'],
  ],
  admin: [
    ['dashboard', 'Dashboard'],
    ['admissions', 'Admissions'],
    ['students', 'Students'],
    ['classes', 'Classes'],
    ['users', 'Users'],
    ['attendance', 'Attendance'],
    ['reports', 'Reports'],
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

  async function loadProfile() {
    setLoading(true);
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

  const tabs = TABS[profile.role] || TABS.student;
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
    account: <Account profile={profile} onSaved={loadProfile} />,
  };

  return (
    <Layout profile={profile} tabs={tabs} current={current} onTab={setTab}>
      {pages[current]}
    </Layout>
  );
}
