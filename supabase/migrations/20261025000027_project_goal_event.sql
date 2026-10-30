-- A project's goal: the event the team is working toward (a show, a competition, an audition).
-- Optional; without it the app counts down to the next show. Cleared if the event is deleted.
alter table public.projects add column if not exists target_event_id uuid references public.project_events (id) on delete set null;
create index if not exists projects_target_event_idx on public.projects (target_event_id);

-- The goal has to be one of this project's own events.
create or replace function private.check_target_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.target_event_id is not null and not exists (
    select 1 from public.project_events e where e.id = new.target_event_id and e.project_id = new.id
  ) then
    raise exception 'That event belongs to another project.';
  end if;
  return new;
end;
$$;
revoke execute on function private.check_target_event() from public, anon, authenticated;
drop trigger if exists before_target_event on public.projects;
create trigger before_target_event
  before insert or update of target_event_id on public.projects
  for each row execute function private.check_target_event();
