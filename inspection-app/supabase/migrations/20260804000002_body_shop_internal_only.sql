-- Lock the body shop + car photo surface to signed-in staff.
--
-- 20260804000001 granted these to `anon` by reflex, copying list_all_inventory()
-- — but that RPC is granted to anon for a reason (the Chrome extension writes
-- with the anon key). Nothing anonymous needs the body shop board or a car's
-- photo history, and both are internal business data:
--
--   body_shop_board  — a plain (non-security_invoker) view, so it reads through
--                      RLS entirely. Granted to anon it hands the whole board —
--                      stock numbers, repair prices, techs — to anyone with the
--                      publishable anon key, which ships in the client bundle.
--   vehicle_photos() — SECURITY DEFINER over wa_inbound_messages; anon could
--                      enumerate every photo path we hold for any car.
--
-- The marketplace pages are public and DO render the vehicle history modal, so
-- this is not theoretical. The UI half of the fix is HistoryButton's showPhotos
-- prop, which defaults to off; this is the half that doesn't depend on a caller
-- remembering.

REVOKE SELECT ON body_shop_board FROM anon;
GRANT  SELECT ON body_shop_board TO authenticated;

REVOKE EXECUTE ON FUNCTION vehicle_photos(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION vehicle_photos(TEXT, TEXT) TO authenticated;

-- The Telegram webhook calls this with the service key, never the anon key.
REVOKE EXECUTE ON FUNCTION ensure_body_shop_job(TEXT, TIMESTAMPTZ) FROM anon;

NOTIFY pgrst, 'reload schema';
