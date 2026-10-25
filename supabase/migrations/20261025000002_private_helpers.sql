-- Move internal helpers and trigger functions out of the exposed API schema.
-- Policies keep working: they reference functions by id, not by name.
create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.is_project_member(uuid) set schema private;
alter function public.is_project_owner(uuid) set schema private;
alter function public.shares_project_with(uuid) set schema private;
alter function public.is_member_of_storage_path(text) set schema private;
alter function public.handle_new_project() set schema private;
alter function public.handle_new_take() set schema private;
alter function public.handle_note_write() set schema private;

create or replace function private.is_member_of_storage_path(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_project_member(folder::uuid);
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
  if n.id is null or not private.is_project_member(n.project_id) then
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

-- Helpers are needed by row level security for signed-in users only; trigger functions by nobody.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_project_member(uuid) to authenticated;
grant execute on function private.is_project_owner(uuid) to authenticated;
grant execute on function private.shares_project_with(uuid) to authenticated;
grant execute on function private.is_member_of_storage_path(text) to authenticated;
