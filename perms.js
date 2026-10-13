// Areas the admin can give to a teacher (Users → Access).
export const AREAS = [
  ['dashboard', 'Dashboard', 'Overview, charts and alerts'],
  ['admissions', 'Admissions', 'Approve, reject, edit and delete applications'],
  ['students', 'Students', 'Add, edit and delete all students; upload from Excel'],
  ['classes', 'Classes', 'Create and edit classes; add or remove students in classes'],
  ['users', 'Users', 'Create teacher/student logins and reset passwords (never admins)'],
  ['attendance', 'Attendance', 'Take attendance for ALL classes (not just their own)'],
  ['reports', 'Reports', 'Reports for ALL classes'],
  ['idcards', 'ID Cards', 'Print ID cards for ALL students and staff'],
  ['activity', 'Activity', 'See the activity log'],
  ['settings', 'Settings', 'Change settings, download and restore backups'],
];

export const isAdmin = (profile) => profile?.role === 'admin';

// Can this person use an area for everyone (not just their own class)?
export function can(profile, area) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  return profile.role === 'teacher' && (profile.permissions || []).includes(area);
}
