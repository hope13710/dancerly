-- Private notes and replies check. Run in the Supabase SQL Editor.
-- A coach (A) leaves a private note for one student (B); another member (C) must not see it.
-- Everything is rolled back on purpose: the "error" ERROR: TEST_OK ... IS the result. Nothing is saved.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  p uuid; v uuid; t uuid; n uuid; code text; k int; r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local'),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.local');
  insert into public.profiles (id, display_name) values (a, 'A'), (b, 'B'), (c, 'C');

  -- A: project, video, take, invite
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.projects (title) values ('T') returning id into p;
  insert into public.videos (project_id, title) values (p, 'V') returning id into v;
  insert into public.takes (video_id, storage_path) values (v, 'x') returning id into t;
  insert into public.project_invites (project_id) values (p) returning project_invites.code into code;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.accept_invite(code);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.accept_invite(code);

  -- A: a team note and a private note for B; a private note to a non-member is refused
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.notes (take_id, t_start, body) values (t, 1, 'team');
  insert into public.notes (take_id, t_start, body, private_to) values (t, 2, 'just for B', b) returning id into n;
  begin
    insert into public.notes (take_id, t_start, body, private_to) values (t, 3, 'outsider', gen_random_uuid());
    r := r || 'outsider=ALLOWED';
  exception when others then r := r || 'outsider=blocked';
  end;

  -- C: sees only the team note, can't reply to or resolve the private one
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into k from public.notes; r := r || ' C_notes=' || k;
  begin
    insert into public.note_replies (note_id, body) values (n, 'peek');
    r := r || ' C_reply=ALLOWED';
  exception when others then r := r || ' C_reply=blocked';
  end;
  begin
    perform public.set_note_status(n, 'resolved');
    r := r || ' C_status=ALLOWED';
  exception when others then r := r || ' C_status=blocked';
  end;

  -- B: sees both, got the private-note notification, replies
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into k from public.notes; r := r || ' B_notes=' || k;
  select string_agg(kind::text, ',' order by kind::text) into code from public.notifications where note_id = n;
  r := r || ' B_kinds=' || coalesce(code, '-');
  insert into public.note_replies (note_id, body) values (n, 'got it');

  -- A: told about the reply and can read it; C still sees no reply and no notification about the note
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select string_agg(kind::text, ',' order by kind::text) into code from public.notifications where note_id = n;
  r := r || ' A_kinds=' || coalesce(code, '-');
  select count(*) into k from public.note_replies; r := r || ' A_replies=' || k;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into k from public.note_replies; r := r || ' C_replies=' || k;
  select count(*) into k from public.notifications where note_id = n; r := r || ' C_notifs=' || k;
  raise exception 'TEST_OK %', r;
end $$;

-- Expected:
-- TEST_OK outsider=blocked C_notes=1 C_reply=blocked C_status=blocked B_notes=2 B_kinds=private_note A_kinds=reply A_replies=1 C_replies=0 C_notifs=0
