-- Storage allowance (migration 044) without Trash: like Settings (migration 032), anything in Trash doesn't count,
-- so deleting an old take frees its space right away even though Trash keeps it for 30 days.
-- (044 was first applied before this change; this brings the function in line. Privileges are kept.)
create or replace function private.storage_used(p_user uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from public.project_members m
  join public.projects p on p.id = m.project_id and p.deleted_at is null
  join public.takes t on t.project_id = p.id and t.deleted_at is null
    and exists (select 1 from public.videos v where v.id = t.video_id and v.deleted_at is null)
  join storage.objects o on o.bucket_id = 'takes' and o.name in (t.storage_path, t.thumb_path)
  where m.user_id = p_user and m.role = 'owner';
$$;
