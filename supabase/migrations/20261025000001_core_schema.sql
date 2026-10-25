-- Looproom core schema: profiles, projects (Owner/Member), invites, videos, takes, notes.
-- Every table has row level security: people only ever see projects they belong to.

-- ---------- Profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

-- ---------- Projects and membership ----------
create type public.project_role as enum ('owner', 'member');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.project_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.project_invites (
  code text primary key default encode(extensions.gen_random_bytes(9), 'hex'),
  project_id uuid not null references public.projects (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked boolean not null default false
);
create index project_invites_project_idx on public.project_invites (project_id);

-- ---------- Videos, takes, notes ----------
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index videos_project_idx on public.videos (project_id);

create table public.takes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  number int not null,
  storage_path text not null,
  file_name text,
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (video_id, number)
);
create index takes_video_idx on public.takes (video_id);

create type public.note_status as enum ('open', 'practicing', 'resolved');

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  take_id uuid not null references public.takes (id) on delete cascade,
  t_start numeric(9, 2) not null check (t_start >= 0),
  t_end numeric(9, 2) check (t_end is null or t_end > t_start),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  status public.note_status not null default 'open',
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_video_idx on public.notes (video_id);
create index notes_take_idx on public.notes (take_id);
create index notes_project_created_idx on public.notes (project_id, created_at);

create table public.note_mentions (
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (note_id, user_id)
);
create index note_mentions_user_idx on public.note_mentions (user_id);

create table public.note_reactions (
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- ---------- Membership helpers (security definer so policies don't recurse) ----------
create function public.is_project_member(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = (select auth.uid())
  );
$$;

create function public.is_project_owner(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

create function public.shares_project_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user
  );
$$;

-- ---------- Triggers ----------
-- Whoever creates a project becomes its owner.
create function public.handle_new_project()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- Takes are numbered per video (Take 1, 2, 3…) and inherit the video's project.
create function public.handle_new_take()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select v.project_id into new.project_id from public.videos v where v.id = new.video_id;
  perform pg_advisory_xact_lock(hashtext(new.video_id::text));
  select coalesce(max(t.number), 0) + 1 into new.number from public.takes t where t.video_id = new.video_id;
  return new;
end;
$$;
create trigger before_take_insert
  before insert on public.takes
  for each row execute function public.handle_new_take();

-- Notes inherit video and project from their take; status changes go through set_note_status().
create function public.handle_note_write()
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
    new.video_id := old.video_id;
    new.take_id := old.take_id;
    new.author_id := old.author_id;
    if new.status is distinct from old.status and current_setting('looproom.status_change', true) is distinct from 'on' then
      raise exception 'Use set_note_status() to change a note''s status';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger before_note_write
  before insert or update on public.notes
  for each row execute function public.handle_note_write();

-- ---------- RPCs ----------
-- Practicing: anyone on the project. Resolved / reopened: the note's author or the project owner.
create function public.set_note_status(p_note uuid, p_status public.note_status)
returns public.notes
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notes;
begin
  select * into n from public.notes where id = p_note;
  if n.id is null or not public.is_project_member(n.project_id) then
    raise exception 'Note not found';
  end if;
  if p_status <> 'practicing' and n.author_id <> (select auth.uid()) and not public.is_project_owner(n.project_id) then
    raise exception 'Only the person who wrote this note or the project owner can change it to %', p_status;
  end if;
  perform set_config('looproom.status_change', 'on', true);
  update public.notes
     set status = p_status,
         resolved_by = case when p_status = 'resolved' then (select auth.uid()) end,
         resolved_at = case when p_status = 'resolved' then now() end
   where id = p_note
  returning * into n;
  perform set_config('looproom.status_change', 'off', true);
  return n;
end;
$$;

-- Joining with an invite code. Returns the project id.
create function public.accept_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.project_invites;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first';
  end if;
  select * into inv from public.project_invites where code = p_code;
  if inv.code is null or inv.revoked or inv.expires_at < now() then
    raise exception 'This invite link has expired. Ask the project owner for a new one.';
  end if;
  insert into public.project_members (project_id, user_id, role)
  values (inv.project_id, (select auth.uid()), 'member')
  on conflict (project_id, user_id) do nothing;
  return inv.project_id;
end;
$$;

-- What the join page shows before you accept.
create function public.invite_preview(p_code text)
returns table (project_title text, member_count bigint, valid boolean)
language sql stable security definer set search_path = ''
as $$
  select p.title,
         (select count(*) from public.project_members m where m.project_id = p.id),
         (not i.revoked and i.expires_at > now())
  from public.project_invites i
  join public.projects p on p.id = i.project_id
  where i.code = p_code;
$$;

revoke execute on function public.set_note_status(uuid, public.note_status) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.set_note_status(uuid, public.note_status) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ---------- Row level security ----------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invites enable row level security;
alter table public.videos enable row level security;
alter table public.takes enable row level security;
alter table public.notes enable row level security;
alter table public.note_mentions enable row level security;
alter table public.note_reactions enable row level security;

create policy "profiles: see yourself and teammates" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.shares_project_with(id));
create policy "profiles: create your own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles: edit your own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "projects: members can see" on public.projects
  for select to authenticated using (public.is_project_member(id) or created_by = (select auth.uid()));
create policy "projects: anyone signed in can create" on public.projects
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "projects: owner can edit" on public.projects
  for update to authenticated using (public.is_project_owner(id)) with check (public.is_project_owner(id));
create policy "projects: owner can delete" on public.projects
  for delete to authenticated using (public.is_project_owner(id));

create policy "members: members can see the roster" on public.project_members
  for select to authenticated using (public.is_project_member(project_id));
create policy "members: owner removes others, members can leave" on public.project_members
  for delete to authenticated using (
    (public.is_project_owner(project_id) and user_id <> (select auth.uid()))
    or (user_id = (select auth.uid()) and role = 'member')
  );

create policy "invites: members can see" on public.project_invites
  for select to authenticated using (public.is_project_member(project_id));
create policy "invites: members can create" on public.project_invites
  for insert to authenticated with check (public.is_project_member(project_id) and created_by = (select auth.uid()));
create policy "invites: creator or owner can revoke" on public.project_invites
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_project_owner(project_id))
  with check (created_by = (select auth.uid()) or public.is_project_owner(project_id));

