// Areas the admin can give to a teacher (Users → Access).
export const AREAS = [
  ['dashboard', 'Dashboard', 'Overview, charts and alerts'],
  ['admissions', 'Admissions', 'Approve, reject, edit and delete applications'],
  ['students', 'Students', 'Add, edit and delete all students; upload from Excel'],
  ['classes', 'Classes', 'Create and edit classes; add or remove students in classes'],
  ['users', 'Users', 'Create teacher/student logins and reset passwords (never admins)'],
  ['attendance', 'Attendance', 'Take attendance for ALL classes (not just their own)'],
  ['progress', 'Progress', 'Record progress & comments for ALL students'],
  ['reports', 'Reports', 'Reports for ALL classes'],
  ['idcards', 'ID Cards', 'Print ID cards for ALL students and staff'],
  ['staffatt', 'Staff Attendance', 'Mark and report teachers\' attendance'],
  ['team', 'QTC Team', 'Edit the team list (names, responsibilities, contacts)'],
  ['messages', 'Messages', 'Send email / WhatsApp messages to parents'],
  ['activity', 'Activity', 'See the activity log'],
  ['settings', 'Settings', 'Change settings, download and restore backups'],
];

// Ready-made access for an "Admin assistant": everything except Users and Settings.
export const ASSISTANT_PERMS = ['dashboard', 'admissions', 'students', 'classes', 'attendance', 'progress', 'staffatt', 'reports', 'idcards', 'messages', 'team', 'activity'];

export const isAdmin = (profile) => profile?.role === 'admin';

export function roleLabel(p) {
  if (!p) return '';
  if (p.role === 'admin') return 'Admin';
  if (p.role === 'teacher') return p.staff_title === 'assistant' ? 'Admin assistant' : 'Teacher';
  return 'Student';
}

// Can this person use an area for everyone (not just their own class)?
export function can(profile, area) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  return profile.role === 'teacher' && (profile.permissions || []).includes(area);
}
