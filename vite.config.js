import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Connection to the QuranClass Supabase project (public anon key — safe to publish).
const SUPABASE_URL = 'https://zyqkuwthgdsouycqxfla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5cWt1d3RoZ2Rzb3V5Y3F4ZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2OTQxNzMsImV4cCI6MjEwNzI3MDE3M30.42GqkGi0ETFfsGiWi4aoxuLA_xHJN7jdPL_MuJmjoXo';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(SUPABASE_ANON_KEY),
  },
});
