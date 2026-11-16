-- Counts on a YouTube choreo video: its tempo and where count 1 falls, kept on the project (a YouTube choreo video
-- has no video row; a choreo video file keeps them on its video and take, set with set_counts, as before).
-- Anyone in the project can set them from Practice, like sections. Changing the YouTube video clears them.

alter table public.projects
  add column if not exists choreo_bpm numeric(5, 1) check (choreo_bpm is null or choreo_bpm between 40 and 240),
  add column if not exists choreo_count_start numeric(8, 3) check (choreo_count_start is null or choreo_count_start >= 0);

create or replace function public.set_choreo_counts(p_project uuid, p_bpm numeric, p_count_start numeric)
returns void
language plpgsql security definer set search_path = ''
as $fn$
begin
  if not private.is_project_member(p_project) then
    raise exception 'Project not found';
  end if;
  if not exists (select 1 from public.projects where id = p_project and choreo_youtube is not null) then
    raise exception 'This project has no YouTube choreo video';
  end if;
  if p_bpm is not null and (p_bpm < 40 or p_bpm > 240) then
    raise exception 'Tempo must be between 40 and 240 BPM';
  end if;
  if p_count_start is not null and p_count_start < 0 then
    raise exception 'Invalid count 1';
  end if;
  update public.projects set choreo_bpm = round(p_bpm, 1), choreo_count_start = round(p_count_start, 3) where id = p_project;
end;
$fn$;
revoke execute on function public.set_choreo_counts(uuid, numeric, numeric) from public, anon;
grant execute on function public.set_choreo_counts(uuid, numeric, numeric) to authenticated;

-- A different YouTube video has a different tempo and start.
create or replace function private.clear_choreo_counts()
returns trigger
language plpgsql set search_path = ''
as $fn$
begin
  if new.choreo_youtube is distinct from old.choreo_youtube then
    new.choreo_bpm := null;
    new.choreo_count_start := null;
  end if;
  return new;
end;
$fn$;
drop trigger if exists clear_choreo_counts on public.projects;
create trigger clear_choreo_counts before update of choreo_youtube on public.projects
  for each row execute function private.clear_choreo_counts();
