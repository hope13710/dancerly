-- @mentions in replies, like YouTube's and Instagram's "@name" replies: whoever is mentioned hears about it
-- even if they aren't in the thread yet. People already in it (the note's author and everyone who replied) get
-- the usual reply notification instead, so nobody is told twice.
create or replace function public.mention_in_reply(p_reply uuid, p_users uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  rp public.note_replies;
  n public.notes;
  u uuid;
begin
  select * into rp from public.note_replies where id = p_reply;
  if rp.id is null or rp.author_id <> (select auth.uid()) then
    raise exception 'Reply not found';
  end if;
  -- Only right after writing it, and only a handful of people.
  if rp.created_at < now() - interval '5 minutes' or coalesce(array_length(p_users, 1), 0) > 10 then
    return;
  end if;
  select * into n from public.notes where id = rp.note_id;
  for u in select distinct x from unnest(p_users) x loop
    continue when u = rp.author_id
      or u = n.author_id
      or exists (select 1 from public.note_replies r where r.note_id = n.id and r.author_id = u)
      or not private.can_see_note(n.id, u)
      or exists (select 1 from public.notifications x where x.user_id = u and x.note_id = n.id and x.kind = 'mention'
                   and x.actor_id = rp.author_id and x.created_at > now() - interval '5 minutes');
    perform private.notify(u, 'mention', rp.author_id, n.project_id, n.take_id, n.id);
  end loop;
end;
$$;
revoke execute on function public.mention_in_reply(uuid, uuid[]) from public, anon;
grant execute on function public.mention_in_reply(uuid, uuid[]) to authenticated;
