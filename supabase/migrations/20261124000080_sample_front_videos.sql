-- The sample's videos become Nova Crew from the front: seven pictogram dancers in a studio, Chorus 1 as six
-- eights at 98 BPM (32.7 s each, silent, about 3 MB). Take 1 has the mistakes the notes are about (you come up
-- early from the squat, the back row blocked, the left side ahead on the walk-up, Leo hidden behind Jin, Maya's
-- arm straight up), Take 2 has most of them fixed, and Jin's choreo video is clean and lines up with both by counts.
-- The notes, practice sections, page chips and sketches move onto the six-eight timeline. Migrations 077 and 078
-- run first; samples people already have are rebuilt the next time they come back to them.
-- The videos are drawn by tools/sample-video/front.html.

create or replace function private.create_sample_project_seed(p_lang text default 'en', p_tz text default 'UTC')
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  me uuid := (select auth.uid());
  tz text := coalesce((select name from pg_catalog.pg_timezone_names where name = p_tz limit 1), 'UTC');
  my_name text;
  jin uuid := '5a3b0000-0000-4000-8000-000000000005';
  dani uuid := '5a3b0000-0000-4000-8000-000000000006';
  maya uuid := '5a3b0000-0000-4000-8000-000000000007';
  leo uuid := '5a3b0000-0000-4000-8000-000000000008';
  ari uuid := '5a3b0000-0000-4000-8000-000000000009';
  sofia uuid := '5a3b0000-0000-4000-8000-000000000010';
  p uuid; v uuid; t1 uuid; t2 uuid; rq uuid; regionals uuid; practice uuid; dress uuid; s_walk uuid; s_end uuid;
  day_fmt text := 'Dy, Mon FMDD';
  n_face uuid; n_squat uuid; n_six uuid; n_space uuid; n_ask uuid; n_walk uuid; n_gap uuid; n_end uuid;
  m_squat uuid; m_early uuid; m_freeze uuid;
  day0 timestamptz;
  take1_at timestamptz := now() - interval '8 days';
  take2_at timestamptz := now() - interval '22 hours';
  beat numeric := 60.0 / 98;   -- the videos' tempo: six eights of Chorus 1
  c1 numeric := 1.25;          -- count 1 in Take 1 (after the count-in)
  c2 numeric := 1.25;          -- count 1 in Take 2
