-- =====================================================================
-- Update 28: FINANCE
--   * Income & expenses (receipts RC-0001…, payment vouchers PV-0001…)
--   * Fees: fee plans, sibling discounts, free places, monthly / term charges
--   * Staff payments and payslips (fixed monthly, per class, volunteer)
--   * Budget, month closing, bill / receipt attachments
--   * Students and parents see their own fee statement; staff see own payslips
--   Access: the admin, and anyone given "Finance" under Users → Access
--   (e.g. a Treasurer / accountant login).
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

-- ---------- who may use finance ----------
create or replace function public.fin_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_perm('finance');
$$;
grant execute on function public.fin_ok() to authenticated;

-- is this student mine (student login) or my child (parent login)?
create or replace function public.fin_is_mine(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = p_student and s.profile_id = auth.uid())
      or exists (select 1 from public.parent_links l where l.student_id = p_student and l.parent_id = auth.uid() and coalesce(l.verified, true));
$$;
grant execute on function public.fin_is_mine(uuid) to authenticated;

-- Treasurer / accountant: a staff login with only Finance access
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%staff_title%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.profiles add constraint profiles_staff_title_check
  check (staff_title is null or staff_title in ('assistant', 'principal', 'accountant')) not valid;

-- the finance team must be able to read students, classes and staff names
drop policy if exists "students: finance read" on public.students;
create policy "students: finance read" on public.students for select to authenticated using (public.fin_ok());
drop policy if exists "profiles: finance read" on public.profiles;
create policy "profiles: finance read" on public.profiles for select to authenticated using (public.fin_ok());
drop policy if exists "classes: finance read" on public.classes;
create policy "classes: finance read" on public.classes for select to authenticated using (public.fin_ok());
drop policy if exists "parent_links: finance read" on public.parent_links;
create policy "parent_links: finance read" on public.parent_links for select to authenticated using (public.fin_ok());
do $$ begin
  execute 'drop policy if exists "class_groups: finance read" on public.class_groups';
  execute 'create policy "class_groups: finance read" on public.class_groups for select to authenticated using (public.fin_ok())';
exception when undefined_table then null; end $$;

-- ---------- settings ----------
alter table public.settings add column if not exists fin_currency text not null default 'SAR';
alter table public.settings add column if not exists fin_sibling2_pct numeric(5,2) not null default 0;  -- 2nd child discount %
alter table public.settings add column if not exists fin_sibling3_pct numeric(5,2) not null default 0;  -- 3rd child and more %
alter table public.settings add column if not exists fin_year_start int not null default 9;            -- financial year starts in this month (9 = September)

-- ---------- categories and payment methods ----------
create table if not exists public.fin_categories (
  id     uuid primary key default gen_random_uuid(),
  kind   text not null check (kind in ('income', 'expense')),
  name   text not null,
  sort   int not null default 0,
  active boolean not null default true,
  unique (kind, name)
);
insert into public.fin_categories (kind, name, sort) values
  ('income', 'Student fees', 1), ('income', 'Admission / registration fees', 2), ('income', 'Donations / sadaqah', 3),
  ('income', 'Books & uniform sales', 4), ('income', 'Other income', 9),
  ('expense', 'Teacher payments', 1), ('expense', 'Hall / room rent', 2), ('expense', 'Books & Qurans', 3),
  ('expense', 'Printing & ID cards', 4), ('expense', 'Prizes & events', 5), ('expense', 'Refreshments', 6),
  ('expense', 'Transport', 7), ('expense', 'Stationery & supplies', 8), ('expense', 'Other expenses', 9)
on conflict (kind, name) do nothing;

create table if not exists public.fin_methods (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  sort   int not null default 0,
  active boolean not null default true
);
insert into public.fin_methods (name, sort) values ('Cash', 1), ('Bank transfer', 2), ('STC Pay', 3), ('Card', 4), ('Cheque', 5)
on conflict (name) do nothing;

