-- Pages, step 2: mentions that notify, and photos.
--
-- 1. @mentioning someone on a page tells them (Inbox, and email like a note @mention, under the same setting).
--    notify_page_mentions() is called by the app after a save with the people newly mentioned in it, each with the
--    line they're on ("- [ ] @Jin bring the speaker"). Only people in the page's project, never the writer, at most
--    once an hour per person and page (re-saving doesn't notify again).
-- 2. Photos on a page live in the same private bucket as videos, under <project>/pages/<page>/…: only people in
--    the project can see them, uploads need room in the owner's storage, and they count toward it.
--    The hourly cleanup keeps a page photo while its page still shows it.

-- ---------- 1. Mentions ----------
alter type public.notification_kind add value if not exists 'page_mention';
alter table public.notifications add column if not exists page_id uuid references public.project_pages (id) on delete cascade;
-- The line someone was mentioned on, shown in the Inbox and the email.
alter table public.notifications add column if not exists detail text;
create index if not exists notifications_page_idx on public.notifications (page_id) where page_id is not null;

create or replace function public.notify_page_mentions(p_page uuid, p_mentions jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $fn$
declare
  me uuid := (select auth.uid());
  pg record;
  m jsonb;
  who uuid;
  sent integer := 0;
begin
  select id, project_id into pg from public.project_pages where id = p_page;
  if pg.id is null or not private.is_project_member(pg.project_id) then
    raise exception 'Page not found';
  end if;
  for m in select * from jsonb_array_elements(coalesce(p_mentions, '[]'::jsonb)) limit 50 loop
    begin who := (m ->> 'user')::uuid; exception when others then continue; end;
    if who is null or who = me then continue; end if;
    if not exists (select 1 from public.project_members where project_id = pg.project_id and user_id = who) then continue; end if;
    -- Their setting for @mentions (the same one note mentions use).
    if coalesce((select (notify ->> 'mention')::boolean from public.profiles where id = who), true) is false then continue; end if;
    if exists (select 1 from public.notifications n where n.user_id = who and n.page_id = p_page and n.actor_id = me
               and n.created_at > now() - interval '1 hour') then continue; end if;
    insert into public.notifications (user_id, kind, actor_id, project_id, page_id, detail)
    values (who, 'page_mention', me, pg.project_id, p_page, nullif(left(btrim(coalesce(m ->> 'line', '')), 240), ''));
    sent := sent + 1;
  end loop;
  return sent;
end;
$fn$;
revoke all on function public.notify_page_mentions(uuid, jsonb) from public, anon;
grant execute on function public.notify_page_mentions(uuid, jsonb) to authenticated;

-- ---------- 2. Photos ----------
-- Storage used: videos and thumbnails as before, plus page photos in projects you own.
create or replace function private.storage_used(p_user uuid)
returns bigint
language sql stable security definer set search_path = ''
as $fn$
  select coalesce((
    select sum((o.metadata->>'size')::bigint)
    from public.project_members m
    join public.projects p on p.id = m.project_id and p.deleted_at is null
    join public.takes t on t.project_id = p.id and t.deleted_at is null
      and exists (select 1 from public.videos v where v.id = t.video_id and v.deleted_at is null)
    join storage.objects o on o.bucket_id = 'takes' and o.name in (t.storage_path, t.thumb_path)
    where m.user_id = p_user and m.role = 'owner'
  ), 0)::bigint + coalesce((
    select sum((o.metadata->>'size')::bigint)
    from public.project_members m
    join public.projects p on p.id = m.project_id and p.deleted_at is null
    join storage.objects o on o.bucket_id = 'takes' and o.name like p.id::text || '/pages/%'
    where m.user_id = p_user and m.role = 'owner'
  ), 0)::bigint;
$fn$;

-- The hourly cleanup: a page photo stays while a page shows it (its path is in the page's text).
create or replace function public.storage_orphans(p_limit int default 500)
returns setof text
language sql stable security definer set search_path = ''
as $fn$
  select o.name from storage.objects o
  where o.bucket_id = 'takes'
    and o.created_at < now() - interval '2 days'
    and not exists (select 1 from public.takes t where t.storage_path = o.name or t.thumb_path = o.name)
    and not (o.name like '%/pages/%' and exists (
      select 1 from public.project_pages pg
      where pg.id::text = split_part(o.name, '/', 3) and position(o.name in pg.body) > 0))
  order by o.created_at
  limit p_limit;
$fn$;
revoke execute on function public.storage_orphans(int) from public, anon, authenticated;
grant execute on function public.storage_orphans(int) to service_role;
