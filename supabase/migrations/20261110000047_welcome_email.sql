-- Welcome email (send-emails): one per person, about 10 minutes after signing up. Leaders get how dancerly works and
-- their first step; people who joined through an invite get how to take part in that team. Logged once in email_log.
alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind = any (array['instant', 'digest', 'weekly', 'start_nudge', 'first_teammate', 'upload_link', 'invite_nudge', 'welcome']));
