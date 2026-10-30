-- Storage used by the projects you own (videos and their thumbnails in the "takes" bucket), for Settings › Plan.
-- Plans count storage per owner, so a project counts toward its owner, not toward every member.
-- Files live under "<project id>/…", which is how they're matched to projects. Sample projects don't count.
create or replace function public.my_storage_usage()
returns table (project_id uuid, bytes bigint)
language sql stable security definer set search_path = ''
as $$
  select p.id, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from public.project_members m
  join public.projects p on p.id = m.project_id and not p.is_sample
  left join storage.objects o on o.bucket_id = 'takes' and o.name like p.id::text || '/%'
  where m.user_id = (select auth.uid()) and m.role = 'owner'
  group by p.id;
$$;
revoke execute on function public.my_storage_usage() from public, anon;
grant execute on function public.my_storage_usage() to authenticated;
