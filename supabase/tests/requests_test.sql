-- Requests / review queue / calendar check. Run in the Supabase SQL Editor; the "ERROR: TEST_OK ..." line is the result (all rolled back).
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  p uuid; v uuid; rid uuid; rid2 uuid; code text; n int; r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local'),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.local'),
    (x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@test.local');
  insert into public.profiles (id, display_name) values (a, 'A'), (b, 'B'), (c, 'C'), (x, 'X');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.projects (title) values ('T') returning id into p;
  insert into public.project_invites (project_id) values (p) returning project_invites.code into code;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.accept_invite(code);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.accept_invite(code);

  -- A asks everyone; then asks only B.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  rid := public.create_request_v2(p, 'Chorus', 'brief', now() + interval '1 day', '{}', '{}', null, false);
  rid2 := public.create_request_v2(p, 'Solo', null, now() - interval '1 hour', array[b], '{}', null, false);
  begin
    insert into public.requests (project_id, title) values (p, 'direct');
    r := r || 'direct_insert=ALLOWED';
  exception when others then r := r || 'direct_insert=blocked';
  end;

  -- B: gets two Inbox items, submits to the first.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notifications where kind = 'request_new'; r := r || ' B_inbox=' || n;
  insert into public.videos (project_id, title, request_id) values (p, 'B chorus', rid) returning id into v;
  insert into public.video_views (video_id) values (v);
  select count(*) into n from public.video_views; r := r || ' B_views=' || n;
  -- C: only the first request was for them.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notifications where kind = 'request_new'; r := r || ' C_inbox=' || n;
  begin
    perform public.remind_request(rid);
    r := r || ' C_remind=ALLOWED';
  exception when others then r := r || ' C_remind=blocked';
  end;
  -- A reminds: only C is missing on the first request.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  n := public.remind_request(rid); r := r || ' reminded=' || n;
  begin
    perform public.remind_request(rid);
    r := r || ' remind_again=ALLOWED';
  exception when others then r := r || ' remind_again=blocked';
  end;
  insert into public.project_events (project_id, title, starts_at) values (p, 'Rehearsal', now() + interval '2 days');
  -- An outsider sees none of it.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select (select count(*) from public.requests) + (select count(*) from public.project_events) + (select count(*) from public.request_assignees) into n;
  r := r || ' outsider_sees=' || n;
  raise exception 'TEST_OK %', r;
end $$;

-- Expected:
-- TEST_OK direct_insert=blocked B_inbox=2 B_views=1 C_inbox=1 C_remind=blocked reminded=1 remind_again=blocked outsider_sees=0
