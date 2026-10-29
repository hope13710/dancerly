-- Getting-started emails (send-emails function): a nudge when a new leader has no video after 2 days,
-- and a note when the first teammate joins. Each goes out at most once per person ('once').
alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('instant', 'digest', 'weekly', 'start_nudge', 'first_teammate'));
