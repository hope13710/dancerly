-- Run in the Supabase SQL editor (read-only). Does dancerly's loop close for new teams?
-- The loop: a video goes up → someone else leaves a note on it → a later take comes up → that note is marked fixed.
-- One row per week that projects were created (real projects only: no samples, no Trash, no sample teammates).
--   projects          real projects created that week
--   with_video        ... with at least one take
--   two_people_7d     ... where, within 7 days of creation, two different people worked on the same video
--                     (uploaded a take of it or left a note on it): the team is actually using it together
--   note_by_other_7d  ... where someone left a note on a take someone else uploaded, within 7 days
--   fixed_14d         ... where, within 14 days, a note was marked fixed on someone else's take (in a new take or
--                     right on the same one: plenty of teams fix it at practice and tick it)
--   fixed_new_take_14d  the stricter version: fixed after a later take of that video was uploaded
-- And at the end, weekly active teams now: projects where two or more people did something in the last 7 days.
-- Change the interval to look further back.
with p as (
  select id, created_at, date_trunc('week', created_at)::date as week
  from public.projects
  where not coalesce(is_sample, false) and deleted_at is null
    and created_by::text not like '5a3b0000-%'
    and created_at > now() - interval '90 days'
),
t as (
  select tk.id, tk.project_id, tk.video_id, tk.number, tk.uploaded_by, tk.created_at
  from public.takes tk join p on p.id = tk.project_id
  where tk.deleted_at is null and coalesce(tk.kind, 'take') <> 'choreo'
),
n as (
  select nt.id, t.project_id, t.video_id, nt.take_id, nt.author_id, nt.created_at, nt.status, nt.resolved_at,
         t.uploaded_by as take_by, t.created_at as take_at
  from public.notes nt join t on t.id = nt.take_id
  where nt.author_id::text not like '5a3b0000-%'
),
-- Who touched each video, and when.
touch as (
  select project_id, video_id, uploaded_by as who, created_at as at from t
  union all
  select project_id, video_id, author_id, created_at from n
),
two_people as (
  select distinct x.project_id
  from touch x join p on p.id = x.project_id
  where x.at < p.created_at + interval '7 days'
  group by x.project_id, x.video_id
  having count(distinct x.who) >= 2
),
note_by_other as (
  select distinct n.project_id
  from n join p on p.id = n.project_id
  where n.author_id <> n.take_by and n.created_at < p.created_at + interval '7 days'
),
fixed_any as (
  select distinct n.project_id
  from n join p on p.id = n.project_id
  where n.status = 'resolved' and n.author_id <> n.take_by and n.resolved_at < p.created_at + interval '14 days'
),
fixed_loop as (
  select distinct n.project_id
  from n join p on p.id = n.project_id
  where n.status = 'resolved' and n.resolved_at < p.created_at + interval '14 days'
    and exists (select 1 from t later where later.video_id = n.video_id and later.created_at > n.take_at
                and later.created_at <= n.resolved_at)
)
select p.week,
  count(*) as projects,
  count(*) filter (where exists (select 1 from t where t.project_id = p.id)) as with_video,
  count(*) filter (where p.id in (select project_id from two_people)) as two_people_7d,
  count(*) filter (where p.id in (select project_id from note_by_other)) as note_by_other_7d,
  count(*) filter (where p.id in (select project_id from fixed_any)) as fixed_14d,
  count(*) filter (where p.id in (select project_id from fixed_loop)) as fixed_new_take_14d,
  round(100.0 * count(*) filter (where p.id in (select project_id from two_people)) / nullif(count(*), 0), 1) as two_people_pct,
  round(100.0 * count(*) filter (where p.id in (select project_id from fixed_any)) / nullif(count(*), 0), 1) as fixed_pct
from p
group by p.week
order by p.week desc;

-- Weekly active teams (the number to watch week over week): real projects where at least two different people
-- uploaded a take, left a note, or replied in the last 7 days.
-- with recent as (
--   select tk.project_id, tk.uploaded_by as who from public.takes tk where tk.created_at > now() - interval '7 days' and tk.deleted_at is null
--   union all select tk.project_id, nt.author_id from public.notes nt join public.takes tk on tk.id = nt.take_id where nt.created_at > now() - interval '7 days'
--   union all select tk.project_id, r.author_id from public.note_replies r join public.notes nt on nt.id = r.note_id join public.takes tk on tk.id = nt.take_id where r.created_at > now() - interval '7 days'
-- )
-- select count(*) as weekly_active_teams from (
--   select r.project_id from recent r join public.projects pr on pr.id = r.project_id
--   where not coalesce(pr.is_sample, false) and pr.deleted_at is null and r.who::text not like '5a3b0000-%'
--   group by r.project_id having count(distinct r.who) >= 2
-- ) x;
