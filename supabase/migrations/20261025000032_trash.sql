-- Trash: deleting a video or a take moves it here for 30 days instead of removing it.
-- • Trashed rows stay in their tables with deleted_at set; row-level security hides them (and everything on them:
--   takes, notes, replies, agrees, mentions, inbox items) from every normal query, so no screen has to filter.
-- • trash_item / restore_item / purge_item / trash_list are the only ways in and out, with the same rights as
--   deleting before: the project owner, whoever made the video or uploaded the take, or the sample's creator.
-- • Every day, anything trashed over 30 days ago is deleted for good; the hourly storage cleanup then removes its
--   files. Trashed items don't count toward storage.

alter table public.videos add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references auth.users (id) on delete set null;
alter table public.takes add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references auth.users (id) on delete set null;
create index if not exists videos_deleted_idx on public.videos (deleted_at) where deleted_at is not null;
create index if not exists takes_deleted_idx on public.takes (deleted_at) where deleted_at is not null;

-- ---------- What people can see ----------
drop policy if exists "videos: members can see" on public.videos;
create policy "videos: members can see" on public.videos
  for select to authenticated using (private.is_project_member(project_id) and deleted_at is null);

-- A take shows only while it and its video are in place (the subquery sees videos through their own policy).
drop policy if exists "takes: members can see" on public.takes;
create policy "takes: members can see" on public.takes
  for select to authenticated using (
    private.is_project_member(project_id) and deleted_at is null
    and exists (select 1 from public.videos v where v.id = takes.video_id)
  );

drop policy if exists "notes: members see team notes; private ones only the two people" on public.notes;
create policy "notes: members see team notes; private ones only the two people" on public.notes
  for select to authenticated using (
    private.is_project_member(project_id)
    and (private_to is null or author_id = (select auth.uid()) or private_to = (select auth.uid()))
    and exists (select 1 from public.takes t where t.id = notes.take_id)
  );

drop policy if exists "notifications: see your own" on public.notifications;
create policy "notifications: see your own" on public.notifications
  for select to authenticated using (
    user_id = (select auth.uid())
    and (take_id is null or exists (select 1 from public.takes t where t.id = notifications.take_id))
    and (note_id is null or exists (select 1 from public.notes n where n.id = notifications.note_id))
  );

-- ---------- Who can move things in and out ----------
create or replace function private.can_trash(p_project uuid, p_maker uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    p_maker = (select auth.uid())
    or private.is_project_owner(p_project)
    or exists (select 1 from public.projects p where p.id = p_project and p.is_sample and p.created_by = (select auth.uid()))
  );
$$;
revoke execute on function private.can_trash(uuid, uuid) from public, anon, authenticated;

