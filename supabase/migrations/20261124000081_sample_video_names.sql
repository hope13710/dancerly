-- The sample's videos and thumbnails under new names (nova2-…). /samples/ files are cached for a week, so
-- browsers that saw the first version (with words in the corners) kept showing it under the old names.
-- Samples people have now point at the new files right away; new samples (the seed, the choreo video) and the
-- version check in reset_sample use them too. Each function's text is changed in place, and the migration stops
-- if a function doesn't hold the old name.

update public.takes t
   set storage_path = replace(t.storage_path, 'public:/samples/nova-', 'public:/samples/nova2-'),
       thumb_path = replace(t.thumb_path, 'public:/samples/nova-', 'public:/samples/nova2-')
  from public.videos v join public.projects p on p.id = v.project_id
 where t.video_id = v.id and p.is_sample and t.storage_path like 'public:/samples/nova-%';

do $migration$
declare
  fn regprocedure;
  d text;
begin
  foreach fn in array array[
    'private.create_sample_project_seed(text,text)'::regprocedure,
    'private.add_sample_choreo(uuid)'::regprocedure,
    'public.reset_sample(text,text,boolean)'::regprocedure
  ] loop
    d := pg_get_functiondef(fn);
    if position('public:/samples/nova-' in d) = 0 then
      raise exception 'Expected the sample video names in %', fn;
    end if;
    execute replace(d, 'public:/samples/nova-', 'public:/samples/nova2-');
  end loop;
end
$migration$;
