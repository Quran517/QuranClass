-- =====================================================================
-- SLIS-Jeddah Quran Class Management — database setup
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again: it only creates what is missing and
-- re-creates the security policies.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. Older versions of these tables (from the first starter project)
-- are renamed to <name>_old so nothing is deleted, and fresh tables are
-- created below. Tables that already match this version are left alone.
-- ---------------------------------------------------------------------
do $$
declare
  t record;
  i record;
  missing int;
  suffix text;
begin
  for t in
    select * from (values
      (1, 'attendance', array['id','student_id','class_id','att_date','status','method','marked_by','marked_at']),
      (2, 'students',   array['id','profile_id','student_code','full_name','gender','date_of_birth','school_grade','quran_level','guardian_name','guardian_phone','whatsapp','address','notes','class_id','status','qr_token','consent_given','created_at','approved_at']),
      (3, 'classes',    array['id','name','level','schedule','teacher_id','created_at']),
      (4, 'profiles',   array['id','email','full_name','phone','role','created_at'])
    ) as v(ord, name, cols)
    order by ord
  loop
    if to_regclass('public.' || t.name) is not null then
      select count(*) into missing
      from unnest(t.cols) c
      where not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t.name and column_name = c
      );
      if missing > 0 then
        suffix := '_old';
        while to_regclass('public.' || t.name || suffix) is not null loop
          suffix := suffix || '_';
        end loop;
        execute format('alter table public.%I rename to %I', t.name, t.name || suffix);
        -- lock the old copy so it can't be read through the website's API
        execute format('alter table public.%I enable row level security', t.name || suffix);
        execute format('revoke all on public.%I from anon, authenticated', t.name || suffix);
        -- give its indexes new names too, so the fresh tables can use the standard ones
        for i in
          select ic.relname as idx from pg_index x
          join pg_class ic on ic.oid = x.indexrelid
          where x.indrelid = ('public.' || quote_ident(t.name || suffix))::regclass
        loop
          begin
            execute format('alter index public.%I rename to %I', i.idx, left(i.idx, 55) || suffix);
          exception when others then null;
          end;
        end loop;
        raise notice 'Renamed old table % to %', t.name, t.name || suffix;
      end if;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- One row per login (student, teacher or admin). Created automatically
-- when someone signs up.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  role        text not null default 'student'
              check (role in ('student', 'teacher', 'admin')),
  created_at  timestamptz not null default now()
);

create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  level       text,
  schedule    text,
  teacher_id  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create sequence if not exists public.student_code_seq start 1001;

-- One row per student. A student who signs up submits an admission
-- application (status = pending); the admin approves it and assigns a class.
-- The admin can also add students who have no login of their own.
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid unique references public.profiles(id) on delete set null,
  student_code    text unique not null
                  default ('QC' || nextval('public.student_code_seq')::text),
  full_name       text not null,
  gender          text check (gender in ('male', 'female')),
  date_of_birth   date,
  school_grade    text,
  quran_level     text,
  guardian_name   text,
  guardian_phone  text,
  whatsapp        text,
  address         text,
  notes           text,
  class_id        uuid references public.classes(id) on delete set null,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'inactive')),
  qr_token        uuid unique not null default gen_random_uuid(),
  consent_given   boolean not null default false,
  created_at      timestamptz not null default now(),
  approved_at     timestamptz
);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  att_date    date not null default current_date,
  status      text not null check (status in ('present', 'absent', 'late', 'excused')),
  method      text not null default 'manual' check (method in ('manual', 'qr')),
  marked_by   uuid references public.profiles(id) on delete set null,
  marked_at   timestamptz not null default now(),
  unique (student_id, class_id, att_date)
);

create index if not exists attendance_class_date_idx on public.attendance (class_id, att_date);
create index if not exists attendance_student_idx    on public.attendance (student_id);
create index if not exists students_class_idx        on public.students (class_id);
create index if not exists classes_teacher_idx       on public.classes (teacher_id);

