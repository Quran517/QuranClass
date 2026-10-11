import { createClient } from '@supabase/supabase-js';

const url = 'https://zyqkuwthgdsouycqxfla.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5cWt1d3RoZ2Rzb3V5Y3F4ZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2OTQxNzMsImV4cCI6MjEwNzI3MDE3M30.42GqkGi0ETFfsGiWi4aoxuLA_xHJN7jdPL_MuJmjoXo';

export const configured = true;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
