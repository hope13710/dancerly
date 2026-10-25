-- Replies on notes, and private notes (author + one recipient only — e.g. a coach to one student).
-- Privacy is enforced in row level security, so every screen, recap, and share link inherits it.

-- ---------- Private notes ----------
alter table public.notes add column private_to uuid references auth.users (id) on delete cascade;
create index notes_private_to_idx on public.notes (private_to);

drop policy "notes: members can see" on public.notes;
create policy "notes: members see team notes; private ones only the two people" on public.notes
  for select to authenticated using (
    private.is_project_member(project_id)
    and (private_to is null or author_id = (select auth.uid()) or private_to = (select auth.uid()))
  );

drop policy "notes: members can write" on public.notes;
create policy "notes: members can write" on public.notes
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.takes t where t.id = take_id and private.is_project_member(t.project_id))
    and (
      private_to is null
      or (private_to <> (select auth.uid())
          and exists (select 1 from public.takes t join public.project_members m on m.project_id = t.project_id
                      where t.id = take_id and m.user_id = private_to))
    )
  );

-- Who can see a note (for security-definer code that bypasses RLS).
create function private.can_see_note(p_note uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.notes n
    join public.project_members m on m.project_id = n.project_id and m.user_id = p_user
    where n.id = p_note and (n.private_to is null or n.author_id = p_user or n.private_to = p_user)
  );
$$;
grant execute on function private.can_see_note(uuid, uuid) to authenticated;

-- Visibility is fixed once a note is written.
create or replace function private.handle_note_write()
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
    new.take_id := old.take_id;
    new.author_id := old.author_id;
    new.private_to := old.private_to;
    if current_setting('looproom.merge', true) is distinct from 'on' then
      new.video_id := old.video_id;
    end if;
    if new.status is distinct from old.status and current_setting('looproom.status_change', true) is distinct from 'on' then
      raise exception 'Use set_note_status() to change a note''s status';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_note_status(p_note uuid, p_status public.note_status)
returns public.notes
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notes;
begin
  select * into n from public.notes where id = p_note;
  if n.id is null or not private.can_see_note(n.id, (select auth.uid())) then
    raise exception 'Note not found';
  end if;
  if p_status <> 'practicing' and n.author_id <> (select auth.uid()) and not private.is_project_owner(n.project_id) then
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

-- Only people who can see the note can be @mentioned in it.
drop policy "mentions: the note's author mentions teammates" on public.note_mentions;
create policy "mentions: the note's author mentions people who can see it" on public.note_mentions
  for insert to authenticated with check (
    exists (
      select 1 from public.notes n
      join public.project_members m on m.project_id = n.project_id and m.user_id = note_mentions.user_id
      where n.id = note_id and n.author_id = (select auth.uid())
        and (n.private_to is null or note_mentions.user_id = n.private_to)
    )
  );

-- ---------- Inbox kinds ----------
alter type public.notification_kind add value if not exists 'private_note';
alter type public.notification_kind add value if not exists 'reply';
update public.profiles set notify = notify || '{"reply": true}'::jsonb where not notify ? 'reply';
alter table public.profiles alter column notify set default '{"mention": true, "note_on_your_video": true, "new_take": true, "note_resolved": true, "joined": true, "recap_shared": true, "request": true, "reply": true}'::jsonb;

-- A private note tells only its recipient (always — it's addressed to them).
create or replace function private.on_note_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uploader uuid;
  owner_of_video uuid;
begin
  if new.private_to is not null then
    insert into public.notifications (user_id, kind, actor_id, project_id, take_id, note_id)
    values (new.private_to, 'private_note', new.author_id, new.project_id, new.take_id, new.id);
    return null;
  end if;
  select t.uploaded_by into uploader from public.takes t where t.id = new.take_id;
  select v.created_by into owner_of_video from public.videos v where v.id = new.video_id;
  perform private.notify(uploader, 'note_on_your_video', new.author_id, new.project_id, new.take_id, new.id);
  if owner_of_video is distinct from uploader then
    perform private.notify(owner_of_video, 'note_on_your_video', new.author_id, new.project_id, new.take_id, new.id);
  end if;
  return null;
end;
$$;

-- ---------- Replies ----------
create table public.note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index note_replies_note_idx on public.note_replies (note_id, created_at);
create index note_replies_author_idx on public.note_replies (author_id);

alter table public.note_replies enable row level security;
-- The notes subquery runs under the notes policy, so private threads stay private.
create policy "replies: whoever can see the note" on public.note_replies
  for select to authenticated using (exists (select 1 from public.notes n where n.id = note_id));
create policy "replies: reply to a note you can see" on public.note_replies
  for insert to authenticated with check (author_id = (select auth.uid()) and exists (select 1 from public.notes n where n.id = note_id));
create policy "replies: edit your own" on public.note_replies
  for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "replies: author or project owner deletes" on public.note_replies
  for delete to authenticated using (
    author_id = (select auth.uid())
    or exists (select 1 from public.notes n where n.id = note_id and private.is_project_owner(n.project_id))
  );
revoke update on public.note_replies from authenticated;
grant update (body, updated_at) on public.note_replies to authenticated;

-- Tell the note's author and everyone already in the thread.
create function private.on_reply_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notes;
  u uuid;
begin
  select * into n from public.notes where id = new.note_id;
  for u in
    select n.author_id union select r.author_id from public.note_replies r where r.note_id = n.id
  loop
    continue when u = new.author_id or not private.can_see_note(n.id, u);
    perform private.notify(u, 'reply', new.author_id, n.project_id, n.take_id, n.id);
  end loop;
  return null;
end;
$$;
create trigger after_reply_created
  after insert on public.note_replies
  for each row execute function private.on_reply_created();
revoke execute on function private.on_reply_created() from public, anon, authenticated;

alter publication supabase_realtime add table public.note_replies;

-- ---------- Recaps never leak private notes ----------
-- The recap function marks recaps built from private notes; those can't be shared to the project.
alter table public.recaps add column has_private boolean not null default false;
drop policy "recaps: creator shares and ticks items" on public.recaps;
create policy "recaps: creator shares and ticks items" on public.recaps
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and (shared_at is null or not has_private));
