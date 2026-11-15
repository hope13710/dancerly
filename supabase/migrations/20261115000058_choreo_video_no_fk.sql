-- Fix for 057: a second foreign key between projects and videos (projects.choreo_video_id → videos) made every
-- "videos(…)" / "projects(…)" embed in the API ambiguous ("more than one relationship was found"), so project
-- pages failed to load. Keep the column, drop the foreign key. The same-project check (trigger from 057) stays,
-- and a deleted video clears the choreo video with a trigger instead of "on delete set null".
alter table public.projects drop constraint if exists projects_choreo_video_id_fkey;

create or replace function private.clear_choreo_video()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.projects set choreo_video_id = null where choreo_video_id = old.id;
  return old;
end;
$$;
revoke execute on function private.clear_choreo_video() from public, anon, authenticated;
drop trigger if exists after_video_delete_clear_choreo on public.videos;
create trigger after_video_delete_clear_choreo
  after delete on public.videos
  for each row execute function private.clear_choreo_video();

-- Make the API pick up the change right away.
notify pgrst, 'reload schema';
