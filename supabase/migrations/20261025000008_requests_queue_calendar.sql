-- Requests (ask people to submit a video by a date), the review queue (what you haven't watched yet),
-- and the project calendar (rehearsals, shows, and request due dates).

-- ---------- Requests ----------
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  brief text check (brief is null or char_length(brief) <= 4000),
  due_at timestamptz,
  -- true: everyone on the project; false: only the people in request_assignees.
  everyone boolean not null default true,
  reference_video_id uuid references public.videos (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  last_reminded_at timestamptz
);
create index requests_project_idx on public.requests (project_id, created_at desc);
create index requests_creator_idx on public.requests (created_by);
create index requests_reference_idx on public.requests (reference_video_id);

create table public.request_assignees (
  request_id uuid not null references public.requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (request_id, user_id)
);
create index request_assignees_user_idx on public.request_assignees (user_id);

-- A submission is a video that answers a request; re-submitting adds a take to it.
alter table public.videos add column request_id uuid references public.requests (id) on delete set null;
create index videos_request_idx on public.videos (request_id);

create function private.check_video_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.request_id is not null and not exists (
    select 1 from public.requests r where r.id = new.request_id and r.project_id = new.project_id
  ) then
    raise exception 'That request belongs to another project';
  end if;
  return new;
end;
$$;
create trigger before_video_request
  before insert or update of request_id on public.videos
  for each row execute function private.check_video_request();

alter table public.requests enable row level security;
alter table public.request_assignees enable row level security;

create policy "requests: members can see" on public.requests
  for select to authenticated using (private.is_project_member(project_id));
create policy "requests: creator or owner edits" on public.requests
  for update to authenticated
  using (created_by = (select auth.uid()) or private.is_project_owner(project_id))
  with check (private.is_project_member(project_id));
create policy "requests: creator or owner deletes" on public.requests
  for delete to authenticated using (created_by = (select auth.uid()) or private.is_project_owner(project_id));
revoke update on public.requests from authenticated;
grant update (title, brief, due_at, reference_video_id, status, closed_at) on public.requests to authenticated;

create policy "request assignees: members can see" on public.request_assignees
  for select to authenticated using (
    exists (select 1 from public.requests r where r.id = request_id and private.is_project_member(r.project_id))
  );

-- ---------- Inbox kinds ----------
alter type public.notification_kind add value if not exists 'request_new';
alter type public.notification_kind add value if not exists 'request_reminder';
alter table public.notifications add column request_id uuid references public.requests (id) on delete cascade;
create index notifications_request_idx on public.notifications (request_id);
update public.profiles set notify = notify || '{"request": true}'::jsonb where not notify ? 'request';
alter table public.profiles alter column notify set default '{"mention": true, "note_on_your_video": true, "new_take": true, "note_resolved": true, "joined": true, "recap_shared": true, "request": true}'::jsonb;

-- Who a request is for, as user ids.
create function private.request_people(p_request uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id
  from public.requests r
  join public.project_members m on m.project_id = r.project_id
  where r.id = p_request
    and (r.everyone or exists (select 1 from public.request_assignees a where a.request_id = r.id and a.user_id = m.user_id));
$$;

create function private.notify_request(p_request uuid, p_kind public.notification_kind, p_only_missing boolean)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests;
  u uuid;
  sent int := 0;
begin
  select * into r from public.requests where id = p_request;
  for u in select * from private.request_people(p_request) loop
    continue when u = (select auth.uid());
    continue when p_only_missing and exists (select 1 from public.videos v where v.request_id = r.id and v.created_by = u);
    continue when coalesce((select (notify ->> 'request')::boolean from public.profiles where id = u), true) is false;
    insert into public.notifications (user_id, kind, actor_id, project_id, request_id)
    values (u, p_kind, (select auth.uid()), r.project_id, r.id);
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

-- Create a request with its assignees in one go, and tell them.
create function public.create_request(p_project uuid, p_title text, p_brief text, p_due timestamptz, p_assignees uuid[], p_reference uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid;
begin
  if not private.is_project_member(p_project) then
    raise exception 'Project not found';
  end if;
  insert into public.requests (project_id, title, brief, due_at, everyone, reference_video_id, created_by)
  values (p_project, p_title, nullif(btrim(coalesce(p_brief, '')), ''), p_due, coalesce(array_length(p_assignees, 1), 0) = 0,
          (select v.id from public.videos v where v.id = p_reference and v.project_id = p_project), (select auth.uid()))
  returning id into rid;
  if coalesce(array_length(p_assignees, 1), 0) > 0 then
    insert into public.request_assignees (request_id, user_id)
    select rid, m.user_id from public.project_members m where m.project_id = p_project and m.user_id = any (p_assignees);
  end if;
  perform private.notify_request(rid, 'request_new', false);
  return rid;
end;
$$;

-- Nudge everyone who hasn't submitted. Once an hour at most.
create function public.remind_request(p_request uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests;
  sent int;
begin
  select * into r from public.requests where id = p_request;
  if r.id is null or not (r.created_by = (select auth.uid()) or private.is_project_owner(r.project_id)) then
    raise exception 'Only the person who made this request or the project owner can send reminders';
  end if;
  if r.last_reminded_at > now() - interval '1 hour' then
    raise exception 'You already sent a reminder in the last hour';
  end if;
  sent := private.notify_request(r.id, 'request_reminder', true);
  update public.requests set last_reminded_at = now() where id = r.id;
  return sent;
end;
$$;

revoke execute on function private.check_video_request() from public, anon, authenticated;
revoke execute on function private.request_people(uuid) from public, anon, authenticated;
revoke execute on function private.notify_request(uuid, public.notification_kind, boolean) from public, anon, authenticated;
revoke execute on function public.create_request(uuid, text, text, timestamptz, uuid[], uuid) from public, anon;
revoke execute on function public.remind_request(uuid) from public, anon;
grant execute on function public.create_request(uuid, text, text, timestamptz, uuid[], uuid) to authenticated;
grant execute on function public.remind_request(uuid) to authenticated;

-- ---------- Review queue: what you've watched ----------
create table public.video_views (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index video_views_video_idx on public.video_views (video_id);
alter table public.video_views enable row level security;
create policy "video views: your own" on public.video_views
  for select to authenticated using (user_id = (select auth.uid()));
create policy "video views: record your own" on public.video_views
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (select 1 from public.videos v where v.id = video_id and private.is_project_member(v.project_id))
  );
create policy "video views: update your own" on public.video_views
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Calendar ----------
create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  kind text not null default 'rehearsal' check (kind in ('rehearsal', 'show', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or ends_at >= starts_at),
  location text check (location is null or char_length(location) <= 200),
  details text check (details is null or char_length(details) <= 2000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index project_events_project_idx on public.project_events (project_id, starts_at);
create index project_events_creator_idx on public.project_events (created_by);
alter table public.project_events enable row level security;
create policy "events: members can see" on public.project_events
  for select to authenticated using (private.is_project_member(project_id));
create policy "events: members can add" on public.project_events
  for insert to authenticated with check (private.is_project_member(project_id) and created_by = (select auth.uid()));
create policy "events: creator or owner edits" on public.project_events
  for update to authenticated
  using (created_by = (select auth.uid()) or private.is_project_owner(project_id))
  with check (private.is_project_member(project_id));
create policy "events: creator or owner deletes" on public.project_events
  for delete to authenticated using (created_by = (select auth.uid()) or private.is_project_owner(project_id));
