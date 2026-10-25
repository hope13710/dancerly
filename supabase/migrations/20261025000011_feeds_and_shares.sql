-- Calendar subscription feeds (a private URL calendar apps poll) and guest share links for one video.
-- Both are read by Edge Functions with the service role; the token is the only key, so it can be turned off.

create table public.calendar_feeds (
  token text primary key default encode(extensions.gen_random_bytes(18), 'hex'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index calendar_feeds_user_idx on public.calendar_feeds (user_id);
alter table public.calendar_feeds enable row level security;
create policy "calendar feeds: your own" on public.calendar_feeds
  for select to authenticated using (user_id = (select auth.uid()));
create policy "calendar feeds: create your own" on public.calendar_feeds
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "calendar feeds: turn off your own" on public.calendar_feeds
  for delete to authenticated using (user_id = (select auth.uid()));

create table public.video_shares (
  token text primary key default encode(extensions.gen_random_bytes(18), 'hex'),
  video_id uuid not null references public.videos (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  include_notes boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked boolean not null default false,
  views int not null default 0
);
create index video_shares_video_idx on public.video_shares (video_id);
create index video_shares_project_idx on public.video_shares (project_id);
create index video_shares_creator_idx on public.video_shares (created_by);

create function private.check_share()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select v.project_id into new.project_id from public.videos v where v.id = new.video_id;
  return new;
end;
$$;
create trigger before_share_insert
  before insert on public.video_shares
  for each row execute function private.check_share();
revoke execute on function private.check_share() from public, anon, authenticated;

alter table public.video_shares enable row level security;
create policy "shares: members can see" on public.video_shares
  for select to authenticated using (private.is_project_member(project_id));
create policy "shares: members can share" on public.video_shares
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.videos v where v.id = video_id and private.is_project_member(v.project_id))
  );
create policy "shares: creator or owner turns off" on public.video_shares
  for update to authenticated
  using (created_by = (select auth.uid()) or private.is_project_owner(project_id))
  with check (private.is_project_member(project_id));
revoke update on public.video_shares from authenticated;
grant update (revoked) on public.video_shares to authenticated;
