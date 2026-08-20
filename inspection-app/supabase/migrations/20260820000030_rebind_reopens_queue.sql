-- Moving photos onto the right car must not hide that car.
--
-- P06498 was a slip; the car is P60498, a 2019 BMW X6. The rebind moved 27
-- photographs onto it correctly — and the car promptly vanished from the
-- extension's list, because an earlier SmartAuction upload had stamped it
-- 'listed' and the queue only shows 'queued'. From the user's side, correcting
-- a VIN deleted the car.
--
-- rebind_intake_vin6 kept the destination's status on the reasoning that a
-- status set about a real car outranks one set about a number that turned out to
-- be nobody. That is right about hold/removed and wrong about the whole point of
-- the action: photographs have just been attached to this car, which is the
-- definition of it being ready to list again.
--
-- The Telegram pipeline already settled this question — sa_queue_reopen_on_intake
-- exists because "somebody is re-shooting this car, so it belongs back in the
-- ready-to-list view even if a SmartAuction upload once stamped it hold/removed".
-- A rebind is the same event arriving by a different door.

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

  -- The odometer that was really the VIN — see 20260819000022.
  UPDATE wa_inbound_messages
     SET parsed = parsed - 'miles'
   WHERE upper(vin6) = v_to
     AND parsed ? 'miles'
     AND ltrim(regexp_replace(COALESCE(parsed ->> 'miles', ''), '\D', '', 'g'), '0')
       = ltrim(regexp_replace(v_to, '\D', '', 'g'), '0');
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  -- The car now has photographs that were just attached to it, so it belongs in
  -- the ready-to-list view whatever an older upload said about it. Both rows
  -- collapse to one queued entry: the source status goes with the intake it
  -- described, and the destination is reopened.
  DELETE FROM sa_queue_status WHERE vin6 = v_from;
  INSERT INTO sa_queue_status (vin6, status, updated_at)
  VALUES (v_to, 'queued', now())
  ON CONFLICT (vin6) DO UPDATE SET status = 'queued', updated_at = now();

  RETURN QUERY SELECT v_msgs, v_photos, v_fixed > 0, v_stock;
END;
$$;

REVOKE ALL ON FUNCTION rebind_intake_vin6(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rebind_intake_vin6(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