begin
  if me is null then raise exception 'Log in first'; end if;
  select id into p from public.projects where created_by = me and is_sample limit 1;
  if p is not null then return p; end if;
  select coalesce(nullif(btrim(display_name), ''), 'you') into my_name from public.profiles where id = me;
  my_name := coalesce(my_name, 'you'); -- no profile row yet: the mention still reads
  -- Midnight today in the person's time zone.
  day0 := (date_trunc('day', now() at time zone tz)) at time zone tz;

  insert into public.projects (title, created_by, is_sample, goal, music_title)
  values ('Nova Crew — RED RED', me, true,
    'Top 3 at City Dance Cup Regionals with Jin''s RED RED choreo. This week: clean Chorus 1, every hit together and everyone on their marks.',
    'RED RED — CORTIS')
  returning id into p;
  insert into public.project_members (project_id, user_id, role, joined_at)
  values (p, jin, 'member', now() - interval '30 days'), (p, ari, 'member', now() - interval '30 days'),
         (p, dani, 'member', now() - interval '29 days'), (p, maya, 'member', now() - interval '28 days'),
         (p, leo, 'member', now() - interval '28 days'), (p, sofia, 'member', now() - interval '27 days');

  -- Chorus 1, filmed twice: Take 1 eight days ago, Take 2 yesterday after working the notes.
  insert into public.videos (project_id, title, created_by, created_at, bpm)
  values (p, 'Chorus 1 — full out', dani, take1_at, 98)
  returning id into v;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (v, 'public:/samples/nova-take-1.mp4', 'IMG_4127.MOV', dani, take1_at, c1, 'public:/samples/nova-take-1.jpg')
  returning id into t1;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (v, 'public:/samples/nova-take-2.mp4', 'IMG_4188.MOV', dani, take2_at, c2, 'public:/samples/nova-take-2.jpg')
  returning id into t2;

  -- ---------- Notes on Take 1 (beats from count 1 of the 1st eight; each eight is 8 beats) ----------
  insert into public.notes (take_id, t_start, body, author_id, private_to, created_at)
  values (t1, c1, 'Your facials in the first eight are 🔥 Keep that energy all the way to the ending pose.',
    jin, me, take1_at + interval '35 minutes')
  returning id into n_face;
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t1, c1 + 10 * beat, c1 + 12 * beat,
    '@' || my_name || ' The squat hits on 3 and holds through 4. You''re popping back up on the "and." Sit in it.',
    jin, take1_at + interval '40 minutes')
  returning id into n_squat;
  insert into public.note_mentions (note_id, user_id) values (n_squat, me);
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t1, c1 + 13 * beat, 'Squat on 6 was SO together 👏 Keep that.', maya, take1_at + interval '48 minutes')
  returning id into n_six;
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t1, c1 + 16 * beat,
    'Back row, open up your spacing. Find your window between the front row so we can see you.',
    ari, take1_at + interval '55 minutes')
  returning id into n_space;
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t1, c1 + 20 * beat, 'Do we start walking on 5 or on the "and" before it?', leo, take1_at + interval '62 minutes')
  returning id into n_ask;
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at, sketch)
  values (t1, c1 + 20 * beat, c1 + 24 * beat,
    'The left side is a step ahead on the walk-up. Stay in one line, eyes front.',
    jin, take1_at + interval '70 minutes',
    '{"v":1,"strokes":[{"tool":"circle","color":"#ffd60a","w":0.006,"pts":[[0.12,0.42],[0.46,0.88]]},{"tool":"arrow","color":"#ff453a","w":0.006,"pts":[[0.29,0.95],[0.29,0.84]]}]}'::jsonb)
  returning id into n_walk;
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at, sketch)
  values (t1, c1 + 24 * beat, c1 + 28 * beat,
    'On the formation change, Leo ends up hidden behind Jin. Shift half a step left into the gap.',
    dani, take1_at + interval '80 minutes',
    '{"v":1,"strokes":[{"tool":"circle","color":"#ffd60a","w":0.006,"pts":[[0.42,0.36],[0.58,0.86]]},{"tool":"arrow","color":"#ff453a","w":0.006,"pts":[[0.5,0.32],[0.4,0.32]]}]}'::jsonb)
  returning id into n_gap;
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t1, c1 + 46 * beat, c1 + 48 * beat,
    'Ending pose: Maya''s arm goes straight up, everyone else bends the elbow with the hand by the head. Match the angle and freeze on 8.',
    sofia, take1_at + interval '90 minutes')
  returning id into n_end;

  -- ---------- Notes on Take 2 ----------
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t2, c2 + 10 * beat, c2 + 12 * beat,
    '@' || my_name || ' So much better. You sat in the squat this time ✅',
    jin, take2_at + interval '50 minutes')
  returning id into m_squat;
  insert into public.note_mentions (note_id, user_id) values (m_squat, me);
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t2, c2 + 24 * beat, c2 + 28 * beat,
    'Spacing looks clean now. New one: the formation change starts a little early. You''re going on the "and" of 1. Wait for 2.',
    ari, take2_at + interval '60 minutes')
  returning id into m_early;
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t2, c2 + 47 * beat, 'The ending is way sharper. Hold the freeze for a full beat before you drop.',
    dani, take2_at + interval '70 minutes')
  returning id into m_freeze;

  -- What kind of note each one is (Insights and the recaps group by these).
  perform set_config('looproom.category_change', 'on', true);
  update public.notes n set category = c.category, category_source = 'ai'
  from (values (n_face, 'performance'), (n_squat, 'timing'), (n_six, 'sync'), (n_space, 'formation'), (n_ask, 'timing'),
               (n_walk, 'formation'), (n_gap, 'formation'), (n_end, 'technique'),
               (m_squat, 'timing'), (m_early, 'timing'), (m_freeze, 'technique')) as c(id, category)
  where n.id = c.id;
  perform set_config('looproom.category_change', 'off', true);

  -- Replies, agrees, and where things stand now.
  insert into public.note_replies (note_id, author_id, body, created_at) values
    (n_ask, jin, 'On 5. The "and" is the head turn.', take1_at + interval '75 minutes'),
    (n_end, maya, 'That''s me 😅 Drilling it in mirror mode.', take1_at + interval '3 hours'),
    (n_gap, leo, 'Found my gap, fixed it in Take 2!', take2_at + interval '30 minutes');
  insert into public.note_reactions (note_id, user_id) values
    (n_squat, dani), (n_squat, ari), (n_six, jin), (n_six, dani), (n_six, ari), (n_space, jin), (n_space, sofia),
    (n_gap, jin), (n_gap, leo), (n_end, jin), (n_end, maya), (m_squat, maya), (m_squat, ari), (m_freeze, jin);
  perform set_config('looproom.status_change', 'on', true);
  update public.notes set status = 'practicing' where id in (n_walk, n_end, m_freeze);
  update public.notes set status = 'resolved', resolved_by = jin, resolved_at = take2_at + interval '2 hours' where id in (n_squat, n_space, n_gap, m_squat);
  update public.notes set status = 'resolved', resolved_by = maya, resolved_at = take1_at + interval '2 hours' where id = n_six;
  update public.notes set status = 'resolved', resolved_by = leo, resolved_at = take1_at + interval '80 minutes' where id = n_ask;
  perform set_config('looproom.status_change', 'off', true);

  -- ---------- Practice sections (moved onto the choreo video by add_sample_choreo) ----------
  insert into public.count_sheet_rows (project_id, position, section, counts, focus, video_id, t_start, status) values
    (p, 0, 'Hook groove', '1st eight', 'Bounce on the beat, chest leads', v, c2, 'clean'),
    (p, 1, 'Squats', '2nd eight, 3–6', 'Sit in it on 3–4, hit 6 together', v, c2 + 10 * beat, 'clean'),
    (p, 2, 'Walk-up', '3rd eight, 5–8', 'One line, eyes front', v, c2 + 20 * beat, 'practicing'),
    (p, 3, 'Formation change', '4th eight, 1–4', 'Wait for 2, find your window', v, c2 + 24 * beat, 'practicing'),
    (p, 4, 'Ending pose', '6th eight, 5–8', 'Elbow bent, hand by the head, freeze on 8', v, c2 + 44 * beat, 'learning');
  select id into s_walk from public.count_sheet_rows where project_id = p and position = 2;
  select id into s_end from public.count_sheet_rows where project_id = p and position = 4;

  -- ---------- Calendar: practice tomorrow, the dress run, and Regionals (the goal) ----------
  insert into public.project_events (project_id, title, kind, starts_at, ends_at, location, details, created_by)
  values (p, 'Practice', 'rehearsal', day0 + interval '1 day 19 hours', day0 + interval '1 day 21 hours', 'Studio B',
    'Chorus 1 3x full out, then drill the formation change in 4-counts.', jin)
  returning id into practice;
  insert into public.project_events (project_id, title, kind, starts_at, ends_at, location, details, created_by)
  values (p, 'Full dress run', 'rehearsal', day0 + interval '11 days 18 hours', day0 + interval '11 days 20 hours', 'Studio B',
    'Costumes on. Two full runs, then notes.', jin)
  returning id into dress;
  insert into public.project_events (project_id, title, kind, starts_at, location, details, created_by)
  values (p, 'City Dance Cup Regionals', 'show', day0 + interval '18 days 10 hours', 'City Arts Center',
    'Call time 9:00. We''re in the second block.', jin)
  returning id into regionals;
  update public.projects set target_event_id = regionals where id = p;

  -- ---------- An assignment for you, Leo and Maya, due before practice ----------
  insert into public.requests (project_id, title, brief, due_at, everyone, reference_video_id, created_by, created_at, audience)
  values (p, 'Solo check: film your Chorus 1',
    'Front view, full body in frame, with the music, full out.' || chr(10) || 'We''ll go through them together at practice.',
    day0 + interval '1 day 18 hours', false, v, ari, now() - interval '1 day', null)
  returning id into rq;
  insert into public.request_assignees (request_id, user_id) values (rq, me), (rq, leo), (rq, maya);

  -- ---------- The week's plan, pinned: chips to the dates, the takes, the sections and the people ----------
  -- Chip labels are stored as written (as when someone picks them in the editor), so the dates are spelled out here.
  insert into public.project_pages (project_id, title, body, pinned, created_by, updated_by, created_at, updated_at)
  values (p, 'This week: cleaning Chorus 1',
    '# This week: cleaning Chorus 1' || chr(10) ||
    '**[City Dance Cup Regionals · ' || to_char((day0 + interval '18 days') at time zone tz, day_fmt) || '](dancerly:event/' || regionals || ') is 18 days out.** '
      || 'We clean Chorus 1 this week so we can start full runs next week.' || chr(10) || chr(10) ||
    '## Schedule' || chr(10) ||
    '- [Practice · ' || to_char((day0 + interval '1 day') at time zone tz, day_fmt) || ' · 7 PM](dancerly:event/' || practice || ') at Studio B: Chorus 1 3x full out, then the formation change in 4-counts' || chr(10) ||
    '- Solo check videos due before practice: [' || my_name || '](dancerly:person/' || me || ') [Leo Kim](dancerly:person/' || leo || ') [Maya Chen](dancerly:person/' || maya || ')' || chr(10) ||
    '- Costumes on for the [Full dress run · ' || to_char((day0 + interval '11 days') at time zone tz, day_fmt) || ' · 6 PM](dancerly:event/' || dress || ')' || chr(10) || chr(10) ||
    '## Cleaning checklist' || chr(10) ||
    '- [x] Squat on 3–4, sit in it' || chr(10) ||
    '- [x] Back row spacing (3rd eight)' || chr(10) ||
    '- [x] Formation change: [Leo Kim](dancerly:person/' || leo || ') found his gap' || chr(10) ||
    '- [ ] [Practice · Walk-up · 3rd eight, 5–8](dancerly:section/' || s_walk || ') in one line. Left side, see [Chorus 1 — full out · Take 1 · 00:13](dancerly:video/' || v || '?take=1&t=' || round(c1 + 20 * beat, 2) || '&note=' || n_walk || ')' || chr(10) ||
    '- [ ] Ending pose: elbow bent, freeze on 8. [Maya Chen](dancerly:person/' || maya || ') [Sofia Reyes](dancerly:person/' || sofia || ') can you two lead it in [Practice · Ending pose · 6th eight, 5–8](dancerly:section/' || s_end || ')' || chr(10) || chr(10) ||
    '## Watch before practice' || chr(10) ||
    'Take 2 is so much cleaner. The formation change still goes early, on the "and" of 1. Wait for 2:' || chr(10) ||
    '![Chorus 1 — full out · Take 2 · 00:15](dancerly:video/' || v || '?take=2&t=' || round(c2 + 24 * beat, 2) || '&note=' || m_early || ')' || chr(10) || chr(10) ||
    '**Bring**: knee pads and water. Mark if you need to, but run it full out at least twice.',
    true, ari, ari, now() - interval '20 hours', now() - interval '20 hours');

  -- ---------- Your recap, written ahead (no AI call); the team's follows from it (add_sample_team_recap) ----------
  insert into public.recaps (project_id, created_by, scope, period, period_start, period_end, notes_up_to, note_count, content, sources, model, created_at, has_private)
  values (p, me, 'me', 'week', now() - interval '8 days', now(), now(), 8,
    jsonb_build_object(
      'lang', 'en',
      'headline', 'Your squat on 3–4 landed in Take 2. The ending pose is next.',
      'worked_on', jsonb_build_array(jsonb_build_object('text', 'Sitting in the squat on 3–4 instead of popping up on the "and."', 'cites', jsonb_build_array('n1'))),
      'next', jsonb_build_array(
        jsonb_build_object('text', 'Ending pose: elbow bent, hand by the head, and hold the freeze on 8 for a full beat.', 'cites', jsonb_build_array('n5', 'n8')),
        jsonb_build_object('text', 'Formation change: wait for 2 before you move.', 'cites', jsonb_build_array('n7'))),
      'landed', jsonb_build_array(jsonb_build_object('text', 'You sat in the squat on 3–4 in Take 2.', 'cites', jsonb_build_array('n6'))),
      'recurring', jsonb_build_array(jsonb_build_object('text', 'The ending pose came up in both takes.', 'cites', jsonb_build_array('n5', 'n8')))),
    (select jsonb_agg(jsonb_build_object('ref', s.ref, 'note_id', n.id, 'body', n.body, 'status', n.status, 't_start', n.t_start, 't_end', n.t_end,
              'video_id', n.video_id, 'video_title', 'Chorus 1 — full out', 'author', (select display_name from public.profiles pr where pr.id = n.author_id),
              'take_number', s.take_number, 'agrees', (select count(*) from public.note_reactions x where x.note_id = n.id)) order by s.ref)
       from (values ('n1', n_squat, 1), ('n2', n_space, 1), ('n3', n_walk, 1), ('n4', n_gap, 1), ('n5', n_end, 1),
                    ('n6', m_squat, 2), ('n7', m_early, 2), ('n8', m_freeze, 2)) as s(ref, id, take_number)
       join public.notes n on n.id = s.id),
    'sample', now() - interval '2 hours', false);
  insert into public.recap_pins (recap_id, user_id) select id, me from public.recaps where project_id = p;

  -- The sample shouldn't fill the Inbox with seeding noise.
  delete from public.notifications where project_id = p;
  return p;
