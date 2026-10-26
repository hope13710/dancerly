-- Run in the Supabase SQL editor. Each block is one question about the sample project.
-- Leaders only, last 30 days. Change the interval to look further back.

-- 1. The funnel: of the people who signed up, how many opened the sample, left a note in it,
--    created a real project, uploaded a real video, and invited someone?
with signed_up as (
  select id as user_id from auth.users
  where created_at > now() - interval '30 days' and coalesce(raw_user_meta_data->>'sample', '') <> 'true'
),
ev as (
  select user_id, event, props from public.product_events where created_at > now() - interval '30 days'
)
select
  (select count(*) from signed_up) as signed_up,
  count(distinct user_id) filter (where event = 'sample_opened') as opened_sample,
  count(distinct user_id) filter (where event = 'first_note' and props->>'sample' = 'true') as noted_in_sample,
  count(distinct user_id) filter (where event = 'onboarding_step_done' and props->>'step' = 'project') as made_project,
  count(distinct user_id) filter (where event = 'first_real_video') as uploaded_real_video,
  count(distinct user_id) filter (where event = 'invite_link_shared') as shared_invite
from ev where user_id in (select user_id from signed_up);

-- 2. Does the sample help? First real video within 7 days of signing up, sample vs. no sample.
with u as (
  select a.id, a.created_at,
    exists (select 1 from public.product_events e where e.user_id = a.id and e.event = 'sample_opened') as tried_sample,
    exists (select 1 from public.product_events e where e.user_id = a.id and e.event = 'first_real_video' and e.created_at < a.created_at + interval '7 days') as activated
  from auth.users a
  where a.created_at > now() - interval '60 days' and coalesce(a.raw_user_meta_data->>'sample', '') <> 'true'
)
select tried_sample, count(*) as people, count(*) filter (where activated) as activated_7d,
  round(100.0 * count(*) filter (where activated) / nullif(count(*), 0), 1) as pct
from u group by tried_sample;

-- 3. Where people open the sample from, and which nudges they saw.
select event, coalesce(props->>'from', props->>'key', props->>'to') as detail, count(*) as times, count(distinct user_id) as people
from public.product_events
where event in ('sample_opened', 'sample_moment', 'sample_exit', 'sample_deleted', 'sample_graduated', 'sample_cleanup', 'plan_preview')
  and created_at > now() - interval '30 days'
group by 1, 2 order by 1, 4 desc;
