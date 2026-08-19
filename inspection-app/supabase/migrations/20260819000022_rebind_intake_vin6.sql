-- Move an intake onto the car it was actually about.
--
-- A worker posted a ready-to-sell message with the VIN on the SECOND line:
--
--     73893          <- not a car; a slip
--     437541         <- the car (2023 Tesla Model 3, stock 08-137-26)
--     9/10
--     Tires are Great
--     Light abrasion
--
-- The parser takes line 1 as the VIN and line 2 as the odometer, so the intake
-- filed itself under 073893 — a car that does not exist — with 437,541 miles,
-- which is the VIN. Thirty photographs went with it. The Tesla shows nothing:
-- no photos on the marketplace, nothing in the extension's queue.
--
-- Everything downstream keys on vin6 — the queue, ready_to_sell_photos(), the
-- marketplace's rts photo injection — so ONE column decides which car owns those
-- photographs, and nothing could change it. Typing the right last 6 into the
-- extension found the car but left the pictures behind, because the pictures were
-- never the car's; they belonged to a number.
--
-- So: move them. This is the repair. The prevention is in api/telegram.js, which
-- now checks a parsed VIN against inventory before believing it.

CREATE OR REPLACE FUNCTION rebind_intake_vin6(p_from text, p_to text)
RETURNS TABLE (messages integer, photos integer, miles_dropped boolean, stock_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from    text := upper(regexp_replace(COALESCE(p_from, ''), '[^0-9A-Za-z]', '', 'g'));
  v_to      text := upper(regexp_replace(COALESCE(p_to, ''), '[^0-9A-Za-z]', '', 'g'));
  v_stock   text;
  v_msgs    integer := 0;
  v_photos  integer := 0;
  v_fixed   integer := 0;
BEGIN
  IF length(v_from) <> 6 OR length(v_to) <> 6 THEN
    RAISE EXCEPTION 'Both VINs must be exactly the last 6 (got % and %)', v_from, v_to;
  END IF;
  IF v_from = v_to THEN
    RAISE EXCEPTION 'That intake is already filed under %', v_to;
  END IF;

  -- The target must be a real car. This is the whole safety model: the anon key
  -- can call this (the extension is where the mistake is noticed, and it holds
  -- nothing else), so the damage anyone can do is bounded to moving an intake
  -- onto a car we actually own — which is the only thing the button is for.
  SELECT s.stock_number INTO v_stock FROM lookup_vin_by_last6(v_to) s LIMIT 1;
  IF v_stock IS NULL THEN
    RAISE EXCEPTION '% is not in inventory — check the last 6', v_to;
  END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE media_path IS NOT NULL)::int
    INTO v_msgs, v_photos
    FROM wa_inbound_messages WHERE upper(vin6) = v_from;

  IF v_msgs = 0 THEN
    RAISE EXCEPTION 'Nothing filed under % to move', v_from;
  END IF;

  UPDATE wa_inbound_messages SET vin6 = v_to WHERE upper(vin6) = v_from;

  -- The odometer that was really the VIN. When the number on the miles line is
  -- the same number we just moved the car to, it was never a reading — it was
  -- the worker typing the VIN on the wrong line, and left alone it would go to
  -- SmartAuction as a 437,541-mile Tesla. Compared without leading zeros because
  -- a 5-digit slip gets padded to 6 on the way in.
  UPDATE wa_inbound_messages
     SET parsed = parsed - 'miles'
   WHERE upper(vin6) = v_to
     AND parsed ? 'miles'
     AND ltrim(regexp_replace(COALESCE(parsed ->> 'miles', ''), '\D', '', 'g'), '0')
       = ltrim(regexp_replace(v_to, '\D', '', 'g'), '0');
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  -- Whatever the extension had done with the wrong number (held it, skipped it)
  -- goes with it, unless the right car already has a status of its own — that
  -- one was set deliberately about the real car and outranks a status set about
  -- a number that turned out to be nobody.
  IF EXISTS (SELECT 1 FROM sa_queue_status WHERE vin6 = v_to) THEN
    DELETE FROM sa_queue_status WHERE vin6 = v_from;
  ELSE
    UPDATE sa_queue_status SET vin6 = v_to, updated_at = now() WHERE vin6 = v_from;
  END IF;

  RETURN QUERY SELECT v_msgs, v_photos, v_fixed > 0, v_stock;
END;
$$;

REVOKE ALL ON FUNCTION rebind_intake_vin6(text, text) FROM PUBLIC;
-- anon, matching sa_queue_set_status: the extension ships the anon key and is
-- the surface where a misfiled intake is spotted. The inventory check above is
-- what makes that safe.
GRANT EXECUTE ON FUNCTION rebind_intake_vin6(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
