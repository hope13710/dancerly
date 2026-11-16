-- Permissions, tightened to what the app actually does, plus the music link for everyone in a project.
--
-- 1. Anyone in a project can set its music (title and link), like the choreo video (071). The goal stays the owner's.
--
-- 2. Notes: an author edits the words, nothing else.
--    - Who can see a note (private_to) is fixed once written. Before, an author could make a private note public
--      through the API, and the other person's private replies with it.
--    - Who fixed a note, and when, changes only through set_note_status().
--    - "Edited" is marked only when the author changes the words, not when a renamed teammate's @mention is updated.
--
-- 3. Each table's updatable columns are narrowed to the ones the app changes. Row-level security already decides
--    which rows; this stops changing a row's project, author or creator directly through the API (moving a video
--    into another project, claiming someone's page to delete it, marking a project as a sample...). Functions that
--    run as the database (set_note_status, trash_item, the sample...) and the server are not affected.
--
-- 4. merge_video() is no longer offered in the app; nobody can call it now (the function stays).

-- ---------- 1. Music ----------
create or replace function public.set_project_music(p_project uuid, p_title text, p_url text)
returns void
language plpgsql security definer set search_path = ''
as $fn$
begin
  if not private.is_project_member(p_project) then
    raise exception 'Project not found';
  end if;
  update public.projects
     set music_title = nullif(left(btrim(coalesce(p_title, '')), 200), ''),
         music_url = nullif(left(btrim(coalesce(p_url, '')), 500), '')
   where id = p_project;
end;
$fn$;
revoke all on function public.set_project_music(uuid, text, text) from public, anon;
grant execute on function public.set_project_music(uuid, text, text) to authenticated;

-- ---------- 2. Notes ----------
create or replace function private.handle_note_write()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
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
    new.created_at := old.created_at;
    -- Who can see it is decided when it's written: making a private note public would show the other person's
    -- private replies to everyone.
    new.private_to := old.private_to;
    if new.status is distinct from old.status and current_setting('looproom.status_change', true) is distinct from 'on' then
      raise exception 'Use set_note_status() to change a note''s status';
    end if;
    if current_setting('looproom.status_change', true) is distinct from 'on' then
      new.resolved_by := old.resolved_by;
      new.resolved_at := old.resolved_at;
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
$fn$;

create or replace function private.note_edited()
returns trigger
language plpgsql set search_path = ''
as $fn$
begin
  -- The author changed the words (a teammate's rename updating an @mention isn't an edit).
  if new.body is distinct from old.body and (select auth.uid()) = old.author_id then
    new.edited_at := now();
  end if;
  return new;
end;
$fn$;

-- ---------- 3. Updatable columns ----------
-- From here on, a new column people should change needs its own grant update (...) in its migration.
revoke update on public.projects from anon, authenticated;
grant update (title, image_url, goal, music_title, music_url, target_event_id, allow_share_cards, members_share_links,
  members_share_practice, auto_recap, choreo_video_id, choreo_youtube, choreo_title, choreo_bpm, choreo_count_start)
  on public.projects to authenticated;

revoke update on public.notes from anon, authenticated;
grant update (body) on public.notes to authenticated;

revoke update on public.videos from anon, authenticated;
grant update (title) on public.videos to authenticated;

revoke update on public.count_sheet_rows from anon, authenticated;
grant update (section, counts, focus, status, position, t_start, t_end, video_id, take_id, assignees, assigned_groups)
  on public.count_sheet_rows to authenticated;

revoke update on public.project_pages from anon, authenticated;
grant update (title, body, pinned) on public.project_pages to authenticated;

revoke update on public.project_events from anon, authenticated;
grant update (title, kind, starts_at, ends_at, location, details) on public.project_events to authenticated;

revoke update on public.project_groups from anon, authenticated;
grant update (name) on public.project_groups to authenticated;

revoke update on public.project_invites from anon, authenticated;
grant update (revoked) on public.project_invites to authenticated;

revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, notify, onboarding) on public.profiles to authenticated;

-- Nothing in the app updates these (and row-level security has no update rule for them): no updates at all.
revoke update on public.takes, public.project_members, public.join_requests, public.note_mentions, public.note_reactions,
  public.request_assignees, public.project_group_members, public.take_choreo_align, public.calendar_feeds,
  public.account_deletion_feedback from anon, authenticated;

-- ---------- 4. merge_video ----------
revoke execute on function public.merge_video(uuid, uuid) from public, anon, authenticated;
