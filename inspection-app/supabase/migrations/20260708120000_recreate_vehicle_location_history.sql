-- Recreate vehicle_location_history.
--
-- The original migration (20260424000001) is recorded as applied on prod, but
-- the table is ABSENT (REST returns PGRST205). Most likely it was cascade-
-- dropped when vehicle_locations was later recreated, because the original put
-- a FOREIGN KEY (stock_number) REFERENCES vehicle_locations ON DELETE CASCADE
-- on it. Since the version is already in schema_migrations, `db push` won't
-- re-run it — hence this fresh, idempotent migration.
--
-- Two corrections vs. the original (both are why re-applying it verbatim would
-- be worse than the current broken state):
--   1. NO foreign key to vehicle_locations. An audit trail must OUTLIVE the
--      parent row. The old ON DELETE CASCADE erased history on removal AND made
--      the AFTER-DELETE 'inventory_removed' insert violate its own FK (the
--      parent stock_number no longer exists), which would abort every delete on
--      vehicle_locations.
--   2. log_vehicle_location_change() is SECURITY DEFINER. The trigger fires on
--      anon/authenticated writes to vehicle_locations (run-list uploads,
--      Telegram intake). With RLS enabled on the history table, a non-definer
--      insert would be blocked and take the whole vehicle_locations write down
--      with it. DEFINER runs the insert as the table owner, bypassing RLS.

CREATE TABLE IF NOT EXISTS vehicle_location_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stock_number TEXT NOT NULL,          -- no FK: audit rows outlive the parent
  vin TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'location_change', 'marketplace_listed', 'marketplace_status',
      'marketplace_sold', 'transport_initiated', 'transport_completed',
      'service_sent', 'service_completed', 'inventory_added',
      'inventory_removed', 'manual_update', 'scan_detected', 'note_added'
    )
  ),
  previous_location TEXT,
  new_location TEXT,
  location_source TEXT,
  marketplace TEXT,
  marketplace_status TEXT,
  listing_price NUMERIC,
  sale_price NUMERIC,
  buyer_name TEXT,
  service_provider TEXT,
  service_type TEXT,
  transport_carrier TEXT,
  transport_destination TEXT,
  estimated_arrival DATE,
  event_data JSONB DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vlh_stock_number ON vehicle_location_history(stock_number);
CREATE INDEX IF NOT EXISTS idx_vlh_vin ON vehicle_location_history(vin);
CREATE INDEX IF NOT EXISTS idx_vlh_event_type ON vehicle_location_history(event_type);
CREATE INDEX IF NOT EXISTS idx_vlh_created_at ON vehicle_location_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vlh_new_location ON vehicle_location_history(new_location);

CREATE OR REPLACE FUNCTION log_vehicle_location_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO vehicle_location_history (
      stock_number, vin, event_type, new_location, location_source,
      marketplace, marketplace_status, event_data, created_by
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
      current_setting('app.current_user', true)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.physical_location IS DISTINCT FROM NEW.physical_location THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, previous_location, new_location,
        location_source, event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin, 'location_change',
        OLD.physical_location, NEW.physical_location, NEW.physical_source,
        jsonb_build_object('location_updated_at', NEW.location_updated_at, 'notes', NEW.notes),
        current_setting('app.current_user', true)
      );
    END IF;

    IF OLD.sa_status IS DISTINCT FROM NEW.sa_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, marketplace, marketplace_status,
        listing_price, sale_price, buyer_name, event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin,
        CASE WHEN NEW.sa_status = 'sold' THEN 'marketplace_sold'
             WHEN OLD.sa_status IS NULL THEN 'marketplace_listed'
             ELSE 'marketplace_status' END,
        'smart_auction', NEW.sa_status,
        (NEW.notes->>'listing_price')::numeric,
        CASE WHEN NEW.sa_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.sa_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object('previous_status', OLD.sa_status, 'updated_at', NEW.sa_updated_at),
        current_setting('app.current_user', true)
      );
    END IF;

    IF OLD.manheim_status IS DISTINCT FROM NEW.manheim_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, marketplace, marketplace_status,
        sale_price, buyer_name, event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin,
        CASE WHEN NEW.manheim_status = 'sold' THEN 'marketplace_sold'
             WHEN OLD.manheim_status IS NULL THEN 'marketplace_listed'
             ELSE 'marketplace_status' END,
        'manheim', NEW.manheim_status,
        CASE WHEN NEW.manheim_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.manheim_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object('previous_status', OLD.manheim_status, 'updated_at', NEW.manheim_updated_at),
        current_setting('app.current_user', true)
      );
    END IF;

    IF OLD.ove_status IS DISTINCT FROM NEW.ove_status THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, marketplace, marketplace_status,
        sale_price, buyer_name, event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin,
        CASE WHEN NEW.ove_status = 'sold' THEN 'marketplace_sold'
             WHEN OLD.ove_status IS NULL THEN 'marketplace_listed'
             ELSE 'marketplace_status' END,
        'ove', NEW.ove_status,
        CASE WHEN NEW.ove_status = 'sold' THEN NEW.sold_price END,
        CASE WHEN NEW.ove_status = 'sold' THEN NEW.buyer_name END,
        jsonb_build_object('previous_status', OLD.ove_status, 'updated_at', NEW.ove_updated_at),
        current_setting('app.current_user', true)
      );
    END IF;

    IF NEW.physical_location IN ('mechanic_section', 'body_shop', 'summit_tire',
                                 'pro_auto', 'upholstery', 'tri_state_glass',
                                 'city_auto', 'jim_keras_chevy_service', '901_sound')
       AND OLD.physical_location IS DISTINCT FROM NEW.physical_location THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, previous_location, new_location,
        service_provider, service_type, event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin, 'service_sent',
        OLD.physical_location, NEW.physical_location, NEW.physical_location,
        CASE
          WHEN NEW.physical_location = 'mechanic_section' THEN 'mechanic'
          WHEN NEW.physical_location = 'body_shop' THEN 'body_shop'
          WHEN NEW.physical_location IN ('upholstery', '901_sound') THEN 'upholstery'
          WHEN NEW.physical_location = 'tri_state_glass' THEN 'glass'
          ELSE 'service'
        END,
        NEW.notes, current_setting('app.current_user', true)
      );
    END IF;

    IF NEW.physical_location = 'in_transit' AND OLD.physical_location != 'in_transit' THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, previous_location, new_location,
        transport_destination, event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin, 'transport_initiated',
        OLD.physical_location, NEW.physical_location,
        NEW.notes->>'destination', NEW.notes, current_setting('app.current_user', true)
      );
    ELSIF OLD.physical_location = 'in_transit' AND NEW.physical_location != 'in_transit' THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, previous_location, new_location,
        event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin, 'transport_completed',
        OLD.physical_location, NEW.physical_location,
        NEW.notes, current_setting('app.current_user', true)
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
      current_setting('app.current_user', true)
    );
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_location_history_trigger ON vehicle_locations;
CREATE TRIGGER vehicle_location_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_locations
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_location_change();

-- RLS: read-only for anon + authenticated (the app reads with the anon key).
-- Inserts happen only through the SECURITY DEFINER trigger, so no write policy
-- is needed (and none is granted, so REST clients can't forge history rows).
ALTER TABLE vehicle_location_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can read vehicle_location_history" ON vehicle_location_history;
CREATE POLICY "Anon can read vehicle_location_history"
  ON vehicle_location_history FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Authenticated can read vehicle_location_history" ON vehicle_location_history;
CREATE POLICY "Authenticated can read vehicle_location_history"
  ON vehicle_location_history FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
