-- The choreo video is its own kind of video, not a take (Practice mode, 057/058).
-- A project's videos are either takes (filmed by the team, for feedback) or its choreo video (the original the team
-- learns from). A take can't become the choreo video and the choreo video can't become a take, so lists of takes,
-- the review queue, notifications and stats never pick up the choreo video, and nobody leaves feedback on it.
alter table public.videos add column if not exists kind text not null default 'take' check (kind in ('take', 'choreo'));
alter table public.takes add column if not exists kind text not null default 'take' check (kind in ('take', 'choreo'));
create index if not exists videos_choreo_idx on public.videos (project_id) where kind = 'choreo';

-- A take is the kind of its video (copied so take lists can leave choreo files out without a join).
create or replace function private.take_kind()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select v.kind into new.kind from public.videos v where v.id = new.video_id;
  new.kind := coalesce(new.kind, 'take');
  return new;
end;
$$;
revoke execute on function private.take_kind() from public, anon, authenticated;
drop trigger if exists before_take_kind on public.takes;
create trigger before_take_kind
  before insert on public.takes
  for each row execute function private.take_kind();

-- A video's kind is set once, when it's created.
create or replace function private.video_kind_fixed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'A video can’t switch between choreo and take.';
  end if;
  return new;
end;
$$;
revoke execute on function private.video_kind_fixed() from public, anon, authenticated;
drop trigger if exists before_video_kind on public.videos;
create trigger before_video_kind
  before update of kind on public.videos
  for each row execute function private.video_kind_fixed();

-- The choreo video has to be a choreo video of this project (not a take).
create or replace function private.check_choreo_video()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.choreo_video_id is not null and not exists (
    select 1 from public.videos v where v.id = new.choreo_video_id and v.project_id = new.id and v.kind = 'choreo'
  ) then
    raise exception 'Upload the choreo video as a choreo video, or use a YouTube link.';
  end if;
  return new;
end;
$$;

-- Projects that pointed at a take: that video stays a take, with its notes; the project has no choreo video.
update public.projects p set choreo_video_id = null
where p.choreo_video_id is not null
  and not exists (select 1 from public.videos v where v.id = p.choreo_video_id and v.kind = 'choreo');

-- Uploading the choreo video isn't a new take: no "new take" notification for it.
create or replace function private.on_take_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  m record;
begin
  if new.kind = 'choreo' then
    return null;
  end if;
  for m in select user_id from public.project_members where project_id = new.project_id loop
    perform private.notify(m.user_id, 'new_take', new.uploaded_by, new.project_id, new.id, null);
  end loop;
  return null;
end;
$$;

notify pgrst, 'reload schema';
