-- Ask to join from a guest link (/app/s/:token): someone watching a shared video writes a note, signs in,
-- and the note goes to the project's owner as a request. Approving adds them as a member and posts the note
-- at its moment, in their name. Nothing is visible to them, and nothing is posted, until an owner says yes.
--
--   video_shares.allow_requests   per link; on by default (approval is what keeps the project private)
--   join_requests                 one pending request per person per project, with the note they wrote
--   request_join(token, body, t)  the guest page calls this once signed in; a member's note posts right away
--   share_access(token)           what the guest page should show a signed-in viewer (member / pending / none)
--   decide_join_request(id, yes)  owners approve or decline; approving posts the note
-- Owners get an Inbox item (and email) for each request; the person who asked gets one when they're let in.

alter table public.video_shares add column if not exists allow_requests boolean not null default true;

alter type public.notification_kind add value if not exists 'join_request';
alter type public.notification_kind add value if not exists 'join_approved';

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  take_id uuid references public.takes (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  requester_name text, -- owners can't read a non-member's profile, so the name travels with the request
  share_token text references public.video_shares (token) on delete set null,
  body text check (body is null or char_length(btrim(body)) between 1 and 2000),
  t_start numeric(9, 2) check (t_start is null or t_start >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  note_id uuid references public.notes (id) on delete set null
);
create unique index if not exists join_requests_one_pending on public.join_requests (project_id, user_id) where status = 'pending';
create index if not exists join_requests_project_idx on public.join_requests (project_id, status);
create index if not exists join_requests_user_idx on public.join_requests (user_id);

alter table public.join_requests enable row level security;
-- The person who asked sees their own; owners see their project's. All writes go through the functions below.
drop policy if exists "join requests: own or owner" on public.join_requests;
create policy "join requests: own or owner" on public.join_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.is_project_owner(project_id));

alter table public.notifications add column if not exists join_request_id uuid references public.join_requests (id) on delete cascade;
create index if not exists notifications_join_request_idx on public.notifications (join_request_id);

-- A live link: not turned off, not expired, its video and project not in the Trash, not the sample.
create or replace function private.share_target(p_token text)
returns table (project_id uuid, video_id uuid, take_id uuid, allow_requests boolean)
language sql stable security definer set search_path = ''
as $$
  select s.project_id, s.video_id,
    (select t.id from public.takes t where t.video_id = s.video_id and t.deleted_at is null order by t.number desc limit 1),
    s.allow_requests
  from public.video_shares s
  join public.videos v on v.id = s.video_id and v.deleted_at is null
  join public.projects p on p.id = s.project_id and p.deleted_at is null and not p.is_sample
  where s.token = p_token and not s.revoked and s.expires_at > now();
$$;
revoke execute on function private.share_target(text) from public, anon, authenticated;

