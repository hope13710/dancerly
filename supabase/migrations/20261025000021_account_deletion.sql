-- Deleting an account: a person's own things go with them; the team's things stay.
-- Before: deleting a user cascaded through created_by and wiped whole projects (and their calendars, pages,
-- requests, invite links, and videos with other people's takes) for everyone. Now those keep their place
-- and simply lose the creator's name. Personal content — takes, notes, replies, reactions, AI summaries,
-- share links, calendar feeds — is still deleted with the account.

alter table public.projects alter column created_by drop not null;
alter table public.projects drop constraint projects_created_by_fkey,
  add constraint projects_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.videos alter column created_by drop not null;
alter table public.videos drop constraint videos_created_by_fkey,
  add constraint videos_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.requests alter column created_by drop not null;
alter table public.requests drop constraint requests_created_by_fkey,
  add constraint requests_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.project_events alter column created_by drop not null;
alter table public.project_events drop constraint project_events_created_by_fkey,
  add constraint project_events_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.project_groups alter column created_by drop not null;
alter table public.project_groups drop constraint project_groups_created_by_fkey,
  add constraint project_groups_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.project_pages alter column created_by drop not null;
alter table public.project_pages drop constraint project_pages_created_by_fkey,
  add constraint project_pages_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.project_invites alter column created_by drop not null;
alter table public.project_invites drop constraint project_invites_created_by_fkey,
  add constraint project_invites_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

-- Files to remove from storage when an account goes: everything the person uploaded, their profile photos,
-- and everything in the projects being deleted with them. Only the delete-account function (service role) calls it.
create function public.storage_paths_for_deletion(p_user uuid, p_projects uuid[])
returns table (bucket text, name text)
language sql stable security definer set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('takes', 'images')
    and (
      o.owner_id = p_user::text
      or (o.bucket_id = 'images' and o.name like 'users/' || p_user::text || '/%')
      or (o.bucket_id = 'takes' and split_part(o.name, '/', 1) = any (select x::text from unnest(p_projects) x))
      or (o.bucket_id = 'images' and o.name like 'projects/%' and split_part(o.name, '/', 2) = any (select x::text from unnest(p_projects) x))
    );
$$;
revoke execute on function public.storage_paths_for_deletion(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.storage_paths_for_deletion(uuid, uuid[]) to service_role;

-- Why people leave, kept without any link to who they were.
create table public.account_deletion_feedback (
  id bigint generated always as identity primary key,
  reason text check (reason is null or char_length(reason) <= 40),
  details text check (details is null or char_length(details) <= 1000),
  created_at timestamptz not null default now()
);
alter table public.account_deletion_feedback enable row level security;
-- No policies: only the service role (the delete-account function) writes or reads it.

-- Security cleanup: migration 013 (dropping the first version of create_request) was never applied, so the old
-- function was still callable. The app only uses create_request_v2.
drop function if exists public.create_request(uuid, text, text, timestamptz, uuid[], uuid);
