-- Inbox, notification preferences, and handing a project to a new owner.
-- Notifications are written only by triggers; people can read, mark read, and clear their own.

-- ---------- Preferences ----------
alter table public.profiles
  add column notify jsonb not null default '{"mention": true, "note_on_your_video": true, "new_take": true, "note_resolved": true, "joined": true}'::jsonb;

-- ---------- Notifications ----------
create type public.notification_kind as enum ('mention', 'note_on_your_video', 'new_take', 'note_resolved', 'joined');

-- The video is not stored: takes and notes can move between videos (merge), so it is read through them.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.notification_kind not null,
  actor_id uuid references auth.users (id) on delete set null,
  project_id uuid not null references public.projects (id) on delete cascade,
  take_id uuid references public.takes (id) on delete cascade,
  note_id uuid references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_actor_idx on public.notifications (actor_id);
create index notifications_project_idx on public.notifications (project_id);
create index notifications_take_idx on public.notifications (take_id);
create index notifications_note_idx on public.notifications (note_id);

alter table public.notifications enable row level security;
create policy "notifications: see your own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: mark your own read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: clear your own" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));
-- Only the read time can change.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Owners and teammates need to see each other's profile rows already allowed; preferences stay private
-- because the client only ever selects id and display_name for others.

-- ---------- Writing notifications ----------
create function private.notify(p_user uuid, p_kind public.notification_kind, p_actor uuid, p_project uuid, p_take uuid, p_note uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  if coalesce((select (notify ->> p_kind::text)::boolean from public.profiles where id = p_user), true) is false then
    return;
  end if;
  insert into public.notifications (user_id, kind, actor_id, project_id, take_id, note_id)
  values (p_user, p_kind, p_actor, p_project, p_take, p_note);
end;
$$;

-- A new note tells whoever uploaded that take and whoever added the video.
create function private.on_note_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uploader uuid;
  owner_of_video uuid;
begin
  select t.uploaded_by into uploader from public.takes t where t.id = new.take_id;
  select v.created_by into owner_of_video from public.videos v where v.id = new.video_id;
  perform private.notify(uploader, 'note_on_your_video', new.author_id, new.project_id, new.take_id, new.id);
  if owner_of_video is distinct from uploader then
    perform private.notify(owner_of_video, 'note_on_your_video', new.author_id, new.project_id, new.take_id, new.id);
  end if;
  return null;
end;
$$;
create trigger after_note_created
  after insert on public.notes
  for each row execute function private.on_note_created();

-- A mention replaces the plainer "note on your video" for the same note.
create function private.on_mention_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notes;
begin
  select * into n from public.notes where id = new.note_id;
  delete from public.notifications where note_id = n.id and user_id = new.user_id and kind = 'note_on_your_video';
  perform private.notify(new.user_id, 'mention', n.author_id, n.project_id, n.take_id, n.id);
  return null;
end;
$$;
create trigger after_mention_created
  after insert on public.note_mentions
  for each row execute function private.on_mention_created();

-- A new take (or a new video's first take) tells everyone else on the project.
create function private.on_take_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  m record;
begin
  for m in select user_id from public.project_members where project_id = new.project_id loop
    perform private.notify(m.user_id, 'new_take', new.uploaded_by, new.project_id, new.id, null);
  end loop;
  return null;
end;
$$;
create trigger after_take_created
  after insert on public.takes
  for each row execute function private.on_take_created();

-- Someone else marking your note fixed.
create function private.on_note_resolved()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform private.notify(new.author_id, 'note_resolved', new.resolved_by, new.project_id, new.take_id, new.id);
  end if;
  return null;
end;
$$;
create trigger after_note_resolved
  after update of status on public.notes
  for each row execute function private.on_note_resolved();

-- Owners hear when someone joins with an invite.
create function private.on_member_joined()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o record;
begin
  if new.role <> 'member' then
    return null;
  end if;
  for o in select user_id from public.project_members where project_id = new.project_id and role = 'owner' loop
    perform private.notify(o.user_id, 'joined', new.user_id, new.project_id, null, null);
  end loop;
  return null;
end;
$$;
create trigger after_member_joined
  after insert on public.project_members
  for each row execute function private.on_member_joined();

revoke execute on function private.notify(uuid, public.notification_kind, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.on_note_created() from public, anon, authenticated;
revoke execute on function private.on_mention_created() from public, anon, authenticated;
revoke execute on function private.on_take_created() from public, anon, authenticated;
revoke execute on function private.on_note_resolved() from public, anon, authenticated;
revoke execute on function private.on_member_joined() from public, anon, authenticated;

-- ---------- Handing a project to someone else ----------
-- Only the owner can do it; they stay on as a member.
create function public.transfer_ownership(p_project uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_project_owner(p_project) then
    raise exception 'Only the project owner can hand it over';
  end if;
  if p_user = (select auth.uid()) or not exists (select 1 from public.project_members where project_id = p_project and user_id = p_user) then
    raise exception 'Pick someone else on this project';
  end if;
  update public.project_members set role = 'owner' where project_id = p_project and user_id = p_user;
  update public.project_members set role = 'member' where project_id = p_project and user_id = (select auth.uid());
end;
$$;
revoke execute on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- ---------- Live badge ----------
alter publication supabase_realtime add table public.notifications;
