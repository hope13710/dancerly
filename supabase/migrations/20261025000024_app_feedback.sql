-- In-app "Help & feedback": what people tell us from inside the app (bugs, ideas, questions).
-- Signed-in users can only add their own messages; reading happens in the dashboard (service role).
-- The page and browser are attached so bugs can be reproduced. Messages stay readable after an account is
-- deleted, but no longer point to the person.
create table if not exists public.app_feedback (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'question', 'other')),
  body text not null check (char_length(body) between 1 and 4000),
  page text check (page is null or char_length(page) <= 500),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  lang text check (lang is null or char_length(lang) <= 10),
  created_at timestamptz not null default now()
);
alter table public.app_feedback enable row level security;
drop policy if exists "Send your own feedback" on public.app_feedback;
create policy "Send your own feedback" on public.app_feedback
  for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.app_feedback from anon;
revoke select, update, delete on public.app_feedback from authenticated;
grant insert on public.app_feedback to authenticated;
create index if not exists app_feedback_created on public.app_feedback (created_at desc);
