-- Separate private bucket for REFERENCE photos from location/transport groups
-- (body shop, mechanic, transport key-tags, etc.). These are kept for the car's
-- history/backend only and must NEVER feed the marketplace listing — listing
-- photos live in wa-photos and come only from the ready-to-sell intake group.
--
-- Retrieve a car's history photos with:
--   select station, media_path, received_at from wa_inbound_messages
--   where vin6 = :v and station in ('body_shop','mechanic','transport')
--         and media_path is not null order by received_at;
--   -> fetch each from the car-history bucket.
INSERT INTO storage.buckets (id, name, public)
VALUES ('car-history', 'car-history', false)
ON CONFLICT (id) DO NOTHING;
