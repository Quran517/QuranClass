# SLIS-Jeddah Quran Class Management

Starter project for GitHub + Vercel + Supabase using free-tier services where available.

## Included
- React + Vite web app
- Supabase email/password authentication
- Student profile entry and listing
- QR attendance scanning and manual attendance
- Attendance CSV export
- Supabase SQL schema, role setup, and row-level security policies

## Setup
1. Create a Supabase project.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env.local` and enter your Supabase Project URL and anon/public key.
4. Run `npm install` then `npm run dev`.
5. Push these files to a new GitHub repository.
6. Import the repository in Vercel and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables.
7. Add your Vercel URL to Supabase Authentication URL Configuration.

## First admin
Create an account in the app. In Supabase Authentication → Users, copy your own user UUID. Then run this in SQL Editor, replacing the placeholder:

```sql
update public.profiles set role = 'admin' where id = 'YOUR_AUTH_USER_UUID';
```

Never put your Supabase `service_role` key in frontend code or GitHub. Do not commit `.env.local`. Test with dummy data before using real student information. Obtain appropriate parent/guardian consent for children's personal information.
