-- The app uses create_request_v2 (groups, weekly repeat); drop the first version so it isn't callable.
drop function if exists public.create_request(uuid, text, text, timestamptz, uuid[], uuid);
