-- NOTE: written 2026-10-25 but NOT yet applied to the live Supabase project (the apply was interrupted). Apply before shipping the merge button.
-- Merge one video into another: its takes become the next takes of the target, notes come along.
-- For when someone uploaded a new take of the same piece as a separate video.

-- Notes keep their video unless a merge is moving them.
create or replace function private.handle_note_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select t.video_id, t.project_id into new.video_id, new.project_id from public.takes t where t.id = new.take_id;
    new.status := 'open';
    new.resolved_by := null;
    new.resolved_at := null;
  else
    new.project_id := old.project_id;
    new.take_id := old.take_id;
    new.author_id := old.author_id;
    if current_setting('looproom.merge', true) is distinct from 'on' then
      new.video_id := old.video_id;
    end if;
    if new.status is distinct from old.status and current_setting('looproom.status_change', true) is distinct from 'on' then
      raise exception 'Use set_note_status() to change a note''s status';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Allowed for the project owner, or whoever created the video being merged away.
create function public.merge_video(p_source uuid, p_target uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  src public.videos;
  dst public.videos;
  base int;
  moved int;
begin
  select * into src from public.videos where id = p_source;
  select * into dst from public.videos where id = p_target;
  if src.id is null or dst.id is null or src.id = dst.id or src.project_id <> dst.project_id
     or not private.is_project_member(src.project_id) then
    raise exception 'Pick another video in the same project';
  end if;
  if src.created_by <> (select auth.uid()) and not private.is_project_owner(src.project_id) then
    raise exception 'Only the person who added this video or the project owner can merge it';
  end if;

  perform pg_advisory_xact_lock(hashtext(dst.id::text));
  select coalesce(max(number), 0) into base from public.takes where video_id = dst.id;

  -- Takes keep their order and continue the target's numbering.
  with ordered as (
    select id, row_number() over (order by number) as rn from public.takes where video_id = src.id
  )
  update public.takes t
     set video_id = dst.id, number = base + o.rn
    from ordered o
   where t.id = o.id;
  get diagnostics moved = row_count;

  perform set_config('looproom.merge', 'on', true);
  update public.notes set video_id = dst.id where video_id = src.id;
  perform set_config('looproom.merge', 'off', true);

  delete from public.videos where id = src.id;
  return moved;
end;
$$;

revoke execute on function public.merge_video(uuid, uuid) from public, anon;
grant execute on function public.merge_video(uuid, uuid) to authenticated;
