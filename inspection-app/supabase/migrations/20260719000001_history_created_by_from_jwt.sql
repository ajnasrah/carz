-- Populate vehicle_location_history.created_by.
--
-- Nothing in the codebase ever set `app.current_user`, so created_by was NULL
-- on every history row — the timeline could show WHAT changed and WHEN but not
-- WHO. Rather than thread a user id through every write path (client upserts,
-- scraper uploads, Telegram intake, mark-sold RPCs), we derive the actor from
-- the request JWT that PostgREST already exposes as `request.jwt.claims`:
--   * Authenticated user writes (manual edit, bulk edit) carry the user's JWT,
--     so we get their email.
--   * Anon-key writes (run-list uploads, Telegram) have no user — we fall back
--     to the row's physical_source (e.g. 'lot_scan', 'telegram', 'bulk_manual'),
--     then to 'system'. That's accurate attribution, not a blank.
--
-- Only the created_by expressions change; all event logic is identical to
-- 20260708120000. CREATE OR REPLACE keeps the existing trigger binding, so no
-- trigger DROP/CREATE is needed.

CREATE OR REPLACE FUNCTION log_vehicle_location_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      COALESCE(actor, NEW.physical_source, 'system')
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
        COALESCE(actor, NEW.physical_source, 'system')
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
        COALESCE(actor, 'smart_auction')
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
        COALESCE(actor, 'manheim')
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
        COALESCE(actor, 'ove')
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
        NEW.notes, COALESCE(actor, NEW.physical_source, 'system')
      );
    END IF;

    IF NEW.physical_location = 'in_transit' AND OLD.physical_location != 'in_transit' THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, previous_location, new_location,
        transport_destination, event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin, 'transport_initiated',
        OLD.physical_location, NEW.physical_location,
        NEW.notes->>'destination', NEW.notes, COALESCE(actor, NEW.physical_source, 'system')
      );
    ELSIF OLD.physical_location = 'in_transit' AND NEW.physical_location != 'in_transit' THEN
      INSERT INTO vehicle_location_history (
        stock_number, vin, event_type, previous_location, new_location,
        event_data, created_by
      ) VALUES (
        NEW.stock_number, NEW.vin, 'transport_completed',
        OLD.physical_location, NEW.physical_location,
        NEW.notes, COALESCE(actor, NEW.physical_source, 'system')
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

NOTIFY pgrst, 'reload schema';
