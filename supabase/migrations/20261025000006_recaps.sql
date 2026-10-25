-- AI recaps: one per project × period × scope, saved automatically.
-- Written only by the generate-recap Edge Function (service role); people read, pin, share, and tick off their own.

create type public.recap_scope as enum ('me', 'project');

create table public.recaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  scope public.recap_scope not null,
  period text not null check (period in ('last', 'week', 'month', 'custom')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  video_id uuid references public.videos (id) on delete set null,
  -- The newest note the recap saw, and how many: if neither changed, regenerating returns this one.
  notes_up_to timestamptz not null,
  note_count int not null check (note_count > 0),
  content jsonb not null,
  -- Snapshot of each cited note (ref "n1" -> note id, text, moment), so citations survive edits.
  sources jsonb not null,
  -- "What to do next" items ticked off by the creator (indexes into content.next).
  checked int[] not null default '{}',
  shared_at timestamptz,
  model text,
  created_at timestamptz not null default now()
);
create index recaps_project_created_idx on public.recaps (project_id, created_at desc);
create index recaps_creator_created_idx on public.recaps (created_by, created_at desc);
create index recaps_video_idx on public.recaps (video_id);

create table public.recap_pins (
  recap_id uuid not null references public.recaps (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recap_id, user_id)
);
create index recap_pins_user_idx on public.recap_pins (user_id);

alter table public.recaps enable row level security;
alter table public.recap_pins enable row level security;

-- Before sharing only the creator sees a recap; after, everyone on the project.
create policy "recaps: creator, or the project once shared" on public.recaps
  for select to authenticated using (
    created_by = (select auth.uid())
    or (shared_at is not null and private.is_project_member(project_id))
  );
create policy "recaps: creator shares and ticks items" on public.recaps
  for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy "recaps: creator or project owner deletes" on public.recaps
  for delete to authenticated using (created_by = (select auth.uid()) or private.is_project_owner(project_id));
revoke update on public.recaps from authenticated;
grant update (shared_at, checked) on public.recaps to authenticated;

create policy "recap pins: your own" on public.recap_pins
  for select to authenticated using (user_id = (select auth.uid()));
create policy "recap pins: pin what you can see" on public.recap_pins
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (select 1 from public.recaps r where r.id = recap_id)
  );
create policy "recap pins: unpin your own" on public.recap_pins
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- Inbox: a recap shared to the project ----------
alter type public.notification_kind add value if not exists 'recap_shared';
alter table public.notifications add column recap_id uuid references public.recaps (id) on delete cascade;
create index notifications_recap_idx on public.notifications (recap_id);
update public.profiles set notify = notify || '{"recap_shared": true}'::jsonb where not notify ? 'recap_shared';
alter table public.profiles alter column notify set default '{"mention": true, "note_on_your_video": true, "new_take": true, "note_resolved": true, "joined": true, "recap_shared": true}'::jsonb;

create function private.on_recap_shared()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  m record;
begin
  if new.shared_at is null or old.shared_at is not null then
    return null;
  end if;
  for m in select user_id from public.project_members where project_id = new.project_id and user_id <> new.created_by loop
    if coalesce((select (notify ->> 'recap_shared')::boolean from public.profiles where id = m.user_id), true) then
      insert into public.notifications (user_id, kind, actor_id, project_id, recap_id)
      values (m.user_id, 'recap_shared', new.created_by, new.project_id, new.id);
    end if;
  end loop;
  return null;
end;
$$;
create trigger after_recap_shared
  after update of shared_at on public.recaps
  for each row execute function private.on_recap_shared();
revoke execute on function private.on_recap_shared() from public, anon, authenticated;
