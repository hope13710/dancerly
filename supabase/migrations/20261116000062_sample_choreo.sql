-- The sample project shows Practice too: a choreo video, and its count sheet sections (Groove, Walk-up, …) as
-- parts with a start and an end, so "Learn the choreo" can be tried there like "Get feedback" already can.
--   • The choreo video is the leader's (choreographer's) clean run of the opener, a choreo-kind video (059),
--     served with the site like the sample's takes (no storage, nothing counted against anyone).
--   • The five seeded sections move onto it, with ends by the counts (98 BPM, count 1 at 0.43 s) (060).
--   • New samples get it from create_sample_project; the samples people already have get it once, below.

create or replace function private.add_sample_choreo(p uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ko boolean;
  lead uuid;
  cv uuid;
  ct uuid;
  beat numeric := 60.0 / 98;
  c numeric := 0.43;
  len numeric := 15.0; -- opener-take-2.mp4 runs 15.1 s
begin
  if not exists (select 1 from public.projects where id = p and is_sample and choreo_video_id is null and choreo_youtube is null) then
    return;
  end if;
  ko := exists (select 1 from public.project_members where project_id = p and user_id = '5a3b0000-0000-4000-8000-000000000001');
  lead := case when ko then '5a3b0000-0000-4000-8000-000000000001' else '5a3b0000-0000-4000-8000-000000000005' end::uuid;
  if not exists (select 1 from public.project_members where project_id = p and user_id = lead) then
    return; -- not one of our seeded samples
  end if;

  insert into public.videos (project_id, title, created_by, created_at, bpm, kind)
  values (p, case when ko then '오프닝 · 안무가 시범' else 'Opener · choreographer’s run' end, lead, now() - interval '4 days', 98, 'choreo')
  returning id into cv;
  insert into public.takes (video_id, storage_path, file_name, uploaded_by, created_at, count_start, thumb_path)
  values (cv, 'public:/samples/opener-take-2.mp4', 'choreo.mov', lead, now() - interval '4 days', c, 'public:/samples/opener-take-2.jpg')
  returning id into ct;
  update public.projects set choreo_video_id = cv where id = p;

  -- The seeded sections, by position, onto the choreo video, each with its own end.
  update public.count_sheet_rows r set video_id = cv, take_id = ct,
    t_start = round(c + s.b0 * beat, 2),
    t_end = least(round(c + s.b1 * beat, 2), len)
  from (values (0, 0, 8), (1, 8, 14), (2, 14, 16), (3, 16, 20), (4, 20, 24)) as s(pos, b0, b1)
  where r.project_id = p and r.position = s.pos;
end;
$$;
revoke execute on function private.add_sample_choreo(uuid) from public, anon, authenticated;

create or replace function public.create_sample_project(p_lang text default 'en', p_tz text default 'UTC')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  p uuid;
begin
  p := private.create_sample_project_seed(p_lang, p_tz);
  perform private.categorize_sample(p);
  perform private.add_sample_choreo(p);
  return p;
end;
$$;

-- Samples people already have. The count sheet's "last edited" stays as it was, so switching the sample's
-- language still sees it as untouched.
alter table public.count_sheet_rows disable trigger before_count_row_write;
select private.add_sample_choreo(id) from public.projects where is_sample and deleted_at is null;
alter table public.count_sheet_rows enable trigger before_count_row_write;

notify pgrst, 'reload schema';
