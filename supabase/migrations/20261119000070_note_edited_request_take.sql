-- Two small additions.
--
-- 1. A note says "edited" once its words change. notes.updated_at also moves when its status changes (Working on it,
--    Fixed), so it can't tell an edit apart: edited_at is set by the database, only when the body changes.
--
-- 2. An assignment can point at one take of its reference video ("Take 2: fix these and film it again").
--    reference_take_id must be a take of reference_video_id; anything else (or a take that's deleted) falls back to
--    the video itself, which opens on its latest take as before. The creator sets it right after creating the
--    assignment, through the same column grant as the reference video.

alter table public.notes add column if not exists edited_at timestamptz;

create or replace function private.note_edited()
returns trigger
language plpgsql set search_path = ''
as $fn$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$fn$;
drop trigger if exists note_edited on public.notes;
create trigger note_edited before update of body on public.notes
  for each row execute function private.note_edited();

alter table public.requests add column if not exists reference_take_id uuid references public.takes (id) on delete set null;

create or replace function private.request_reference_take()
returns trigger
language plpgsql set search_path = ''
as $fn$
begin
  if new.reference_take_id is not null and not exists (
    select 1 from public.takes t where t.id = new.reference_take_id and t.video_id = new.reference_video_id
  ) then
    new.reference_take_id := null;
  end if;
  return new;
end;
$fn$;
drop trigger if exists request_reference_take on public.requests;
create trigger request_reference_take before insert or update of reference_take_id, reference_video_id on public.requests
  for each row execute function private.request_reference_take();

grant update (reference_take_id) on public.requests to authenticated;
