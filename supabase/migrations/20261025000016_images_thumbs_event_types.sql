-- Profile photos, project images, video thumbnails, and custom event types.

-- ---------- Profile photos and project images (public bucket; unguessable file names) ----------
alter table public.profiles add column avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500);
alter table public.projects add column image_url text check (image_url is null or char_length(image_url) <= 500);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- users/<your id>/... for your photo; projects/<project id>/... for the owner of that project.
create function private.can_write_image(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  kind text := split_part(p_name, '/', 1);
  id text := split_part(p_name, '/', 2);
begin
  if id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if kind = 'users' then
    return id::uuid = (select auth.uid());
  elsif kind = 'projects' then
    return public.is_project_owner(id::uuid);
  end if;
  return false;
end;
$$;
grant execute on function private.can_write_image(text) to authenticated;

create policy "images bucket: upload your own" on storage.objects
  for insert to authenticated with check (bucket_id = 'images' and private.can_write_image(name));
create policy "images bucket: replace your own" on storage.objects
  for update to authenticated using (bucket_id = 'images' and private.can_write_image(name));
create policy "images bucket: remove your own" on storage.objects
  for delete to authenticated using (bucket_id = 'images' and private.can_write_image(name));

-- ---------- Video thumbnails: a still from each take, kept next to the video in the private bucket ----------
alter table public.takes add column thumb_path text check (thumb_path is null or char_length(thumb_path) <= 300);
update storage.buckets set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/webp'] where id = 'takes';

-- Any member may save the still (the first viewer backfills older takes); the path must sit in the take's own folder.
create function public.set_take_thumb(p_take uuid, p_path text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.takes;
begin
  select * into t from public.takes where id = p_take;
  if t.id is null or not public.is_project_member(t.project_id) then
    raise exception 'Take not found';
  end if;
  if p_path is null or p_path not like t.project_id::text || '/' || t.video_id::text || '/%' or p_path !~ '\.(jpg|webp)$' then
    raise exception 'Invalid thumbnail path';
  end if;
  update public.takes set thumb_path = p_path where id = p_take;
end;
$$;
revoke execute on function public.set_take_thumb(uuid, text) from public, anon;
grant execute on function public.set_take_thumb(uuid, text) to authenticated;

-- ---------- Events: Rehearsal, Show, Other, plus any type a team names ----------
alter table public.project_events drop constraint if exists project_events_kind_check;
alter table public.project_events add constraint project_events_kind_check check (char_length(btrim(kind)) between 1 and 30);
