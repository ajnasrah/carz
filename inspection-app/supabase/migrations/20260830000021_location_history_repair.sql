-- The per-car location history was wrong in four separate ways at once. All of
-- them live in log_vehicle_location_change(), which this replaces.
--
-- What was measured on prod before writing this:
--
--   1. ONE MOVE, UP TO THREE ROWS. The trigger had four independent IF blocks
--      that could all fire on the same UPDATE. 348 real moves were stored as
--      769 rows — 73 of them as three rows sharing a timestamp (a car leaving
--      transit for the body shop logged "Location Changed", "Sent to Service"
--      AND "Transport Completed"). The timeline drew each as its own bullet.
--
--   2. TRANSPORT STARTS WERE SILENTLY DROPPED — 26 recorded against 182
--      completions. The guard read `OLD.physical_location != 'in_transit'`,
--      and `NULL != 'in_transit'` is NULL, not true. Every car whose first
--      known location was in transit got an end with no beginning.
--
--   3. "LISTED" WAS LOGGED FOR CARS BEING REMOVED. The event type came from
--      `WHEN OLD.status IS NULL THEN 'marketplace_listed'` — a transition FROM
--      nothing was called a listing whatever it went TO, so `None -> removed`
--      rendered as "Listed on Manheim".
--
--   4. EVENTS WERE STAMPED WHEN THE ROW WAS WRITTEN, NOT WHEN THE MOVE
--      HAPPENED. The table had only created_at DEFAULT now(); the true time sat
--      unread in event_data->>'location_updated_at'. 27 of 38 Super Dispatch
--      moves were more than an hour out, which puts them in the wrong ORDER on
--      a timeline — the one thing a timeline exists to get right.
--
-- The fix for (1) is the one worth stating plainly: a physical move is ONE
-- event. "Sent to service" and "transport started" were never separate things
-- that happened to the car — they were the same move, described twice, using a
-- hardcoded list of nine shop names that had already rotted (location_keywords
-- carries 47 locations today, so 30-odd shops never matched it at all). In
-- transit is itself a location, so "Front -> In transit" followed by
-- "In transit -> Body Shop" already tells the whole story, in the right order,
-- with no list to maintain.

-- ---------------------------------------------------------------- event_at
--
-- When it HAPPENED, as opposed to when we heard about it. Every source that
-- knows the real time already passes it as location_updated_at; the history
-- table just never kept it.

ALTER TABLE vehicle_location_history
  ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ;

-- Backfill from what the old rows were already carrying, so the existing
-- timeline reorders itself correctly instead of only new events being right.
UPDATE vehicle_location_history
   SET event_at = COALESCE(
         NULLIF(event_data->>'location_updated_at', '')::timestamptz,
         NULLIF(event_data->>'updated_at', '')::timestamptz,
         created_at)
 WHERE event_at IS NULL;

ALTER TABLE vehicle_location_history
  ALTER COLUMN event_at SET DEFAULT NOW();
ALTER TABLE vehicle_location_history
  ALTER COLUMN event_at SET NOT NULL;

-- The timeline reads one car newest-first and nothing else.
CREATE INDEX IF NOT EXISTS idx_vlh_stock_event_at
  ON vehicle_location_history (stock_number, event_at DESC);

-- ---------------------------------------------------------------- event types
--
-- Two additions. 'marketplace_removed' is what (3) was mislabelling as a
-- listing. 'runlist_unconfirmed' is new — see below.
ALTER TABLE vehicle_location_history DROP CONSTRAINT IF EXISTS vehicle_location_history_event_type_check;
ALTER TABLE vehicle_location_history ADD CONSTRAINT vehicle_location_history_event_type_check
  CHECK (event_type IN (
    'location_change', 'marketplace_listed', 'marketplace_status',
    'marketplace_sold', 'marketplace_removed', 'runlist_unconfirmed',
    'transport_initiated', 'transport_completed', 'service_sent',
    'service_completed', 'inventory_added', 'inventory_removed',
    'manual_update', 'scan_detected', 'note_added'));

