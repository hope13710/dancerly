-- Undoing a note's status, like Gmail's and Linear's Undo:
--   • "I'm on it" can be taken back by anyone who can see the note: the same people who can set it.
--   • "I'm on it" no longer applies to a fixed note (it used to reopen it, even for people who can't reopen notes).
--   • Reopening a note within 10 minutes of marking it fixed takes back the "fixed your note" notification,
--     if its author hasn't read it yet (it's only emailed in the digest, so it hasn't gone out either).

create or replace function public.set_note_status(p_note uuid, p_status public.note_status)
returns public.notes
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notes;
  -- Practicing ↔ open: anyone who can see the note. Fixing and reopening a fixed note: its author or the owner.
  light boolean;
begin
  select * into n from public.notes where id = p_note;
  if n.id is null or not private.can_see_note(n.id, (select auth.uid())) then
    raise exception 'Note not found';
  end if;
  if n.status = p_status then
    return n;
  end if;
  light := (p_status = 'practicing' and n.status = 'open') or (p_status = 'open' and n.status = 'practicing');
  if not light and n.author_id <> (select auth.uid()) and not private.is_project_owner(n.project_id) then
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

create or replace function private.on_note_resolved()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform private.notify(new.author_id, 'note_resolved', new.resolved_by, new.project_id, new.take_id, new.id);
  elsif old.status = 'resolved' and new.status <> 'resolved' then
    delete from public.notifications
     where note_id = new.id and kind = 'note_resolved' and read_at is null
       and created_at > now() - interval '10 minutes';
  end if;
  return null;
end;
$$;
revoke execute on function private.on_note_resolved() from public, anon, authenticated;