end;
$function$;

-- The choreo video: Jin's clean run of Chorus 1, in the same front view, lined up with the takes by counts.
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
  beat numeric := 60.0 / 98;
  c numeric := 1.25;
  len numeric := 32.6; -- nova-choreo.mp4 runs 32.7 s
begin
  if not exists (select 1 from public.projects where id = p and is_sample and choreo_video_id is null and choreo_youtube is null) then
    return;
  end if;
  if not exists (select 1 from public.project_members where project_id = p and user_id = jin) then
    return; -- not one of our seeded samples
  end if;
  insert into public.videos (project_id, title, created_by, created_at, bpm, kind)
  values (p, 'Chorus 1 — Jin''s choreo', jin, now() - interval '10 days', 98, 'choreo')
  returning id into cv;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (cv, 'public:/samples/nova-choreo.mp4', 'choreo.mov', jin, now() - interval '10 days', c, 'public:/samples/nova-choreo.jpg')
  returning id into ct;
  update public.projects set choreo_video_id = cv where id = p;
  -- The seeded sections, by position, onto the choreo video (beats from count 1).
  update public.count_sheet_rows r set video_id = cv, take_id = ct,
    t_start = round(c + s.b0 * beat, 2),
    t_end = least(round(c + s.b1 * beat, 2), len)
  from (values (0, 0, 8), (1, 10, 14), (2, 20, 24), (3, 24, 28), (4, 44, 48)) as s(pos, b0, b1)
  where r.project_id = p and r.position = s.pos;
end;
$function$;

-- Back to how it started. A sample without these videos (any earlier version) is rebuilt the next time someone comes back.
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
                   where v.project_id = old_p and v.kind = 'choreo' and t.storage_path = 'public:/samples/nova-choreo.mp4')
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
