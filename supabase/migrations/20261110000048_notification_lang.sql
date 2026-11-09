-- The app language each person uses (Settings > Language), saved by the app like their time zone, so emails can
-- follow it later. Nothing reads it yet; English stays the default.
alter table public.notification_settings add column if not exists lang text not null default 'en'
  check (lang in ('en', 'ko'));
