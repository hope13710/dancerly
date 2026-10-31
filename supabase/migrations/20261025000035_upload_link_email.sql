-- "Send the link to my phone" on Home: someone on a computer emails themselves the upload link for their project,
-- so they can open it on the phone where their rehearsal videos are. Logged in email_log like the other emails;
-- one per person per 10 minutes (the period is the 10-minute slot, and (user_id, kind, period) is unique).

alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind = any (array['instant', 'digest', 'weekly', 'start_nudge', 'first_teammate', 'upload_link']));
