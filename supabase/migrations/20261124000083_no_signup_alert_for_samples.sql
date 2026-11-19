-- The "New signup" alert skips the sample teammates. They're accounts only so they can appear in sample projects
-- (no one can log in as them), but migration 077 adding two of them sent two "New signup" emails.
-- The other alerts (first project, first upload, first teammate) already skip sample projects, and the funnel
-- queries in supabase/queries already leave these accounts out.

create or replace function private.alert_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id::text like '5a3b0000-%'
     or exists (select 1 from auth.users u where u.id = new.id and u.raw_user_meta_data->>'sample' = 'true') then
    return null; -- a sample teammate, not a person
  end if;
  perform private.notify_admin('signup', new.id);
  return null;
end;
$function$;
