-- Feedback completion is a collaborative state: anyone who can see a note can mark it
-- fixed or reopen it. Private notes remain limited by private.can_see_note().

drop function if exists public.set_recap_checked(uuid, int[]);

create or replace function public.set_note_status(p_note uuid, p_status public.note_status)
returns public.notes
language plpgsql
security definer set search_path = ''
as $$
declare
  n public.notes;
begin
  select * into n from public.notes where id = p_note;
  if n.id is null or not private.can_see_note(n.id, (select auth.uid())) then
    raise exception 'Note not found';
  end if;
  if n.status = p_status then
    return n;
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
revoke execute on function public.set_note_status(uuid, public.note_status) from public, anon;
grant execute on function public.set_note_status(uuid, public.note_status) to authenticated;
