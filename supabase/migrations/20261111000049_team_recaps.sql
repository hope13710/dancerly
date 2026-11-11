-- Team recaps: dancerly writes the project's recap on its own, so nobody has to remember to make one,
-- and a team gets one recap per practice instead of one per person.
--   • Before each rehearsal on the calendar (3 hours ahead): the feedback since the previous rehearsal.
--   • Projects with no rehearsals on the calendar: Monday 8 AM in the owner's time zone, the past week.
--   • Only when there are at least 3 new team-visible notes. Private notes never go in.
-- A team recap is visible to everyone on the project right away (it's built only from notes they can all see).
-- Anyone on the project can update it when new feedback comes in; the earlier one stays as an earlier version.
-- Personal recaps ("Just me") work as before: yours until you share them.

-- The owner can switch automatic team recaps off for a project (on by default).
alter table public.projects add column if not exists auto_recap boolean not null default true;

alter table public.recaps
  -- The project's own recap, visible to every member.
  add column if not exists team boolean not null default false,
  -- Which practice it covers: 'rehearsal:<event id>', 'week:<Monday>', or '<period>:<start day>' for one made by hand.
  -- Updates keep the cycle, so the app shows them as versions of the same recap.
  add column if not exists cycle text,
  -- true = written on schedule by dancerly; false = a member made or updated it.
  add column if not exists auto boolean not null default false;

-- One scheduled recap per practice, however often the schedule runs.
create unique index if not exists recaps_team_cycle_auto_idx on public.recaps (project_id, cycle) where team and auto;
-- Two people pressing Update at the same moment get the same recap, not two.
create unique index if not exists recaps_team_same_input_idx on public.recaps (project_id, cycle, coalesce(video_id, '00000000-0000-0000-0000-000000000000'::uuid), note_count, notes_up_to) where team;
create index if not exists recaps_team_project_idx on public.recaps (project_id, created_at desc) where team;

-- Team recaps are seen by the whole project; everything else as before (creator, or the project once shared).
drop policy if exists "recaps: creator, or the project once shared" on public.recaps;
create policy "recaps: creator, the project once shared, or a team recap" on public.recaps
  for select to authenticated using (
    created_by = (select auth.uid())
    or ((shared_at is not null or team) and private.is_project_member(project_id))
  );

-- Only the project owner deletes a team recap (it belongs to the project, not to whoever pressed Update).
drop policy if exists "recaps: creator or project owner deletes" on public.recaps;
create policy "recaps: creator or project owner deletes" on public.recaps
  for delete to authenticated using (
    (created_by = (select auth.uid()) and not team) or private.is_project_owner(project_id)
  );

-- Team recaps aren't "shared" one by one, and their to-do ticks would be the same for everyone, so a member
-- can't change them; sharing and ticks stay for personal recaps.
drop policy if exists "recaps: creator shares and ticks items" on public.recaps;
create policy "recaps: creator shares and ticks items" on public.recaps
  for update to authenticated
  using (created_by = (select auth.uid()) and not team)
  with check (created_by = (select auth.uid()) and not team and (shared_at is null or not has_private));

-- ---------- The schedule ----------
-- Every 15 minutes the recap function looks for rehearsals starting within 3 hours and for Monday mornings.
-- It checks the same database secret as the email function before doing anything.
select cron.unschedule(jobid) from cron.job where jobname = 'dancerly-team-recaps';
select cron.schedule('dancerly-team-recaps', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://egkwjdwfzuslyrhuzkmq.supabase.co/functions/v1/generate-recap',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := '{"schedule": true}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
