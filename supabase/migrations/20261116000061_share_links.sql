-- Share links, one model for takes and Practice (like Notion's or Figma's "anyone with the link"):
--   • one live link per video (takes) and one per project's Practice page, turned on and off;
--   • no expiry unless someone picks one;
--   • whoever made a link, or the owner, changes its settings (notes, requests to join, expiry) or turns it off;
--   • a Practice link opens the choreo video and its sections read-only, and can take requests to join the project.
-- Who can share Practice: the owner, or everyone in the project when the owner allows it (projects.members_share_practice).

-- ---------- Take links: no expiry by default, settings can change ----------
alter table public.video_shares alter column expires_at drop not null;
alter table public.video_shares alter column expires_at set default null;
grant update (revoked, include_notes, allow_requests, expires_at) on public.video_shares to authenticated;

-- ---------- Practice links ----------
alter table public.projects add column if not exists members_share_practice boolean not null default false;

create table if not exists public.practice_shares (
  token text primary key default encode(extensions.gen_random_bytes(18), 'hex'),
  project_id uuid not null references public.projects (id) on delete cascade,
  allow_requests boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false,
  views int not null default 0
);
create index if not exists practice_shares_project_idx on public.practice_shares (project_id);
create index if not exists practice_shares_creator_idx on public.practice_shares (created_by);

alter table public.practice_shares enable row level security;
drop policy if exists "practice shares: members can see" on public.practice_shares;
create policy "practice shares: members can see" on public.practice_shares
  for select to authenticated using (private.is_project_member(project_id));
drop policy if exists "practice shares: owner, or members when allowed" on public.practice_shares;
create policy "practice shares: owner, or members when allowed" on public.practice_shares
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and (private.is_project_owner(project_id)
      or (private.is_project_member(project_id) and exists (select 1 from public.projects p where p.id = project_id and p.members_share_practice)))
  );
drop policy if exists "practice shares: creator or owner changes" on public.practice_shares;
create policy "practice shares: creator or owner changes" on public.practice_shares
  for update to authenticated
  using (created_by = (select auth.uid()) or private.is_project_owner(project_id))
  with check (private.is_project_member(project_id));
revoke update on public.practice_shares from authenticated;
grant update (revoked, allow_requests, expires_at) on public.practice_shares to authenticated;

-- ---------- Requests to join can come from a Practice link (no video) ----------
alter table public.join_requests alter column video_id drop not null;
alter table public.join_requests add column if not exists practice_token text references public.practice_shares (token) on delete set null;

-- A live link: not turned off, not expired, its project (and video) not in the Trash, not the sample.
-- A Practice link also needs a choreo video to show.
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
  where s.token = p_token and not s.revoked and (s.expires_at is null or s.expires_at > now())
  union all
  select ps.project_id, null::uuid, null::uuid, ps.allow_requests
  from public.practice_shares ps
  join public.projects p on p.id = ps.project_id and p.deleted_at is null and not p.is_sample
    and (p.choreo_video_id is not null or p.choreo_youtube is not null)
  where ps.token = p_token and not ps.revoked and (ps.expires_at is null or ps.expires_at > now());
$$;

-- The same as before, except the link a request came from is recorded in the column for its kind.
create or replace function public.request_join(p_token text, p_body text, p_t numeric)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  s record;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_t numeric := greatest(0, coalesce(p_t, 0));
  v_video_token text;
  v_practice_token text;
  req uuid;
  note uuid;
  o record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if v_body is not null and char_length(v_body) > 2000 then raise exception 'Keep the note under 2,000 characters.' using errcode = '22001'; end if;
  select * into s from private.share_target(p_token);
  if s.project_id is null then raise exception 'This link isn’t available anymore.' using errcode = 'P0002'; end if;
  v_video_token := case when s.video_id is not null then p_token end;
  v_practice_token := case when s.video_id is null then p_token end;

  -- Already in the project: post the note right away (take links only; Practice links have no note).
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
      video_id = coalesce(s.video_id, jr.video_id), take_id = coalesce(s.take_id, jr.take_id),
      share_token = coalesce(v_video_token, jr.share_token), practice_token = coalesce(v_practice_token, jr.practice_token),
      requester_name = coalesce((select p.display_name from public.profiles p where p.id = me), jr.requester_name)
    where jr.id = req;
    return jsonb_build_object('status', 'pending', 'request_id', req);
  end if;
  -- A little friction against floods: at most 5 new requests per person per hour.
  if (select count(*) from public.join_requests r where r.user_id = me and r.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many requests. Try again in a little while.' using errcode = '54000';
  end if;
  insert into public.join_requests (project_id, video_id, take_id, user_id, requester_name, share_token, practice_token, body, t_start)
  values (s.project_id, s.video_id, s.take_id, me, (select p.display_name from public.profiles p where p.id = me), v_video_token, v_practice_token, v_body, case when v_body is null then null else v_t end)
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

notify pgrst, 'reload schema';
