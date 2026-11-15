-- The sample project reads like a K-pop cover team getting a showcase opener ready: the words cover teams use
-- (the original, center, ending pose, angles), with no real song or artist named. The music stays as it is.
-- Only the text inside private.create_sample_project_seed changes: each string is swapped in the live definition,
-- and the migration stops if any of them isn't found exactly once (so nothing is half-applied).
-- Existing samples pick up the new text the next time they reset (Reset, or coming back after 30 minutes).

do $migration$
declare
  d text := pg_get_functiondef('private.create_sample_project_seed(text,text)'::regprocedure);
  pairs text[][] := array[
    -- Project
    [$o$'샘플 · 2026 봄 정기공연'$o$, $n$'샘플 · 2026 봄 정기공연 K-pop 커버'$n$],
    [$o$'Sample · Spring Showcase 2026'$o$, $n$'Sample · Spring Showcase 2026 K-pop Cover'$n$],
    [$o$'5월 정기공연 오프닝 무대. 스쿼트 깊이 다 같이 맞추고, 3에잇 대형 전환 깔끔하게.'$o$,
     $n$'5월 정기공연 K-pop 커버 오프닝. 원곡처럼 스쿼트 깊이 다 같이 맞추고, 3에잇 센터 체인지 깔끔하게.'$n$],
    [$o$'Opening number for the May showcase. Every squat at the same depth, and a clean transition in the 3rd eight.'$o$,
     $n$'K-pop cover opener for the May showcase. Every squat as deep as the original, and a clean center change in the 3rd eight.'$n$],
    [$o$'오프닝 — dancerly 오리지널 (98 BPM)'$o$, $n$'오프닝 곡 (98 BPM)'$n$],
    [$o$'Opener — dancerly original (98 BPM)'$o$, $n$'Opener track (98 BPM)'$n$],
    -- Notes on Take 1
    [$o$' 2에잇 8 스쿼트에서 뒷줄이 앞줄보다 높아요. 앞줄 깊이까지 내려가 주세요!'$o$,
     $n$' 2에잇 8 딥 스쿼트, 뒷줄이 앞줄보다 높아요. 원곡처럼 앞줄 깊이까지 내려가 주세요!'$n$],
    [$o$' the squat on 8 of the 2nd eight: the back row sits higher than the front. Drop to the front row''s depth.'$o$,
     $n$' deep squat on 8 of the 2nd eight: the back row sits higher than the front. Drop to the front row''s depth, like the original.'$n$],
    [$o$'3에잇 1-4 대형 전환에서 수아가 앞줄 뒤에 완전히 가려요. 앞사람 사이 빈 공간으로 반 칸 옮기기.'$o$,
     $n$'3에잇 1-4 센터 체인지 때 수아가 센터 뒤에 완전히 가려요. 앞사람 사이 빈 공간으로 반 칸 옮겨 주세요.'$n$],
    [$o$'Transition on 1-4 of the 3rd eight: Leo disappears behind the front row. Shift half a spot into the gap between them.'$o$,
     $n$'Center change on 1-4 of the 3rd eight: Leo disappears behind the center. Shift half a spot into the gap.'$n$],
    [$o$'엔딩 7-8에서 지우만 팔을 위로 쭉 뻗어요. 다들 팔꿈치 굽혀서 손을 머리 옆에 둬요. 모양 맞춰 주세요!'$o$,
     $n$'엔딩 포즈 7-8, 지우만 팔을 위로 쭉 뻗어요. 원곡은 팔꿈치 굽혀서 손이 머리 옆이에요. 각도 맞춰 주세요!'$n$],
    [$o$'Ending on 7-8: Maya''s arm goes straight up, but everyone else bends the elbow with the hand by the head. Match the shape.'$o$,
     $n$'Ending pose on 7-8: Maya''s arm goes straight up, but in the original the elbow bends with the hand by the head. Match the angle.'$n$],
    [$o$'첫 에잇 표정 너무 좋아요. 엔딩까지 이 에너지 그대로 가져가 봐요 🙂'$o$,
     $n$'첫 에잇 표정 진짜 좋아요. 엔딩 포즈까지 이 에너지 그대로 가져가 봐요 🙂'$n$],
    [$o$'Your facials in the first eight are great. Carry that energy all the way to the ending 🙂'$o$,
     $n$'Your facials in the first eight are great. Carry that energy all the way to the ending pose 🙂'$n$],
    [$o$'1에잇 3에 스쿼트 다 같이 딱 맞았어요 👏 이대로!'$o$,
     $n$'1에잇 3 스쿼트 다 같이 딱 맞았어요 👏 원곡 느낌 그대로!'$n$],
    [$o$'The squat on 3 in the first eight — everyone hit it together 👏 Keep it exactly like this.'$o$,
     $n$'The squat on 3 in the first eight — everyone hit it together 👏 Just like the original.'$n$],
    -- Note on Take 2
    [$o$' 8 스쿼트 훨씬 깊어졌어요! 1에잇 스쿼트도 이 깊이로만 가 주세요.'$o$,
     $n$' 8 스쿼트 훨씬 깊어졌어요, 원곡 느낌 나요! 1에잇 스쿼트도 이 깊이로 가 주세요.'$n$],
    [$o$' the squat on 8 is so much deeper! Take the first-eight squats to the same depth.'$o$,
     $n$' the squat on 8 is so much deeper — it looks like the original now! Take the first-eight squats to the same depth.'$n$],
    -- Count sheet
    [$o$'그루브' else 'Groove'$o$, $n$'인트로 그루브' else 'Intro groove'$n$],
    [$o$'대형 전환' else 'Transition'$o$, $n$'센터 체인지' else 'Center change'$n$],
    [$o$'가운데로 모이기. 앞사람 사이 빈 공간 찾기' else 'Close in to the center. Find your gap, don''t hide'$o$,
     $n$'센터 쪽으로 모이기. 앞사람 사이 빈 공간 찾기' else 'Close in to the center. Find your gap, don''t hide'$n$],
    [$o$'팔꿈치 굽혀 손은 머리 옆, 8에 멈추기' else 'Elbow bent, hand by the head, freeze on 8'$o$,
     $n$'원곡처럼 팔꿈치 굽혀 손은 머리 옆, 8에 멈추기' else 'Like the original: elbow bent, hand by the head, freeze on 8'$n$],
    -- Calendar
    [$o$'오프닝 통으로 3번 + 대형 전환 따로 쪼개서 연습'$o$, $n$'오프닝 통으로 3번 + 센터 체인지 따로 쪼개서 연습'$n$],
    [$o$'Run the opener 3x full out, then clean the transition in 4-counts'$o$, $n$'Run the opener 3x full out, then clean the center change in 4-counts'$n$],
    -- Pinned practice notice
    [$o$'- [ ] 3에잇 대형 전환 빈 공간'$o$, $n$'- [ ] 3에잇 센터 체인지 빈 공간'$n$],
    [$o$'- [ ] 엔딩 포즈 팔 모양'$o$, $n$'- [ ] 엔딩 포즈 팔 각도 (원곡 확인)'$n$],
    [$o$'- [ ] Transition gaps in the 3rd eight'$o$, $n$'- [ ] Center change gaps in the 3rd eight'$n$],
    [$o$'- [ ] Ending pose arm shape'$o$, $n$'- [ ] Ending pose arm angle (check the original)'$n$]
  ];
  i int;
  found int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    found := (length(d) - length(replace(d, pairs[i][1], ''))) / length(pairs[i][1]);
    if found <> 1 then
      raise exception 'Sample text not found exactly once (% times): %', found, pairs[i][1];
    end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  execute d;
end
$migration$;
