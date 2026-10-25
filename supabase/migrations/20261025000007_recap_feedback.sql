-- "Was this summary useful?" One answer per person per recap; only you see your own.
create table public.recap_feedback (
  recap_id uuid not null references public.recaps (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  primary key (recap_id, user_id)
);
create index recap_feedback_user_idx on public.recap_feedback (user_id);
alter table public.recap_feedback enable row level security;
create policy "recap feedback: see your own" on public.recap_feedback
  for select to authenticated using (user_id = (select auth.uid()));
create policy "recap feedback: rate what you can see" on public.recap_feedback
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (select 1 from public.recaps r where r.id = recap_id)
  );
create policy "recap feedback: change your answer" on public.recap_feedback
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "recap feedback: take it back" on public.recap_feedback
  for delete to authenticated using (user_id = (select auth.uid()));
