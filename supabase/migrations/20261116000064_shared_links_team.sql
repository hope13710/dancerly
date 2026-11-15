-- Share links belong to what's shared, not to whoever turned them on (like Notion's "Share to web"):
--   • one live link per take (video) and one per project's Practice page, enforced here;
--   • anyone who can share in the project can turn it on, change its settings, or turn it off;
--   • who can share: the owner always; everyone else while projects.members_share_links is on (the default,
--     which keeps today's "any member can share a take"). It replaces members_share_practice (061), which
--     only covered Practice;
--   • updated_by / updated_at say who changed a link last, shown in the share dialog.

alter table public.projects add column if not exists members_share_links boolean not null default true;

-- ---------- Who changed it last ----------
alter table public.video_shares add column if not exists updated_by uuid references auth.users (id) on delete set null;
alter table public.video_shares add column if not exists updated_at timestamptz not null default now();
alter table public.practice_shares add column if not exists updated_by uuid references auth.users (id) on delete set null;
alter table public.practice_shares add column if not exists updated_at timestamptz not null default now();
update public.video_shares set updated_by = created_by, updated_at = created_at where updated_by is null;
update public.practice_shares set updated_by = created_by, updated_at = created_at where updated_by is null;

create or replace function private.touch_share()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Counting a view (the shared-video function bumps views) isn't a change to the link.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'views' - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'views' - 'updated_at' - 'updated_by') then
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by, new.created_by);
  return new;
end;
$$;
revoke execute on function private.touch_share() from public, anon, authenticated;
drop trigger if exists before_share_touch on public.video_shares;
create trigger before_share_touch before insert or update on public.video_shares for each row execute function private.touch_share();
drop trigger if exists before_share_touch on public.practice_shares;
create trigger before_share_touch before insert or update on public.practice_shares for each row execute function private.touch_share();

-- ---------- One live link per item ----------
-- Older duplicates (from before one-link-per-item) are turned off, keeping the newest.
update public.video_shares s set revoked = true
where not s.revoked and exists (select 1 from public.video_shares o where o.video_id = s.video_id and not o.revoked and o.created_at > s.created_at);
update public.practice_shares s set revoked = true
where not s.revoked and exists (select 1 from public.practice_shares o where o.project_id = s.project_id and not o.revoked and o.created_at > s.created_at);
create unique index if not exists video_shares_one_live on public.video_shares (video_id) where not revoked;
create unique index if not exists practice_shares_one_live on public.practice_shares (project_id) where not revoked;

-- ---------- Who can share ----------
create or replace function private.can_share(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_project_owner(p_project)
    or (private.is_project_member(p_project) and exists (select 1 from public.projects p where p.id = p_project and p.members_share_links));
$$;
revoke execute on function private.can_share(uuid) from public, anon;
grant execute on function private.can_share(uuid) to authenticated;

drop policy if exists "shares: members can share" on public.video_shares;
create policy "shares: who can share turns it on" on public.video_shares
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.videos v where v.id = video_id and private.can_share(v.project_id))
  );
drop policy if exists "shares: creator or owner turns off" on public.video_shares;
drop policy if exists "shares: who can share changes it" on public.video_shares;
create policy "shares: who can share changes it" on public.video_shares
  for update to authenticated using (private.can_share(project_id)) with check (private.can_share(project_id));

drop policy if exists "practice shares: owner, or members when allowed" on public.practice_shares;
create policy "practice shares: who can share turns it on" on public.practice_shares
  for insert to authenticated with check (created_by = (select auth.uid()) and private.can_share(project_id));
drop policy if exists "practice shares: creator or owner changes" on public.practice_shares;
drop policy if exists "practice shares: who can share changes it" on public.practice_shares;
create policy "practice shares: who can share changes it" on public.practice_shares
  for update to authenticated using (private.can_share(project_id)) with check (private.can_share(project_id));

notify pgrst, 'reload schema';
