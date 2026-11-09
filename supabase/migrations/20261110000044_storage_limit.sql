-- dancerly is free; a storage allowance per team owner keeps server costs predictable.
-- Every owner gets 5 GB for the videos in the projects they own (about 140 practice videos). Members' uploads count
-- toward the project owner, the same way Settings already counts storage. When it's full nothing is deleted:
-- new uploads stop until old takes are removed, or until we raise that owner's allowance (private.storage_grants,
-- which only we can edit). The check runs in the storage upload rule itself, so it can't be skipped from the app.

create table if not exists private.storage_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bytes bigint not null check (bytes > 0),
  note text,
  created_at timestamptz not null default now()
);

create or replace function private.storage_limit(p_user uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((select bytes from private.storage_grants where user_id = p_user), 5::bigint * 1024 * 1024 * 1024);
$$;

-- Bytes of video (and thumbnails) in every project this person owns. Like Settings (migration 032), anything in
-- Trash doesn't count, so deleting an old take frees its space right away even though Trash keeps it 30 days.
create or replace function private.storage_used(p_user uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from public.project_members m
  join public.projects p on p.id = m.project_id and p.deleted_at is null
  join public.takes t on t.project_id = p.id and t.deleted_at is null
    and exists (select 1 from public.videos v where v.id = t.video_id and v.deleted_at is null)
  join storage.objects o on o.bucket_id = 'takes' and o.name in (t.storage_path, t.thumb_path)
  where m.user_id = p_user and m.role = 'owner';
$$;

create or replace function private.project_owner(p_project uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select user_id from public.project_members where project_id = p_project and role = 'owner' limit 1),
    (select created_by from public.projects where id = p_project));
$$;

-- Room left for an upload into this project's folder (the owner's allowance; one file may run past the edge).
create or replace function private.storage_has_room(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  folder text := split_part(p_name, '/', 1);
  owner uuid;
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  owner := private.project_owner(folder::uuid);
  if owner is null then return false; end if;
  return private.storage_used(owner) < private.storage_limit(owner);
end;
$$;

-- Only the upload rule needs to ask; the numbers behind it aren't for calling directly.
revoke execute on function private.storage_limit(uuid), private.storage_used(uuid), private.project_owner(uuid) from public, anon, authenticated;
revoke execute on function private.storage_has_room(text) from public, anon;
grant execute on function private.storage_has_room(text) to authenticated;

drop policy if exists "takes bucket: members can upload" on storage.objects;
create policy "takes bucket: members can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'takes' and private.is_member_of_storage_path(name) and private.storage_has_room(name));

-- For the app: where a project's owner stands (any member may ask, so an upload can explain itself before it starts).
create or replace function public.project_storage(p_project uuid)
returns table (used bigint, allowance bigint, mine boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  owner uuid;
begin
  if not private.is_project_member(p_project) then
    raise exception 'Project not found';
  end if;
  owner := private.project_owner(p_project);
  return query select private.storage_used(owner), private.storage_limit(owner), owner = (select auth.uid());
end;
$$;
revoke execute on function public.project_storage(uuid) from public, anon;
grant execute on function public.project_storage(uuid) to authenticated;

-- For Settings: your own allowance.
create or replace function public.my_storage()
returns table (used bigint, allowance bigint)
language sql stable security definer set search_path = ''
as $$
  select private.storage_used((select auth.uid())), private.storage_limit((select auth.uid()));
$$;
revoke execute on function public.my_storage() from public, anon;
grant execute on function public.my_storage() to authenticated;
