-- The team's recap before practice reaches the team: when dancerly writes one on schedule (migration 049), everyone
-- on the project gets an Inbox item (and an email, per their recap email setting: right away unless they chose the
-- morning summary or off). dancerly is the sender, so the item has no actor.
-- Recaps someone makes or updates by hand already tell the project when they're shared (on_recap_shared).
-- Nothing for sample projects: their teammates aren't real.
create or replace function private.on_team_recap_written()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  m record;
begin
  if not (new.team and new.auto) then
    return null;
  end if;
  if exists (select 1 from public.projects where id = new.project_id and (is_sample or deleted_at is not null)) then
    return null;
  end if;
  for m in select user_id from public.project_members where project_id = new.project_id loop
    if coalesce((select (notify ->> 'recap_shared')::boolean from public.profiles where id = m.user_id), true) then
      insert into public.notifications (user_id, kind, actor_id, project_id, recap_id)
      values (m.user_id, 'recap_shared', null, new.project_id, new.id);
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function private.on_team_recap_written() from public, anon, authenticated;

drop trigger if exists after_team_recap_written on public.recaps;
create trigger after_team_recap_written
  after insert on public.recaps
  for each row execute function private.on_team_recap_written();
