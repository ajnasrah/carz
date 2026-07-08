-- Fix: extension damage-sync rows were polluting the extension's "Ready to List"
-- queue.
--
-- Background: upsert_listing_damages (Feature A) saves damages typed in the
-- SmartAuction auto-fill extension into inspections.checklist so they render on
-- the public marketplace. When no PWA inspection exists for the VIN yet, it
-- CREATES one. It previously created that row with status='complete', which made
-- it indistinguishable from a real, finished PWA inspection — so the extension's
-- "Ready to List" tab (which lists status='complete' rows) showed these
-- marketplace-only cars as if they were awaiting listing. But you only ever enter
-- SA damages for a car that is ALREADY being listed, so it never belonged there.
--
-- Why status='listed' is the right marker:
--   * type is CHECK-constrained to ('inbound','outbound'), so we cannot tag these
--     with a new type — status is the free dimension.
--   * The marketplace RPCs (marketplace_listings / marketplace_listing_detail)
--     join inspections purely on `completed_at IS NOT NULL` + VIN/stock match —
--     they do NOT filter on status. So switching these rows to 'listed' keeps the
--     damages showing on the marketplace, unchanged.
--   * The extension "Ready to List" query filters status=eq.complete, so 'listed'
--     rows drop out of the queue with zero extension code changes.
--   * 'listed' is semantically accurate: syncing SA damages == the car is listed.
--
-- This migration: (1) backfills the already-leaked synthetic rows, and
-- (2) replaces the RPC so future INSERTs use status='listed'. The UPDATE branch
-- (a real PWA inspection getting SA damages merged in) is left untouched.

-- ── (1) Backfill existing synthetic rows ──────────────────────────────────────
-- Synthetic = created by the RPC, which never sets user_id. Every real PWA
-- inspection sets user_id at creation (StartInspection), so user_id IS NULL is a
-- reliable discriminator. completed_at is already set on these, so the marketplace
-- keeps showing them.
UPDATE inspections
   SET status = 'listed'
 WHERE status = 'complete'
   AND user_id IS NULL;

-- ── (2) Replace the RPC: new synthetic rows get status='listed' ───────────────
CREATE OR REPLACE FUNCTION upsert_listing_damages(p_vin text, p_exterior jsonb, p_interior jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clean text := upper(regexp_replace(COALESCE(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  v_last6 text;
  v_id uuid;
  v_checklist jsonb;
  v_ext jsonb;
  v_int jsonb;
  v_stock text;
  v_full text;
BEGIN
  IF length(v_clean) < 6 THEN RETURN 'bad_vin'; END IF;
  v_last6 := right(v_clean, 6);

  SELECT id, COALESCE(checklist, '{}'::jsonb) INTO v_id, v_checklist
  FROM inspections
  WHERE vin_last6 = v_last6 OR upper(right(vin, 6)) = v_last6
  ORDER BY completed_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  -- Nothing to save and no existing row → don't create an empty inspection.
  IF v_id IS NULL
     AND COALESCE(p_exterior, '{}'::jsonb) = '{}'::jsonb
     AND COALESCE(p_interior, '{}'::jsonb) = '{}'::jsonb THEN
    RETURN 'skipped';
  END IF;

  -- Keep PWA-entered damages (any key NOT starting 'sa_'), swap in the fresh 'sa_' set.
  v_ext := COALESCE((SELECT jsonb_object_agg(k, val)
                     FROM jsonb_each(COALESCE(v_checklist -> 'exterior', '{}'::jsonb)) AS e(k, val)
                     WHERE k NOT LIKE 'sa\_%'), '{}'::jsonb) || COALESCE(p_exterior, '{}'::jsonb);
  v_int := COALESCE((SELECT jsonb_object_agg(k, val)
                     FROM jsonb_each(COALESCE(v_checklist -> 'interior', '{}'::jsonb)) AS e(k, val)
                     WHERE k NOT LIKE 'sa\_%'), '{}'::jsonb) || COALESCE(p_interior, '{}'::jsonb);

  IF v_id IS NULL THEN
    SELECT stock_number, vehicle_vin INTO v_stock, v_full
    FROM inventory
    WHERE upper(right(vehicle_vin, 6)) = v_last6 OR last_6_vin = v_last6
    LIMIT 1;

    -- status='listed' (not 'complete'): the marketplace surfaces this via
    -- completed_at, but the extension's "Ready to List" queue (status=complete)
    -- correctly ignores it — this car is already being listed on SmartAuction.
    INSERT INTO inspections (type, status, vin, vin_last6, stock_number, checklist, completed_at)
    VALUES ('inbound', 'listed',
      COALESCE(v_full, CASE WHEN length(v_clean) >= 11 THEN v_clean ELSE v_last6 END),
      v_last6,
      COALESCE(v_stock, v_last6),
      jsonb_build_object('v', 2, 'exterior', v_ext, 'interior', v_int,
                         'photos', COALESCE(v_checklist -> 'photos', '{}'::jsonb)),
      now());
    RETURN 'created';
  ELSE
    UPDATE inspections
      SET checklist = jsonb_set(jsonb_set(COALESCE(checklist, '{}'::jsonb), '{exterior}', v_ext), '{interior}', v_int),
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
    WHERE id = v_id;
    RETURN 'updated';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_listing_damages(text, jsonb, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
