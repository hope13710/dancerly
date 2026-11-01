-- @mentions show people's current names. A note stores its text as written ("@Jordan Lee …"), and who it
-- mentions in note_mentions. When someone changes their name, the notes that mention them (and the AI summaries
-- that quote those notes) switch "@Old name" to "@New name". Samples written before this get the opener's
-- current name once.

-- Refresh the note text an AI summary quotes in its sources, from the notes themselves.
create or replace function private.refresh_recap_sources(p_recap uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.recaps r
  set sources = coalesce((
    select jsonb_agg(case when n.id is not null then jsonb_set(x.e, '{body}', to_jsonb(n.body)) else x.e end order by x.ord)
    from jsonb_array_elements(r.sources) with ordinality as x(e, ord)
    left join public.notes n on n.id = case when x.e->>'note_id' ~ '^[0-9a-f-]{36}$' then (x.e->>'note_id')::uuid end
  ), r.sources)
  where r.id = p_recap and jsonb_typeof(r.sources) = 'array';
$$;
revoke execute on function private.refresh_recap_sources(uuid) from public, anon, authenticated;

create or replace function private.on_display_name_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  if coalesce(old.display_name, '') = '' or new.display_name is not distinct from old.display_name then
    return null;
  end if;
  update public.notes n
  set body = replace(n.body, '@' || old.display_name, '@' || new.display_name)
  where n.id in (select note_id from public.note_mentions where user_id = new.id)
    and position('@' || old.display_name in n.body) > 0;
  for r in
    select id from public.recaps
    where project_id in (select project_id from public.project_members where user_id = new.id)
      and position('@' || old.display_name in sources::text) > 0
  loop
    perform private.refresh_recap_sources(r.id);
  end loop;
  return null;
end;
$$;
revoke execute on function private.on_display_name_changed() from public, anon, authenticated;

drop trigger if exists after_display_name_change on public.profiles;
create trigger after_display_name_change
  after update of display_name on public.profiles
  for each row execute function private.on_display_name_changed();

-- Samples already open: the seeded notes that @mention the opener use their name from when the sample was made.
-- Rewrite the name part (everything before the seeded text) with their current name.
update public.notes n
set body = '@' || pr.display_name || substr(n.body, position(s.suffix in n.body))
from public.projects p
join public.profiles pr on pr.id = p.created_by
cross join (values (' 2에잇 8 스쿼트'), (' 8 스쿼트 훨씬'), (' the squat on 8'),
                   (' 1에잇 5-6 팔'), (' 5-6 팔 훨씬'), (' your arms are late'), (' the 5-6 arms')) as s(suffix)
where n.project_id = p.id and p.is_sample
  and n.author_id is distinct from p.created_by
  and n.body like '@%'
  and position(s.suffix in n.body) > 1
  and left(n.body, position(s.suffix in n.body) - 1) <> '@' || pr.display_name;

select private.refresh_recap_sources(r.id) from public.recaps r join public.projects p on p.id = r.project_id where p.is_sample;
