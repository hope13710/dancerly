-- The sample's title drops its "Sample ·" prefix: every place that shows the sample already marks it
-- (the Sample badge on its card, "Try it out" in the sidebar, the sample bar inside it, Search), and the
-- cross-project lists (Inbox, Feedback, Calendar, the calendar feed) leave it out. So the title can read
-- like a real team's project.
-- Only the title text inside private.create_sample_project_seed changes, swapped in the live definition;
-- the migration stops if either string isn't found exactly once.
-- Existing samples pick up the new title the next time they reset (Reset, or coming back after 30 minutes).

do $migration$
declare
  d text := pg_get_functiondef('private.create_sample_project_seed(text,text)'::regprocedure);
  pairs text[][] := array[
    [$o$'샘플 · 2026 봄 정기공연 K-pop 커버'$o$, $n$'2026 봄 정기공연 K-pop 커버'$n$],
    [$o$'Sample · Spring Showcase 2026 K-pop Cover'$o$, $n$'Spring Showcase 2026 K-pop Cover'$n$]
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
