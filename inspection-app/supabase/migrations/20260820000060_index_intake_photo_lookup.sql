-- The marketplace was one busy minute away from not loading at all.
--
-- marketplace_listings() injects each car's Telegram photos, and both halves of
-- that — the photo map and the "when were we last sent one" timestamp — look up
-- wa_inbound_messages like this:
--
--     WHERE upper(w.vin6) = upper(<the car>) AND w.station = 'ready'
--
-- There is no index that serves it. Worse, there could not be: `upper(vin6)` is
-- an expression, so a plain index on vin6 is not usable for this predicate at
-- all. Every car on the marketplace therefore triggered two sequential scans of
-- the whole message table — around 118 of them for one page load, which is why
-- the RPC sat at ~2.8s against a 5s statement timeout. Under any real load it
-- tipped over: 57014, canceling statement due to statement timeout, and a
-- marketplace that simply does not load.
--
-- An expression index on exactly what the predicate asks for. Not partial:
-- rts_last_seen() reads messages with no media_path (a text-only "ready" post
-- still dates the car), so a WHERE media_path IS NOT NULL index would serve the
-- photo half and quietly skip the other.
CREATE INDEX IF NOT EXISTS idx_wa_inbound_vin6_station
  ON wa_inbound_messages (upper(vin6), station);

ANALYZE wa_inbound_messages;