-- ------------------------------------------------- naming a marketplace event
--
-- Defect (3) in one function, so all three marketplaces answer it identically.
-- The old CASE asked only where the status came FROM; what the event IS depends
-- on where it went TO.
CREATE OR REPLACE FUNCTION marketplace_event_type(p_old TEXT, p_new TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_new = 'sold' THEN 'marketplace_sold'
    -- Off the marketplace: either explicitly removed, or the feed stopped
    -- carrying the car and the sync nulled the column. Both mean the listing
    -- is gone, and neither is a listing being created.
    WHEN p_new IS NULL OR p_new IN ('removed', 'deleted', 'ended', 'expired')
      THEN 'marketplace_removed'
    -- A genuine first listing: nothing before, something live now.
    WHEN p_old IS NULL THEN 'marketplace_listed'
    ELSE 'marketplace_status'
  END;
$$;

REVOKE ALL ON FUNCTION marketplace_event_type(TEXT, TEXT) FROM PUBLIC;

-- ---------------------------------------------------------------- the trigger

CREATE OR REPLACE FUNCTION log_vehicle_location_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Human actor from the JWT, if this write carries one. NULLIF guards the
  -- empty-string case (no JWT) so the ::json cast never sees invalid input.
  claims JSON := NULLIF(current_setting('request.jwt.claims', true), '')::json;
  actor TEXT := COALESCE(
    claims->>'email',
    claims->>'sub',
    current_setting('app.current_user', true)
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO vehicle_location_history (
      stock_number, vin, event_type, new_location, location_source,
      marketplace, marketplace_status, event_data, created_by, event_at
    ) VALUES (
      NEW.stock_number, NEW.vin, 'inventory_added',
      NEW.physical_location, NEW.physical_source,
      CASE
        WHEN NEW.sa_status IS NOT NULL THEN 'smart_auction'
        WHEN NEW.manheim_status IS NOT NULL THEN 'manheim'
        WHEN NEW.ove_status IS NOT NULL THEN 'ove'
      END,
      COALESCE(NEW.sa_status, NEW.manheim_status, NEW.ove_status),
      jsonb_build_object('initial_record', true, 'notes', NEW.notes),
      COALESCE(actor, NEW.physical_source, 'system'),
      COALESCE(NEW.location_updated_at, NOW())
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- ONE row per physical move. Not one per way of describing it.
    IF OLD.physical_location IS DISTINCT FROM NEW.physical_location THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, previous_location, new_location,
        location_source, event_data, created_by, event_at
      ) VALUES (
        NEW.stock_number, NEW.vin, 'location_change',
        OLD.physical_location, NEW.physical_location, NEW.physical_source,
        jsonb_build_object('location_updated_at', NEW.location_updated_at,
                           'notes', NEW.notes),
        COALESCE(actor, NEW.physical_source, 'system'),
        -- The move's own time. now() only when nothing knows better.
        COALESCE(NEW.location_updated_at, NOW())
      );
    END IF;

    IF OLD.sa_status IS DISTINCT FROM NEW.sa_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, marketplace, marketplace_status,
        listing_price, sale_price, buyer_name, event_data, created_by, event_at
      ) VALUES (
        NEW.stock_number, NEW.vin,
        marketplace_event_type(OLD.sa_status, NEW.sa_status),
        'smart_auction', NEW.sa_status,
        (NEW.notes->>'listing_price')::numeric,
        CASE WHEN NEW.sa_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.sa_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object('previous_status', OLD.sa_status, 'updated_at', NEW.sa_updated_at),
        COALESCE(actor, 'smart_auction'),
        COALESCE(NEW.sa_updated_at, NOW())
      );
    END IF;

    IF OLD.manheim_status IS DISTINCT FROM NEW.manheim_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, marketplace, marketplace_status,
        sale_price, buyer_name, event_data, created_by, event_at
      ) VALUES (
        NEW.stock_number, NEW.vin,
        marketplace_event_type(OLD.manheim_status, NEW.manheim_status),
        'manheim', NEW.manheim_status,
        CASE WHEN NEW.manheim_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.manheim_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object('previous_status', OLD.manheim_status, 'updated_at', NEW.manheim_updated_at),
        COALESCE(actor, 'manheim'),
        COALESCE(NEW.manheim_updated_at, NOW())
      );
    END IF;

    IF OLD.ove_status IS DISTINCT FROM NEW.ove_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, marketplace, marketplace_status,
        sale_price, buyer_name, event_data, created_by, event_at
      ) VALUES (
        NEW.stock_number, NEW.vin,
        marketplace_event_type(OLD.ove_status, NEW.ove_status),
        'ove', NEW.ove_status,
        CASE WHEN NEW.ove_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.ove_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object('previous_status', OLD.ove_status, 'updated_at', NEW.ove_updated_at),
        COALESCE(actor, 'ove'),
        COALESCE(NEW.ove_updated_at, NOW())
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO vehicle_location_history (
      stock_number, vin, event_type, previous_location, event_data, created_by
    ) VALUES (
      OLD.stock_number, OLD.vin, 'inventory_removed', OLD.physical_location,
      jsonb_build_object('final_status', jsonb_build_object(
        'sa_status', OLD.sa_status, 'manheim_status', OLD.manheim_status,
        'ove_status', OLD.ove_status, 'sold_on', OLD.sold_on, 'sold_price', OLD.sold_price
      )),
      COALESCE(actor, OLD.physical_source, 'system')
    );
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------- off the run list
--
-- A car that drops off an auction's run list has NOT moved. It is still sitting
-- at DAA; the list just didn't mention it this week. The extension's
-- clearStaleForSource() was recording that as a move — physical_location set to
-- the string 'unknown' and physical_source wiped — which is how 228 of 1497
-- location changes came to read "daa -> unknown", an arrow pointing at a place
-- that doesn't exist.
--
-- This records the truth instead: the location stands, and the gap in tracking
-- is its own event. location_updated_at is deliberately NOT bumped — the last
-- time we actually confirmed the car is exactly what the aging figures need.
CREATE OR REPLACE FUNCTION mark_off_run_list(p_stocks TEXT[], p_source TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT := 0;
  r RECORD;
BEGIN
  IF p_stocks IS NULL OR array_length(p_stocks, 1) IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT stock_number, vin, physical_location, location_updated_at
      FROM vehicle_locations
     WHERE stock_number = ANY(p_stocks)
       AND physical_source = p_source
  LOOP
    INSERT INTO vehicle_location_history (
      stock_number, vin, event_type, previous_location, new_location,
      location_source, event_data, created_by, event_at
    ) VALUES (
      r.stock_number, r.vin, 'runlist_unconfirmed',
      r.physical_location, r.physical_location, p_source,
      jsonb_build_object('run_list', p_source,
                         'last_confirmed_at', r.location_updated_at),
      p_source, NOW()
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION mark_off_run_list(TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_off_run_list(TEXT[], TEXT) TO authenticated;
