-- First-run experience: onboarding progress on the profile, and a sample project anyone can open.
-- The sample is a real project in the person's own account (only they and four sample teammates are in it),
-- built from one shared set of sample videos served with the app (/samples/…), so it costs no storage.

alter table public.profiles add column onboarding jsonb not null default '{}'::jsonb;
alter table public.projects add column is_sample boolean not null default false;

-- ---------- Sample teammates (can't log in; they only appear inside sample projects) ----------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('5a3b0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-ko-1@sample.looproom.invalid', '{"sample": true}', now(), now()),
  ('5a3b0000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-ko-2@sample.looproom.invalid', '{"sample": true}', now(), now()),
  ('5a3b0000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-ko-3@sample.looproom.invalid', '{"sample": true}', now(), now()),
  ('5a3b0000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-ko-4@sample.looproom.invalid', '{"sample": true}', now(), now()),
  ('5a3b0000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-en-1@sample.looproom.invalid', '{"sample": true}', now(), now()),
  ('5a3b0000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-en-2@sample.looproom.invalid', '{"sample": true}', now(), now()),
  ('5a3b0000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-en-3@sample.looproom.invalid', '{"sample": true}', now(), now()),
  ('5a3b0000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sample-en-4@sample.looproom.invalid', '{"sample": true}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, display_name)
values
  ('5a3b0000-0000-4000-8000-000000000001', '서하린'),
  ('5a3b0000-0000-4000-8000-000000000002', '김도윤'),
  ('5a3b0000-0000-4000-8000-000000000003', '박지우'),
  ('5a3b0000-0000-4000-8000-000000000004', '이수아'),
  ('5a3b0000-0000-4000-8000-000000000005', 'Hana Seo'),
  ('5a3b0000-0000-4000-8000-000000000006', 'Jordan Lee'),
  ('5a3b0000-0000-4000-8000-000000000007', 'Maya Park'),
  ('5a3b0000-0000-4000-8000-000000000008', 'Leo Choi')
on conflict (id) do nothing;

-- ---------- The sample project ----------
-- Opens the caller's sample if they already have one; otherwise builds it in their language and time zone.
create function public.create_sample_project(p_lang text default 'en', p_tz text default 'UTC')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ko boolean := p_lang = 'ko';
  tz text := coalesce((select name from pg_catalog.pg_timezone_names where name = p_tz limit 1), 'UTC');
  my_name text;
  lead_id uuid; film_id uuid; d3_id uuid; d4_id uuid; -- leader/choreographer, who films, two dancers
  p uuid; v uuid; t1 uuid; t2 uuid; rq uuid;
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; n5 uuid; n6 uuid; n7 uuid;
  day0 timestamptz;
  beat numeric := 0.6;         -- 100 BPM
  c1 numeric := 1.20;          -- count 1 in Take 1
  c2 numeric := 2.05;          -- count 1 in Take 2
begin
  if me is null then raise exception 'Log in first'; end if;
  select id into p from public.projects where created_by = me and is_sample limit 1;
  if p is not null then return p; end if;
  select display_name into my_name from public.profiles where id = me;

  if ko then
    lead_id := '5a3b0000-0000-4000-8000-000000000001'; film_id := '5a3b0000-0000-4000-8000-000000000002';
    d3_id := '5a3b0000-0000-4000-8000-000000000003'; d4_id := '5a3b0000-0000-4000-8000-000000000004';
  else
    lead_id := '5a3b0000-0000-4000-8000-000000000005'; film_id := '5a3b0000-0000-4000-8000-000000000006';
    d3_id := '5a3b0000-0000-4000-8000-000000000007'; d4_id := '5a3b0000-0000-4000-8000-000000000008';
  end if;
  -- Midnight today in the person's time zone.
  day0 := (date_trunc('day', now() at time zone tz)) at time zone tz;

  insert into public.projects (title, created_by, is_sample, goal, music_title)
  values (
    case when ko then '샘플 · 2026 봄 정기공연' else 'Sample · Spring Showcase 2026' end,
    me, true,
    case when ko then '5월 정기공연 오프닝 무대. 코러스 칼군무 완성하고, 웨이브는 반 카운트씩 딱 맞추기.'
         else 'Opening number for the May showcase. Chorus fully synced, and the ripple clean in half counts.' end,
    case when ko then '오프닝 — Looproom 오리지널 (100 BPM)' else 'Opener — Looproom original (100 BPM)' end)
  returning id into p;
  insert into public.project_members (project_id, user_id, role, joined_at)
  values (p, lead_id, 'member', now() - interval '20 days'), (p, film_id, 'member', now() - interval '20 days'),
         (p, d3_id, 'member', now() - interval '19 days'), (p, d4_id, 'member', now() - interval '18 days');

  -- One piece, two takes of it (Take 2 was filmed after the notes on Take 1).
  insert into public.videos (project_id, title, created_by, created_at, bpm)
  values (p, case when ko then '오프닝 · 1절~코러스 (통으로)' else 'Opener · verse to chorus (full run)' end, film_id, now() - interval '3 days', 100)
  returning id into v;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (v, 'public:/samples/sample-take-1.mp4', 'IMG_2042.MOV', film_id, now() - interval '3 days', c1, 'public:/samples/sample-take-1.jpg')
  returning id into t1;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (v, 'public:/samples/sample-take-2.mp4', 'IMG_2043.MOV', film_id, now() - interval '20 hours', c2, 'public:/samples/sample-take-2.jpg')
  returning id into t2;

  -- ---------- Notes on Take 1 ----------
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at, sketch)
  values (t1, c1 + 4 * beat, c1 + 6 * beat,
    case when ko then '@' || my_name || ' 1에잇 5-6 팔 히트가 반 박자 늦어요. 박자 앞에서 치고 바로 멈춰 주세요!'
         else '@' || my_name || ' your arms are late on the 5-6 hit in the first eight. Hit right on the beat, then freeze.' end,
    lead_id, now() - interval '3 days' + interval '40 minutes',
    '{"v":1,"strokes":[{"tool":"circle","color":"#ffd60a","w":0.006,"pts":[[0.30,0.30],[0.44,0.58]]},{"tool":"arrow","color":"#ff453a","w":0.006,"pts":[[0.55,0.22],[0.44,0.34]]}]}'::jsonb)
  returning id into n1;
  insert into public.note_mentions (note_id, user_id) values (n1, me);
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t1, c1 + 8 * beat, c1 + 16 * beat,
    case when ko then '2에잇 대형 전환에서 수아가 왼쪽으로 반 칸 밀려요. 바닥 테이프 보고 자리 먼저 잡기.'
         else 'Spacing on the transition in the 2nd eight — Leo drifts half a spot stage left. Find your spike tape first.' end,
    lead_id, now() - interval '3 days' + interval '45 minutes')
  returning id into n2;
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t1, c1 + 16 * beat, c1 + 24 * beat,
    case when ko then '3에잇 웨이브 마지막 지우가 반 카운트 늦어요. 앞사람 팔 내려오는 거 보고 출발!'
         else 'Ripple in the 3rd eight: Maya starts half a count late. Go when the person before you drops their arm.' end,
    film_id, now() - interval '3 days' + interval '52 minutes')
  returning id into n3;
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t1, c1 + 30 * beat,
    case when ko then '엔딩 포즈 8까지 버텨야 해요! 7에서 풀리는 사람 있어요.'
         else 'Hold the ending pose through 8! Someone drops it on 7.' end,
    d3_id, now() - interval '3 days' + interval '58 minutes')
  returning id into n4;
  insert into public.notes (take_id, t_start, body, author_id, private_to, created_at)
  values (t1, c1 + 2 * beat,
    case when ko then '첫 에잇 표정 너무 좋아요. 코러스까지 이 에너지 그대로 가져가 봐요 🙂'
         else 'Your facials in the first eight are great. Carry that energy all the way into the chorus 🙂' end,
    lead_id, me, now() - interval '3 days' + interval '61 minutes')
  returning id into n5;
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t1, c1,
    case when ko then '인트로 1에 고개 스냅 다 같이 딱 맞았어요 👏 이대로!'
         else 'Heads snap on 1 — everyone hit it together 👏 Keep it exactly like this.' end,
    d4_id, now() - interval '3 days' + interval '66 minutes')
  returning id into n6;

  -- ---------- Notes on Take 2 ----------
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t2, c2 + 4 * beat, c2 + 6 * beat,
    case when ko then '@' || my_name || ' 5-6 팔 훨씬 깔끔해졌어요! 3에잇 같은 동작에서도 이렇게만 쳐 주세요.'
         else '@' || my_name || ' the 5-6 arms are so much cleaner! Hit the same move in the 3rd eight exactly like this.' end,
    lead_id, now() - interval '18 hours')
  returning id into n7;
  insert into public.note_mentions (note_id, user_id) values (n7, me);

  -- Replies, agrees, and where things stand now.
  insert into public.note_replies (note_id, author_id, body, created_at) values
    (n1, d3_id, case when ko then '저도 같이 늦었어요 ㅠ 오늘 구간 반복으로 같이 맞춰봐요' else 'I was late there too — let''s loop it together tonight' end, now() - interval '3 days' + interval '2 hours'),
    (n3, d3_id, case when ko then '헉 저였네요. 거울 모드로 보면서 다시 해볼게요!' else 'Oops, that''s me. I''ll drill it in mirror mode!' end, now() - interval '2 days'),
    (n2, d4_id, case when ko then '테이프 보고 자리 잡으니까 확실히 편해요. 테이크 2에서 고쳤어요!' else 'Spike tape helps a lot. Fixed it in Take 2!' end, now() - interval '19 hours');
  insert into public.note_reactions (note_id, user_id) values
    (n1, film_id), (n1, d3_id), (n2, film_id), (n3, lead_id), (n3, d4_id), (n6, lead_id), (n6, film_id), (n7, d4_id);
  perform set_config('looproom.status_change', 'on', true);
  update public.notes set status = 'practicing' where id = n1;
  update public.notes set status = 'practicing' where id = n3;
  update public.notes set status = 'resolved', resolved_by = lead_id, resolved_at = now() - interval '18 hours' where id in (n2, n4, n6);
  perform set_config('looproom.status_change', 'off', true);

  -- ---------- Count sheet (moments are in Take 2) ----------
  insert into public.count_sheet_rows (project_id, position, section, counts, focus, video_id, t_start, status) values
    (p, 0, case when ko then '인트로' else 'Intro' end, case when ko then '1에잇 1–4' else 'Eight 1, 1–4' end,
       case when ko then '1에 고개 스냅, 시선 정면' else 'Heads snap on 1, eyes front' end, v, c2, 'clean'),
    (p, 1, case when ko then '코러스 A' else 'Chorus A' end, case when ko then '1에잇 5–8' else 'Eight 1, 5–8' end,
       case when ko then '5-6 팔 히트는 박자 앞에서, 치고 멈추기' else 'Hit 5-6 on the beat, then freeze' end, v, c2 + 4 * beat, 'practicing'),
    (p, 2, case when ko then '대형 전환' else 'Transition' end, case when ko then '2에잇' else 'Eight 2' end,
       case when ko then 'V자 → 일자. 바닥 테이프 기준으로 자리 먼저' else 'V to a line. Find your spike tape first' end, v, c2 + 8 * beat, 'practicing'),
    (p, 3, case when ko then '웨이브 (카논)' else 'Ripple (canon)' end, case when ko then '3에잇' else 'Eight 3' end,
       case when ko then '앞사람 팔 내려오는 거 보고 반 카운트씩' else 'Go half a count after the person before you' end, v, c2 + 16 * beat, 'learning'),
    (p, 4, case when ko then '엔딩 포즈' else 'Ending pose' end, case when ko then '4에잇 5–8' else 'Eight 4, 5–8' end,
       case when ko then '8까지 버티기, 시선은 객석' else 'Hold through 8, eyes on the audience' end, v, c2 + 28 * beat, 'learning');

  -- ---------- A video request for the person (with a teammate), due in 3 days ----------
  insert into public.requests (project_id, title, brief, due_at, everyone, reference_video_id, created_by, created_at, audience)
  values (p,
    case when ko then '솔로 파트 개인 영상 (각자 16카운트)' else 'Solo section — your 16 counts' end,
    case when ko then '정면에서 전신 나오게, 음악 틀고 풀로 찍어 주세요.' || chr(10) || '금요일 연습 전에 다 같이 볼게요.'
         else 'Film from the front, full body in frame, with the track, full out.' || chr(10) || 'We''ll watch them together before Friday''s rehearsal.' end,
    day0 + interval '3 days 18 hours', false, v, lead_id, now() - interval '1 day', null)
  returning id into rq;
  insert into public.request_assignees (request_id, user_id) values (rq, me), (rq, d3_id);

  -- ---------- Calendar ----------
  insert into public.project_events (project_id, title, kind, starts_at, ends_at, location, details, created_by) values
    (p, case when ko then '전체 연습' else 'Full rehearsal' end, 'rehearsal', day0 + interval '1 day 19 hours', day0 + interval '1 day 22 hours',
       case when ko then '학생회관 B102 연습실' else 'Studio B' end,
       case when ko then '오프닝 통으로 3번 + 웨이브 따로 쪼개서 연습' else 'Run the opener 3x full out, then clean the ripple in 4-counts' end, lead_id),
    (p, case when ko then '무대 동선 리허설' else 'Spacing rehearsal on stage' end, case when ko then '리허설' else 'Tech rehearsal' end,
       day0 + interval '8 days 14 hours', day0 + interval '8 days 17 hours',
       case when ko then '소극장 공연장' else 'Main hall' end, null, lead_id),
    (p, case when ko then '2026 봄 정기공연' else 'Spring Showcase 2026' end, 'show', day0 + interval '10 days 18 hours', null,
       case when ko then '소극장 공연장' else 'Main hall' end, null, lead_id);

  -- ---------- A pinned practice notice ----------
  insert into public.project_pages (project_id, title, body, pinned, created_by, updated_by, created_at, updated_at)
  values (p,
    case when ko then '이번 주 연습 공지' else 'This week' end,
    case when ko then
      '# 이번 주 연습 공지' || chr(10) ||
      '- 내일 19:00 전체 연습 (학생회관 B102)' || chr(10) ||
      '- 금 18:00까지 솔로 파트 영상 제출' || chr(10) || chr(10) ||
      '## 연습 전에 체크' || chr(10) ||
      '- [x] 인트로 1 고개 스냅' || chr(10) ||
      '- [ ] 코러스 5-6 팔 히트 (박자 앞)' || chr(10) ||
      '- [ ] 2에잇 대형 전환 자리' || chr(10) ||
      '- [ ] 3에잇 웨이브 타이밍' || chr(10) || chr(10) ||
      '**준비물**: 실내화, 물, 무릎 보호대. 마킹 말고 풀로 한 번씩은 꼭!'
    else
      '# This week' || chr(10) ||
      '- Tomorrow 7 PM: full rehearsal (Studio B)' || chr(10) ||
      '- Friday 6 PM: solo videos due' || chr(10) || chr(10) ||
      '## Before rehearsal' || chr(10) ||
      '- [x] Heads snap on 1' || chr(10) ||
      '- [ ] Chorus 5-6 arm hit (on the beat)' || chr(10) ||
      '- [ ] Spacing in the 2nd eight' || chr(10) ||
      '- [ ] Ripple timing in the 3rd eight' || chr(10) || chr(10) ||
      '**Bring**: dance sneakers, water, knee pads. Mark if you need to, but run it full out at least once.'
    end,
    true, lead_id, lead_id, now() - interval '1 day', now() - interval '1 day');

  -- ---------- A pinned AI summary (written ahead; no AI call) ----------
  insert into public.recaps (project_id, created_by, scope, period, period_start, period_end, notes_up_to, note_count, content, sources, model, created_at, has_private)
  values (p, me, 'me', 'week', now() - interval '7 days', now(), now(), 4,
    case when ko then jsonb_build_object(
      'lang', 'ko',
      'headline', '코러스 5-6 팔 히트만 잡으면 오프닝은 거의 완성이에요.',
      'worked_on', jsonb_build_array(jsonb_build_object('text', '1에잇 5-6 팔 히트 타이밍과 첫 에잇 표정', 'cites', jsonb_build_array('n1', 'n2'))),
      'next', jsonb_build_array(
        jsonb_build_object('text', '3에잇 같은 동작에서도 5-6 팔을 박자 앞에서 치고 멈추기', 'cites', jsonb_build_array('n1', 'n3')),
        jsonb_build_object('text', '코러스까지 첫 에잇 표정과 에너지 유지하기', 'cites', jsonb_build_array('n2'))),
      'landed', jsonb_build_array(jsonb_build_object('text', '테이크 2에서 5-6 팔이 훨씬 깔끔해졌어요', 'cites', jsonb_build_array('n3'))),
      'recurring', jsonb_build_array(jsonb_build_object('text', '5-6 팔 히트 — 테이크 2개에서 두 번 나왔어요', 'cites', jsonb_build_array('n1', 'n3'))))
    else jsonb_build_object(
      'lang', 'en',
      'headline', 'Nail the 5-6 arm hit in the chorus and the opener is nearly there.',
      'worked_on', jsonb_build_array(jsonb_build_object('text', 'Timing of the 5-6 arm hit, and your facials in the first eight.', 'cites', jsonb_build_array('n1', 'n2'))),
      'next', jsonb_build_array(
        jsonb_build_object('text', 'Hit the same 5-6 arms on the beat in the 3rd eight, then freeze.', 'cites', jsonb_build_array('n1', 'n3')),
        jsonb_build_object('text', 'Keep the first-eight energy all the way into the chorus.', 'cites', jsonb_build_array('n2'))),
      'landed', jsonb_build_array(jsonb_build_object('text', 'Your 5-6 arms are much cleaner in Take 2.', 'cites', jsonb_build_array('n3'))),
      'recurring', jsonb_build_array(jsonb_build_object('text', 'The 5-6 arm hit came up in both takes.', 'cites', jsonb_build_array('n1', 'n3'))))
    end,
    jsonb_build_array(
      (select jsonb_build_object('ref', 'n1', 'note_id', id, 'body', body, 'status', status, 't_start', t_start, 't_end', t_end, 'video_id', video_id, 'video_title', (select title from public.videos where id = v), 'author', (select display_name from public.profiles pr where pr.id = author_id), 'take_number', 1, 'agrees', 2) from public.notes where id = n1),
      (select jsonb_build_object('ref', 'n2', 'note_id', id, 'body', body, 'status', status, 't_start', t_start, 't_end', t_end, 'video_id', video_id, 'video_title', (select title from public.videos where id = v), 'author', (select display_name from public.profiles pr where pr.id = author_id), 'take_number', 1, 'agrees', 0) from public.notes where id = n5),
      (select jsonb_build_object('ref', 'n3', 'note_id', id, 'body', body, 'status', status, 't_start', t_start, 't_end', t_end, 'video_id', video_id, 'video_title', (select title from public.videos where id = v), 'author', (select display_name from public.profiles pr where pr.id = author_id), 'take_number', 2, 'agrees', 1) from public.notes where id = n7)),
    'sample', now() - interval '2 hours', true);
  insert into public.recap_pins (recap_id, user_id) select id, me from public.recaps where project_id = p;

  -- The sample shouldn't fill the Inbox with seeding noise.
  delete from public.notifications where project_id = p;
  return p;
end;
$$;
revoke execute on function public.create_sample_project(text, text) from public, anon;
grant execute on function public.create_sample_project(text, text) to authenticated;
