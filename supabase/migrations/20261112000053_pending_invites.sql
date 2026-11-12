-- Someone signs up on their own (the leader forwarded dancerly.app instead of the project's invite link).
-- If a teammate already emailed them an invite (migration 052), the first screen shows it, like Slack's
-- "workspaces you've been invited to", so they join their team instead of making an empty project.
-- Only invites sent to the signed-in person's own email address; the link code is what that email carried.

create or replace function public.my_pending_invites()
returns table (project_id uuid, project_title text, invited_by_name text, code text, sent_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select distinct on (e.project_id)
    e.project_id,
    p.title,
    pr.display_name,
    (select i.code from public.project_invites i
      where i.project_id = e.project_id and not i.revoked and i.expires_at > now()
      order by i.created_at desc limit 1),
    e.sent_at
  from public.invite_emails e
  join public.projects p on p.id = e.project_id and p.deleted_at is null and not p.is_sample
  join public.profiles pr on pr.id = e.invited_by
  where e.email = lower((select u.email from auth.users u where u.id = (select auth.uid())))
    and not exists (select 1 from public.project_members m where m.project_id = e.project_id and m.user_id = (select auth.uid()))
  order by e.project_id, e.sent_at desc
$$;
revoke execute on function public.my_pending_invites() from public, anon;
grant execute on function public.my_pending_invites() to authenticated;
