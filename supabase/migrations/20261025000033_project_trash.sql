-- Project trash: deleting a project moves it to the Trash for 30 days instead of removing it (same as videos, 032).
-- • A trashed project is closed for everyone: the membership helpers treat nobody as a member, so every policy
--   and function built on them (videos, notes, events, requests, files, inbox, recaps…) hides it with no extra code.
-- • Only the project owner can move it in or out; the owner sees it in their Trash, teammates don't.
-- • Restoring brings back everything exactly as it was. After 30 days it's deleted for good (cascade), and the
--   hourly storage cleanup removes its files. A trashed project doesn't count toward storage.
-- • Sample projects aren't trashed; they keep their own Remove sample.

alter table public.projects add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references auth.users (id) on delete set null;
create index if not exists projects_deleted_idx on public.projects (deleted_at) where deleted_at is not null;

-- ---------- A trashed project has no members, as far as access goes ----------
create or replace function private.is_project_member(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m join public.projects p on p.id = m.project_id and p.deleted_at is null
    where m.project_id = p_project and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_project_owner(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m join public.projects p on p.id = m.project_id and p.deleted_at is null
    where m.project_id = p_project and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create or replace function private.shares_project_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.projects p on p.id = mine.project_id and p.deleted_at is null
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user
  );
$$;

-- Owning it regardless of the trash: who may restore or delete it for good.
create or replace function private.owns_project(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = (select auth.uid()) and role = 'owner'
  );
$$;
revoke execute on function private.owns_project(uuid) from public, anon, authenticated;

drop policy if exists "projects: members can see" on public.projects;
create policy "projects: members can see" on public.projects
  for select to authenticated using ((private.is_project_member(id) or created_by = (select auth.uid())) and deleted_at is null);

-- Inbox items from a trashed project (joins, requests, recaps) stay out of sight too.
drop policy if exists "notifications: see your own" on public.notifications;
create policy "notifications: see your own" on public.notifications
  for select to authenticated using (
    user_id = (select auth.uid())
    and (take_id is null or exists (select 1 from public.takes t where t.id = notifications.take_id))
    and (note_id is null or exists (select 1 from public.notes n where n.id = notifications.note_id))
    and not exists (select 1 from public.projects p where p.id = notifications.project_id and p.deleted_at is not null)
  );

-- ---------- In and out of the trash ----------
create or replace function public.trash_item(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.videos;
  t public.takes;
  p public.projects;
begin
  if p_kind = 'project' then
    select * into p from public.projects where id = p_id and deleted_at is null;
    if p.id is null or not private.is_project_owner(p_id) then raise exception 'Only the project owner can delete this project.'; end if;
    if p.is_sample then raise exception 'Remove the sample from its own menu instead.'; end if;
    update public.projects set deleted_at = now(), deleted_by = (select auth.uid()) where id = p_id;
  elsif p_kind = 'video' then
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
returns uuid -- the video (or project) to open afterwards
language plpgsql security definer set search_path = ''
as $$
declare
  v public.videos;
  t public.takes;
begin
  if p_kind = 'project' then
    if not exists (select 1 from public.projects where id = p_id and deleted_at is not null) or not private.owns_project(p_id) then
      raise exception 'This is no longer in the trash.';
    end if;
    update public.projects set deleted_at = null, deleted_by = null where id = p_id;
    return p_id;
  elsif p_kind = 'video' then
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
  if p_kind = 'project' then
    if not exists (select 1 from public.projects where id = p_id and deleted_at is not null) or not private.owns_project(p_id) then
      raise exception 'This is no longer in the trash.';
    end if;
    return query select unnest(array[tk.storage_path, tk.thumb_path]) from public.takes tk where tk.project_id = p_id;
    delete from public.projects where id = p_id;
  elsif p_kind = 'video' then
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

-- Projects you own are listed too (only for you); for a project, `takes` holds how many videos it has.
create or replace function public.trash_list()
returns table (kind text, id uuid, project_id uuid, project_title text, video_id uuid, title text, take_number int, takes int,
               deleted_at timestamptz, deleted_by uuid, can_manage boolean)
language sql stable security definer set search_path = ''
as $$
  select 'project', p.id, p.id, p.title, null::uuid, p.title, null::int,
         (select count(*)::int from public.videos v where v.project_id = p.id and v.deleted_at is null), p.deleted_at, p.deleted_by, true
  from public.projects p
  where p.deleted_at is not null and private.owns_project(p.id)
  union all
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

-- ---------- Storage: a trashed project doesn't count ----------
create or replace function public.my_storage_usage()
returns table (project_id uuid, bytes bigint)
language sql stable security definer set search_path = ''
as $$
  select p.id, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from public.project_members m
  join public.projects p on p.id = m.project_id and not p.is_sample and p.deleted_at is null
  left join public.takes t on t.project_id = p.id and t.deleted_at is null
    and exists (select 1 from public.videos v where v.id = t.video_id and v.deleted_at is null)
  left join storage.objects o on o.bucket_id = 'takes' and o.name in (t.storage_path, t.thumb_path)
  where m.user_id = (select auth.uid()) and m.role = 'owner'
  group by p.id;
$$;

-- ---------- After 30 days, gone for good ----------
select cron.unschedule(jobid) from cron.job where jobname = 'dancerly-empty-trash';
select cron.schedule('dancerly-empty-trash', '41 4 * * *', $$
  delete from public.projects where deleted_at < now() - interval '30 days';
  delete from public.videos where deleted_at < now() - interval '30 days';
  delete from public.takes where deleted_at < now() - interval '30 days';
$$);
