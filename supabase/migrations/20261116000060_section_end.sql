-- A section has an end as well as a start (Practice: loop exactly the part you mark).
-- Without an end, a section runs until the next one starts, as before.
alter table public.count_sheet_rows add column if not exists t_end numeric(9, 2) check (t_end is null or t_end >= 0);
alter table public.count_sheet_rows drop constraint if exists count_sheet_rows_end_after_start;
alter table public.count_sheet_rows add constraint count_sheet_rows_end_after_start check (t_end is null or t_start is null or t_end > t_start);

notify pgrst, 'reload schema';
