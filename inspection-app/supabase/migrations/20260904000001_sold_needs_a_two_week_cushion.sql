-- A sale from two months ago must not delete a car we photographed yesterday.
--
-- 665426 is the whole story. The Frontier sold on SmartAuction 2026-07-25 for
-- $27,900, came back, was re-stocked as 08-264-26, and sat on the front lot.
-- The team re-shot it on 9/3 — seventy pictures. On 9/4 at 13:48 the list
-- upload read SmartAuction's still-standing "sold" for that VIN and stamped the
-- intake queue sold again, off the JULY sale. The car vanished from the
-- extension's ready-to-list view the morning after it was photographed.
--
-- 025652 is the same failure (sold 7/11, re-stocked 08-175-26, 78 photos on
-- 8/29, re-stamped 9/4). 180531 and 601969 are older instances. Across the
-- queue, 42 of the 75 cars marked sold have a photo shoot NEWER than their
-- sale, or no sale on record anywhere.
--
-- THE RULE: a car re-inspected more than two weeks after it sold, which we
-- still own, is a car that came back. Put it in the queue.
--
-- Two weeks is the cushion, and it is doing real work in both directions. The
-- trailing photos of a car that genuinely sold arrive within a day or two of
-- the sale — 627672 was shot 9/2 and sold 9/3, so it stays sold, correctly.
-- A car that comes back from a fallen-through sale is re-stocked and re-shot
-- weeks later. Nothing lands in between.
--
-- The inventory check is what makes the cushion safe. Frazer is a manual
-- export, so a car that sold at DAA yesterday is still in inventory today —
-- being in inventory is not on its own evidence that a car came back. Paired
-- with the cushion it is: still ours AND photographed two weeks after the sale.

