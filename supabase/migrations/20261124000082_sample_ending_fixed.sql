-- Three small things in the sample that didn't add up:
-- 1. Sofia's note on Maya's arm in the ending pose stayed "Practicing", but Take 2 shows the arm fixed (and Dani's
--    Take 2 note says the ending is way sharper). It's marked fixed now, by Maya.
-- 2. The Ending pose practice section said "Learning"; it's "Practicing" now (it's improving, not new).
-- 3. The pinned page said Regionals is "18 days out", but it was written the day before. It says "under three weeks
--    out" now, which stays true.
-- New samples (the seed is changed in place; the migration stops if a piece isn't found exactly once) and the
-- samples people have now.

do $migration$
declare
  d text := pg_get_functiondef('private.create_sample_project_seed(text,text)'::regprocedure);
  pairs text[][] := array[
    ['where id in (n_walk, n_end, m_freeze);', 'where id in (n_walk, m_freeze);'],
    ['update public.notes set status = ''resolved'', resolved_by = maya, resolved_at = take1_at + interval ''2 hours'' where id = n_six;',
     'update public.notes set status = ''resolved'', resolved_by = maya, resolved_at = take1_at + interval ''2 hours'' where id = n_six;' || chr(10) ||
     '  update public.notes set status = ''resolved'', resolved_by = maya, resolved_at = take2_at + interval ''2 hours'' where id = n_end;'],
    ['''Elbow bent, hand by the head, freeze on 8'', v, c2 + 44 * beat, ''learning'')', '''Elbow bent, hand by the head, freeze on 8'', v, c2 + 44 * beat, ''practicing'')'],
    [') is 18 days out.** ''', ') is under three weeks out.** ''']
  ];
  i int;
  found int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    found := (length(d) - length(replace(d, pairs[i][1], ''))) / length(pairs[i][1]);
    if found <> 1 then
      raise exception 'Sample text not found exactly once (% times): %', found, pairs[i][1];
    end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  execute d;
end
$migration$;

-- The samples people have now.
do $existing$
begin
  perform set_config('looproom.status_change', 'on', true);
  update public.notes n
     set status = 'resolved', resolved_by = '5a3b0000-0000-4000-8000-000000000007', resolved_at = now() - interval '20 hours'
    from public.projects p
   where p.id = n.project_id and p.is_sample
     and n.author_id = '5a3b0000-0000-4000-8000-000000000010'
     and n.body like 'Ending pose: Maya''s arm goes straight up%'
     and n.status <> 'resolved';
  perform set_config('looproom.status_change', 'off', true);

  update public.count_sheet_rows r
     set status = 'practicing'
    from public.projects p
   where p.id = r.project_id and p.is_sample and r.section = 'Ending pose' and r.status = 'learning';

  update public.project_pages g
     set body = replace(g.body, ') is 18 days out.** ', ') is under three weeks out.** ')
    from public.projects p
   where p.id = g.project_id and p.is_sample and g.body like '%) is 18 days out.** %';
end
$existing$;
