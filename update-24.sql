-- =====================================================================
-- Update 24: students can update their own contact details
--   (parent / guardian name and phone, WhatsApp, email, address, school grade).
--   Class, Student ID, admission number and status still only change by admin.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

create or replace function public.update_my_details(
  p_guardian_name  text,
  p_guardian_phone text,
  p_whatsapp       text,
  p_email          text,
  p_address        text,
  p_school_grade   text
) returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select id into sid from public.students where profile_id = auth.uid() limit 1;
  if sid is null then
    raise exception 'No student record is linked to this login.';
  end if;
  if coalesce(trim(p_email), '') <> '' and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address, or leave it empty.';
  end if;
  update public.students set
    guardian_name  = nullif(trim(coalesce(p_guardian_name, '')), ''),
    guardian_phone = nullif(trim(coalesce(p_guardian_phone, '')), ''),
    whatsapp       = nullif(trim(coalesce(p_whatsapp, '')), ''),
    email          = nullif(lower(trim(coalesce(p_email, ''))), ''),
    address        = nullif(trim(coalesce(p_address, '')), ''),
    school_grade   = nullif(trim(coalesce(p_school_grade, '')), '')
  where id = sid;
end;
$$;
revoke execute on function public.update_my_details(text, text, text, text, text, text) from public, anon;
grant  execute on function public.update_my_details(text, text, text, text, text, text) to authenticated;

select 'Update 24 installed' as result;
