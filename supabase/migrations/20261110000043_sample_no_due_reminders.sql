-- The sample project's example assignment has a real due date, so the hourly job sent a "due in 24 hours"
-- notification for it. The sample is private and nothing in it should reach anyone: the job now skips sample
-- projects (both the due reminder and the weekly repeat), and leftover sample notifications are marked read so
-- they stop counting toward the Inbox badge.

create or replace function private.run_request_schedule()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests;
  nid uuid;
  next_due timestamptz;
begin
  for r in
    select q.* from public.requests q join public.projects p on p.id = q.project_id
    where q.status = 'active' and q.due_reminded_at is null and q.due_at > now() and q.due_at <= now() + interval '24 hours'
      and not p.is_sample
  loop
    perform private.notify_request(r.id, 'request_due', true);
    update public.requests set due_reminded_at = now() where id = r.id;
  end loop;

  for r in
    select q.* from public.requests q join public.projects p on p.id = q.project_id
    where q.status = 'active' and q.repeat_weekly and q.due_at <= now() and not p.is_sample
  loop
    next_due := r.due_at + interval '7 days';
    while next_due <= now() loop
      next_due := next_due + interval '7 days';
    end loop;
    update public.requests set status = 'closed', closed_at = now(), repeat_weekly = false where id = r.id;
    insert into public.requests (project_id, title, brief, due_at, everyone, reference_video_id, created_by, audience, repeat_weekly, repeat_of)
    values (r.project_id, r.title, r.brief, next_due, r.everyone, r.reference_video_id, r.created_by, r.audience, true, coalesce(r.repeat_of, r.id))
    returning id into nid;
    insert into public.request_assignees (request_id, user_id)
    select nid, a.user_id from public.request_assignees a
    join public.project_members m on m.user_id = a.user_id and m.project_id = r.project_id
    where a.request_id = r.id;
    perform set_config('request.jwt.claims', json_build_object('sub', r.created_by)::text, true);
    perform private.notify_request(nid, 'request_new', false);
    perform set_config('request.jwt.claims', '{}', true);
  end loop;
end;
$$;

update public.notifications n set read_at = now()
  from public.projects p
 where p.id = n.project_id and p.is_sample and n.read_at is null;
