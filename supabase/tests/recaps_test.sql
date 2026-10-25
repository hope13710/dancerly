-- Recap visibility check. Run in the Supabase SQL Editor; the "ERROR: TEST_OK ..." line is the result (everything rolls back).
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  p uuid; rid uuid; code text; n int; r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local'),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.local');
  insert into public.profiles (id, display_name) values (a, 'A'), (b, 'B'), (c, 'C');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.projects (title) values ('T') returning id into p;
  insert into public.project_invites (project_id) values (p) returning project_invites.code into code;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.accept_invite(code);

  -- The Edge Function writes recaps with the service role; simulate that.
  perform set_config('role', 'postgres', true);
  insert into public.recaps (project_id, created_by, scope, period, period_start, period_end, notes_up_to, note_count, content, sources)
  values (p, a, 'me', 'week', now() - interval '7 days', now(), now(), 1, '{"headline":"h"}', '[]') returning id into rid;
  perform set_config('role', 'authenticated', true);

  -- B (member) can't see A's private recap; C (outsider) never can.
  select count(*) into n from public.recaps; r := 'B_before_share=' || n;
  begin
    insert into public.recaps (project_id, created_by, scope, period, period_start, period_end, notes_up_to, note_count, content, sources)
    values (p, b, 'me', 'week', now(), now(), now(), 1, '{}', '[]');
    r := r || ' client_insert=ALLOWED';
  exception when others then r := r || ' client_insert=blocked';
  end;
  -- A shares it; B now sees it and gets an Inbox item.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.recaps set shared_at = now() where id = rid;
  begin
    update public.recaps set content = '{"headline":"edited"}' where id = rid;
    r := r || ' content_edit=ALLOWED';
  exception when others then r := r || ' content_edit=blocked';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.recaps; r := r || ' B_after_share=' || n;
  select count(*) into n from public.notifications where kind = 'recap_shared'; r := r || ' B_inbox=' || n;
  insert into public.recap_pins (recap_id) values (rid);
  select count(*) into n from public.recap_pins; r := r || ' B_pins=' || n;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.recaps; r := r || ' outsider_sees=' || n;
  raise exception 'TEST_OK %', r;
end $$;

-- Expected:
-- TEST_OK B_before_share=0 client_insert=blocked content_edit=blocked B_after_share=1 B_inbox=1 B_pins=1 outsider_sees=0
