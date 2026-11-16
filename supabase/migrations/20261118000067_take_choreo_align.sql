-- Practice a note against the original: where a moment in a take sits in the project's choreo video.
-- A take and the choreo video start at different points, so each take keeps one number: the seconds to add to a
-- time in the take to reach the same moment in the choreo video. It's found from the music (a choreo video file)
-- or by someone tapping "Here" on the original (YouTube, where the music can't be heard), once, for the whole team.
-- The choreo key ('v:<video id>' or 'yt:<YouTube id>') ties it to the choreo video it was made against, so
-- changing the choreo video leaves the old numbers unused instead of pointing at the wrong moments.

create table if not exists public.take_choreo_align (
  take_id uuid not null references public.takes (id) on delete cascade,
  choreo text not null check (choreo ~ '^(v:[0-9a-f-]{36}|yt:[A-Za-z0-9_-]{6,20})$'),
  project_id uuid not null references public.projects (id) on delete cascade,
  shift numeric(8, 2) not null check (shift between -3600 and 3600),
  source text not null check (source in ('music', 'manual')),
  set_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (take_id, choreo)
);
create index if not exists take_choreo_align_project on public.take_choreo_align (project_id);

alter table public.take_choreo_align enable row level security;
drop policy if exists "choreo align: members can see" on public.take_choreo_align;
create policy "choreo align: members can see" on public.take_choreo_align
  for select to authenticated using (private.is_project_member(project_id));
-- Writes go through set_choreo_align only.

create or replace function public.set_choreo_align(p_take uuid, p_choreo text, p_shift numeric, p_source text)
returns void
language plpgsql security definer set search_path = ''
as $fn$
declare
  t public.takes;
  p public.projects;
  want text;
begin
  select * into t from public.takes where id = p_take;
  if t.id is null or not private.is_project_member(t.project_id) then
    raise exception 'Take not found';
  end if;
  select * into p from public.projects where id = t.project_id;
  -- Only against the project's current choreo video.
  want := case when p.choreo_video_id is not null then 'v:' || p.choreo_video_id::text
               when p.choreo_youtube is not null then 'yt:' || p.choreo_youtube end;
  if want is null or p_choreo is distinct from want then
    raise exception 'Not this project''s choreo video';
  end if;
  if p_shift is null or p_shift < -3600 or p_shift > 3600 or p_source not in ('music', 'manual') then
    raise exception 'Invalid alignment';
  end if;
  insert into public.take_choreo_align (take_id, choreo, project_id, shift, source, set_by, updated_at)
  values (t.id, p_choreo, t.project_id, round(p_shift, 2), p_source, auth.uid(), now())
  on conflict (take_id, choreo) do update
    set shift = excluded.shift, source = excluded.source, set_by = excluded.set_by, updated_at = now();
end;
$fn$;
revoke execute on function public.set_choreo_align(uuid, text, numeric, text) from public, anon;
grant execute on function public.set_choreo_align(uuid, text, numeric, text) to authenticated;
