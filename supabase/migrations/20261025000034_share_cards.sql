-- Progress cards: anyone on a project can turn its takes into a progress image for Instagram and the like.
-- The owner can switch that off for a project (say, choreography that's secret until a competition).
-- The image is made on the device; nothing new is stored. Only this switch lives in the database.

alter table public.projects add column if not exists allow_share_cards boolean not null default true;
