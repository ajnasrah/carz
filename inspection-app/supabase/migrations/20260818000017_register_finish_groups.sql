-- Wire the two finish groups to their stations.
--
-- Ids read from tg_unknown_chats after the bot was added and each group posted:
--   -5507317053  "Carz out of Body Shop"
--   -5450209322  "Washline carz"
--
-- location_code stays NULL for both. Unlike body_shop/mechanic — where the group
-- IS the place the car now sits — these groups say a car has LEFT: where it goes
-- next is the station's meaning, not the group's, and it lives in FINISH_STATIONS
-- in api/telegram.js (body_shop_out → wash_line, wash_line → front).

INSERT INTO tg_chats (chat_id, station, location_code, label, active) VALUES
  (-5507317053, 'body_shop_out', NULL, 'Carz out of Body Shop', true),
  (-5450209322, 'wash_line',     NULL, 'Washline carz',         true)
ON CONFLICT (chat_id) DO UPDATE
  SET station = EXCLUDED.station,
      label   = EXCLUDED.label,
      active  = true;

-- They're known groups now, so stop listing them as strays.
DELETE FROM tg_unknown_chats WHERE chat_id IN (-5507317053, -5450209322);

NOTIFY pgrst, 'reload schema';
