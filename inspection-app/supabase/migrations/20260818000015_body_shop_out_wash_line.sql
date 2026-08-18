-- Two new Telegram groups that mark the END of shop work, not the start.
--
--   body_shop_out — "cars out of body shop". A worker posts the last 6 (one or
--                   many). The car's body shop job closes and the car moves to
--                   the wash line.
--   wash_line     — the wash line. Nobody types a VIN there; they photograph the
--                   car's KEY TAG, which carries the VIN across the top. The
--                   webhook reads the VIN off the picture, then the car moves to
--                   the front lot — it is done and sellable.
--
-- Both stations also close any open body shop job for the car, because the
-- washer has no idea whether the car came through Jorge's or not, and a job left
-- open sits on the manager's board forever aging.

-- ------------------------------------------------------------ station names

ALTER TABLE tg_chats DROP CONSTRAINT IF EXISTS tg_chats_station_check;
ALTER TABLE tg_chats ADD CONSTRAINT tg_chats_station_check
  CHECK (station IN (
    'seller', 'ready', 'body_shop', 'mechanic', 'transport',
    'body_shop_out', 'wash_line'
  ));

-- The message log mirrors whatever station tg_chats says. If it ever grew its
-- own CHECK on station, that list is now a second place to remember — and the
-- webhook writes the log row BEFORE it does any work, so a stale list there
-- would drop the message entirely. tg_chats is the one allowlist.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'wa_inbound_messages'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%station%'
  LOOP
    EXECUTE format('ALTER TABLE wa_inbound_messages DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- ------------------------------------------------------------ asked about what
-- The bot already asks "which car?" when a photo can't be identified, but it
-- never recorded WHICH photo it asked about — fine for an intake burst, where
-- one answer speaks for the whole pile, and wrong for the wash line, where every
-- picture is a different car. Stamping the question's own Telegram message id on
-- the row lets a reply bind to exactly the tag it answers.

ALTER TABLE wa_inbound_messages ADD COLUMN IF NOT EXISTS asked_msg_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_wa_inbound_asked_msg
  ON wa_inbound_messages (asked_msg_id) WHERE asked_msg_id IS NOT NULL;

-- ------------------------------------------------------------ closing a job
-- The inverse of ensure_body_shop_job(). SECURITY DEFINER so it can read
-- `inventory`; idempotent — a car with no open job returns NULL and the caller
-- carries on with the location update.
--
-- completed_at is stamped with the TELEGRAM MESSAGE TIME, same rule as
-- entered_at, so "days in shop" measures the real stay even when a webhook is
-- retried hours later. (The status trigger only defaults completed_at when we
-- leave it null, so passing it here wins.)
--
-- Matching is by stock number when the car is in inventory, and by vin6 for a
-- fresh buy whose job opened before Frazer ever had the car — the same two keys
-- the "one open job per car" indexes use.

CREATE OR REPLACE FUNCTION close_body_shop_job(p_vin6 TEXT, p_event TIMESTAMPTZ DEFAULT NOW())
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock TEXT;
  v_id    UUID;
BEGIN
  SELECT stock_number INTO v_stock FROM lookup_vin_by_last6(p_vin6) LIMIT 1;

  SELECT id INTO v_id
  FROM body_shop_jobs
  WHERE status <> 'done'
    AND (
      (v_stock IS NOT NULL AND stock_number = v_stock)
      OR upper(COALESCE(vin6, '')) = upper(p_vin6)
    )
  ORDER BY entered_at ASC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;   -- never went to the body shop, or already closed
  END IF;

  UPDATE body_shop_jobs
  SET status       = 'done',
      completed_at = COALESCE(p_event, NOW())
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_body_shop_job(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_body_shop_job(TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- ------------------------------------------------------------ keyword
-- The wash line has been a real place on the lot for months (lot scans stamp
-- `wash_line`), but the transport group had no word for it, so "wash line" in a
-- dispatch message matched nothing. Give it one while we're here.

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('washline', 'wash_line', 'Wash Line')
ON CONFLICT (keyword) DO NOTHING;

NOTIFY pgrst, 'reload schema';
