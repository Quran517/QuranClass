-- =====================================================================
-- Update 29:
--   * Deactivate / reactivate a login (staff, parent or student) — they cannot
--     sign in while inactive; nothing is deleted
--   * Staff fixed monthly pay can be reduced automatically for missed classes
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists deactivated_at timestamptz;

create or replace function public.admin_set_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only the admin can deactivate or reactivate logins.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot deactivate your own login.';
  end if;
  update public.profiles set active = p_active, deactivated_at = case when p_active then null else now() end where id = p_user;
  -- blocks (or allows) signing in; the account and all its records are kept
  update auth.users set banned_until = case when p_active then null else 'infinity'::timestamptz end where id = p_user;
end;
$$;
revoke execute on function public.admin_set_active(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_active(uuid, boolean) to authenticated;

-- fixed monthly pay: reduce for classes missed
do $$ begin
  alter table public.staff_pay add column if not exists absence_deduct boolean not null default false;
exception when undefined_table then
  raise exception 'Please run update-28.sql (Finance) first.';
end $$;

-- classes attended and excused per staff member in a month
drop function if exists public.fin_classes_taught(date);
create or replace function public.fin_classes_taught(p_month date)
returns table (profile_id uuid, days int, excused int) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fin_ok() then return; end if;
  return query
    select sa.profile_id,
           count(*) filter (where sa.status in ('present', 'late'))::int,
           count(*) filter (where sa.status = 'excused')::int
      from public.staff_attendance sa
     where sa.att_date >= date_trunc('month', p_month)::date
       and sa.att_date < (date_trunc('month', p_month) + interval '1 month')::date
     group by sa.profile_id;
exception when undefined_table then
  return;
end;
$$;
grant execute on function public.fin_classes_taught(date) to authenticated;

notify pgrst, 'reload schema';
select 'Update 29 installed' as result;
