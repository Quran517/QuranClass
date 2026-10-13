-- =====================================================================
-- Update 7: scan attendance by QR code, barcode (QC number) or
--           school admission number; optionally add a student who has
--           no class to the class being marked.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

create or replace function public.mark_attendance_scan(
  p_value        text,
  p_class        uuid,
  p_date         date default current_date,
  p_add_to_class boolean default false
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v text := trim(coalesce(p_value, ''));
  s public.students%rowtype;
  cls_name text;
  added boolean := false;
  already boolean := false;
begin
  if not (public.is_admin() or public.teaches_class(p_class)) then
    raise exception 'You are not the teacher of this class.';
  end if;

  if upper(v) like 'QCSLISJ:%' then
    v := substr(v, 9);
  end if;

  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into s from public.students where qr_token = v::uuid;
  else
    select * into s from public.students where upper(student_code) = upper(v) limit 1;
    if not found then
      select * into s from public.students where upper(coalesce(admission_no, '')) = upper(v)
      order by (status = 'approved') desc limit 1;
    end if;
  end if;

  if not found then
    raise exception 'Card not recognised (%). Check the student ID.', left(v, 40);
  end if;
  if s.status <> 'approved' then
    raise exception '% (%) is not an approved student yet.', s.full_name, s.student_code;
  end if;

  if s.class_id is null then
    if p_add_to_class then
      update public.students set class_id = p_class where id = s.id;
      s.class_id := p_class;
      added := true;
    else
      raise exception 'NO_CLASS|%|%|% (%) has no class yet.', s.id, s.student_code, s.full_name, s.student_code;
    end if;
  end if;

  if s.class_id <> p_class then
    select name into cls_name from public.classes where id = s.class_id;
    raise exception '% (%) is in another class: %.', s.full_name, s.student_code, coalesce(cls_name, '?');
  end if;

  select exists (
    select 1 from public.attendance
    where student_id = s.id and class_id = p_class and att_date = p_date and status = 'present'
  ) into already;

  insert into public.attendance (student_id, class_id, att_date, status, method, marked_by, marked_at)
  values (s.id, p_class, p_date, 'present', 'qr', auth.uid(), now())
  on conflict (student_id, class_id, att_date)
  do update set status = 'present', method = 'qr', marked_by = auth.uid(), marked_at = now();

  return json_build_object(
    'student_id', s.id, 'full_name', s.full_name, 'student_code', s.student_code,
    'added_to_class', added, 'already', already
  );
end;
$$;

revoke execute on function public.mark_attendance_scan(text, uuid, date, boolean) from public, anon;
grant  execute on function public.mark_attendance_scan(text, uuid, date, boolean) to authenticated;

select 'Update 7 installed' as result;
