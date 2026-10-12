-- =====================================================================
-- Update 4: school admission number on students, group on classes
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================
alter table public.students add column if not exists admission_no text;
alter table public.classes  add column if not exists group_name  text;
create index if not exists students_admission_no_idx on public.students (admission_no);

select 'Update 4 installed' as result;
