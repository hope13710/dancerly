-- Add someone you already work with to another project, without sending a link (like Google Docs' Share box).
-- Only people you share (or shared) a real project with can be found or added: there is no search across all of
-- dancerly, emails are never returned, and the sample's made-up teammates never show up. Checked here, not
-- just in the app. The person gets an Inbox item (and an email) saying who added them, and can leave any time.

alter type public.notification_kind add value if not exists 'added_to_project';

-- People you know: everyone on your real, non-trashed projects, minus you and minus who's already in p_project.
-- Most recent first, with one project you share for context ("From Spring Showcase").
create or replace function public.people_i_know(p_project uuid)
returns table (user_id uuid, display_name text, avatar_url text, shared_project text, last_together timestamptz)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select m.project_id, p.title
    from public.project_members m
    join public.projects p on p.id = m.project_id and not p.is_sample and p.deleted_at is null
    where m.user_id = (select auth.uid())
  ),
  them as (
    select o.user_id, mine.title, greatest(o.joined_at, (select joined_at from public.project_members x where x.project_id = o.project_id and x.user_id = (select auth.uid()))) as together
    from public.project_members o
    join mine on mine.project_id = o.project_id
    where o.user_id <> (select auth.uid())
      and o.user_id::text not like '5a3b0000-%'
      and not exists (select 1 from public.project_members already where already.project_id = p_project and already.user_id = o.user_id)
  )
  select distinct on (t.user_id) t.user_id, pr.display_name, pr.avatar_url, t.title, t.together
  from them t
  join public.profiles pr on pr.id = t.user_id
  where private.is_project_member(p_project)
  order by t.user_id, t.together desc
$$;
revoke execute on function public.people_i_know(uuid) from public, anon;
grant execute on function public.people_i_know(uuid) to authenticated;

-- Add one of them. Anyone on the project can invite (as with invite links); the person must share a real project with you.
create or replace function public.add_project_member(p_project uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Log in again.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.project_members where project_id = p_project and user_id = me)
     or exists (select 1 from public.projects where id = p_project and (is_sample or deleted_at is not null)) then
    raise exception 'You can’t add people to this project.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.project_members a
    join public.project_members b on b.project_id = a.project_id and b.user_id = p_user
    join public.projects p on p.id = a.project_id and not p.is_sample and p.deleted_at is null
    where a.user_id = me and p_user <> me
  ) then
    raise exception 'You can only add people you already work with. Send them the invite link instead.' using errcode = '42501';
  end if;
  if exists (select 1 from public.project_members where project_id = p_project and user_id = p_user) then
    return; -- already in: nothing to do
  end if;
  -- Owners still hear that someone joined, except the one who added them (they know).
  perform set_config('dancerly.added_by', me::text, true);
  insert into public.project_members (project_id, user_id, role) values (p_project, p_user, 'member');
  perform private.notify(p_user, 'added_to_project', me, p_project, null, null);
end;
$$;
revoke execute on function public.add_project_member(uuid, uuid) from public, anon;
grant execute on function public.add_project_member(uuid, uuid) to authenticated;

-- Owners hear when someone joins, unless they're the one who just added that person.
create or replace function private.on_member_joined()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o record;
  adder text := nullif(current_setting('dancerly.added_by', true), '');
begin
  if new.role <> 'member' then
    return null;
  end if;
  for o in select user_id from public.project_members where project_id = new.project_id and role = 'owner' loop
    if adder is null or o.user_id::text <> adder then
      perform private.notify(o.user_id, 'joined', new.user_id, new.project_id, null, null);
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function private.on_member_joined() from public, anon, authenticated;
