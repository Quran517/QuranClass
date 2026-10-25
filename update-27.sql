-- =====================================================================
-- Update 27: ID card print status (Printed / Not printed)
--   * every student and staff card remembers when it was printed, how many
--     times and by whom
--   * Reset sets a card back to "Not printed"
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

create table if not exists public.card_prints (
  person_kind text not null check (person_kind in ('student', 'staff')),
  person_id   uuid not null,
  printed_at  timestamptz not null default now(),
  printed_by  uuid references public.profiles (id) on delete set null,
  print_count int not null default 1,
  primary key (person_kind, person_id)
);
alter table public.card_prints enable row level security;

-- Who may print a card: admin / ID-card access for everyone, a teacher for the
-- students in their own classes, and anyone for their own staff card.
create or replace function public.can_print_card(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_perm('idcards')
      or (p_kind = 'student' and exists (select 1 from public.students s where s.id = p_id and public.teaches_class(s.class_id)))
      or (p_kind = 'staff' and p_id = auth.uid());
$$;
grant execute on function public.can_print_card(text, uuid) to authenticated;

drop policy if exists "card_prints: read" on public.card_prints;
create policy "card_prints: read" on public.card_prints for select to authenticated
  using (public.can_print_card(person_kind, person_id));
grant select on public.card_prints to authenticated;

create or replace function public.mark_cards_printed(p_kind text, p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; i uuid;
begin
  foreach i in array coalesce(p_ids, '{}') loop
    if not public.can_print_card(p_kind, i) then
      raise exception 'You cannot print this ID card.';
    end if;
    insert into public.card_prints (person_kind, person_id, printed_at, printed_by, print_count)
    values (p_kind, i, now(), auth.uid(), 1)
    on conflict (person_kind, person_id) do update
      set printed_at = now(), printed_by = auth.uid(), print_count = public.card_prints.print_count + 1;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.reset_card_print(p_kind text, p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if exists (select 1 from unnest(coalesce(p_ids, '{}')) i where not public.can_print_card(p_kind, i)) then
    raise exception 'You cannot change this ID card.';
  end if;
  delete from public.card_prints where person_kind = p_kind and person_id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.mark_cards_printed(text, uuid[]) from public, anon;
grant  execute on function public.mark_cards_printed(text, uuid[]) to authenticated;
revoke execute on function public.reset_card_print(text, uuid[]) from public, anon;
grant  execute on function public.reset_card_print(text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
select 'Update 27 installed' as result;
