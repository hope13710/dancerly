-- Invite by email: type addresses into the invite box and dancerly emails each person the project's invite link,
-- in the inviter's name. One reminder three days later if they haven't joined; nothing after that.
-- Sent by the send-invite function (service role); people only ever see the invites they sent themselves.

create table if not exists public.invite_emails (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  lang text not null default 'en' check (lang in ('en', 'ko')),
  sent_at timestamptz not null default now(),
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, email)
);
create index if not exists invite_emails_inviter_idx on public.invite_emails (invited_by, sent_at desc);
create index if not exists invite_emails_due_idx on public.invite_emails (sent_at) where reminded_at is null;
alter table public.invite_emails enable row level security;
-- No policies for people: the addresses someone typed stay between them and dancerly. Reads go through the
-- function below, writes through send-invite.
revoke all on public.invite_emails from anon, authenticated;

-- Has this address joined the project yet? (Matches the account email, case-insensitive.)
create or replace function private.invite_joined(p_project uuid, p_email text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m join auth.users u on u.id = m.user_id
    where m.project_id = p_project and lower(u.email) = lower(p_email)
  )
$$;
revoke execute on function private.invite_joined(uuid, text) from public, anon, authenticated;

-- The invites you sent for one project, newest first, and whether each person is in now.
create or replace function public.my_sent_invites(p_project uuid)
returns table (email text, sent_at timestamptz, joined boolean)
language sql stable security definer set search_path = ''
as $$
  select e.email, e.sent_at, private.invite_joined(e.project_id, e.email)
  from public.invite_emails e
  where e.project_id = p_project and e.invited_by = (select auth.uid()) and private.is_project_member(p_project)
  order by e.sent_at desc
  limit 20
$$;
revoke execute on function public.my_sent_invites(uuid) from public, anon;
grant execute on function public.my_sent_invites(uuid) to authenticated;

-- For the reminder (send-emails, service role): invites 3–7 days old, not reminded, not joined, project still there.
create or replace function public.invite_reminders_due()
returns table (id uuid, project_id uuid, invited_by uuid, email text, lang text)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.project_id, e.invited_by, e.email, e.lang
  from public.invite_emails e
  join public.projects p on p.id = e.project_id and p.deleted_at is null and not p.is_sample
  where e.reminded_at is null
    and e.sent_at < now() - interval '3 days' and e.sent_at > now() - interval '7 days'
    and not private.invite_joined(e.project_id, e.email)
  limit 200
$$;
revoke execute on function public.invite_reminders_due() from public, anon, authenticated;
grant execute on function public.invite_reminders_due() to service_role;

-- The reminder: once an hour the send-invite function looks for invites due one (same database secret as the
-- email function), so the invite and its reminder are written in one place.
select cron.unschedule(jobid) from cron.job where jobname = 'dancerly-invite-reminders';
select cron.schedule('dancerly-invite-reminders', '17 * * * *', $cron$
  select net.http_post(
    url := 'https://egkwjdwfzuslyrhuzkmq.supabase.co/functions/v1/send-invite',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := '{"reminders": true}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
