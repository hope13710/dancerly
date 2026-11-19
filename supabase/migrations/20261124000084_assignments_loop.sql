-- Assignments, closing the loop:
-- 1) A submission can carry a short note for the person who asked ("Marked the jump, knee's still sore"):
--    takes.message, written when the take is uploaded, shown with the video and in the notification.
-- 2) A reference can be the choreo video or one of the practice sections, so "film the ending pose" opens Practice
--    looping that section (requests.reference_choreo, requests.reference_section_id).
-- 3) When everyone it's for has submitted, the person who asked hears about it once (notification request_all_in).
-- 4) Who an assignment is for can be changed after it's sent (set_request_assignees); people added get it in their
--    Inbox like everyone else did.
-- Weekly assignments now carry their reference take and the new references into next week's copy.

-- ---------- 1) A note with the submission ----------
alter table public.takes add column if not exists message text
  check (message is null or char_length(btrim(message)) between 1 and 500);

-- ---------- 2) Practice references ----------
alter table public.requests add column if not exists reference_choreo boolean not null default false;
alter table public.requests add column if not exists reference_section_id uuid references public.count_sheet_rows (id) on delete set null;
create index if not exists requests_reference_section_idx on public.requests (reference_section_id);

-- A section from another project doesn't count.
create or replace function private.request_reference_section()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.reference_section_id is not null and not exists (
    select 1 from public.count_sheet_rows s where s.id = new.reference_section_id and s.project_id = new.project_id
  ) then
    new.reference_section_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists request_reference_section on public.requests;
create trigger request_reference_section before insert or update of reference_section_id on public.requests
  for each row execute function private.request_reference_section();
grant update (reference_choreo, reference_section_id) on public.requests to authenticated;

-- ---------- 3) Everyone's in ----------
alter type public.notification_kind add value if not exists 'request_all_in';
alter table public.requests add column if not exists all_in_at timestamptz;

create or replace function private.request_all_in()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests;
  people int;
  waiting int;
begin
  select q.* into r from public.requests q
  join public.videos v on v.request_id = q.id
  join public.projects p on p.id = q.project_id
  where v.id = new.video_id and q.status = 'active' and q.all_in_at is null and not p.is_sample;
  if r.id is null then return null; end if;
  -- The person who asked isn't one of the people it's for.
  select count(*), count(*) filter (where not exists (
    select 1 from public.videos v join public.takes t on t.video_id = v.id
    where v.request_id = r.id and v.created_by = u.id and t.deleted_at is null
  )) into people, waiting
  from private.request_people(r.id) as u(id)
  where u.id <> r.created_by;
  if people = 0 or waiting > 0 then return null; end if;
  update public.requests set all_in_at = now() where id = r.id;
  if coalesce((select (notify ->> 'request')::boolean from public.profiles where id = r.created_by), true)
     and exists (select 1 from public.project_members m where m.project_id = r.project_id and m.user_id = r.created_by) then
    insert into public.notifications (user_id, kind, actor_id, project_id, request_id)
    values (r.created_by, 'request_all_in', new.uploaded_by, r.project_id, r.id);
  end if;
  return null;
end;
$$;
drop trigger if exists request_all_in on public.takes;
create trigger request_all_in after insert on public.takes
  for each row execute function private.request_all_in();

-- ---------- 4) Changing who it's for ----------
-- Everyone, or the people listed (members of the project, not the person who asked). Returns how many were added.
create or replace function public.set_request_assignees(p_request uuid, p_everyone boolean, p_people uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests;
  me uuid := (select auth.uid());
  before uuid[];
  added int := 0;
  u uuid;
begin
  select * into r from public.requests where id = p_request;
  if r.id is null or not (r.created_by = me or private.is_project_owner(r.project_id)) then
    raise exception 'Only the person who sent it or the project owner can change who it''s for';
  end if;
  select coalesce(array_agg(x), '{}') into before from private.request_people(r.id) as x;

  if coalesce(p_everyone, false) then
    delete from public.request_assignees where request_id = r.id;
    update public.requests set everyone = true, audience = null where id = r.id;
  else
    if not exists (
      select 1 from public.project_members m
      where m.project_id = r.project_id and m.user_id = any (coalesce(p_people, '{}')) and m.user_id <> r.created_by
    ) then
      raise exception 'Pick at least one person';
    end if;
    delete from public.request_assignees where request_id = r.id and not (user_id = any (p_people));
    insert into public.request_assignees (request_id, user_id)
    select r.id, m.user_id from public.project_members m
    where m.project_id = r.project_id and m.user_id = any (p_people) and m.user_id <> r.created_by
    on conflict do nothing;
    update public.requests set everyone = false, audience = null where id = r.id;
  end if;

  -- Newly added people get it in their Inbox, as if it had just been sent to them.
  for u in select x from private.request_people(r.id) as x where not (x = any (before)) loop
    continue when u = me or u = r.created_by;
    if r.status = 'active' and coalesce((select (notify ->> 'request')::boolean from public.profiles where id = u), true) then
      insert into public.notifications (user_id, kind, actor_id, project_id, request_id)
      values (u, 'request_new', me, r.project_id, r.id);
    end if;
    added := added + 1;
  end loop;
  -- Someone new hasn't submitted yet, so "everyone's in" can be true again later.
  if added > 0 then update public.requests set all_in_at = null where id = r.id; end if;
  return added;
end;
$$;
revoke execute on function public.set_request_assignees(uuid, boolean, uuid[]) from public, anon;
grant execute on function public.set_request_assignees(uuid, boolean, uuid[]) to authenticated;

-- ---------- Weekly copies keep their references ----------
create or replace function private.run_request_schedule()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests;
  nid uuid;
  next_due timestamptz;
begin
  for r in
    select q.* from public.requests q join public.projects p on p.id = q.project_id
    where q.status = 'active' and q.due_reminded_at is null and q.due_at > now() and q.due_at <= now() + interval '24 hours'
      and not p.is_sample
  loop
    perform private.notify_request(r.id, 'request_due', true);
    update public.requests set due_reminded_at = now() where id = r.id;
  end loop;

  for r in
    select q.* from public.requests q join public.projects p on p.id = q.project_id
    where q.status = 'active' and q.repeat_weekly and q.due_at <= now() and not p.is_sample
  loop
    next_due := r.due_at + interval '7 days';
    while next_due <= now() loop
      next_due := next_due + interval '7 days';
    end loop;
    update public.requests set status = 'closed', closed_at = now(), repeat_weekly = false where id = r.id;
    insert into public.requests (project_id, title, brief, due_at, everyone, reference_video_id, reference_take_id,
                                 reference_choreo, reference_section_id, created_by, audience, repeat_weekly, repeat_of)
    values (r.project_id, r.title, r.brief, next_due, r.everyone, r.reference_video_id, r.reference_take_id,
            r.reference_choreo, r.reference_section_id, r.created_by, r.audience, true, coalesce(r.repeat_of, r.id))
    returning id into nid;
    insert into public.request_assignees (request_id, user_id)
    select nid, a.user_id from public.request_assignees a
    join public.project_members m on m.user_id = a.user_id and m.project_id = r.project_id
    where a.request_id = r.id;
    perform set_config('request.jwt.claims', json_build_object('sub', r.created_by)::text, true);
    perform private.notify_request(nid, 'request_new', false);
    perform set_config('request.jwt.claims', '{}', true);
  end loop;
end;
$$;
