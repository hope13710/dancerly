-- The sample project is its creator's sandbox: they can delete its videos and takes even after handing
-- ownership to one of the sample teammates (e.g. while trying "Make owner").
drop policy if exists "videos: sample creator can delete" on public.videos;
create policy "videos: sample creator can delete" on public.videos
  for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.is_sample and p.created_by = (select auth.uid())));
drop policy if exists "takes: sample creator can delete" on public.takes;
create policy "takes: sample creator can delete" on public.takes
  for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.is_sample and p.created_by = (select auth.uid())));
