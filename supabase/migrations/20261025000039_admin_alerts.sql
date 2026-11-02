-- Founder alerts: an email (via the notify-admin function) when someone starts using dancerly.
--   signup          a new profile (right after they pick their name)
--   first_project   someone's first project of their own (samples don't count)
--   first_upload    someone's first take uploaded to storage (sample videos don't count)
--   first_teammate  the first member, besides the owner, to join a project
-- The call goes out through pg_net after the row is written, so it never slows down or blocks the app,
-- and any failure is swallowed. It uses the same secret as the email cron (migration 025).

create or replace function private.notify_admin(p_kind text, p_id uuid, p_extra uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://egkwjdwfzuslyrhuzkmq.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := jsonb_build_object('kind', p_kind, 'id', p_id, 'extra', p_extra),
    timeout_milliseconds := 15000
  );
exception when others then
  null; -- an alert must never get in the way of signing up, creating, or uploading
end;
$$;
revoke execute on function private.notify_admin(text, uuid, uuid) from public, anon, authenticated;

create or replace function private.alert_on_signup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify_admin('signup', new.id);
  return null;
end;
$$;

create or replace function private.alert_on_project()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not new.is_sample and new.created_by is not null
     and (select count(*) from public.projects where created_by = new.created_by and not is_sample) = 1 then
    perform private.notify_admin('first_project', new.id);
  end if;
  return null;
end;
$$;

create or replace function private.alert_on_take()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.storage_path not like 'public:%' and new.uploaded_by is not null
     and (select count(*) from public.takes where uploaded_by = new.uploaded_by and storage_path not like 'public:%') = 1 then
    perform private.notify_admin('first_upload', new.id);
  end if;
  return null;
end;
$$;

create or replace function private.alert_on_member()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'member'
     and not exists (select 1 from public.projects where id = new.project_id and is_sample)
     and (select count(*) from public.project_members where project_id = new.project_id and role = 'member') = 1 then
    perform private.notify_admin('first_teammate', new.project_id, new.user_id);
  end if;
  return null;
end;
$$;

revoke execute on function private.alert_on_signup() from public, anon, authenticated;
revoke execute on function private.alert_on_project() from public, anon, authenticated;
revoke execute on function private.alert_on_take() from public, anon, authenticated;
revoke execute on function private.alert_on_member() from public, anon, authenticated;

drop trigger if exists alert_signup on public.profiles;
create trigger alert_signup after insert on public.profiles for each row execute function private.alert_on_signup();
drop trigger if exists alert_first_project on public.projects;
create trigger alert_first_project after insert on public.projects for each row execute function private.alert_on_project();
drop trigger if exists alert_first_upload on public.takes;
create trigger alert_first_upload after insert on public.takes for each row execute function private.alert_on_take();
drop trigger if exists alert_first_teammate on public.project_members;
create trigger alert_first_teammate after insert on public.project_members for each row execute function private.alert_on_member();
