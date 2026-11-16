-- Anyone in a project can add, change, rename or remove its choreo video, not just the owner. Sections and counts
-- were already the team's; the choreo video they hang on now is too.
--
-- projects stays owner-only to update (title, sharing, trash...), so the choreo goes through these three functions,
-- each checking membership:
--   set_project_choreo     points the project at an uploaded choreo video, a YouTube video, or nothing
--   rename_project_choreo  renames whichever it is (a file's name is on its video, a link's on the project)
--   delete_choreo_video    deletes a replaced or removed choreo file, even one somebody else uploaded
--                          (only choreo videos, and never the one in use; its sections are moved off first by the app)

create or replace function public.set_project_choreo(p_project uuid, p_video uuid, p_youtube text, p_title text)
returns void
language plpgsql security definer set search_path = ''
as $fn$
begin
  if not private.is_project_member(p_project) then
    raise exception 'Project not found';
  end if;
  if p_video is not null and p_youtube is not null then
    raise exception 'Pick either a video file or a YouTube link';
  end if;
  if p_video is not null and not exists (
    select 1 from public.videos v where v.id = p_video and v.project_id = p_project and v.kind = 'choreo'
  ) then
    raise exception 'That video isn''t a choreo video in this project';
  end if;
  update public.projects
     set choreo_video_id = p_video,
         choreo_youtube = p_youtube,
         choreo_title = case when p_youtube is not null then nullif(left(btrim(coalesce(p_title, '')), 120), '') end
   where id = p_project;
end;
$fn$;

create or replace function public.rename_project_choreo(p_project uuid, p_title text)
returns void
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_project public.projects;
begin
  if not private.is_project_member(p_project) then
    raise exception 'Project not found';
  end if;
  if v_title = '' then
    raise exception 'Give the choreo video a name';
  end if;
  select * into v_project from public.projects where id = p_project;
  if v_project.choreo_youtube is not null then
    update public.projects set choreo_title = v_title where id = p_project;
  elsif v_project.choreo_video_id is not null then
    update public.videos set title = v_title where id = v_project.choreo_video_id and kind = 'choreo';
  else
    raise exception 'This project has no choreo video';
  end if;
end;
$fn$;

create or replace function public.delete_choreo_video(p_video uuid)
returns void
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_project uuid;
begin
  select v.project_id into v_project from public.videos v where v.id = p_video and v.kind = 'choreo';
  if v_project is null or not private.is_project_member(v_project) then
    raise exception 'Video not found';
  end if;
  if exists (select 1 from public.projects p where p.id = v_project and p.choreo_video_id = p_video) then
    raise exception 'This is the project''s choreo video. Change or remove it first.';
  end if;
  delete from public.videos where id = p_video;
end;
$fn$;

revoke all on function public.set_project_choreo(uuid, uuid, text, text) from public, anon;
revoke all on function public.rename_project_choreo(uuid, text) from public, anon;
revoke all on function public.delete_choreo_video(uuid) from public, anon;
grant execute on function public.set_project_choreo(uuid, uuid, text, text) to authenticated;
grant execute on function public.rename_project_choreo(uuid, text) to authenticated;
grant execute on function public.delete_choreo_video(uuid) to authenticated;
