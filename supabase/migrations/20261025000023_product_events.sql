-- Product events: which steps people take (opening the sample, first note, first real video, …),
-- so we can see whether the sample actually helps teams get started.
-- Write-only for signed-in users (their own rows); only the service role and the SQL editor can read.
-- No content goes in here — just an event name and a few small labels.
create table if not exists public.product_events (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  event text not null check (char_length(event) between 1 and 60),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.product_events enable row level security;
drop policy if exists "Add your own events" on public.product_events;
create policy "Add your own events" on public.product_events
  for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.product_events from anon;
revoke select, update, delete on public.product_events from authenticated;
grant insert on public.product_events to authenticated;
create index if not exists product_events_event_time on public.product_events (event, created_at);
create index if not exists product_events_user on public.product_events (user_id);
