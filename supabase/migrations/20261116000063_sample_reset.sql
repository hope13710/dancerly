-- The sample is for trying things: change anything, and it goes back to how it started.
-- reset_sample swaps the person's sample for a fresh one (same language), the way relocalize_sample swaps it for
-- another language, without carrying anything over. The app calls it when they come back to the sample after a
-- while (only if something changed), and from the sample's Reset button.
create or replace function public.reset_sample(p_lang text default 'en', p_tz text default 'UTC', p_only_if_changed boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  old_p uuid;
  old_at timestamptz;
  new_p uuid;
  lang text;
begin
  if me is null then raise exception 'Log in first'; end if;
  select id, created_at into old_p, old_at from public.projects where created_by = me and is_sample and deleted_at is null limit 1;
  if old_p is null then return jsonb_build_object('status', 'none'); end if;

  -- Anything done in it since it was made (the seed writes everything at once, at old_at).
  if p_only_if_changed and not (
       exists (select 1 from public.videos where project_id = old_p and created_by = me)
    or exists (select 1 from public.takes where project_id = old_p and uploaded_by = me)
    or exists (select 1 from public.notes where project_id = old_p and (author_id = me or resolved_by = me or updated_at > old_at + interval '1 minute'))
    or exists (select 1 from public.note_replies r join public.notes n on n.id = r.note_id where n.project_id = old_p and r.author_id = me)
    or exists (select 1 from public.note_reactions x join public.notes n on n.id = x.note_id where n.project_id = old_p and x.user_id = me)
    or exists (select 1 from public.count_sheet_rows where project_id = old_p and updated_at > old_at + interval '1 minute')
    or exists (select 1 from public.project_pages where project_id = old_p and updated_at > old_at + interval '1 minute')
    or exists (select 1 from public.project_events where project_id = old_p and created_by = me)
    or exists (select 1 from public.requests where project_id = old_p and created_by = me)
    or exists (select 1 from public.project_groups where project_id = old_p and created_by = me)
    or exists (select 1 from public.recaps where project_id = old_p and created_by = me and model is distinct from 'sample')
  ) then
    return jsonb_build_object('status', 'same', 'project', old_p);
  end if;

  -- The same language as the sample they have (its seeded teammates say which), unless the app asks for another.
  lang := case when exists (select 1 from public.project_members where project_id = old_p and user_id = '5a3b0000-0000-4000-8000-000000000001') then 'ko' else 'en' end;
  if p_lang in ('en', 'ko') then lang := p_lang; end if;

  update public.projects set is_sample = false where id = old_p; -- so create_sample_project makes a new one
  new_p := public.create_sample_project(lang, p_tz);
  delete from public.notifications where project_id in (old_p, new_p);
  delete from public.projects where id = old_p;
  return jsonb_build_object('status', 'done', 'project', new_p, 'previous', old_p);
end;
$$;
revoke execute on function public.reset_sample(text, text, boolean) from public, anon;
grant execute on function public.reset_sample(text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
