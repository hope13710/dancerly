-- "Invite your team" email (send-emails): a leader who uploaded a video but is still alone in the project gets
-- one email, the day after, asking them to send the invite link. Logged once per person in email_log.
alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind = any (array['instant', 'digest', 'weekly', 'start_nudge', 'first_teammate', 'upload_link', 'invite_nudge']));
