-- Email notifications. The Inbox stays the source of truth; email only follows up on what someone hasn't seen.
--   instant: a few minutes after it happens, bundled per person, cancelled if it was read in the app meanwhile
--   digest:  one morning summary (8 AM US Eastern), only on days with something in it
--   weekly:  a Monday progress email, only after an active week
-- The send-emails Edge Function does the sending; pg_cron calls it every 5 minutes through pg_net.

create extension if not exists pg_net with schema extensions;

-- ---------- Per-person email settings (private: only you can see or change yours) ----------
create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- by group: mention, private_note, reply, request, note_on_your_video, new_take, note_resolved, joined,
  -- recap_shared -> 'instant' | 'digest' | 'off'; weekly -> true | false. Missing keys use the defaults.
  email jsonb not null default '{}'::jsonb,
  timezone text check (timezone is null or char_length(timezone) <= 60),
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
drop policy if exists "notification settings: your own" on public.notification_settings;
create policy "notification settings: your own" on public.notification_settings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notification_settings from anon;

-- ---------- Which notifications were followed up by email ----------
alter table public.notifications add column if not exists emailed_at timestamptz;
alter table public.notifications add column if not exists email_state text check (email_state in ('sent', 'skipped'));
create index if not exists notifications_email_pending_idx on public.notifications (created_at) where emailed_at is null;

-- Digests and weekly emails go out once per person per day / week.
create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('instant', 'digest', 'weekly')),
  period text not null, -- e.g. '2026-10-30' for a digest, '2026-W44' for a weekly
  sent_at timestamptz not null default now(),
  unique (user_id, kind, period)
);
create index if not exists email_log_user_idx on public.email_log (user_id);
alter table public.email_log enable row level security; -- service role only
revoke all on public.email_log from anon, authenticated;

-- ---------- The cron call ----------
-- A random secret only the database and the function know; the function checks it before sending anything.
create table if not exists private.cron_secret (id int primary key default 1 check (id = 1), secret text not null);
insert into private.cron_secret (secret) values (encode(extensions.gen_random_bytes(32), 'hex')) on conflict (id) do nothing;
revoke all on private.cron_secret from public, anon, authenticated;

create or replace function public.email_cron_secret()
returns text
language sql security definer set search_path = ''
as $$ select secret from private.cron_secret where id = 1 $$;
revoke execute on function public.email_cron_secret() from public, anon, authenticated;
grant execute on function public.email_cron_secret() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'dancerly-send-emails';
select cron.schedule('dancerly-send-emails', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://egkwjdwfzuslyrhuzkmq.supabase.co/functions/v1/send-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);