create or replace function public.share_access(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  s record;
begin
  if me is null then return jsonb_build_object('status', 'signed_out'); end if;
  select * into s from private.share_target(p_token);
  if s.project_id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if exists (select 1 from public.project_members m where m.project_id = s.project_id and m.user_id = me) then
    return jsonb_build_object('status', 'member', 'project_id', s.project_id, 'video_id', s.video_id);
  end if;
  if exists (select 1 from public.join_requests r where r.project_id = s.project_id and r.user_id = me and r.status = 'pending') then
    return jsonb_build_object('status', 'pending');
  end if;
  return jsonb_build_object('status', case when s.allow_requests then 'none' else 'closed' end);
end;
$$;
revoke execute on function public.share_access(text) from public, anon;
grant execute on function public.share_access(text) to authenticated;

create or replace function public.request_join(p_token text, p_body text, p_t numeric)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  s record;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_t numeric := greatest(0, coalesce(p_t, 0));
  req uuid;
  note uuid;
  o record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if v_body is not null and char_length(v_body) > 2000 then raise exception 'Keep the note under 2,000 characters.' using errcode = '22001'; end if;
  select * into s from private.share_target(p_token);
  if s.project_id is null then raise exception 'This link isn’t available anymore.' using errcode = 'P0002'; end if;

  -- Already in the project: post the note right away.
  if exists (select 1 from public.project_members m where m.project_id = s.project_id and m.user_id = me) then
    if v_body is not null and s.take_id is not null then
      insert into public.notes (project_id, video_id, take_id, t_start, body, author_id)
      values (s.project_id, s.video_id, s.take_id, v_t, v_body, me) returning id into note;
    end if;
    return jsonb_build_object('status', 'member', 'project_id', s.project_id, 'video_id', s.video_id, 'note_id', note);
  end if;
  if not s.allow_requests then raise exception 'This link doesn’t take requests to join.' using errcode = '42501'; end if;

  -- One pending request per person per project; asking again just updates the note.
  select r.id into req from public.join_requests r where r.project_id = s.project_id and r.user_id = me and r.status = 'pending';
  if req is not null then
    update public.join_requests jr set body = coalesce(v_body, jr.body), t_start = case when v_body is null then jr.t_start else v_t end,
      video_id = s.video_id, take_id = s.take_id, share_token = p_token,
      requester_name = coalesce((select p.display_name from public.profiles p where p.id = me), jr.requester_name)
    where jr.id = req;
    return jsonb_build_object('status', 'pending', 'request_id', req);
  end if;
  -- A little friction against floods: at most 5 new requests per person per hour.
  if (select count(*) from public.join_requests r where r.user_id = me and r.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many requests. Try again in a little while.' using errcode = '54000';
  end if;
  insert into public.join_requests (project_id, video_id, take_id, user_id, requester_name, share_token, body, t_start)
  values (s.project_id, s.video_id, s.take_id, me, (select p.display_name from public.profiles p where p.id = me), p_token, v_body, case when v_body is null then null else v_t end)
  returning id into req;
  for o in select m.user_id from public.project_members m where m.project_id = s.project_id and m.role = 'owner' loop
    insert into public.notifications (user_id, kind, actor_id, project_id, take_id, join_request_id)
    values (o.user_id, 'join_request', me, s.project_id, s.take_id, req);
  end loop;
  return jsonb_build_object('status', 'pending', 'request_id', req);
end;
$$;
revoke execute on function public.request_join(text, text, numeric) from public, anon;
grant execute on function public.request_join(text, text, numeric) to authenticated;

create or replace function public.decide_join_request(p_request uuid, p_approve boolean)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.join_requests;
  take uuid;
  note uuid;
begin
  select * into r from public.join_requests where id = p_request for update;
  if r.id is null or not private.is_project_owner(r.project_id) then raise exception 'Only the project’s owner can do this.' using errcode = '42501'; end if;
  if r.status <> 'pending' then return jsonb_build_object('status', r.status); end if;
  if not p_approve then
    update public.join_requests set status = 'declined', decided_at = now(), decided_by = me where id = r.id;
    update public.notifications set read_at = coalesce(read_at, now()) where join_request_id = r.id;
    return jsonb_build_object('status', 'declined');
  end if;
  insert into public.project_members (project_id, user_id, role) values (r.project_id, r.user_id, 'member') on conflict do nothing;
  -- Their note goes on the take they watched (or the latest one, if that take is gone).
  take := coalesce((select t.id from public.takes t where t.id = r.take_id and t.deleted_at is null),
                   (select t.id from public.takes t where t.video_id = r.video_id and t.deleted_at is null order by t.number desc limit 1));
  if r.body is not null and take is not null and exists (select 1 from public.videos v where v.id = r.video_id and v.deleted_at is null) then
    insert into public.notes (project_id, video_id, take_id, t_start, body, author_id)
    values (r.project_id, r.video_id, take, coalesce(r.t_start, 0), r.body, r.user_id) returning id into note;
  end if;
  update public.join_requests set status = 'approved', decided_at = now(), decided_by = me, note_id = note where id = r.id;
  update public.notifications set read_at = coalesce(read_at, now()) where join_request_id = r.id;
  insert into public.notifications (user_id, kind, actor_id, project_id, take_id, note_id, join_request_id)
  values (r.user_id, 'join_approved', me, r.project_id, take, note, r.id);
  return jsonb_build_object('status', 'approved', 'note_id', note);
end;
$$;
revoke execute on function public.decide_join_request(uuid, boolean) from public, anon;
grant execute on function public.decide_join_request(uuid, boolean) to authenticated;
