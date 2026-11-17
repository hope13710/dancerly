-- Run in the Supabase SQL editor (read-only). What people think of AI recaps, to improve the prompt in
-- supabase/functions/generate-recap by hand. "Useful?" and, on "not useful", what was off (migration 076).

-- 1. The overall picture, last 90 days.
select count(*) as answers,
  count(*) filter (where helpful) as useful,
  count(*) filter (where not helpful) as not_useful,
  count(*) filter (where reason = 'wrong') as got_something_wrong,
  count(*) filter (where reason = 'obvious') as too_obvious,
  count(*) filter (where reason = 'missed') as missed_notes,
  count(*) filter (where reason = 'long') as too_long,
  (select count(*) from public.recaps where created_at > now() - interval '90 days') as recaps_made
from public.recap_feedback
where created_at > now() - interval '90 days';

-- 2. Each "not useful", newest first, with what the recap said: read these next to the notes it cited.
select f.created_at, f.reason, r.id as recap_id, r.scope, r.period, r.team,
  r.content->>'headline' as headline,
  left(r.content::text, 600) as content_start
from public.recap_feedback f
join public.recaps r on r.id = f.recap_id
where not f.helpful
order by f.created_at desc
limit 50;
