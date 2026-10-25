-- Count sheet references: remember which take a reference time was taken from, so opening it later
-- (when newer takes exist) can move it to the same moment in the latest take.
alter table public.count_sheet_rows add column take_id uuid references public.takes (id) on delete set null;
create index count_sheet_rows_take_idx on public.count_sheet_rows (take_id);
