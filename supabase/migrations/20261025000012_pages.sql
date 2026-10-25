-- Pages: free-form project docs — rehearsal plans, costume lists, spacing charts — written in plain Markdown.
create table public.project_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default 'Untitled' check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 50000),
  pinned boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_pages_project_idx on public.project_pages (project_id, updated_at desc);
create index project_pages_creator_idx on public.project_pages (created_by);
create index project_pages_updated_by_idx on public.project_pages (updated_by);

create function private.touch_page()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
create trigger before_page_write
  before insert or update on public.project_pages
  for each row execute function private.touch_page();
revoke execute on function private.touch_page() from public, anon, authenticated;

alter table public.project_pages enable row level security;
create policy "pages: members can read" on public.project_pages
  for select to authenticated using (private.is_project_member(project_id));
create policy "pages: members can write" on public.project_pages
  for insert to authenticated with check (private.is_project_member(project_id) and created_by = (select auth.uid()));
create policy "pages: members can edit" on public.project_pages
  for update to authenticated using (private.is_project_member(project_id)) with check (private.is_project_member(project_id));
create policy "pages: creator or owner deletes" on public.project_pages
  for delete to authenticated using (created_by = (select auth.uid()) or private.is_project_owner(project_id));