-- ---------- income & expense entries ----------
create table if not exists public.fin_entries (
  id            uuid primary key default gen_random_uuid(),
  entry_no      text unique,                       -- RC-0001 (income) / PV-0001 (expense)
  kind          text not null check (kind in ('income', 'expense')),
  entry_date    date not null default current_date,
  category_id   uuid references public.fin_categories (id),
  amount        numeric(12,2) not null check (amount > 0),
  method        text,
  party         text,                              -- paid by / paid to
  details       text,
  reference     text,                              -- bank ref, cheque no., family receipt…
  student_id    uuid references public.students (id) on delete set null,
  staff_id      uuid references public.profiles (id) on delete set null,
  payslip_id    uuid,
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  cancel_reason text,
  cancelled_by  uuid,
  cancelled_at  timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists fin_entries_date on public.fin_entries (entry_date);
create index if not exists fin_entries_student on public.fin_entries (student_id);

-- attachments (photo of a bill, receipt, bank slip — images are made small before upload)
create table if not exists public.fin_files (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid references public.fin_entries (id) on delete cascade,
  payslip_id uuid,
  name       text,
  mime       text,
  size       int,
  data       text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- fees ----------
create table if not exists public.fee_plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  amount     numeric(12,2) not null check (amount >= 0),
  frequency  text not null default 'monthly' check (frequency in ('monthly', 'term', 'yearly', 'once')),
  group_id   uuid,                                 -- only this group (empty = everyone)
  class_id   uuid references public.classes (id) on delete set null,
  sibling_discount boolean not null default true,  -- apply brother / sister discount
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- per student: free place, own discount or own fixed fee
create table if not exists public.fee_student (
  student_id   uuid primary key references public.students (id) on delete cascade,
  exempt       boolean not null default false,
  discount_pct numeric(5,2) not null default 0,
  fixed_amount numeric(12,2),
  note         text
);

create table if not exists public.fee_charges (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id) on delete cascade,
  plan_id      uuid references public.fee_plans (id) on delete set null,
  period_label text not null,                      -- e.g. "November 2026", "Term 1"
  period_start date not null,
  due_date     date,
  amount       numeric(12,2) not null,             -- before discount
  discount     numeric(12,2) not null default 0,
  discount_note text,
  status       text not null default 'active' check (status in ('active', 'cancelled')),
  cancel_reason text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create unique index if not exists fee_charges_once on public.fee_charges (student_id, plan_id, period_start) where status = 'active';

-- ---------- staff payments ----------
create table if not exists public.staff_pay (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  pay_type   text not null default 'monthly' check (pay_type in ('monthly', 'per_class', 'volunteer')),
  amount     numeric(12,2) not null default 0,     -- monthly amount, or amount for each class
  note       text
);

create table if not exists public.payslips (
  id          uuid primary key default gen_random_uuid(),
  slip_no     text unique,                         -- PS-0001
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  month       date not null,                       -- first day of the month
  pay_type    text not null,
  basic       numeric(12,2) not null default 0,
  classes     int not null default 0,
  rate        numeric(12,2) not null default 0,
  allowances  jsonb not null default '[]',         -- [{ "label": "Transport", "amount": 100 }]
  deductions  jsonb not null default '[]',
  net         numeric(12,2) not null default 0,
  status      text not null default 'draft' check (status in ('draft', 'paid', 'cancelled')),
  paid_on     date,
  method      text,
  entry_id    uuid references public.fin_entries (id),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index if not exists payslips_once on public.payslips (profile_id, month) where status <> 'cancelled';

-- ---------- budget and month closing ----------
create table if not exists public.fin_budget (
  id          uuid primary key default gen_random_uuid(),
  year_label  text not null,                       -- academic year, e.g. 2026–2027
  category_id uuid not null references public.fin_categories (id) on delete cascade,
  amount      numeric(12,2) not null default 0,
  unique (year_label, category_id)
);

create table if not exists public.fin_closed (
  month     date primary key,                      -- first day of a closed month
  closed_by uuid default auth.uid(),
  closed_at timestamptz not null default now()
);

-- ---------- numbers: RC-0001, PV-0001, PS-0001 ----------
create or replace function public.fin_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare pre text; n int;
begin
  if tg_table_name = 'fin_entries' then
    if new.entry_no is not null and new.entry_no <> '' then return new; end if;
    pre := case when new.kind = 'income' then 'RC-' else 'PV-' end;
    perform pg_advisory_xact_lock(hashtext('fin-no-' || pre));
    select coalesce(max(substring(entry_no from '\d+$')::int), 0) + 1 into n from public.fin_entries where entry_no like pre || '%';
    new.entry_no := pre || lpad(n::text, 4, '0');
  else
    if new.slip_no is not null and new.slip_no <> '' then return new; end if;
    perform pg_advisory_xact_lock(hashtext('fin-no-PS'));
    select coalesce(max(substring(slip_no from '\d+$')::int), 0) + 1 into n from public.payslips where slip_no like 'PS-%';
    new.slip_no := 'PS-' || lpad(n::text, 4, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists fin_entries_number on public.fin_entries;
create trigger fin_entries_number before insert on public.fin_entries for each row execute function public.fin_number();
drop trigger if exists payslips_number on public.payslips;
create trigger payslips_number before insert on public.payslips for each row execute function public.fin_number();

-- ---------- closed months cannot change; entries are never deleted ----------
create or replace function public.fin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Finance entries are never deleted — cancel them with a reason instead.';
  end if;
  if exists (select 1 from public.fin_closed where month = date_trunc('month', new.entry_date)::date)
     or (tg_op = 'UPDATE' and exists (select 1 from public.fin_closed where month = date_trunc('month', old.entry_date)::date)) then
    raise exception 'This month is closed. Ask the admin to reopen it first.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'cancelled' then
    raise exception 'A cancelled entry cannot be changed.';
  end if;
  return new;
end;
$$;
drop trigger if exists fin_entries_guard on public.fin_entries;
create trigger fin_entries_guard before insert or update or delete on public.fin_entries for each row execute function public.fin_guard();

-- ---------- activity log ----------
create or replace function public.fin_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text; what text;
begin
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();
  if tg_table_name = 'fin_entries' then
    what := case when tg_op = 'INSERT' then 'Added ' else 'Changed ' end || new.entry_no || ' — ' || new.kind || ' ' || new.amount
            || coalesce(' · ' || new.details, '') || case when new.status = 'cancelled' then ' (CANCELLED: ' || coalesce(new.cancel_reason, '') || ')' else '' end;
  elsif tg_table_name = 'payslips' then
    what := case when tg_op = 'INSERT' then 'Payslip ' else 'Payslip changed ' end || coalesce(new.slip_no, '') || ' — net ' || new.net || ' (' || new.status || ')';
  else
    what := 'Fee ' || new.period_label || ' — ' || (new.amount - new.discount) || case when new.status = 'cancelled' then ' (cancelled)' else '' end;
  end if;
  begin
    insert into public.activity_log (actor_id, actor_name, action, table_name, record_id, summary)
    values (auth.uid(), who, lower(tg_op), tg_table_name, new.id, what);
  exception when others then null;  -- never stop a payment because of the log
  end;
  return new;
end;
$$;
drop trigger if exists fin_entries_log on public.fin_entries;
create trigger fin_entries_log after insert or update on public.fin_entries for each row execute function public.fin_log();
drop trigger if exists payslips_log on public.payslips;
create trigger payslips_log after insert or update on public.payslips for each row execute function public.fin_log();
drop trigger if exists fee_charges_log on public.fee_charges;
create trigger fee_charges_log after update on public.fee_charges for each row execute function public.fin_log();

-- ---------- row-level security ----------
alter table public.fin_categories enable row level security;
alter table public.fin_methods    enable row level security;
alter table public.fin_entries    enable row level security;
alter table public.fin_files      enable row level security;
alter table public.fee_plans      enable row level security;
alter table public.fee_student    enable row level security;
alter table public.fee_charges    enable row level security;
alter table public.staff_pay      enable row level security;
alter table public.payslips       enable row level security;
alter table public.fin_budget     enable row level security;
alter table public.fin_closed     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['fin_categories', 'fin_methods', 'fin_files', 'fee_plans', 'fee_student', 'staff_pay', 'fin_budget'] loop
    execute format('drop policy if exists "finance: all" on public.%I', t);
    execute format('create policy "finance: all" on public.%I for all to authenticated using (public.fin_ok()) with check (public.fin_ok())', t);
  end loop;
end $$;

-- fee plan names and categories: everyone signed in may read them (for statements)
drop policy if exists "fee_plans: read" on public.fee_plans;
create policy "fee_plans: read" on public.fee_plans for select to authenticated using (true);
-- categories and methods: everyone signed in may read the names (for statements)
drop policy if exists "fin_categories: read" on public.fin_categories;
create policy "fin_categories: read" on public.fin_categories for select to authenticated using (true);

-- entries: finance team reads and adds; students / parents read their own payments; no deletes
drop policy if exists "fin_entries: read" on public.fin_entries;
create policy "fin_entries: read" on public.fin_entries for select to authenticated
  using (public.fin_ok() or (kind = 'income' and student_id is not null and public.fin_is_mine(student_id)));
drop policy if exists "fin_entries: add" on public.fin_entries;
create policy "fin_entries: add" on public.fin_entries for insert to authenticated with check (public.fin_ok());
drop policy if exists "fin_entries: change" on public.fin_entries;
create policy "fin_entries: change" on public.fin_entries for update to authenticated using (public.fin_ok()) with check (public.fin_ok());

-- fee charges: finance team; students / parents read their own
drop policy if exists "fee_charges: read" on public.fee_charges;
create policy "fee_charges: read" on public.fee_charges for select to authenticated using (public.fin_ok() or public.fin_is_mine(student_id));
drop policy if exists "fee_charges: add" on public.fee_charges;
create policy "fee_charges: add" on public.fee_charges for insert to authenticated with check (public.fin_ok());
drop policy if exists "fee_charges: change" on public.fee_charges;
create policy "fee_charges: change" on public.fee_charges for update to authenticated using (public.fin_ok()) with check (public.fin_ok());

-- payslips: finance team; each staff member reads their own paid payslips
drop policy if exists "payslips: read" on public.payslips;
create policy "payslips: read" on public.payslips for select to authenticated using (public.fin_ok() or (profile_id = auth.uid() and status = 'paid'));
drop policy if exists "payslips: add" on public.payslips;
create policy "payslips: add" on public.payslips for insert to authenticated with check (public.fin_ok());
drop policy if exists "payslips: change" on public.payslips;
create policy "payslips: change" on public.payslips for update to authenticated using (public.fin_ok()) with check (public.fin_ok());

-- closed months: everyone in finance reads; only the admin closes / reopens
drop policy if exists "fin_closed: read" on public.fin_closed;
create policy "fin_closed: read" on public.fin_closed for select to authenticated using (public.fin_ok());
drop policy if exists "fin_closed: admin" on public.fin_closed;
create policy "fin_closed: admin" on public.fin_closed for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.fin_categories, public.fin_methods, public.fin_files, public.fee_plans,
  public.fee_student, public.staff_pay, public.fin_budget, public.fin_closed to authenticated;
grant select, insert, update on public.fin_entries, public.fee_charges, public.payslips to authenticated;

-- ---------- cancel an entry (never delete) ----------
create or replace function public.fin_cancel(p_entry uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fin_ok() then raise exception 'Only the finance team can cancel entries.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please give a reason for cancelling.'; end if;
  update public.fin_entries set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_entry and status = 'active';
  -- a cancelled salary payment puts its payslip back to "draft"
  update public.payslips set status = 'draft', entry_id = null, paid_on = null where entry_id = p_entry;
end;
$$;
grant execute on function public.fin_cancel(uuid, text) to authenticated;

-- ---------- create fee charges for a period ----------
-- Brothers and sisters are found by the parent login they share, or else by the same
-- guardian phone. The eldest child pays full; the 2nd and 3rd+ get the discount from Settings.
create or replace function public.fin_generate_charges(p_plan uuid, p_period_start date, p_label text, p_due date)
returns json language plpgsql security definer set search_path = public as $$
declare pl public.fee_plans; st public.settings; made int := 0; skipped int := 0;
begin
  if not public.fin_ok() then raise exception 'Only the finance team can create fees.'; end if;
  select * into pl from public.fee_plans where id = p_plan;
  if pl.id is null then raise exception 'Fee plan not found.'; end if;
  select * into st from public.settings limit 1;

  with fam as (
    select s.id, s.class_id, s.date_of_birth, s.created_at,
           coalesce((select min(l.parent_id::text) from public.parent_links l where l.student_id = s.id),
                    nullif(right(regexp_replace(coalesce(s.guardian_phone, s.whatsapp, ''), '\D', '', 'g'), 9), ''),
                    s.id::text) as fam_key
      from public.students s
     where s.status = 'approved'
  ), ranked as (
    select f.*, row_number() over (partition by fam_key order by date_of_birth nulls last, created_at, id) as child_no
      from fam f
  ), todo as (
    select r.id as student_id, r.child_no, fs.exempt, coalesce(fs.discount_pct, 0) as own_pct, fs.fixed_amount
      from ranked r
      left join public.fee_student fs on fs.student_id = r.id
      left join public.classes c on c.id = r.class_id
     where (pl.class_id is null or r.class_id = pl.class_id)
       and (pl.group_id is null or c.group_id = pl.group_id)
       and r.class_id is not null
  ), priced as (
    select t.*,
           coalesce(t.fixed_amount, pl.amount) as gross,
           case when not pl.sibling_discount or t.fixed_amount is not null then 0
                when t.child_no = 2 then st.fin_sibling2_pct
                when t.child_no >= 3 then st.fin_sibling3_pct else 0 end as sib_pct
      from todo t
     where not coalesce(t.exempt, false)
  ), ins as (
    insert into public.fee_charges (student_id, plan_id, period_label, period_start, due_date, amount, discount, discount_note)
    select p.student_id, pl.id, p_label, p_period_start, p_due, p.gross,
           round(p.gross - p.gross * (1 - p.sib_pct / 100) * (1 - p.own_pct / 100), 2),
           nullif(concat_ws(' + ', case when p.sib_pct > 0 then 'Child ' || p.child_no || ' (' || p.sib_pct || '%)' end,
                                   case when p.own_pct > 0 then 'Own discount ' || p.own_pct || '%' end), '')
      from priced p
    on conflict (student_id, plan_id, period_start) where status = 'active' do nothing
    returning 1
  )
  select count(*) into made from ins;

  select count(*) into skipped
    from public.students s left join public.classes c on c.id = s.class_id
   where s.status = 'approved' and s.class_id is not null
     and (pl.class_id is null or s.class_id = pl.class_id) and (pl.group_id is null or c.group_id = pl.group_id);
  return json_build_object('created', made, 'students', skipped);
end;
$$;
grant execute on function public.fin_generate_charges(uuid, date, text, date) to authenticated;

-- ---------- pay a payslip (creates the expense entry) ----------
create or replace function public.fin_pay_slip(p_slip uuid, p_date date, p_method text)
returns text language plpgsql security definer set search_path = public as $$
declare ps public.payslips; cat uuid; who text; e uuid; no text;
begin
  if not public.fin_ok() then raise exception 'Only the finance team can pay staff.'; end if;
  select * into ps from public.payslips where id = p_slip;
  if ps.id is null then raise exception 'Payslip not found.'; end if;
  if ps.status = 'paid' then raise exception 'This payslip is already paid.'; end if;
  if ps.net <= 0 then raise exception 'Nothing to pay on this payslip.'; end if;
  select id into cat from public.fin_categories where kind = 'expense' and name = 'Teacher payments';
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = ps.profile_id;
  insert into public.fin_entries (kind, entry_date, category_id, amount, method, party, details, staff_id, payslip_id)
  values ('expense', coalesce(p_date, current_date), cat, ps.net, p_method, who,
          'Staff payment ' || to_char(ps.month, 'FMMonth YYYY') || ' — ' || who || ' (' || ps.slip_no || ')', ps.profile_id, ps.id)
  returning id, entry_no into e, no;
  update public.payslips set status = 'paid', paid_on = coalesce(p_date, current_date), method = p_method, entry_id = e where id = ps.id;
  return no;
end;
$$;
grant execute on function public.fin_pay_slip(uuid, date, text) to authenticated;

-- ---------- classes taught in a month (for "per class" pay) ----------
create or replace function public.fin_classes_taught(p_month date)
returns table (profile_id uuid, days int) language sql stable security definer set search_path = public as $$
  select sa.profile_id, count(*)::int
    from public.staff_attendance sa
   where public.fin_ok()
     and sa.att_date >= date_trunc('month', p_month)::date
     and sa.att_date < (date_trunc('month', p_month) + interval '1 month')::date
     and sa.status in ('present', 'late')
   group by sa.profile_id;
$$;
grant execute on function public.fin_classes_taught(date) to authenticated;

-- ---------- finance settings (the finance team may change these, not other settings) ----------
create or replace function public.fin_set_settings(p_sibling2 numeric, p_sibling3 numeric, p_currency text, p_year_start int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fin_ok() then raise exception 'Only the finance team can change finance settings.'; end if;
  update public.settings set
    fin_sibling2_pct = greatest(0, least(100, coalesce(p_sibling2, fin_sibling2_pct))),
    fin_sibling3_pct = greatest(0, least(100, coalesce(p_sibling3, fin_sibling3_pct))),
    fin_currency     = coalesce(nullif(trim(p_currency), ''), fin_currency),
    fin_year_start   = coalesce(p_year_start, fin_year_start)
  where id = 1;
end;
$$;
grant execute on function public.fin_set_settings(numeric, numeric, text, int) to authenticated;

notify pgrst, 'reload schema';
select 'Update 28 installed — Finance is ready' as result;
