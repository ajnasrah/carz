-- A car that leaves the body shop leaves the body shop board.
--
-- The dashboard tally and the board answered to different things. shop_tally_now()
-- counts cars by where they ARE (vehicle_locations.physical_location), so moving a
-- car off Jorge's drops it from the tile immediately. The board reads
-- body_shop_board, which is body_shop_jobs joined to inventory and parts and never
-- looks at a location at all — so the same car kept its card, with its age clock
-- still running, until somebody marked it Done by hand or posted the VIN in the
-- Telegram body_shop_out group.
--
-- Every other way a car leaves — a lot scan, a bulk edit, a Super Dispatch row, a
-- run-list upload, a transport keyword in the group chat — moved the car and left
-- the job open. The board slowly filled with cars that had gone home.
--
-- So: the same close that body_shop_out already performs, fired by the move
-- itself. One trigger, and the two surfaces can no longer disagree.

-- ---------------------------------------------------------------- close by stock
--
-- close_body_shop_job() resolved a VIN's last 6 back to a stock number to find the
-- job. A trigger on vehicle_locations already HAS the stock number, and going back
-- through the last 6 would be worse than redundant: two cars on this lot can share
-- a last 6 (that is why run-list matching insists on the full 17), and closing the
-- wrong car's job is not a mistake anyone would catch. So the stock number can now
-- be passed in directly and is preferred when present; the vin6 path stays for
-- fresh buys, whose job exists before Frazer has ever heard of the car.
--
-- DROP first, deliberately: adding a defaulted third argument with CREATE OR
-- REPLACE would leave the old two-argument function in place alongside it, and
-- every existing two-argument call — including the Telegram webhook's — would fail
-- as ambiguous rather than resolving to either one.
DROP FUNCTION IF EXISTS close_body_shop_job(TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION close_body_shop_job(
  p_vin6  TEXT,
  p_event TIMESTAMPTZ DEFAULT NOW(),
  p_stock TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock   TEXT;
  v_id      UUID;
  v_entered TIMESTAMPTZ;
BEGIN
  v_stock := nullif(btrim(coalesce(p_stock, '')), '');
  IF v_stock IS NULL AND p_vin6 IS NOT NULL THEN
    SELECT stock_number INTO v_stock FROM lookup_vin_by_last6(p_vin6) LIMIT 1;
  END IF;

  SELECT id, entered_at INTO v_id, v_entered
  FROM body_shop_jobs
  WHERE status <> 'done'
    AND (
      (v_stock IS NOT NULL AND stock_number = v_stock)
      OR (p_vin6 IS NOT NULL AND upper(COALESCE(vin6, '')) = upper(p_vin6))
    )
  ORDER BY entered_at ASC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;   -- never went to the body shop, or already closed
  END IF;

  -- The event time, not now(), so "days in shop" measures the real stay even when
  -- a webhook is retried hours later — but never EARLIER than the car arrived. A
  -- backdated move (a dispatch row landing late) would otherwise stamp a job as
  -- finished before it started, which reads as a zero-day stay on a car that sat
  -- there a fortnight.
  UPDATE body_shop_jobs
  SET status       = 'done',
      completed_at = GREATEST(COALESCE(p_event, NOW()), v_entered)
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_body_shop_job(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION close_body_shop_job(TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------- the trigger
--
-- AFTER, not BEFORE: the recency guard (trg_location_recency) runs BEFORE UPDATE
-- and can put the location trio back the way it was when an older event tries to
-- move a car. Reading NEW after that means a move that lost never closes a job.
--
-- Never throws. A failure to close a job must not roll back the location write —
-- knowing where the car is matters more than the board being tidy, and the
-- webhook, the lot scan and the list uploader all treat a location write as the
-- thing they came to do.
CREATE OR REPLACE FUNCTION close_body_shop_job_on_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vin6 TEXT;
BEGIN
  -- Only a car that WAS at the body shop and now is not. 'jorge' is the same
  -- physical place under a second slug (shop_locations('body_shop') agrees), so
  -- jorge → body_shop is not a departure.
  IF COALESCE(OLD.physical_location, '') NOT IN ('body_shop', 'jorge') THEN RETURN NULL; END IF;
  IF COALESCE(NEW.physical_location, '') IN ('body_shop', 'jorge') THEN RETURN NULL; END IF;

  v_vin6 := nullif(upper(right(COALESCE(NULLIF(NEW.vin, ''), ''), 6)), '');

  BEGIN
    PERFORM close_body_shop_job(v_vin6, COALESCE(NEW.location_updated_at, NOW()), NEW.stock_number);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'close_body_shop_job_on_move(%): %', NEW.stock_number, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_body_shop_job_on_move ON vehicle_locations;
CREATE TRIGGER trg_close_body_shop_job_on_move
  AFTER UPDATE OF physical_location ON vehicle_locations
  FOR EACH ROW
  WHEN (OLD.physical_location IS DISTINCT FROM NEW.physical_location)
  EXECUTE FUNCTION close_body_shop_job_on_move();

COMMENT ON FUNCTION close_body_shop_job_on_move() IS
'Closes a car''s open body shop job when its physical_location moves off
body_shop/jorge, so the dashboard tally (which counts by location) and the body
shop board (which reads job status) cannot disagree. Stamps completed_at with the
location event time, floored at the job''s entered_at.';

-- ---------------------------------------------------------------- catch-up
--
-- Every car already gone. Closed at the time it actually left — its location
-- event — rather than now(), so the days-in-shop figures on the finished list
-- stay true instead of every one of these reading as finished today.
--
-- Jobs with no stock number are fresh buys that inventory has never seen; there
-- is no location row to judge them by, so they stay open, which is right.
DO $$
DECLARE
  r RECORD;
  v_id UUID;
  n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT j.id, j.stock_number, vl.physical_location, vl.location_updated_at
    FROM body_shop_jobs j
    JOIN vehicle_locations vl ON vl.stock_number = j.stock_number
    WHERE j.status <> 'done'
      AND COALESCE(vl.physical_location, '') NOT IN ('body_shop', 'jorge')
    ORDER BY j.entered_at
  LOOP
    v_id := close_body_shop_job(NULL, COALESCE(r.location_updated_at, NOW()), r.stock_number);
    IF v_id IS NOT NULL THEN
      n := n + 1;
      RAISE NOTICE 'closed job for stock % — now at %', r.stock_number, COALESCE(r.physical_location, '(none)');
    END IF;
  END LOOP;
  RAISE NOTICE 'body shop catch-up: closed % job(s) whose car had already left', n;
END $$;

NOTIFY pgrst, 'reload schema';
