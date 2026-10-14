import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import defaultLogo from './logo.png';

export { defaultLogo };

export const DEFAULT_SETTINGS = {
  school_name: 'SLIS-Jeddah Quran Class',
  tagline: 'Quran Learning • Character • Knowledge',
  academic_year: '2026–2027',
  contact_phone: '',
  contact_whatsapp: '',
  contact_email: '',
  address: '',
  card_note: 'If found, please return to SLIS-Jeddah Quran Class.',
  low_attendance_pct: 75,
  class_days: [6], // weekdays the class meets (0 = Sunday … 6 = Saturday)
  backup_every_days: 7,
  allow_signup: true,
  show_card_photos: true,
  logo_url: null,
  last_backup_at: null,
};

let current = { ...DEFAULT_SETTINGS };
const listeners = new Set();

export function getSettings() {
  return current;
}

function publish(next) {
  current = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(next || {}).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length))), last_backup_at: next?.last_backup_at ?? null, logo_url: next?.logo_url ?? null };
  listeners.forEach((fn) => fn(current));
}

// Loads settings from the database. Works before sign-in too.
// If the settings table does not exist yet (update-3.sql not run), defaults are used.
export async function loadSettings() {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  if (!error && data) publish(data);
  return current;
}

export async function saveSettings(values) {
  const { data, error } = await supabase.from('settings').update({ ...values, updated_at: new Date().toISOString() }).eq('id', 1).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Settings could not be saved. Has update-3.sql been run in Supabase?');
  publish(data);
  return current;
}

export function setLastBackup(at) {
  publish({ ...current, last_backup_at: at });
}

// The logo to show: an uploaded one (Settings → Logo) or the built-in QTC logo.
export const logoOf = (s) => (s && s.logo_url) || defaultLogo;
export const getLogo = () => logoOf(current);

function setFavicon(url) {
  try {
    for (const rel of ['icon', 'apple-touch-icon']) {
      let l = document.querySelector(`link[rel="${rel}"]`);
      if (!l) { l = document.createElement('link'); l.rel = rel; document.head.appendChild(l); }
      l.href = url;
    }
  } catch { /* ignore */ }
}
listeners.add((s) => setFavicon(logoOf(s)));

export function useLogo() {
  return logoOf(useSettings());
}

export function useSettings() {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    return () => listeners.delete(setS);
  }, []);
  return s;
}
