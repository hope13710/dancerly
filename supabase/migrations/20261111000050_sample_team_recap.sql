-- The sample project shows the new recaps (migration 049): next to the ready-made "My recap", a ready-made
-- team recap written by dancerly, the way a real team gets one before rehearsal. Both are written ahead of time;
-- nothing in the sample ever calls the AI (generate-recap hands back these two instead).
-- New samples get it from a trigger on the sample's own recap, so create_sample_project stays as it is;
-- samples people already have get it below.

create or replace function private.add_sample_team_recap(r public.recaps, pin boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  ko boolean := coalesce(r.content ->> 'lang', 'en') = 'ko';
  new_id uuid;
begin
  if exists (select 1 from public.recaps where project_id = r.project_id and team and model = 'sample') then
    return null;
  end if;
  insert into public.recaps (project_id, created_by, scope, period, period_start, period_end, notes_up_to, note_count,
    content, sources, model, created_at, has_private, team, cycle, auto)
  values (r.project_id, r.created_by, 'project', 'custom', r.period_start, r.period_end, r.notes_up_to, r.note_count,
    case when ko then jsonb_build_object(
      'lang', 'ko',
      'headline', '2에잇 딥 스쿼트 깊이만 맞추면 오프닝은 거의 완성이에요.',
      'worked_on', jsonb_build_array(jsonb_build_object('text', '2에잇 8 딥 스쿼트 깊이와 첫 에잇 표정', 'cites', jsonb_build_array('n1', 'n2'))),
      'next', jsonb_build_array(
        jsonb_build_object('text', '다 같이 1에잇 스쿼트도 테이크 2의 8 스쿼트 깊이로 내려가요.', 'cites', jsonb_build_array('n1', 'n3')),
        jsonb_build_object('text', '첫 에잇의 표정과 에너지를 엔딩까지 함께 유지해요.', 'cites', jsonb_build_array('n2'))),
      'landed', jsonb_build_array(jsonb_build_object('text', '테이크 2에서 8 스쿼트가 훨씬 깊어졌어요.', 'cites', jsonb_build_array('n3'))),
      'recurring', jsonb_build_array(jsonb_build_object('text', '스쿼트 깊이: 테이크 2개에서 두 번 나왔어요.', 'cites', jsonb_build_array('n1', 'n3'))))
    else jsonb_build_object(
      'lang', 'en',
      'headline', 'Get every squat to the same depth and the opener is nearly there.',
      'worked_on', jsonb_build_array(jsonb_build_object('text', 'Squat depth on 8 in the 2nd eight, and facials in the first eight.', 'cites', jsonb_build_array('n1', 'n2'))),
      'next', jsonb_build_array(
        jsonb_build_object('text', 'Everyone takes the first-eight squats as deep as the squat on 8 in Take 2.', 'cites', jsonb_build_array('n1', 'n3')),
        jsonb_build_object('text', 'Keep the first-eight energy all the way to the ending, together.', 'cites', jsonb_build_array('n2'))),
      'landed', jsonb_build_array(jsonb_build_object('text', 'The squat on 8 is much deeper in Take 2.', 'cites', jsonb_build_array('n3'))),
      'recurring', jsonb_build_array(jsonb_build_object('text', 'Squat depth came up in both takes.', 'cites', jsonb_build_array('n1', 'n3'))))
    end,
    r.sources, 'sample', r.created_at + interval '1 hour', false, true, 'sample', true)
  returning id into new_id;
  -- Pinned, like the sample's personal recap. A new sample pins every recap itself (create_sample_project), so only here.
  if pin then
    insert into public.recap_pins (recap_id, user_id) values (new_id, r.created_by) on conflict do nothing;
  end if;
  return new_id;
end;
$$;
revoke execute on function private.add_sample_team_recap(public.recaps, boolean) from public, anon, authenticated;

create or replace function private.on_sample_recap()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.model = 'sample' and not new.team then
    perform private.add_sample_team_recap(new, false);
  end if;
  return null;
end;
$$;
revoke execute on function private.on_sample_recap() from public, anon, authenticated;
drop trigger if exists after_sample_recap on public.recaps;
create trigger after_sample_recap
  after insert on public.recaps
  for each row execute function private.on_sample_recap();

-- Samples people already have.
select private.add_sample_team_recap(r, true)
from public.recaps r
join public.projects p on p.id = r.project_id and p.is_sample
where r.model = 'sample' and not r.team;
