-- Note categories: every note gets one focus area, so Insights can show what a team or a dancer is working on
-- and what got better. Five areas plus "other":
--   timing       on the beat, accents, musicality
--   technique    angles, lines, depth, details, the right move
--   sync         matching each other (height, angle, timing between members)
--   formation    spacing, positions, traffic
--   performance  facials, energy, focus, character
-- category_source says who set it: 'starter' (the note began from a topic chip), 'ai' (classified after saving),
-- or 'user' (someone picked it). A person's choice is never overwritten by the AI.

alter table public.notes
  add column if not exists category text check (category in ('timing', 'technique', 'sync', 'formation', 'performance', 'other')),
  add column if not exists category_source text check (category_source in ('starter', 'ai', 'user'));

create index if not exists notes_project_category_idx on public.notes (project_id, category);

-- Categories are bookkeeping, not an edit: changing one keeps updated_at, so recaps don't go stale over it.
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
    -- Only a topic chip can set a category on insert; anything else is classified afterwards.
    if new.category_source is distinct from 'starter' then
      new.category := null;
      new.category_source := null;
    end if;
    new.updated_at := now();
  else
    new.project_id := old.project_id;
    new.video_id := old.video_id;
    new.take_id := old.take_id;
    new.author_id := old.author_id;
    if new.status is distinct from old.status and current_setting('looproom.status_change', true) is distinct from 'on' then
      raise exception 'Use set_note_status() to change a note''s status';
    end if;
    -- Category changes go through set_note_category() (people) or the classifier (service role).
    if (new.category is distinct from old.category or new.category_source is distinct from old.category_source)
       and current_setting('looproom.category_change', true) is distinct from 'on'
       and (select auth.role()) is distinct from 'service_role' then
      raise exception 'Use set_note_category() to change a note''s category';
    end if;
    if (to_jsonb(new) - 'category' - 'category_source' - 'updated_at') = (to_jsonb(old) - 'category' - 'category_source' - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      new.updated_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- People change a note's category: the note's author or the project owner (the same people who can resolve it).
create or replace function public.set_note_category(p_note uuid, p_category text)
returns public.notes
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notes;
begin
  if p_category not in ('timing', 'technique', 'sync', 'formation', 'performance', 'other') then
    raise exception 'Unknown category %', p_category;
  end if;
  select * into n from public.notes where id = p_note;
  if n.id is null or not private.can_see_note(n.id, (select auth.uid())) then
    raise exception 'Note not found';
  end if;
  if n.author_id <> (select auth.uid()) and not private.is_project_owner(n.project_id) then
    raise exception 'Only the person who wrote this note or the project owner can change its category';
  end if;
  perform set_config('looproom.category_change', 'on', true);
  update public.notes set category = p_category, category_source = 'user' where id = p_note returning * into n;
  perform set_config('looproom.category_change', 'off', true);
  return n;
end;
$$;

revoke execute on function public.set_note_category(uuid, text) from public, anon;
grant execute on function public.set_note_category(uuid, text) to authenticated;
