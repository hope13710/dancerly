-- A project's choreo video: the original choreography the team practices from (Practice mode).
-- Either one of the project's own videos, or a YouTube video (most teams learn from an official dance practice
-- video on YouTube, so they shouldn't have to download and re-upload it). At most one of the two.
alter table public.projects
  add column if not exists choreo_video_id uuid, -- no foreign key: a second projects↔videos key makes API embeds ambiguous (058)
  add column if not exists choreo_youtube text check (choreo_youtube is null or choreo_youtube ~ '^[A-Za-z0-9_-]{11}$'),
  add column if not exists choreo_title text check (choreo_title is null or char_length(choreo_title) <= 120);

alter table public.projects drop constraint if exists projects_one_choreo;
alter table public.projects add constraint projects_one_choreo check (choreo_video_id is null or choreo_youtube is null);

create index if not exists projects_choreo_video_idx on public.projects (choreo_video_id);

-- The choreo video has to be one of this project's own videos.
create or replace function private.check_choreo_video()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.choreo_video_id is not null and not exists (
    select 1 from public.videos v where v.id = new.choreo_video_id and v.project_id = new.id
  ) then
    raise exception 'That video belongs to another project.';
  end if;
  return new;
end;
$$;
revoke execute on function private.check_choreo_video() from public, anon, authenticated;
drop trigger if exists before_choreo_video on public.projects;
create trigger before_choreo_video
  before insert or update of choreo_video_id on public.projects
  for each row execute function private.check_choreo_video();

-- Who can set it: the existing projects update policy (owners only). Everyone in the project can read it.