-- ---------------------------------------------------------------------
-- 2. Helper functions (used by the security policies)
-- ---------------------------------------------------------------------

-- Older versions of these helpers may exist with a different shape.
-- Dropping them also drops the policies that use them; all policies are
-- re-created in section 5 below.
drop function if exists public.is_admin() cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.teaches_class(uuid) cascade;
drop function if exists public.my_student_id() cascade;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'));
$$;

create or replace function public.teaches_class(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes where id = p_class and teacher_id = auth.uid());
$$;

create or replace function public.my_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.students where profile_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------

-- Create a profile automatically for every new sign-up (always as 'student').
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Remove sign-up triggers left by the older starter version (they would
-- write to the old tables' layout and break new sign-ups).
do $$
declare r record;
begin
  for r in
    select tg.tgname from pg_trigger tg
    join pg_proc p on p.oid = tg.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where tg.tgrelid = 'auth.users'::regclass and not tg.tgisinternal
      and n.nspname = 'public' and tg.tgname <> 'on_auth_user_created'
  loop
    execute format('drop trigger %I on auth.users', r.tgname);
    raise notice 'Removed old sign-up trigger %', r.tgname;
  end loop;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create profiles for anyone who signed up before this script was run.
insert into public.profiles (id, email, full_name, phone)
select u.id, u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', ''),
       coalesce(u.raw_user_meta_data ->> 'phone', '')
from auth.users u
on conflict (id) do nothing;

-- Only an admin may change someone's role or email.
-- (Changes made from the SQL Editor are allowed, so you can create the first admin.)
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role  := old.role;
    new.email := old.email;
    new.id    := old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- Students cannot approve themselves, pick a class or change their QR code.
create or replace function public.protect_student_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status       := 'pending';
      new.class_id     := null;
      new.approved_at  := null;
      new.profile_id   := auth.uid();
      new.qr_token     := gen_random_uuid();
      new.student_code := 'QC' || nextval('public.student_code_seq')::text;
    else
      new.status       := old.status;
      new.class_id     := old.class_id;
      new.approved_at  := old.approved_at;
      new.profile_id   := old.profile_id;
      new.qr_token     := old.qr_token;
      new.student_code := old.student_code;
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status <> 'approved' then
    new.approved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists protect_student_fields on public.students;
create trigger protect_student_fields
  before insert or update on public.students
  for each row execute function public.protect_student_fields();

-- ---------------------------------------------------------------------
-- 4. QR attendance (called by the teacher's scanner)
-- ---------------------------------------------------------------------

create or replace function public.mark_attendance_qr(p_token uuid, p_class uuid, p_date date default current_date)
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.students%rowtype;
begin
  if not (public.is_admin() or public.teaches_class(p_class)) then
    raise exception 'You are not the teacher of this class.';
  end if;

  select * into s from public.students where qr_token = p_token;
  if not found then
    raise exception 'QR code not recognised.';
  end if;
  if s.status <> 'approved' then
    raise exception '% is not an approved student.', s.full_name;
  end if;
  if s.class_id is distinct from p_class then
    raise exception '% is not in this class.', s.full_name;
  end if;

  insert into public.attendance (student_id, class_id, att_date, status, method, marked_by, marked_at)
  values (s.id, p_class, p_date, 'present', 'qr', auth.uid(), now())
  on conflict (student_id, class_id, att_date)
  do update set status = 'present', method = 'qr', marked_by = auth.uid(), marked_at = now();

  return json_build_object('student_id', s.id, 'full_name', s.full_name, 'student_code', s.student_code);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Row-level security (who can see and change what)
-- ---------------------------------------------------------------------

alter table public.profiles   enable row level security;
alter table public.classes    enable row level security;
alter table public.students   enable row level security;
alter table public.attendance enable row level security;

-- profiles
drop policy if exists "profiles: read own"          on public.profiles;
drop policy if exists "profiles: admin reads all"   on public.profiles;
drop policy if exists "profiles: update own"        on public.profiles;
drop policy if exists "profiles: admin updates all" on public.profiles;
drop policy if exists "profiles: admin deletes"     on public.profiles;

create policy "profiles: read own"          on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles: admin reads all"   on public.profiles for select to authenticated using (public.is_admin());
create policy "profiles: update own"        on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles: admin updates all" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "profiles: admin deletes"     on public.profiles for delete to authenticated using (public.is_admin());

-- classes
drop policy if exists "classes: signed-in users read" on public.classes;
drop policy if exists "classes: admin manages"        on public.classes;

create policy "classes: signed-in users read" on public.classes for select to authenticated using (true);
create policy "classes: admin manages"        on public.classes for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- students
drop policy if exists "students: read own"             on public.students;
drop policy if exists "students: apply"                on public.students;
drop policy if exists "students: edit own pending"     on public.students;
drop policy if exists "students: teacher reads class"  on public.students;
drop policy if exists "students: admin manages"        on public.students;

create policy "students: read own"            on public.students for select to authenticated using (profile_id = auth.uid());
create policy "students: apply"               on public.students for insert to authenticated
  with check (profile_id = auth.uid());
create policy "students: edit own pending"    on public.students for update to authenticated
  using (profile_id = auth.uid() and status = 'pending') with check (profile_id = auth.uid());
create policy "students: teacher reads class" on public.students for select to authenticated using (public.teaches_class(class_id));
create policy "students: admin manages"       on public.students for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- attendance
drop policy if exists "attendance: student reads own"     on public.attendance;
drop policy if exists "attendance: teacher reads class"   on public.attendance;
drop policy if exists "attendance: teacher marks"         on public.attendance;
drop policy if exists "attendance: teacher updates"       on public.attendance;
drop policy if exists "attendance: teacher deletes"       on public.attendance;
drop policy if exists "attendance: admin manages"         on public.attendance;

create policy "attendance: student reads own"   on public.attendance for select to authenticated using (student_id = public.my_student_id());
create policy "attendance: teacher reads class" on public.attendance for select to authenticated using (public.teaches_class(class_id));
create policy "attendance: teacher marks"       on public.attendance for insert to authenticated
  with check (public.teaches_class(class_id)
              and exists (select 1 from public.students s where s.id = student_id and s.class_id = attendance.class_id));
create policy "attendance: teacher updates"     on public.attendance for update to authenticated
  using (public.teaches_class(class_id)) with check (public.teaches_class(class_id));
create policy "attendance: teacher deletes"     on public.attendance for delete to authenticated using (public.teaches_class(class_id));
create policy "attendance: admin manages"       on public.attendance for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Permissions for the app's API (signed-in users only; nothing public)
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.classes, public.students, public.attendance from anon;
grant select, insert, update, delete on public.profiles, public.classes, public.students, public.attendance to authenticated;
grant usage on sequence public.student_code_seq to authenticated;

revoke execute on function public.mark_attendance_qr(uuid, uuid, date) from public, anon;
grant  execute on function public.mark_attendance_qr(uuid, uuid, date) to authenticated;
grant  execute on function public.is_admin(), public.is_staff(), public.teaches_class(uuid), public.my_student_id() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Keep-alive
-- Free Supabase projects pause after about 7 days without activity
-- (school holidays, Ramadan breaks…). The GitHub workflow in
-- .github/workflows/keep-alive.yml calls this every day so the project
-- never pauses. It returns only the current time — no data.
-- ---------------------------------------------------------------------

create or replace function public.keep_alive()
returns timestamptz language sql stable as $$ select now(); $$;

revoke execute on function public.keep_alive() from public;
grant  execute on function public.keep_alive() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Make yourself the first admin
-- Sign up in the app first, then replace the email below and run ONLY this line:
--
--   update public.profiles set role = 'admin' where email = 'quranclass.slisj@yahoo.com';
-- ---------------------------------------------------------------------
