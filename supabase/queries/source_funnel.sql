-- Run in the Supabase SQL editor. Where signups came from, and how far each source's people got.
-- Source = the link tag (?ref=ig_dm, ?ref=ig_bio, ?ref=share …) or, without a tag, the site they came from.
-- Change the interval to look further back.
with u as (
  select a.id, a.created_at,
    coalesce(nullif(a.raw_user_meta_data->>'signup_source', ''), '(unknown)') as source
  from auth.users a
  where a.created_at > now() - interval '90 days'
    and coalesce(a.raw_user_meta_data->>'sample', '') <> 'true'
),
real_projects as (select id, created_by from public.projects where not coalesce(is_sample, false)),
first_video as (
  select distinct t.uploaded_by as user_id from public.takes t join real_projects p on p.id = t.project_id
),
team_active as (
  -- leaders whose own project has at least one other real person in it
  select distinct p.created_by as user_id
  from real_projects p join public.project_members m on m.project_id = p.id
  where m.user_id <> p.created_by and m.user_id::text not like '5a3b0000-%'
)
select u.source,
  count(*) as signups,
  count(*) filter (where u.id in (select user_id from first_video)) as uploaded_a_video,
  count(*) filter (where u.id in (select user_id from team_active)) as team_activated,
  round(100.0 * count(*) filter (where u.id in (select user_id from team_active)) / nullif(count(*), 0), 1) as team_activation_pct
from u
group by u.source
order by signups desc;
