import { createClient } from '@supabase/supabase-js';

// Public connection details for the QuranClass Supabase project.
// The anon key is meant to be public (every visitor's browser receives it);
// the data is protected by the row-level security rules in supabase/schema.sql.
// NEVER put the service_role / secret key here.
const DEFAULT_URL = 'https://zyqkuwthgdsouycqxfla.supabase.co';
const DEFAULT_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5cWt1d3RoZ2Rzb3V5Y3F4ZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2OTQxNzMsImV4cCI6MjEwNzI3MDE3M30.42GqkGi0ETFfsGiWi4aoxuLA_xHJN7jdPL_MuJmjoXo';

// Netlify environment variables, if set, take priority.
const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const url = (envUrl && !envUrl.includes('YOUR_PROJECT_REF') ? envUrl : DEFAULT_URL).replace(/\/+$/, '');
const key = envKey && !envKey.startsWith('YOUR_') ? envKey : DEFAULT_KEY;

export const configured = Boolean(url && key);

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
