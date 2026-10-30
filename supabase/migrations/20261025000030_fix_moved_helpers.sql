-- The membership helpers (is_project_member, is_project_owner, is_member_of_storage_path) moved to the private
-- schema, but four functions still called them as public.*, so they failed every time:
--   set_take_thumb  (thumbnails were uploaded but never saved, so a new one was made on every visit)
--   set_take_align, set_counts, private.can_write_image
-- Re-create each with the private.* names; nothing else in them changes.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (p.prosrc like '%public.is_project_member%' or p.prosrc like '%public.is_project_owner%' or p.prosrc like '%public.is_member_of_storage_path%')
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'public.is_project_member(', 'private.is_project_member(');
    def := replace(def, 'public.is_project_owner(', 'private.is_project_owner(');
    def := replace(def, 'public.is_member_of_storage_path(', 'private.is_member_of_storage_path(');
    execute def; -- pg_get_functiondef returns CREATE OR REPLACE, so grants and ownership stay
  end loop;
end;
$$;
