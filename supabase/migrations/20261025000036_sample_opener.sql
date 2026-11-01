-- The sample project now plays the team's own rehearsal clip: seven dancers, three eights at 98 BPM
-- (/samples/opener-take-1.mp4 and -2.mp4). Notes, the sketch, the count sheet, the notice and the AI summary
-- point at what's on screen: the squat on 3, the back row sitting high on the squat on 8, Leo hidden in the
-- transition, and Maya's arm on the ending pose. Samples people already have keep their old videos and notes.

create or replace function public.create_sample_project(p_lang text default 'en', p_tz text default 'UTC')
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
  beat numeric := 60.0 / 98;  -- 98 BPM
  c1 numeric := 0.43;          -- count 1 in Take 1
  c2 numeric := 0.43;          -- count 1 in Take 2
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
    case when ko then '5월 정기공연 오프닝 무대. 스쿼트 깊이 다 같이 맞추고, 3에잇 대형 전환 깔끔하게.'
         else 'Opening number for the May showcase. Every squat at the same depth, and a clean transition in the 3rd eight.' end,
    case when ko then '오프닝 — dancerly 오리지널 (98 BPM)' else 'Opener — dancerly original (98 BPM)' end)
  returning id into p;
  insert into public.project_members (project_id, user_id, role, joined_at)
  values (p, lead_id, 'member', now() - interval '20 days'), (p, film_id, 'member', now() - interval '20 days'),
         (p, d3_id, 'member', now() - interval '19 days'), (p, d4_id, 'member', now() - interval '18 days');

  -- One piece, two takes of it (Take 2 was filmed after the notes on Take 1).
  insert into public.videos (project_id, title, created_by, created_at, bpm)
  values (p, case when ko then '오프닝 · 1~3에잇 (풀로)' else 'Opener · first three eights (full out)' end, film_id, now() - interval '3 days', 98)
  returning id into v;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (v, 'public:/samples/opener-take-1.mp4', 'IMG_2042.MOV', film_id, now() - interval '3 days', c1, 'public:/samples/opener-take-1.jpg')
  returning id into t1;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (v, 'public:/samples/opener-take-2.mp4', 'IMG_2043.MOV', film_id, now() - interval '20 hours', c2, 'public:/samples/opener-take-2.jpg')
  returning id into t2;

  -- ---------- Notes on Take 1 ----------
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at, sketch)
  values (t1, c1 + 15 * beat, c1 + 16 * beat,
    case when ko then '@' || my_name || ' 2에잇 8 스쿼트에서 뒷줄이 앞줄보다 높아요. 앞줄 깊이까지 내려가 주세요!'
         else '@' || my_name || ' the squat on 8 of the 2nd eight: the back row sits higher than the front. Drop to the front row''s depth.' end,
    lead_id, now() - interval '3 days' + interval '40 minutes',
    '{"v":1,"strokes":[{"tool":"circle","color":"#ffd60a","w":0.006,"pts":[[0.565,0.44],[0.67,0.78]]},{"tool":"arrow","color":"#ff453a","w":0.006,"pts":[[0.62,0.24],[0.62,0.41]]}]}'::jsonb)
  returning id into n1;
  insert into public.note_mentions (note_id, user_id) values (n1, me);
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t1, c1 + 16 * beat, c1 + 20 * beat,
    case when ko then '3에잇 1-4 대형 전환에서 수아가 앞줄 뒤에 완전히 가려요. 앞사람 사이 빈 공간으로 반 칸 옮기기.'
         else 'Transition on 1-4 of the 3rd eight: Leo disappears behind the front row. Shift half a spot into the gap between them.' end,
    lead_id, now() - interval '3 days' + interval '45 minutes')
  returning id into n2;
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t1, c1 + 22 * beat, c1 + 24 * beat,
    case when ko then '엔딩 7-8에서 지우만 팔을 위로 쭉 뻗어요. 다들 팔꿈치 굽혀서 손을 머리 옆에 둬요. 모양 맞춰 주세요!'
         else 'Ending on 7-8: Maya''s arm goes straight up, but everyone else bends the elbow with the hand by the head. Match the shape.' end,
    film_id, now() - interval '3 days' + interval '52 minutes')
  returning id into n3;
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t1, c1 + 8 * beat,
    case when ko then '2에잇 워크업은 박자에 맞춰 작게, 각자 자기 라인 지키면서 걸어요.'
         else 'Walk-up in the 2nd eight: small steps on the beat, and everyone stays in their lane.' end,
    d3_id, now() - interval '3 days' + interval '58 minutes')
  returning id into n4;
  insert into public.notes (take_id, t_start, body, author_id, private_to, created_at)
  values (t1, c1 + 2 * beat,
    case when ko then '첫 에잇 표정 너무 좋아요. 엔딩까지 이 에너지 그대로 가져가 봐요 🙂'
         else 'Your facials in the first eight are great. Carry that energy all the way to the ending 🙂' end,
    lead_id, me, now() - interval '3 days' + interval '61 minutes')
  returning id into n5;
  insert into public.notes (take_id, t_start, body, author_id, created_at)
  values (t1, c1 + 2 * beat,
    case when ko then '1에잇 3에 스쿼트 다 같이 딱 맞았어요 👏 이대로!'
         else 'The squat on 3 in the first eight — everyone hit it together 👏 Keep it exactly like this.' end,
    d4_id, now() - interval '3 days' + interval '66 minutes')
  returning id into n6;

  -- ---------- Notes on Take 2 ----------
  insert into public.notes (take_id, t_start, t_end, body, author_id, created_at)
  values (t2, c2 + 15 * beat, c2 + 16 * beat,
    case when ko then '@' || my_name || ' 8 스쿼트 훨씬 깊어졌어요! 1에잇 스쿼트도 이 깊이로만 가 주세요.'
         else '@' || my_name || ' the squat on 8 is so much deeper! Take the first-eight squats to the same depth.' end,
    lead_id, now() - interval '18 hours')
  returning id into n7;
  insert into public.note_mentions (note_id, user_id) values (n7, me);

  -- Replies, agrees, and where things stand now.
  insert into public.note_replies (note_id, author_id, body, created_at) values
    (n1, d3_id, case when ko then '저도 높았어요 ㅠ 오늘 구간 반복으로 같이 맞춰봐요' else 'I was high there too — let''s loop it together tonight' end, now() - interval '3 days' + interval '2 hours'),
    (n3, d3_id, case when ko then '헉 저였네요. 거울 모드로 보면서 다시 해볼게요!' else 'Oops, that''s me. I''ll drill it in mirror mode!' end, now() - interval '2 days'),
    (n2, d4_id, case when ko then '빈 공간 찾으니까 확실히 잘 보여요. 테이크 2에서 고쳤어요!' else 'Found my gap — you can see me now. Fixed it in Take 2!' end, now() - interval '19 hours');
  insert into public.note_reactions (note_id, user_id) values
    (n1, film_id), (n1, d3_id), (n2, film_id), (n3, lead_id), (n3, d4_id), (n6, lead_id), (n6, film_id), (n7, d4_id);
  perform set_config('looproom.status_change', 'on', true);
  update public.notes set status = 'practicing' where id = n1;
  update public.notes set status = 'practicing' where id = n3;
  update public.notes set status = 'resolved', resolved_by = lead_id, resolved_at = now() - interval '18 hours' where id in (n2, n4, n6);
  perform set_config('looproom.status_change', 'off', true);

  -- ---------- Count sheet (moments are in Take 2) ----------
  insert into public.count_sheet_rows (project_id, position, section, counts, focus, video_id, t_start, status) values
    (p, 0, case when ko then '그루브' else 'Groove' end, case when ko then '1에잇' else 'Eight 1' end,
       case when ko then '3, 6에 스쿼트. 무릎은 박자에 맞춰' else 'Squat on 3 and 6, knees on the beat' end, v, c2, 'clean'),
    (p, 1, case when ko then '워크업' else 'Walk-up' end, case when ko then '2에잇 1–6' else 'Eight 2, 1–6' end,
       case when ko then '작게 걷기, 자기 라인 지키기' else 'Small steps, stay in your lane' end, v, c2 + 8 * beat, 'clean'),
    (p, 2, case when ko then '딥 스쿼트' else 'Deep squat' end, case when ko then '2에잇 8' else 'Eight 2, 8' end,
       case when ko then '뒷줄도 앞줄 깊이까지 내려가기' else 'Back row as low as the front' end, v, c2 + 15 * beat, 'practicing'),
    (p, 3, case when ko then '대형 전환' else 'Transition' end, case when ko then '3에잇 1–4' else 'Eight 3, 1–4' end,
       case when ko then '가운데로 모이기. 앞사람 사이 빈 공간 찾기' else 'Close in to the center. Find your gap, don''t hide' end, v, c2 + 16 * beat, 'practicing'),
    (p, 4, case when ko then '엔딩 포즈' else 'Ending pose' end, case when ko then '3에잇 5–8' else 'Eight 3, 5–8' end,
       case when ko then '팔꿈치 굽혀 손은 머리 옆, 8에 멈추기' else 'Elbow bent, hand by the head, freeze on 8' end, v, c2 + 20 * beat, 'learning');

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
       case when ko then '오프닝 통으로 3번 + 대형 전환 따로 쪼개서 연습' else 'Run the opener 3x full out, then clean the transition in 4-counts' end, lead_id),
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
      '- [x] 1에잇 3 스쿼트 다 같이' || chr(10) ||
      '- [ ] 2에잇 8 딥 스쿼트 (뒷줄도 앞줄 깊이로)' || chr(10) ||
      '- [ ] 3에잇 대형 전환 빈 공간' || chr(10) ||
      '- [ ] 엔딩 포즈 팔 모양' || chr(10) || chr(10) ||
      '**준비물**: 실내화, 물, 무릎 보호대. 마킹 말고 풀로 한 번씩은 꼭!'
    else
      '# This week' || chr(10) ||
      '- Tomorrow 7 PM: full rehearsal (Studio B)' || chr(10) ||
      '- Friday 6 PM: solo videos due' || chr(10) || chr(10) ||
      '## Before rehearsal' || chr(10) ||
      '- [x] Squat on 3, all together' || chr(10) ||
      '- [ ] Deep squat on 8 (back row as low as the front)' || chr(10) ||
      '- [ ] Transition gaps in the 3rd eight' || chr(10) ||
      '- [ ] Ending pose arm shape' || chr(10) || chr(10) ||
      '**Bring**: dance sneakers, water, knee pads. Mark if you need to, but run it full out at least once.'
    end,
    true, lead_id, lead_id, now() - interval '1 day', now() - interval '1 day');

  -- ---------- A pinned AI summary (written ahead; no AI call) ----------
  insert into public.recaps (project_id, created_by, scope, period, period_start, period_end, notes_up_to, note_count, content, sources, model, created_at, has_private)
  values (p, me, 'me', 'week', now() - interval '7 days', now(), now(), 4,
    case when ko then jsonb_build_object(
      'lang', 'ko',
      'headline', '2에잇 딥 스쿼트 깊이만 맞추면 오프닝은 거의 완성이에요.',
      'worked_on', jsonb_build_array(jsonb_build_object('text', '2에잇 8 딥 스쿼트 깊이와 첫 에잇 표정', 'cites', jsonb_build_array('n1', 'n2'))),
      'next', jsonb_build_array(
        jsonb_build_object('text', '1에잇 스쿼트도 테이크 2의 8 스쿼트 깊이로 내려가기', 'cites', jsonb_build_array('n1', 'n3')),
        jsonb_build_object('text', '엔딩까지 첫 에잇 표정과 에너지 유지하기', 'cites', jsonb_build_array('n2'))),
      'landed', jsonb_build_array(jsonb_build_object('text', '테이크 2에서 8 스쿼트가 훨씬 깊어졌어요', 'cites', jsonb_build_array('n3'))),
      'recurring', jsonb_build_array(jsonb_build_object('text', '스쿼트 깊이 — 테이크 2개에서 두 번 나왔어요', 'cites', jsonb_build_array('n1', 'n3'))))
    else jsonb_build_object(
      'lang', 'en',
      'headline', 'Get every squat to the same depth and the opener is nearly there.',
      'worked_on', jsonb_build_array(jsonb_build_object('text', 'Depth on the squat on 8 in the 2nd eight, and your facials in the first eight.', 'cites', jsonb_build_array('n1', 'n2'))),
      'next', jsonb_build_array(
        jsonb_build_object('text', 'Take the first-eight squats as deep as your squat on 8 in Take 2.', 'cites', jsonb_build_array('n1', 'n3')),
        jsonb_build_object('text', 'Keep the first-eight energy all the way to the ending.', 'cites', jsonb_build_array('n2'))),
      'landed', jsonb_build_array(jsonb_build_object('text', 'Your squat on 8 is much deeper in Take 2.', 'cites', jsonb_build_array('n3'))),
      'recurring', jsonb_build_array(jsonb_build_object('text', 'Squat depth came up in both takes.', 'cites', jsonb_build_array('n1', 'n3'))))
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