-- ── 1. The stamper ────────────────────────────────────────────────────────
-- The SmartAuction upload runs against the whole listing feed every time, and
-- a sold listing stays sold on SmartAuction forever, so every run re-applies
-- every historical sale. That is why the damage kept accumulating: the stamp
-- was re-written 40 days after the sale it described.
--
-- The uploader now goes through here instead of sa_queue_set_status, and hands
-- over the sale date it read off the row. Refusing the stamp leaves the car
-- where it is — nothing else about the upload changes.
--
-- sa_queue_set_status stays exactly as it was. It backs the extension's Hold /
-- Remove / Mark Sold buttons, and a person pressing one of those means the
-- queue's version of it, today. This guard is only for the automated sweep.
CREATE OR REPLACE FUNCTION sa_queue_sync_status(
  p_vin6 text, p_status text, p_sale_date timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vin6  text := upper(p_vin6);
  v_owned boolean;
  v_shoot timestamptz;
BEGIN
  SELECT EXISTS (SELECT 1 FROM inventory WHERE upper(last_6_vin) = v_vin6) INTO v_owned;

  IF p_status = 'sold' AND v_owned THEN
    -- SmartAuction says sold, we still own it, and it can't tell us when. That
    -- is 376535: no row in sa_sold_sales, no sold_at in vehicle_locations, and
    -- sixty photographs taken on 9/1. The upload already surfaces these as
    -- `soldStillInInv` for a human to look at; it must not also delete them
    -- from the queue on the way past.
    IF p_sale_date IS NULL THEN RETURN false; END IF;

    SELECT max(received_at) INTO v_shoot
      FROM wa_inbound_messages
     WHERE upper(vin6) = v_vin6 AND station IN ('ready', 'seller');

    IF v_shoot IS NOT NULL AND v_shoot >= p_sale_date + interval '14 days' THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO sa_queue_status (vin6, status, updated_at)
  VALUES (v_vin6, p_status, now())
  ON CONFLICT (vin6) DO UPDATE SET status = EXCLUDED.status, updated_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION sa_queue_sync_status(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sa_queue_sync_status(text, text, timestamptz)
  TO anon, authenticated, service_role;

-- ── 2. The reopener ───────────────────────────────────────────────────────
-- 20260817000005 built this for hold/removed and argued explicitly against
-- extending it: "'sold' and 'listed' are left alone — those say the car is
-- handled, and re-posting pictures is not an argument that it is not."
--
-- Seventy photographs taken forty days after the sale is that argument. What
-- the original reasoning was missing is the clock: it treated re-posting as
-- undated, when the gap between the sale and the shoot is exactly what tells a
-- straggler photo apart from a car that came back. So sold and listed reopen
-- now too — but only across two weeks, and only for a car we still own.
--
-- hold/removed keep their old terms (any newer intake, no cushion, no
-- inventory test). A person pressed those about this car; the moment somebody
-- photographs it again the queue owes it a listing.
CREATE OR REPLACE FUNCTION sa_queue_reopen_on_intake(p_vin6 text, p_event timestamptz)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vin6   text := upper(p_vin6);
  v_status text;
  v_stamp  timestamptz;
  v_sale   timestamptz;
  v_owned  boolean;
BEGIN
  SELECT status, updated_at INTO v_status, v_stamp
    FROM sa_queue_status WHERE vin6 = v_vin6;
  IF v_status IS NULL THEN RETURN false; END IF;

  IF v_status IN ('hold', 'removed') THEN
    IF v_stamp >= p_event THEN RETURN false; END IF;

  ELSIF v_status IN ('sold', 'listed') THEN
    SELECT EXISTS (SELECT 1 FROM inventory WHERE upper(last_6_vin) = v_vin6) INTO v_owned;
    IF NOT v_owned THEN RETURN false; END IF;

    -- When the car sold, by the full VIN. Resolving the VIN through inventory
    -- rather than matching sales on the last 6 keeps a colliding last-6 from
    -- lending this car somebody else's sale date — the same trap the run-list
    -- uploads hit.
    SELECT max(d) INTO v_sale FROM (
      SELECT s.sale_date::timestamptz AS d
        FROM sa_sold_sales s
        JOIN vehicle_locations vl ON vl.vin = s.vin
        JOIN inventory i ON i.stock_number = vl.stock_number
       WHERE upper(i.last_6_vin) = v_vin6
      UNION ALL
      SELECT vl.sold_at
        FROM vehicle_locations vl
        JOIN inventory i ON i.stock_number = vl.stock_number
       WHERE upper(i.last_6_vin) = v_vin6 AND vl.sold_at IS NOT NULL
    ) x;

    -- No sale on record: the stamp itself is the only date we have for when
    -- the car was last dealt with. That is the right anchor for 'listed',
    -- which carries no sale date of its own.
    IF p_event < COALESCE(v_sale, v_stamp) + interval '14 days' THEN RETURN false; END IF;
  ELSE
    RETURN false;   -- already queued
  END IF;

  UPDATE sa_queue_status SET status = 'queued', updated_at = now() WHERE vin6 = v_vin6;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION sa_queue_reopen_on_intake(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sa_queue_reopen_on_intake(text, timestamptz) TO service_role;

-- ── 3. The cars already stuck ─────────────────────────────────────────────
-- The rules above only fire on the NEXT message about a car, and these cars
-- were photographed days or weeks ago — nobody is going to shoot them again to
-- wake them up. So apply the rule once, retrospectively, to the shoot that
-- already happened.
--
-- Anchored on the sale rather than the stamp, because the stamps are the thing
-- that went wrong: the upload re-wrote them long after the sales they describe,
-- so 665426's stamp reads 9/4 for a sale on 7/25. Every car restored here is
-- one we still own, whose most recent shoot is either two weeks past its sale
-- or has no sale on record at all.
WITH stuck AS (
  SELECT q.vin6, max(q.received_at) AS shoot
    FROM wa_inbound_messages q
    JOIN sa_queue_status s ON s.vin6 = upper(q.vin6)
   WHERE q.station IN ('ready', 'seller')
     AND q.vin6 IS NOT NULL
     AND s.status IN ('sold', 'listed')
     AND EXISTS (SELECT 1 FROM inventory i WHERE upper(i.last_6_vin) = upper(q.vin6))
   GROUP BY q.vin6
), dated AS (
  SELECT st.vin6, st.shoot, (
    SELECT max(d) FROM (
      SELECT s.sale_date::timestamptz AS d
        FROM sa_sold_sales s
        JOIN vehicle_locations vl ON vl.vin = s.vin
        JOIN inventory i ON i.stock_number = vl.stock_number
       WHERE upper(i.last_6_vin) = upper(st.vin6)
      UNION ALL
      SELECT vl.sold_at
        FROM vehicle_locations vl
        JOIN inventory i ON i.stock_number = vl.stock_number
       WHERE upper(i.last_6_vin) = upper(st.vin6) AND vl.sold_at IS NOT NULL
    ) y
  ) AS sale
  FROM stuck st
)
UPDATE sa_queue_status s
   SET status = 'queued', updated_at = now()
  FROM dated d
 WHERE s.vin6 = upper(d.vin6)
   AND (d.sale IS NULL OR d.shoot >= d.sale + interval '14 days');

-- ── 4. The stamps that never landed ───────────────────────────────────────
-- popup.js passed whatever VIN the user had straight through, so a button
-- pressed on a car opened by its full 17-char VIN wrote a row keyed on that,
-- and ready_to_sell_queue keys on the last 6 — the row could never join, the
-- click reported success, and nothing happened. 151 of these had accumulated;
-- one was written at 14:24 on 9/4 while this was being diagnosed.
--
-- They are deleted rather than folded into their last-6 rows. Replaying a year
-- of never-applied stamps would HIDE cars, which is the direction that caused
-- all of this, and a click that silently did nothing is not a decision anybody
-- has been relying on. The popup fix stops new ones.
DELETE FROM sa_queue_status WHERE length(vin6) > 6;

NOTIFY pgrst, 'reload schema';
