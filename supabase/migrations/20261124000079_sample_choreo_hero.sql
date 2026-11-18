-- The sample's choreo video becomes the clip on the landing page (Jin leading the routine in front of the class):
-- it reads more like a real choreographer's video than a take of the crew. It's 7.3 s and silent, shot wide
-- (0-3.6 s) then pushed in, so the five practice sections are laid out on its own timeline, and it has no count
-- start: the takes can't be lined up with it by counts (they're 15 s), so Practice asks "Find this move in the
-- original" and the team taps Here once, which is how it works with a real choreo video too.
-- Samples people already have are rebuilt with it the next time they come back (reset_sample below).

create or replace function private.add_sample_choreo(p uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  jin uuid := '5a3b0000-0000-4000-8000-000000000005';
  cv uuid;
  ct uuid;
begin
  if not exists (select 1 from public.projects where id = p and is_sample and choreo_video_id is null and choreo_youtube is null) then
    return;
  end if;
  if not exists (select 1 from public.project_members where project_id = p and user_id = jin) then
    return; -- not one of our seeded samples
  end if;
  insert into public.videos (project_id, title, created_by, created_at, kind)
  values (p, 'Chorus 1 — Jin''s choreo', jin, now() - interval '10 days', 'choreo')
  returning id into cv;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, thumb_path)
  values (cv, 'public:/samples/hero.mp4', 'choreo.mov', jin, now() - interval '10 days', 'public:/samples/hero.jpg')
  returning id into ct;
  update public.projects set choreo_video_id = cv where id = p;
  -- The seeded sections, by position, onto the choreo video (seconds on this clip).
  update public.count_sheet_rows r set video_id = cv, take_id = ct, t_start = s.a, t_end = s.b
  from (values (0, 0.0, 1.2), (1, 1.2, 2.9), (2, 2.9, 4.4), (3, 4.4, 5.8), (4, 5.8, 7.2)) as s(pos, a, b)
  where r.project_id = p and r.position = s.pos;
end;
$function$;

-- Back to how it started. A sample without this choreo video (any earlier version) counts as changed, so it's
-- rebuilt the next time someone comes back to it.
create or replace function public.reset_sample(p_lang text default 'en', p_tz text default 'UTC', p_only_if_changed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  me uuid := (select auth.uid());
  old_p uuid;
  old_at timestamptz;
  new_p uuid;
begin
  if me is null then raise exception 'Log in first'; end if;
  select id, created_at into old_p, old_at from public.projects where created_by = me and is_sample and deleted_at is null limit 1;
  if old_p is null then return jsonb_build_object('status', 'none'); end if;

  -- Anything done in it since it was made (the seed writes everything at once, at old_at), or an older version.
  if p_only_if_changed and not (
       not exists (select 1 from public.takes t join public.videos v on v.id = t.video_id
                   where v.project_id = old_p and v.kind = 'choreo' and t.storage_path = 'public:/samples/hero.mp4')
    or not exists (select 1 from public.project_pages where project_id = old_p and body like '%dancerly:event/%')
    or exists (select 1 from public.videos where project_id = old_p and created_by = me)
    or exists (select 1 from public.takes where project_id = old_p and uploaded_by = me)
    or exists (select 1 from public.notes where project_id = old_p and (author_id = me or resolved_by = me or updated_at > old_at + interval '1 minute'))
    or exists (select 1 from public.note_replies r join public.notes n on n.id = r.note_id where n.project_id = old_p and r.author_id = me)
    or exists (select 1 from public.note_reactions x join public.notes n on n.id = x.note_id where n.project_id = old_p and x.user_id = me)
    or exists (select 1 from public.count_sheet_rows where project_id = old_p and updated_at > old_at + interval '1 minute')
    or exists (select 1 from public.project_pages where project_id = old_p and updated_at > old_at + interval '1 minute')
    or exists (select 1 from public.project_events where project_id = old_p and created_by = me)
    or exists (select 1 from public.requests where project_id = old_p and created_by = me)
    or exists (select 1 from public.project_groups where project_id = old_p and created_by = me)
    or exists (select 1 from public.recaps where project_id = old_p and created_by = me and model is distinct from 'sample')
  ) then
    return jsonb_build_object('status', 'same', 'project', old_p);
  end if;

  update public.projects set is_sample = false where id = old_p; -- so create_sample_project makes a new one
  new_p := public.create_sample_project('en', p_tz);
  delete from public.notifications where project_id in (old_p, new_p);
  delete from public.projects where id = old_p;
  return jsonb_build_object('status', 'done', 'project', new_p, 'previous', old_p);
end;
$function$;
