-- "Not useful" on an AI recap now asks what was off, in one tap: it got something wrong, it was too obvious,
-- it missed notes, or it was too long. Read with supabase/queries/recap_feedback.sql to improve the recap
-- prompt (generate-recap) by hand. Nothing reads it automatically.
alter table public.recap_feedback add column if not exists reason text
  check (reason in ('wrong', 'obvious', 'missed', 'long'));
-- A reason only goes with "not useful".
alter table public.recap_feedback drop constraint if exists recap_feedback_reason_with_down;
alter table public.recap_feedback add constraint recap_feedback_reason_with_down check (reason is null or helpful = false);
