-- The sample project follows the app's language. Its seeded content (notes, replies, count sheet, notice,
-- assignment, calendar, AI summary, teammates) is written once, in the language chosen when it was opened.
-- When someone switches language later, relocalize_sample() opens a fresh sample in the new language and
-- carries over what they did in the old one: their own notes (with mentions, sketches and status), their
-- replies, their 👍, and status changes on the seeded notes. Then the old sample goes.
--
-- Left alone ('kept') when they've done more than that in the sample (uploaded a video or take, edited the
-- count sheet or notice, added an event, assignment or group, or made their own AI summary), so nothing they
-- made is lost. Samples from before migration 036 (the old videos) are simply replaced.
--
-- Returns {"status": "none" | "same" | "kept" | "done", "project": <the sample's id>}.

create or replace function public.relocalize_sample(p_lang text default 'en', p_tz text default 'UTC')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ko boolean := p_lang = 'ko';
  ko_ids uuid[] := array['5a3b0000-0000-4000-8000-000000000001', '5a3b0000-0000-4000-8000-000000000002',
                         '5a3b0000-0000-4000-8000-000000000003', '5a3b0000-0000-4000-8000-000000000004']::uuid[];
  en_ids uuid[] := array['5a3b0000-0000-4000-8000-000000000005', '5a3b0000-0000-4000-8000-000000000006',
                         '5a3b0000-0000-4000-8000-000000000007', '5a3b0000-0000-4000-8000-000000000008']::uuid[];
  old_ids uuid[]; new_ids uuid[];
  old_p uuid; new_p uuid; old_at timestamptz; new_at timestamptz; old_version boolean;
  n record; m uuid;
begin
  if me is null then raise exception 'Log in first'; end if;
  select id, created_at into old_p, old_at from public.projects where created_by = me and is_sample limit 1;
  if old_p is null then return jsonb_build_object('status', 'none'); end if;

  -- Which language the sample is in: its seeded teammates say so.
  if exists (select 1 from public.project_members where project_id = old_p and user_id = any (ko_ids)) = ko then
    return jsonb_build_object('status', 'same', 'project', old_p);
  end if;
  old_ids := case when ko then en_ids else ko_ids end;
  new_ids := case when ko then ko_ids else en_ids end;
  old_version := exists (select 1 from public.takes t join public.videos v on v.id = t.video_id
                         where v.project_id = old_p and t.storage_path like 'public:/samples/sample-take-%');

  if not old_version and (
       exists (select 1 from public.videos where project_id = old_p and created_by = me)
    or exists (select 1 from public.takes where project_id = old_p and uploaded_by = me)
    or exists (select 1 from public.count_sheet_rows where project_id = old_p and updated_at > old_at + interval '1 minute')
    or exists (select 1 from public.project_pages where project_id = old_p and updated_at > old_at + interval '1 minute')
    or exists (select 1 from public.project_events where project_id = old_p and created_by = me)
    or exists (select 1 from public.requests where project_id = old_p and created_by = me)
    or exists (select 1 from public.project_groups where project_id = old_p and created_by = me)
    or exists (select 1 from public.recaps where project_id = old_p and created_by = me and model is distinct from 'sample')
  ) then
    return jsonb_build_object('status', 'kept', 'project', old_p);
  end if;

  -- A fresh sample in the new language.
  update public.projects set is_sample = false where id = old_p;
  new_p := public.create_sample_project(p_lang, p_tz);
  select created_at into new_at from public.projects where id = new_p;

  if not old_version then
    -- Seeded notes line up by when they were written relative to the sample's creation (the same offsets each time).
    create temp table note_map (old_id uuid primary key, new_id uuid) on commit drop;
    insert into note_map
    select o.id, w.id
    from public.notes o
    join public.takes ot on ot.id = o.take_id
    join public.notes w on w.project_id = new_p and w.author_id = any (new_ids)
    join public.takes wt on wt.id = w.take_id and wt.number = ot.number
    where o.project_id = old_p and o.author_id = any (old_ids)
      and w.created_at - new_at = o.created_at - old_at;

    perform set_config('looproom.status_change', 'on', true);
    -- Where the seeded notes stand now (someone may have resolved or reopened them).
    update public.notes w
    set status = o.status, resolved_at = o.resolved_at,
        resolved_by = case when o.resolved_by = any (old_ids) then new_ids[array_position(old_ids, o.resolved_by)] else o.resolved_by end
    from note_map nm join public.notes o on o.id = nm.old_id
    where w.id = nm.new_id;

    -- Their own notes, on the same take of the new sample.
    for n in
      select o.*, ot.number as take_number from public.notes o join public.takes ot on ot.id = o.take_id
      where o.project_id = old_p and o.author_id = me order by o.created_at
    loop
      insert into public.notes (take_id, t_start, t_end, body, author_id, private_to, sketch, created_at)
      select t.id, n.t_start, n.t_end, n.body, me,
             case when n.private_to = any (old_ids) then new_ids[array_position(old_ids, n.private_to)] else n.private_to end,
             n.sketch, n.created_at
      from public.takes t join public.videos v on v.id = t.video_id
      where v.project_id = new_p and t.number = n.take_number
      returning id into m;
      if m is null then continue; end if;
      update public.notes set status = n.status, resolved_at = n.resolved_at,
        resolved_by = case when n.resolved_by = any (old_ids) then new_ids[array_position(old_ids, n.resolved_by)] else n.resolved_by end
      where id = m;
      insert into note_map values (n.id, m);
      insert into public.note_mentions (note_id, user_id)
      select m, case when nm2.user_id = any (old_ids) then new_ids[array_position(old_ids, nm2.user_id)] else nm2.user_id end
      from public.note_mentions nm2 where nm2.note_id = n.id
      on conflict do nothing;
      m := null;
    end loop;
    perform set_config('looproom.status_change', 'off', true);

    -- Their replies and 👍 on any of those notes.
    insert into public.note_replies (note_id, author_id, body, created_at, updated_at)
    select nm.new_id, me, r.body, r.created_at, r.updated_at
    from public.note_replies r join note_map nm on nm.old_id = r.note_id
    where r.author_id = me;
    insert into public.note_reactions (note_id, user_id, created_at)
    select nm.new_id, me, x.created_at
    from public.note_reactions x join note_map nm on nm.old_id = x.note_id
    where x.user_id = me
    on conflict do nothing;
  end if;

  delete from public.notifications where project_id in (old_p, new_p);
  delete from public.projects where id = old_p;
  return jsonb_build_object('status', 'done', 'project', new_p, 'previous', old_p);
end;
$$;

revoke all on function public.relocalize_sample(text, text) from public, anon;
grant execute on function public.relocalize_sample(text, text) to authenticated;
