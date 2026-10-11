import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

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
  backup_every_days: 7,
  last_backup_at: null,
};

let current = { ...DEFAULT_SETTINGS };
const listeners = new Set();

export function getSettings() {
  return current;
}

function publish(next) {
  current = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(next || {}).filter(([, v]) => v !== null && v !== '')), last_backup_at: next?.last_backup_at ?? null };
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

export function useSettings() {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    return () => listeners.delete(setS);
  }, []);
  return s;
}
