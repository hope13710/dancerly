-- Counts: a video's tempo (same music across its takes) and where count 1 falls in each take.
-- With both set, the review shows "eight · count" over the video, marks every eight on the timeline,
-- and lines up two takes count-for-count in compare mode.
alter table public.videos add column bpm numeric(5, 2) check (bpm is null or bpm between 40 and 240);
alter table public.takes add column count_start numeric(8, 3) check (count_start is null or count_start >= 0);

-- Any member may set counts (it's shared rehearsal info, like a count sheet).
create function public.set_counts(p_take uuid, p_bpm numeric, p_count_start numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.takes;
begin
  select * into t from public.takes where id = p_take;
  if t.id is null or not public.is_project_member(t.project_id) then
    raise exception 'Take not found';
  end if;
  if p_bpm is not null and (p_bpm < 40 or p_bpm > 240) then
    raise exception 'Tempo must be between 40 and 240 BPM';
  end if;
  update public.videos set bpm = p_bpm where id = t.video_id;
  update public.takes set count_start = p_count_start where id = p_take;
end;
$$;
revoke execute on function public.set_counts(uuid, numeric, numeric) from public, anon;
grant execute on function public.set_counts(uuid, numeric, numeric) to authenticated;
