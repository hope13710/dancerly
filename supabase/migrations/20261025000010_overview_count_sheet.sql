-- Project overview (goal and music) and the count sheet: the piece broken into sections, each with
-- its counts, what to focus on, a reference moment, and how clean it is.

alter table public.projects
  add column goal text check (goal is null or char_length(goal) <= 1000),
  add column music_title text check (music_title is null or char_length(music_title) <= 200),
  add column music_url text check (music_url is null or (char_length(music_url) <= 500 and music_url ~* '^https?://'));

create table public.count_sheet_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  position int not null default 0,
  section text not null check (char_length(btrim(section)) between 1 and 80),
  counts text check (counts is null or char_length(counts) <= 80),
  focus text check (focus is null or char_length(focus) <= 500),
  video_id uuid references public.videos (id) on delete set null,
  t_start numeric(9, 2) check (t_start is null or t_start >= 0),
  status text not null default 'learning' check (status in ('learning', 'practicing', 'clean')),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index count_sheet_project_idx on public.count_sheet_rows (project_id, position);
create index count_sheet_video_idx on public.count_sheet_rows (video_id);
create index count_sheet_updated_by_idx on public.count_sheet_rows (updated_by);

create function private.touch_count_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if new.video_id is not null and not exists (select 1 from public.videos v where v.id = new.video_id and v.project_id = new.project_id) then
    raise exception 'Pick a video from this project';
  end if;
  return new;
end;
$$;
create trigger before_count_row_write
  before insert or update on public.count_sheet_rows
  for each row execute function private.touch_count_row();
revoke execute on function private.touch_count_row() from public, anon, authenticated;

-- The whole team keeps the sheet up to date.
alter table public.count_sheet_rows enable row level security;
create policy "count sheet: members can see" on public.count_sheet_rows
  for select to authenticated using (private.is_project_member(project_id));
create policy "count sheet: members can add" on public.count_sheet_rows
  for insert to authenticated with check (private.is_project_member(project_id));
create policy "count sheet: members can edit" on public.count_sheet_rows
  for update to authenticated using (private.is_project_member(project_id)) with check (private.is_project_member(project_id));
create policy "count sheet: members can delete" on public.count_sheet_rows
  for delete to authenticated using (private.is_project_member(project_id));
