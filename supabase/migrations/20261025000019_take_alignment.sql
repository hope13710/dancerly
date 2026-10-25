-- Lining takes up: phone recordings of the same piece start at different moments, so 00:42 in Take 1
-- isn't 00:42 in Take 2. align = seconds to add to a Take 1 time to reach the same moment in this take
-- (found from the music). Take 1 is the reference (0). Used to place carried-over notes and for Insights.
alter table public.takes add column align numeric(7, 2) check (align is null or align between -120 and 120);

create function public.set_take_align(p_take uuid, p_align numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.takes;
begin
  select * into t from public.takes where id = p_take;
  if t.id is null or not public.is_project_member(t.project_id) then
    raise exception 'Take not found';
  end if;
  if p_align is null or p_align < -120 or p_align > 120 then
    raise exception 'Invalid alignment';
  end if;
  update public.takes set align = round(p_align, 2) where id = p_take;
end;
$$;
revoke execute on function public.set_take_align(uuid, numeric) from public, anon;
grant execute on function public.set_take_align(uuid, numeric) to authenticated;