create policy "videos: members can see" on public.videos
  for select to authenticated using (public.is_project_member(project_id));
create policy "videos: members can add" on public.videos
  for insert to authenticated with check (public.is_project_member(project_id) and created_by = (select auth.uid()));
create policy "videos: creator or owner can edit" on public.videos
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_project_owner(project_id))
  with check (public.is_project_member(project_id));
create policy "videos: creator or owner can delete" on public.videos
  for delete to authenticated using (created_by = (select auth.uid()) or public.is_project_owner(project_id));

create policy "takes: members can see" on public.takes
  for select to authenticated using (public.is_project_member(project_id));
create policy "takes: members can upload" on public.takes
  for insert to authenticated with check (
    uploaded_by = (select auth.uid())
    and exists (select 1 from public.videos v where v.id = video_id and public.is_project_member(v.project_id))
  );
create policy "takes: uploader or owner can delete" on public.takes
  for delete to authenticated using (uploaded_by = (select auth.uid()) or public.is_project_owner(project_id));

create policy "notes: members can see" on public.notes
  for select to authenticated using (public.is_project_member(project_id));
create policy "notes: members can write" on public.notes
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.takes t where t.id = take_id and public.is_project_member(t.project_id))
  );
create policy "notes: authors edit their own" on public.notes
  for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "notes: author or owner can delete" on public.notes
  for delete to authenticated using (author_id = (select auth.uid()) or public.is_project_owner(project_id));

create policy "mentions: members can see" on public.note_mentions
  for select to authenticated using (
    exists (select 1 from public.notes n where n.id = note_id and public.is_project_member(n.project_id))
  );
create policy "mentions: the note's author mentions teammates" on public.note_mentions
  for insert to authenticated with check (
    exists (
      select 1 from public.notes n
      join public.project_members m on m.project_id = n.project_id and m.user_id = note_mentions.user_id
      where n.id = note_id and n.author_id = (select auth.uid())
    )
  );

create policy "reactions: members can see" on public.note_reactions
  for select to authenticated using (
    exists (select 1 from public.notes n where n.id = note_id and public.is_project_member(n.project_id))
  );
create policy "reactions: agree on your own behalf" on public.note_reactions
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.notes n where n.id = note_id and public.is_project_member(n.project_id))
  );
create policy "reactions: take back your own" on public.note_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- Private video storage ----------
-- Files live at takes/<project_id>/<video_id>/<file>. Only members of that project can read or upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('takes', 'takes', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

create function public.is_member_of_storage_path(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_project_member(folder::uuid);
end;
$$;

create policy "takes bucket: members can watch" on storage.objects
  for select to authenticated using (bucket_id = 'takes' and public.is_member_of_storage_path(name));
create policy "takes bucket: members can upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'takes' and public.is_member_of_storage_path(name));
create policy "takes bucket: uploader can delete" on storage.objects
  for delete to authenticated using (bucket_id = 'takes' and owner_id = (select auth.uid())::text);

-- ---------- Realtime: notes and agrees appear live for everyone watching ----------
alter publication supabase_realtime add table public.notes, public.note_reactions;
