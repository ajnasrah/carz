-- Confirm or release a reservation, in one step.
--
-- Reserving hides the car; releasing has to un-hide it. Those are two tables, and
-- doing them as two calls from the browser means a failure between them leaves a
-- car released on paper and still invisible on the marketplace — permanently, and
-- with nothing on screen saying so. There was no way to release at all before
-- this: the RLS policy allowed an admin UPDATE and nothing ever called it, so a
-- reservation you turned down left the car hidden forever.
CREATE OR REPLACE FUNCTION decide_car_reservation(p_id uuid, p_status text)
RETURNS TABLE (id uuid, status text, stock_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_status NOT IN ('confirmed', 'released') THEN
    RAISE EXCEPTION 'status must be confirmed or released';
  END IF;

  UPDATE car_reservations r
     SET status      = p_status,
         released_at = CASE WHEN p_status = 'released' THEN NOW() ELSE r.released_at END,
         decided_by  = auth.uid()
   WHERE r.id = p_id
     AND r.status IN ('reserved', 'confirmed')
  RETURNING r.stock_number INTO v_stock;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'That reservation is no longer open';
  END IF;

  -- Back on the market only when it is let go. A confirmed car stays hidden —
  -- it is sold, not available.
  IF p_status = 'released' THEN
    DELETE FROM marketplace_hidden WHERE stock_number = v_stock;
  END IF;

  RETURN QUERY SELECT p_id, p_status, v_stock;
END $$;
REVOKE ALL ON FUNCTION decide_car_reservation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION decide_car_reservation(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