create or replace function public.trash_item(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.videos;
  t public.takes;
begin
  if p_kind = 'video' then
    select * into v from public.videos where id = p_id and deleted_at is null;
    if v.id is null or not private.can_trash(v.project_id, v.created_by) then raise exception 'You can’t delete this video.'; end if;
    update public.videos set deleted_at = now(), deleted_by = (select auth.uid()) where id = p_id;
  elsif p_kind = 'take' then
    select * into t from public.takes where id = p_id and deleted_at is null;
    if t.id is null or not private.can_trash(t.project_id, t.uploaded_by) then raise exception 'You can’t delete this take.'; end if;
    if (select count(*) from public.takes where video_id = t.video_id and deleted_at is null) < 2 then
      raise exception 'This is the only take. Delete the video instead.';
    end if;
    update public.takes set deleted_at = now(), deleted_by = (select auth.uid()) where id = p_id;
  else
    raise exception 'Unknown item.';
  end if;
end;
$$;

create or replace function public.restore_item(p_kind text, p_id uuid)
returns uuid -- the video to open afterwards
language plpgsql security definer set search_path = ''
as $$
declare
  v public.videos;
  t public.takes;
begin
  if p_kind = 'video' then
    select * into v from public.videos where id = p_id and deleted_at is not null;
    if v.id is null or not private.can_trash(v.project_id, v.created_by) then raise exception 'This is no longer in the trash.'; end if;
    update public.videos set deleted_at = null, deleted_by = null where id = p_id;
    return v.id;
  elsif p_kind = 'take' then
    select * into t from public.takes where id = p_id and deleted_at is not null;
    if t.id is null or not private.can_trash(t.project_id, t.uploaded_by) then raise exception 'This is no longer in the trash.'; end if;
    if exists (select 1 from public.videos where id = t.video_id and deleted_at is not null) then
      raise exception 'Its video is in the trash too. Restore the video first.';
    end if;
    update public.takes set deleted_at = null, deleted_by = null where id = p_id;
    return t.video_id;
  end if;
  raise exception 'Unknown item.';
end;
$$;

create or replace function public.purge_item(p_kind text, p_id uuid)
returns setof text -- file paths for the client to remove right away (the hourly cleanup catches the rest)
language plpgsql security definer set search_path = ''
as $$
declare
  v public.videos;
  t public.takes;
begin
  if p_kind = 'video' then
    select * into v from public.videos where id = p_id and deleted_at is not null;
    if v.id is null or not private.can_trash(v.project_id, v.created_by) then raise exception 'This is no longer in the trash.'; end if;
    return query select unnest(array[tk.storage_path, tk.thumb_path]) from public.takes tk where tk.video_id = p_id;
    delete from public.videos where id = p_id;
  elsif p_kind = 'take' then
    select * into t from public.takes where id = p_id and deleted_at is not null;
    if t.id is null or not private.can_trash(t.project_id, t.uploaded_by) then raise exception 'This is no longer in the trash.'; end if;
    return query select unnest(array[t.storage_path, t.thumb_path]);
    delete from public.takes where id = p_id;
  else
    raise exception 'Unknown item.';
  end if;
end;
$$;

-- What's in the trash for the projects you're in, newest first; can_manage says whether you can restore it.
create or replace function public.trash_list()
returns table (kind text, id uuid, project_id uuid, project_title text, video_id uuid, title text, take_number int, takes int,
               deleted_at timestamptz, deleted_by uuid, can_manage boolean)
language sql stable security definer set search_path = ''
as $$
  select 'video', v.id, v.project_id, p.title, v.id, v.title, null::int,
         (select count(*)::int from public.takes t where t.video_id = v.id), v.deleted_at, v.deleted_by,
         private.can_trash(v.project_id, v.created_by)
  from public.videos v join public.projects p on p.id = v.project_id
  where v.deleted_at is not null and private.is_project_member(v.project_id)
  union all
  select 'take', t.id, t.project_id, p.title, v.id, v.title, t.number, null::int, t.deleted_at, t.deleted_by,
         private.can_trash(t.project_id, t.uploaded_by)
  from public.takes t join public.videos v on v.id = t.video_id and v.deleted_at is null join public.projects p on p.id = t.project_id
  where t.deleted_at is not null and private.is_project_member(t.project_id)
  order by 9 desc;
$$;

revoke execute on function public.trash_item(text, uuid), public.restore_item(text, uuid), public.purge_item(text, uuid), public.trash_list() from public, anon;
grant execute on function public.trash_item(text, uuid), public.restore_item(text, uuid), public.purge_item(text, uuid), public.trash_list() to authenticated;

-- ---------- Storage: trashed things don't count ----------
create or replace function public.my_storage_usage()
returns table (project_id uuid, bytes bigint)
language sql stable security definer set search_path = ''
as $$
  select p.id, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from public.project_members m
  join public.projects p on p.id = m.project_id and not p.is_sample
  left join public.takes t on t.project_id = p.id and t.deleted_at is null
    and exists (select 1 from public.videos v where v.id = t.video_id and v.deleted_at is null)
  left join storage.objects o on o.bucket_id = 'takes' and o.name in (t.storage_path, t.thumb_path)
  where m.user_id = (select auth.uid()) and m.role = 'owner'
  group by p.id;
$$;

-- ---------- After 30 days, gone for good ----------
select cron.unschedule(jobid) from cron.job where jobname = 'dancerly-empty-trash';
select cron.schedule('dancerly-empty-trash', '41 4 * * *', $$
  delete from public.videos where deleted_at < now() - interval '30 days';
  delete from public.takes where deleted_at < now() - interval '30 days';
$$);
