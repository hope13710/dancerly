-- Inbox / ownership check. Run in the Supabase SQL Editor.
-- It creates two throwaway users, runs the flow, then rolls everything back on purpose:
-- the "error" ERROR: TEST_OK ... IS the result. Nothing is saved.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  p uuid; v uuid; t uuid; n uuid; code text; c int; r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local');
  insert into public.profiles (id, display_name) values (a, 'A'), (b, 'B');

  -- A: project, video, take, invite
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.projects (title) values ('T') returning id into p;
  insert into public.videos (project_id, title) values (p, 'V') returning id into v;
  insert into public.takes (video_id, storage_path) values (v, 'x') returning id into t;
  insert into public.project_invites (project_id) values (p) returning project_invites.code into code;

  -- B: joins, notes on A's take with an @mention, uploads Take 2
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.accept_invite(code);
  insert into public.notes (take_id, t_start, body) values (t, 1, 'hi') returning id into n;
  insert into public.note_mentions (note_id, user_id) values (n, a);
  insert into public.takes (video_id, storage_path) values (v, 'y');
  select count(*) into c from public.notifications; r := 'B_sees_before=' || c;

  -- A: reads inbox, resolves B's note, marks read, tries to tamper, hands over the project
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select string_agg(kind::text, ',' order by kind::text) into code from public.notifications;
  r := r || ' A_kinds=' || coalesce(code, '-');
  perform public.set_note_status(n, 'resolved');
  update public.notifications set read_at = now();
  get diagnostics c = row_count; r := r || ' A_marked=' || c;
  begin
    update public.notifications set kind = 'joined';
    r := r || ' kind_update=ALLOWED';
  exception when others then r := r || ' kind_update=blocked';
  end;
  perform public.transfer_ownership(p, b);
  select role::text into code from public.project_members where project_id = p and user_id = b;
  r := r || ' B_role=' || code;

  -- B: sees only their own
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select string_agg(kind::text, ',') into code from public.notifications; r := r || ' B_kinds=' || coalesce(code, '-');
  raise exception 'TEST_OK %', r;
end $$;

-- Expected:
-- TEST_OK B_sees_before=0 A_kinds=joined,mention,new_take A_marked=3 kind_update=blocked B_role=owner B_kinds=note_resolved
