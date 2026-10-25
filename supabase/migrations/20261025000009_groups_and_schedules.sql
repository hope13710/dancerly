-- Groups inside a project (e.g. "Juniors", "Front line"), requests aimed at groups,
-- weekly repeating requests, and an hourly job for due-date reminders and the next repeat.

-- ---------- Groups ----------
create table public.project_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
create index project_groups_creator_idx on public.project_groups (created_by);

create table public.project_group_members (
  group_id uuid not null references public.project_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (group_id, user_id)
);
create index project_group_members_user_idx on public.project_group_members (user_id);

alter table public.project_groups enable row level security;
alter table public.project_group_members enable row level security;

create policy "groups: members can see" on public.project_groups
  for select to authenticated using (private.is_project_member(project_id));
create policy "groups: members can create" on public.project_groups
  for insert to authenticated with check (private.is_project_member(project_id) and created_by = (select auth.uid()));
create policy "groups: creator or owner renames" on public.project_groups
  for update to authenticated
  using (created_by = (select auth.uid()) or private.is_project_owner(project_id))
  with check (private.is_project_member(project_id));
create policy "groups: creator or owner deletes" on public.project_groups
  for delete to authenticated using (created_by = (select auth.uid()) or private.is_project_owner(project_id));

create function private.can_manage_group(p_group uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_groups g
    where g.id = p_group and (g.created_by = (select auth.uid()) or private.is_project_owner(g.project_id))
  );
$$;
grant execute on function private.can_manage_group(uuid) to authenticated;

create policy "group members: members can see" on public.project_group_members
  for select to authenticated using (
    exists (select 1 from public.project_groups g where g.id = group_id and private.is_project_member(g.project_id))
  );
-- Only people already on the project can be added.
create policy "group members: manager adds teammates" on public.project_group_members
  for insert to authenticated with check (
    private.can_manage_group(group_id)
    and exists (
      select 1 from public.project_groups g join public.project_members m on m.project_id = g.project_id
      where g.id = group_id and m.user_id = project_group_members.user_id
    )
  );
create policy "group members: manager removes" on public.project_group_members
  for delete to authenticated using (private.can_manage_group(group_id));

-- ---------- Requests: audience label, weekly repeat, reminder bookkeeping ----------
alter table public.requests
  add column audience text check (audience is null or char_length(audience) <= 200),
  add column repeat_weekly boolean not null default false,
  add column repeat_of uuid references public.requests (id) on delete set null,
  add column due_reminded_at timestamptz;
create index requests_repeat_of_idx on public.requests (repeat_of);
create index requests_due_idx on public.requests (due_at) where status = 'active';
grant update (repeat_weekly) on public.requests to authenticated;

alter type public.notification_kind add value if not exists 'request_due';

-- Groups expand into people when the request is created (a snapshot: later group changes don't move old requests).
create function public.create_request_v2(
  p_project uuid, p_title text, p_brief text, p_due timestamptz,
  p_assignees uuid[], p_groups uuid[], p_reference uuid, p_repeat_weekly boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid;
  people uuid[];
  label text;
begin
  if not private.is_project_member(p_project) then
    raise exception 'Project not found';
  end if;
  if p_repeat_weekly and p_due is null then
    raise exception 'A weekly request needs a due date';
  end if;
  select coalesce(array_agg(distinct u), '{}') into people from (
    select unnest(coalesce(p_assignees, '{}')) as u
    union
    select gm.user_id from public.project_group_members gm
    join public.project_groups g on g.id = gm.group_id
    where g.project_id = p_project and g.id = any (coalesce(p_groups, '{}'))
  ) s;
  select string_agg(g.name, ', ' order by g.name) into label
  from public.project_groups g where g.project_id = p_project and g.id = any (coalesce(p_groups, '{}'));
  if coalesce(array_length(p_groups, 1), 0) > 0 and coalesce(array_length(people, 1), 0) = 0 then
    raise exception 'Those groups have nobody in them yet';
  end if;

  insert into public.requests (project_id, title, brief, due_at, everyone, reference_video_id, created_by, audience, repeat_weekly)
  values (p_project, p_title, nullif(btrim(coalesce(p_brief, '')), ''), p_due, coalesce(array_length(people, 1), 0) = 0,
          (select v.id from public.videos v where v.id = p_reference and v.project_id = p_project), (select auth.uid()),
          label, coalesce(p_repeat_weekly, false))
  returning id into rid;
  if coalesce(array_length(people, 1), 0) > 0 then
    insert into public.request_assignees (request_id, user_id)
    select rid, m.user_id from public.project_members m where m.project_id = p_project and m.user_id = any (people);
  end if;
  perform private.notify_request(rid, 'request_new', false);
  return rid;
end;
$$;
revoke execute on function public.create_request_v2(uuid, text, text, timestamptz, uuid[], uuid[], uuid, boolean) from public, anon;
grant execute on function public.create_request_v2(uuid, text, text, timestamptz, uuid[], uuid[], uuid, boolean) to authenticated;

-- ---------- Hourly job ----------
-- 1) 24 hours before a due date, nudge everyone who hasn't submitted (once).
-- 2) When a weekly request's due date passes, close it and open next week's copy.
create function private.run_request_schedule()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests;
  nid uuid;
  next_due timestamptz;
begin
  for r in
    select * from public.requests
    where status = 'active' and due_reminded_at is null and due_at > now() and due_at <= now() + interval '24 hours'
  loop
    perform private.notify_request(r.id, 'request_due', true);
    update public.requests set due_reminded_at = now() where id = r.id;
  end loop;

  for r in
    select * from public.requests where status = 'active' and repeat_weekly and due_at <= now()
  loop
    next_due := r.due_at + interval '7 days';
    while next_due <= now() loop
      next_due := next_due + interval '7 days';
    end loop;
    update public.requests set status = 'closed', closed_at = now(), repeat_weekly = false where id = r.id;
    insert into public.requests (project_id, title, brief, due_at, everyone, reference_video_id, created_by, audience, repeat_weekly, repeat_of)
    values (r.project_id, r.title, r.brief, next_due, r.everyone, r.reference_video_id, r.created_by, r.audience, true, coalesce(r.repeat_of, r.id))
    returning id into nid;
    insert into public.request_assignees (request_id, user_id)
    select nid, a.user_id from public.request_assignees a
    join public.project_members m on m.user_id = a.user_id and m.project_id = r.project_id
    where a.request_id = r.id;
    -- Tell people, as if from whoever set it up.
    perform set_config('request.jwt.claims', json_build_object('sub', r.created_by)::text, true);
    perform private.notify_request(nid, 'request_new', false);
    perform set_config('request.jwt.claims', '{}', true);
  end loop;
end;
$$;
revoke execute on function private.run_request_schedule() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('looproom-request-schedule', '7 * * * *', $$select private.run_request_schedule()$$);
