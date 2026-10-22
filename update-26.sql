-- =====================================================================
-- Update 26: gender for teachers and staff (male / female)
--   Used on the Users page, the Users report and staff ID cards.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

alter table public.profiles add column if not exists gender text;
alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check check (gender is null or gender in ('male', 'female'));

-- make the website see the new column straight away
notify pgrst, 'reload schema';

select 'Update 26 installed — gender column: ' || count(*) as result
  from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'gender';
