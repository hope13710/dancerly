-- The sample project's seeded notes come with their focus area, so someone opening the sample sees the chips and the
-- Insights focus areas right away instead of waiting for the AI. Seeded notes are recognized the same way
-- relocalize_sample() does it: by their sample teammate author and when they were written relative to the project
-- (the same offsets every time, in both languages). A person's own choice (category_source 'user') is never touched;
-- notes people write in the sample are left to the classifier as usual.

create or replace function private.categorize_sample(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  old_version boolean := exists (select 1 from public.takes t join public.videos v on v.id = t.video_id
                                 where v.project_id = p_project and t.storage_path like 'public:/samples/sample-take-%');
begin
  perform set_config('looproom.category_change', 'on', true);
  update public.notes n
     set category = c.category, category_source = 'ai'
    from public.projects p,
         (values
           -- current sample (the opener): back row depth, Leo hidden, Maya's arm, walk-up, facials, squat together, deeper squat
           (false, -256800, 'technique'), (false, -256500, 'formation'), (false, -256080, 'sync'), (false, -255720, 'timing'),
           (false, -255540, 'performance'), (false, -255240, 'sync'), (false, -64800, 'technique'),
           -- samples from before migration 036: late arms, spacing, ripple, ending pose, heads together, cleaner arms
           (true, -256800, 'timing'), (true, -256500, 'formation'), (true, -256080, 'sync'), (true, -255720, 'timing'),
           (true, -255540, 'performance'), (true, -255240, 'sync'), (true, -64800, 'timing')
         ) as c(old, off, category)
   where p.id = p_project and n.project_id = p.id and p.is_sample
     and n.author_id::text like '5a3b0000-0000-4000-8000-%'
     and c.old = old_version
     and round(extract(epoch from (n.created_at - p.created_at))) = c.off
     and n.category_source is distinct from 'user';
  perform set_config('looproom.category_change', 'off', true);
end;
$$;
revoke all on function private.categorize_sample(uuid) from public, anon, authenticated;

-- New samples: the existing seeding function keeps doing the work; a wrapper with the same name adds the categories.
alter function public.create_sample_project(text, text) rename to create_sample_project_seed;
alter function public.create_sample_project_seed(text, text) set schema private;
revoke all on function private.create_sample_project_seed(text, text) from public, anon, authenticated;

create function public.create_sample_project(p_lang text default 'en', p_tz text default 'UTC')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  p uuid;
begin
  p := private.create_sample_project_seed(p_lang, p_tz);
  perform private.categorize_sample(p);
  return p;
end;
$$;
revoke all on function public.create_sample_project(text, text) from public, anon;
grant execute on function public.create_sample_project(text, text) to authenticated;

-- Samples people already have.
do $$
declare s record;
begin
  for s in select id from public.projects where is_sample loop
    perform private.categorize_sample(s.id);
  end loop;
end $$;
