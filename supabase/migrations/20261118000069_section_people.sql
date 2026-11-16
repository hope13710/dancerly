-- Who dances each section: members and groups (a solo, a center, the front line). Empty means everyone.
-- Anyone in the project can set it from Practice, like the rest of a section (the existing row policies apply).
-- People who leave and groups that are deleted simply stop showing; nothing needs cleaning up.
-- The sample gets a few of its sections assigned, including two to the person trying it, so "My sections" works there.

alter table public.count_sheet_rows
  add column if not exists assignees uuid[] not null default '{}',
  add column if not exists assigned_groups uuid[] not null default '{}';

create or replace function private.add_sample_parts(p uuid)
returns void
language plpgsql security definer set search_path = ''
as $fn$
declare
  me uuid;
  mates uuid[];
begin
  select created_by into me from public.projects where id = p and is_sample;
  if not found then
    return;
  end if;
  select array_agg(user_id order by user_id) into mates
  from public.project_members where project_id = p and user_id::text like '5a3b0000-%';
  if mates is null or array_length(mates, 1) < 3 then
    return; -- not one of our seeded samples
  end if;
  update public.count_sheet_rows set assignees = array[mates[2]]
    where project_id = p and position = 1 and assignees = '{}';
  update public.count_sheet_rows set assignees = array_remove(array[me, mates[3]], null)
    where project_id = p and position = 3 and assignees = '{}';
  if me is not null then
    update public.count_sheet_rows set assignees = array[me]
      where project_id = p and position = 4 and assignees = '{}';
  end if;
end;
$fn$;

create or replace function public.create_sample_project(p_lang text default 'en', p_tz text default 'UTC')
returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  p uuid;
begin
  p := private.create_sample_project_seed(p_lang, p_tz);
  perform private.categorize_sample(p);
  perform private.add_sample_choreo(p);
  perform private.add_sample_parts(p);
  return p;
end;
$fn$;

-- Samples people already have.
select private.add_sample_parts(id) from public.projects where is_sample;
