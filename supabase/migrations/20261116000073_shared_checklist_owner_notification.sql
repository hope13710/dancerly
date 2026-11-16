-- Shared recap checklists are collaborative: every project member can tick them.
-- Handing over a project also tells the new owner in their Inbox.

alter type public.notification_kind add value if not exists 'ownership_transferred';

-- Keep personal recaps private, but let any member update only the checked array on a team recap.
-- The function is deliberately narrow so callers cannot change the recap, sharing, or authorship fields.
create or replace function public.set_recap_checked(p_recap uuid, p_checked int[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.recaps r
    where r.id = p_recap
      and (
        (r.team and private.is_project_member(r.project_id))
        or (not r.team and r.created_by = (select auth.uid()))
      )
  ) then
    raise exception 'You cannot update this recap checklist';
  end if;

  update public.recaps
  set checked = coalesce(p_checked, '{}')
  where id = p_recap;
end;
$$;
revoke execute on function public.set_recap_checked(uuid, int[]) from public, anon;
grant execute on function public.set_recap_checked(uuid, int[]) to authenticated;

create or replace function public.transfer_ownership(p_project uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
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
  perform private.notify(p_user, 'ownership_transferred', (select auth.uid()), p_project, null, null);
end;
$$;
revoke execute on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
