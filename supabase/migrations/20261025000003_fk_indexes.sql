-- Indexes for foreign keys to auth.users and projects, so deleting an account or project stays fast.
create index if not exists note_reactions_user_idx on public.note_reactions (user_id);
create index if not exists notes_author_idx on public.notes (author_id);
create index if not exists notes_resolved_by_idx on public.notes (resolved_by);
create index if not exists project_invites_created_by_idx on public.project_invites (created_by);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists takes_project_idx on public.takes (project_id);
create index if not exists takes_uploaded_by_idx on public.takes (uploaded_by);
create index if not exists videos_created_by_idx on public.videos (created_by);
