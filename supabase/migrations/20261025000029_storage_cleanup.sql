-- Deleting a video, a take, or a whole project removes its rows; this removes the files they leave behind.
-- 1. Storage usage counts only files a take still points to, so it drops the moment something is deleted.
-- 2. Every hour the storage-cleanup function removes files in "takes" that no take points to any more.
--    Files uploaded in the last 2 days are left alone, so an upload that's still being finished isn't touched.

create or replace function public.my_storage_usage()
returns table (project_id uuid, bytes bigint)
language sql stable security definer set search_path = ''
as $$
  select p.id, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from public.project_members m
  join public.projects p on p.id = m.project_id and not p.is_sample
  left join public.takes t on t.project_id = p.id
  left join storage.objects o on o.bucket_id = 'takes' and o.name in (t.storage_path, t.thumb_path)
  where m.user_id = (select auth.uid()) and m.role = 'owner'
  group by p.id;
$$;
revoke execute on function public.my_storage_usage() from public, anon;
grant execute on function public.my_storage_usage() to authenticated;

create or replace function public.storage_orphans(p_limit int default 500)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'takes'
    and o.created_at < now() - interval '2 days'
    and not exists (select 1 from public.takes t where t.storage_path = o.name or t.thumb_path = o.name)
  order by o.created_at
  limit p_limit;
$$;
revoke execute on function public.storage_orphans(int) from public, anon, authenticated;
grant execute on function public.storage_orphans(int) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'dancerly-storage-cleanup';
select cron.schedule('dancerly-storage-cleanup', '23 * * * *', $$
  select net.http_post(
    url := 'https://egkwjdwfzuslyrhuzkmq.supabase.co/functions/v1/storage-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := '{}'::jsonb
  );
$$);
