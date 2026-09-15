-- Buyer Outreach: a queue of cars, each texted to its best-matched buyers one
-- at a time, moving to the next buyer when 30 minutes pass without a reply.
--
-- The rules, as the owner set them (2026-09-15):
--   * a car is only queued by hand, and only while it is live on SmartAuction
--   * up to 5 buyers per car (max_offers); a reply from any of them pauses it
--   * texts go out Mon-Sat 8am-6pm Memphis; the 30 minutes only count inside
--     those hours (the deadline is computed by the API, not here)
--   * a buyer gets at most 5 cars a day, at least an hour apart, and never the
--     same car twice. A buyer over a limit is skipped, not waited for
--   * Sold stops everything for that car, for good
--
-- Every table here holds buyer phone numbers, so none has a policy: anon and
-- authenticated cannot read or write any of it. The only door is /api/outreach,
-- which checks for an admin and uses the service key.

CREATE TABLE IF NOT EXISTS public.outreach_cars (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vin           text        NOT NULL,
  stock_number  text,
  year          integer,
  make          text,
  model         text,
  "trim"        text,
  mileage       integer,
  price         numeric,
  sa_url        text,
  status        text        NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'waiting', 'paused', 'exhausted', 'sold', 'stopped')),
  status_note   text,
  max_offers    integer     NOT NULL DEFAULT 5 CHECK (max_offers BETWEEN 1 AND 15),
  added_by      uuid,
  added_at      timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
-- One open run per car. A car that ran out of buyers can be queued again (a new
-- row); buyers it already went to are still skipped, because that rule is keyed
-- on the VIN, not on the run.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_cars_one_open
  ON public.outreach_cars (vin) WHERE status IN ('queued', 'waiting', 'paused');
CREATE INDEX IF NOT EXISTS outreach_cars_status ON public.outreach_cars (status, added_at);

-- The lineup, frozen when the car is queued. "Next best match" has to mean the
-- next name on a list the owner already saw, not whatever the hourly recompute
-- says this minute.
CREATE TABLE IF NOT EXISTS public.outreach_candidates (
  car_id          uuid    NOT NULL REFERENCES public.outreach_cars (id) ON DELETE CASCADE,
  rank            integer NOT NULL,
  buyer_key       text    NOT NULL,
  buyer_name      text    NOT NULL,
  phone           text    NOT NULL,           -- 10 digits
  email           text,
  city            text,
  state           text,
  predicted_price integer,
  confidence      text,
  reason          text,
  total_buys      integer,
  days_since      integer,
  PRIMARY KEY (car_id, rank)
);

-- Every text sent to a buyer about a car.
--   sending   claimed, Twilio not answered yet
--   sent      out, waiting for a reply until expires_at
--   replied   the buyer answered (resolved_at = the owner has acted on it)
--   expired   30 business minutes passed, no answer
--   failed    Twilio refused it (bad number, carrier block)
--   cancelled the car sold or was stopped while this was open
--   sold      this buyer bought it
--   opted_out the buyer answered STOP
CREATE TABLE IF NOT EXISTS public.outreach_offers (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  car_id       uuid        NOT NULL REFERENCES public.outreach_cars (id) ON DELETE CASCADE,
  vin          text        NOT NULL,
  buyer_key    text        NOT NULL,
  buyer_name   text,
  phone        text        NOT NULL,          -- 10 digits
  rank         integer,                        -- null when sent by hand
  manual       boolean     NOT NULL DEFAULT false,
  status       text        NOT NULL DEFAULT 'sending'
               CHECK (status IN ('sending', 'sent', 'replied', 'expired', 'failed', 'cancelled', 'sold', 'opted_out')),
  body         text,
  sent_at      timestamptz,
  expires_at   timestamptz,
  replied_at   timestamptz,
  reply_body   text,
  resolved_at  timestamptz,
  twilio_sid   text,
  error        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Never the same car to the same number twice — across every run of that car.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_offers_once_per_car
  ON public.outreach_offers (vin, phone);
CREATE INDEX IF NOT EXISTS outreach_offers_phone ON public.outreach_offers (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS outreach_offers_car ON public.outreach_offers (car_id, created_at);
CREATE INDEX IF NOT EXISTS outreach_offers_open ON public.outreach_offers (expires_at) WHERE status IN ('sending', 'sent');

CREATE TABLE IF NOT EXISTS public.outreach_opt_outs (
  phone        text        PRIMARY KEY,       -- 10 digits
  body         text,
  opted_out_at timestamptz NOT NULL DEFAULT now()
);

-- A car sold through outreach, at the price the owner typed. Also feeds Buyer
-- Match (see buyer_training_rows below), so the engine learns from its own wins.
CREATE TABLE IF NOT EXISTS public.outreach_sales (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  car_id       uuid        NOT NULL REFERENCES public.outreach_cars (id),
  offer_id     bigint      REFERENCES public.outreach_offers (id),
  vin          text        NOT NULL,
  stock_number text,
  year         integer,
  make         text,
  model        text,
  mileage      integer,
  buyer_key    text        NOT NULL,
  buyer_name   text,
  buyer_phone  text,
  buyer_email  text,
  buyer_city   text,
  buyer_state  text,
  price        numeric     NOT NULL CHECK (price > 0),
  asking_price numeric,
  sold_by      uuid,
  sold_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_sales_car ON public.outreach_sales (car_id);
CREATE INDEX IF NOT EXISTS outreach_sales_vin ON public.outreach_sales (vin);

ALTER TABLE public.outreach_cars       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_offers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_opt_outs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_sales      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outreach_cars, public.outreach_candidates, public.outreach_offers,
              public.outreach_opt_outs, public.outreach_sales FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queue a car with its lineup, in one statement. Refuses a car that already
-- sold through outreach, and (via the unique index) one that is already open.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_add_car(p_car jsonb, p_candidates jsonb, p_actor uuid, p_max integer DEFAULT 5)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vin text := upper(btrim(p_car->>'vin'));
  v_id uuid;
BEGIN
  IF v_vin IS NULL OR v_vin = '' THEN RAISE EXCEPTION 'vin required'; END IF;
  IF EXISTS (SELECT 1 FROM outreach_sales WHERE vin = v_vin) THEN
    RAISE EXCEPTION 'already sold through outreach' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM outreach_cars WHERE vin = v_vin AND status IN ('queued', 'waiting', 'paused')) THEN
    RAISE EXCEPTION 'already in the queue' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO outreach_cars (vin, stock_number, year, make, model, "trim", mileage, price, sa_url, max_offers, added_by)
  VALUES (v_vin, p_car->>'stock_number', (p_car->>'year')::int, p_car->>'make', p_car->>'model',
          p_car->>'trim', (p_car->>'mileage')::int, (p_car->>'price')::numeric, p_car->>'sa_url',
          COALESCE(p_max, 5), p_actor)
  RETURNING id INTO v_id;

  INSERT INTO outreach_candidates (car_id, rank, buyer_key, buyer_name, phone, email, city, state,
                                   predicted_price, confidence, reason, total_buys, days_since)
  SELECT v_id, (r->>'rank')::int, r->>'buyer_key', r->>'buyer_name', r->>'phone', r->>'email',
         r->>'city', r->>'state', (r->>'predicted_price')::int, r->>'confidence', r->>'reason',
         (r->>'total_buys')::int, (r->>'days_since')::int
  FROM jsonb_array_elements(p_candidates) r;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- Pick the next buyer for a car and claim the send, atomically.
--
-- Returns the new offer (status 'sending') for the API to text, or a reason it
-- didn't. Everything that decides who is eligible lives here, under one lock,
-- because two ticks deciding at once is how a buyer gets two texts in a minute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_claim_next(p_car uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c outreach_cars;
  cand outreach_candidates;
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
  v_used integer;
  v_blocked integer := 0;
  v_offer outreach_offers;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('outreach_claim'));

  SELECT * INTO c FROM outreach_cars WHERE id = p_car FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('skip', 'missing'); END IF;
  IF c.status NOT IN ('queued', 'waiting') THEN RETURN jsonb_build_object('skip', c.status); END IF;

  -- Someone still has the car. Wait for them.
  IF EXISTS (SELECT 1 FROM outreach_offers o WHERE o.car_id = c.id AND o.status IN ('sending', 'sent')) THEN
    RETURN jsonb_build_object('skip', 'offer_open');
  END IF;

  SELECT count(*) INTO v_used FROM outreach_offers o
   WHERE o.car_id = c.id AND o.status NOT IN ('failed');
  IF v_used >= c.max_offers THEN
    UPDATE outreach_cars SET status = 'exhausted', status_note = format('No reply from %s buyers', v_used),
           closed_at = now(), updated_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('skip', 'exhausted');
  END IF;

  FOR cand IN SELECT * FROM outreach_candidates WHERE car_id = c.id ORDER BY rank LOOP
    -- Permanent skips: already offered this car (any run), or opted out.
    CONTINUE WHEN EXISTS (SELECT 1 FROM outreach_offers o WHERE o.vin = c.vin AND o.phone = cand.phone);
    CONTINUE WHEN EXISTS (SELECT 1 FROM outreach_opt_outs x WHERE x.phone = cand.phone);

    -- Temporary skips: holding another car right now, 5 cars today already, or
    -- texted within the hour. Skipped, not waited for.
    IF EXISTS (SELECT 1 FROM outreach_offers o WHERE o.phone = cand.phone AND o.status IN ('sending', 'sent'))
       OR (SELECT count(*) FROM outreach_offers o
            WHERE o.phone = cand.phone AND o.status <> 'failed' AND o.created_at >= v_day_start) >= 5
       OR EXISTS (SELECT 1 FROM outreach_offers o
                   WHERE o.phone = cand.phone AND o.status <> 'failed' AND o.created_at > now() - interval '60 minutes')
    THEN
      v_blocked := v_blocked + 1;
      CONTINUE;
    END IF;

    INSERT INTO outreach_offers (car_id, vin, buyer_key, buyer_name, phone, rank, status)
    VALUES (c.id, c.vin, cand.buyer_key, cand.buyer_name, cand.phone, cand.rank, 'sending')
    RETURNING * INTO v_offer;
    UPDATE outreach_cars SET status = 'waiting', status_note = NULL, updated_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('offer', to_jsonb(v_offer), 'candidate', to_jsonb(cand));
  END LOOP;

  IF v_blocked > 0 THEN
    -- Everyone left is at a limit for now. Nobody else to send it to, so the car
    -- stays in line and the next tick looks again.
    UPDATE outreach_cars SET status = 'queued',
           status_note = format('%s remaining %s at their daily limit or texted within the hour',
                                v_blocked, CASE WHEN v_blocked = 1 THEN 'buyer is' ELSE 'buyers are' END),
           updated_at = now()
     WHERE id = c.id;
    RETURN jsonb_build_object('skip', 'buyers_at_limit');
  END IF;

  UPDATE outreach_cars SET status = 'exhausted',
         status_note = CASE WHEN v_used = 0 THEN 'No textable buyers left for this car'
                            ELSE format('Ran out of matches after %s %s', v_used, CASE WHEN v_used = 1 THEN 'buyer' ELSE 'buyers' END) END,
         closed_at = now(), updated_at = now()
   WHERE id = c.id;
  RETURN jsonb_build_object('skip', 'exhausted');
END $$;

-- ---------------------------------------------------------------------------
-- "Send this buyer their next car": the best other queued car this buyer is in
-- the lineup for and hasn't been offered. Skips the daily limits by design —
-- the buyer is mid-conversation. Prefers a car nobody is holding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_claim_next_car(p_offer bigint, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  src outreach_offers;
  pick record;
  v_offer outreach_offers;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('outreach_claim'));
  SELECT * INTO src FROM outreach_offers WHERE id = p_offer;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found'; END IF;
  IF EXISTS (SELECT 1 FROM outreach_opt_outs x WHERE x.phone = src.phone) THEN
    RAISE EXCEPTION 'this buyer opted out' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.id, c.vin, cand.rank, cand.buyer_key, cand.buyer_name,
         EXISTS (SELECT 1 FROM outreach_offers o WHERE o.car_id = c.id AND o.status IN ('sending', 'sent')) AS held
    INTO pick
    FROM outreach_cars c
    JOIN outreach_candidates cand ON cand.car_id = c.id AND cand.phone = src.phone
   WHERE c.status IN ('queued', 'waiting', 'exhausted')
     AND c.vin <> src.vin
     AND NOT EXISTS (SELECT 1 FROM outreach_offers o WHERE o.vin = c.vin AND o.phone = src.phone)
     AND NOT EXISTS (SELECT 1 FROM outreach_sales s WHERE s.vin = c.vin)
     -- An exhausted run whose car has since been queued again is not the one to use.
     AND NOT EXISTS (SELECT 1 FROM outreach_cars c2
                      WHERE c2.vin = c.vin AND c2.id <> c.id AND c2.status IN ('queued', 'waiting', 'paused'))
   ORDER BY held, cand.rank, c.added_at
   LIMIT 1;

  IF pick.id IS NULL THEN RETURN jsonb_build_object('skip', 'no_other_car'); END IF;

  INSERT INTO outreach_offers (car_id, vin, buyer_key, buyer_name, phone, rank, manual, status, created_by)
  VALUES (pick.id, pick.vin, pick.buyer_key, pick.buyer_name, src.phone, pick.rank, true, 'sending', p_actor)
  RETURNING * INTO v_offer;
  UPDATE outreach_cars SET status = 'waiting', status_note = NULL, closed_at = NULL, updated_at = now()
   WHERE id = pick.id;
  UPDATE outreach_offers SET resolved_at = COALESCE(resolved_at, now()) WHERE id = src.id AND status = 'replied';

  RETURN jsonb_build_object('offer', to_jsonb(v_offer),
    'candidate', (SELECT to_jsonb(x) FROM outreach_candidates x WHERE x.car_id = pick.id AND x.rank = pick.rank));
END $$;

-- ---------------------------------------------------------------------------
-- The clock. Open offers past their deadline expire; a send that was claimed
-- but never confirmed (the function died mid-send) is written off as failed so
-- the car can't sit forever on a text nobody knows went out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_expire()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer; m integer;
BEGIN
  UPDATE outreach_offers SET status = 'expired'
   WHERE status = 'sent' AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE outreach_offers SET status = 'failed', error = COALESCE(error, 'send interrupted - unknown whether it went')
   WHERE status = 'sending' AND created_at < now() - interval '5 minutes';
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN n + m;
END $$;

-- ---------------------------------------------------------------------------
-- An inbound text. Matches the buyer's most recent offer in the last 3 days.
--   STOP words  -> opt-out; the car carries on to the next buyer
--   START words -> opt back in
--   anything else pauses the car, unless the owner already acted on this
--   buyer's earlier reply (a conversation that continues shouldn't re-pause a
--   car that has since moved on)
-- Returns what matched, so the webhook can tell the owner which car it's about.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_record_reply(p_phone text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
  v_word text := upper(btrim(regexp_replace(COALESCE(p_body, ''), '[^A-Za-z]', '', 'g')));
  o outreach_offers;
  c outreach_cars;
  v_paused boolean := false;
BEGIN
  IF length(v_phone) <> 10 THEN RETURN NULL; END IF;

  IF v_word IN ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE') THEN
    INSERT INTO outreach_opt_outs (phone, body) VALUES (v_phone, left(p_body, 500))
    ON CONFLICT (phone) DO UPDATE SET body = EXCLUDED.body, opted_out_at = now();
    UPDATE outreach_offers SET status = 'opted_out', replied_at = now(), reply_body = left(p_body, 2000)
     WHERE phone = v_phone AND status IN ('sending', 'sent');
    RETURN jsonb_build_object('opted_out', true,
      'buyer_name', (SELECT buyer_name FROM outreach_offers WHERE phone = v_phone ORDER BY created_at DESC LIMIT 1));
  END IF;
  IF v_word IN ('START', 'UNSTOP', 'YES') AND EXISTS (SELECT 1 FROM outreach_opt_outs WHERE phone = v_phone) THEN
    DELETE FROM outreach_opt_outs WHERE phone = v_phone;
    RETURN jsonb_build_object('opted_in', true);
  END IF;

  SELECT * INTO o FROM outreach_offers
   WHERE phone = v_phone AND status IN ('sent', 'expired', 'replied', 'sold') AND sent_at > now() - interval '3 days'
   ORDER BY sent_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM outreach_cars WHERE id = o.car_id FOR UPDATE;

  IF o.status IN ('sent', 'expired') OR (o.status = 'replied' AND o.resolved_at IS NULL) THEN
    UPDATE outreach_offers SET status = 'replied', replied_at = COALESCE(replied_at, now()),
           reply_body = left(CASE WHEN reply_body IS NULL THEN p_body ELSE reply_body || E'\n' || p_body END, 2000)
     WHERE id = o.id;
    IF c.status IN ('queued', 'waiting', 'exhausted') THEN
      UPDATE outreach_cars SET status = 'paused', status_note = NULL, closed_at = NULL, updated_at = now()
       WHERE id = c.id;
      v_paused := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'offer_id', o.id, 'car_id', c.id, 'buyer_name', o.buyer_name, 'vin', c.vin,
    'car', concat_ws(' ', c.year, c.make, c.model, c."trim"), 'car_status', c.status,
    'paused', v_paused, 'late', o.status = 'expired');
END $$;

-- ---------------------------------------------------------------------------
-- Owner actions.
-- ---------------------------------------------------------------------------
-- Next buyer: the reply is dealt with; carry on down the lineup.
CREATE OR REPLACE FUNCTION public.outreach_resume(p_car uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE outreach_offers SET resolved_at = now()
   WHERE car_id = p_car AND status = 'replied' AND resolved_at IS NULL;
  UPDATE outreach_cars SET status = 'queued', status_note = NULL, updated_at = now()
   WHERE id = p_car AND status = 'paused';
  IF NOT FOUND THEN RAISE EXCEPTION 'car is not paused' USING ERRCODE = 'P0001'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.outreach_stop(p_car uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE outreach_offers SET status = 'cancelled' WHERE car_id = p_car AND status IN ('sending', 'sent');
  UPDATE outreach_offers SET resolved_at = now() WHERE car_id = p_car AND status = 'replied' AND resolved_at IS NULL;
  UPDATE outreach_cars SET status = 'stopped', status_note = COALESCE(status_note, 'Stopped by hand'),
         closed_at = now(), updated_at = now()
   WHERE id = p_car AND status IN ('queued', 'waiting', 'paused', 'exhausted');
END $$;

-- Sold: record it, close every run of this VIN, cancel open offers, and take
-- the car off the marketplace — all in one statement, so there is no moment
-- where it is sold on paper and still being texted to somebody.
CREATE OR REPLACE FUNCTION public.outreach_sell(p_car uuid, p_offer bigint, p_price numeric, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c outreach_cars;
  o outreach_offers;
  cand outreach_candidates;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('outreach_claim'));
  IF p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'enter the sale price' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM outreach_cars WHERE id = p_car FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'car not found'; END IF;
  IF c.status = 'sold' OR EXISTS (SELECT 1 FROM outreach_sales WHERE vin = c.vin) THEN
    RAISE EXCEPTION 'already marked sold' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO o FROM outreach_offers WHERE id = p_offer AND vin = c.vin;
  IF NOT FOUND THEN RAISE EXCEPTION 'that buyer was not offered this car' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO cand FROM outreach_candidates WHERE car_id = o.car_id AND phone = o.phone LIMIT 1;

  INSERT INTO outreach_sales (car_id, offer_id, vin, stock_number, year, make, model, mileage, buyer_key,
                              buyer_name, buyer_phone, buyer_email, buyer_city, buyer_state, price, asking_price, sold_by)
  VALUES (c.id, o.id, c.vin, c.stock_number, c.year, c.make, c.model, c.mileage, o.buyer_key,
          o.buyer_name, o.phone, cand.email, cand.city, cand.state, p_price, c.price, p_actor);

  UPDATE outreach_offers SET status = 'sold', resolved_at = now() WHERE id = o.id;
  UPDATE outreach_offers SET status = 'cancelled'
   WHERE vin = c.vin AND id <> o.id AND status IN ('sending', 'sent');
  UPDATE outreach_offers SET resolved_at = now()
   WHERE vin = c.vin AND id <> o.id AND status = 'replied' AND resolved_at IS NULL;
  UPDATE outreach_cars SET status = 'sold', status_note = NULL, closed_at = now(), updated_at = now()
   WHERE id = c.id;
  UPDATE outreach_cars SET status = 'stopped', status_note = 'Sold on another run', closed_at = now(), updated_at = now()
   WHERE vin = c.vin AND id <> c.id AND status IN ('queued', 'waiting', 'paused', 'exhausted');

  IF c.stock_number IS NOT NULL THEN
    INSERT INTO marketplace_hidden (stock_number, hidden_by) VALUES (c.stock_number, p_actor)
    ON CONFLICT (stock_number) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'vin', c.vin, 'stock_number', c.stock_number, 'car', concat_ws(' ', c.year, c.make, c.model, c."trim"),
    'price', p_price, 'asking_price', c.price, 'buyer_name', o.buyer_name, 'buyer_phone', o.phone,
    'buyer_email', cand.email, 'buyer_city', cand.city, 'buyer_state', cand.state,
    'hidden', c.stock_number IS NOT NULL);
END $$;

-- Server only, every one of them. EXECUTE defaults to PUBLIC (which includes
-- anon), and Supabase also grants new functions to anon explicitly — so both
-- are named.
REVOKE ALL ON FUNCTION public.outreach_add_car(jsonb, jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_claim_next(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_claim_next_car(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_expire() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_record_reply(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_resume(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_stop(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_sell(uuid, bigint, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outreach_add_car(jsonb, jsonb, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.outreach_claim_next(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.outreach_claim_next_car(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.outreach_expire() TO service_role;
GRANT EXECUTE ON FUNCTION public.outreach_record_reply(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.outreach_resume(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.outreach_stop(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.outreach_sell(uuid, bigint, numeric, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The Messages screen names a buyer's thread instead of showing a bare number.
-- Outreach buyers go last: staff and crew numbers win if they ever collide.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sms_name_for(p_phone text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS (SELECT right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10) AS last10)
  SELECT COALESCE(
    (SELECT c.name FROM sms_checklists c, d
      WHERE right(regexp_replace(c.phone, '\D', '', 'g'), 10) = d.last10 LIMIT 1),
    (SELECT n.name FROM sms_nudges n, d
      WHERE right(regexp_replace(n.phone, '\D', '', 'g'), 10) = d.last10 LIMIT 1),
    (SELECT p.name FROM profiles p, d
      WHERE right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = d.last10 LIMIT 1),
    (SELECT o.buyer_name FROM outreach_offers o, d
      WHERE o.phone = d.last10 ORDER BY o.created_at DESC LIMIT 1)
  );
$function$;

-- ---------------------------------------------------------------------------
-- Buyer Match learns from outreach sales. A car sold through outreach usually
-- also shows up later in the SmartAuction sold report or Frazer; the same
-- 30-day VIN window the Frazer arm uses keeps that from counting twice.
-- (buyer_training_count() wraps this function, so it follows automatically.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_training_rows(p_include_arbitration boolean DEFAULT false, p_limit integer DEFAULT NULL::integer, p_offset integer DEFAULT 0)
 RETURNS TABLE(source text, channel_key text, channel_label text, channel_kind text, per_buyer_data boolean, vin text, year integer, make text, model text, odometer integer, segment text, sale_date date, sale_price numeric, buyer_key text, buyer_name text, buyer_email text, buyer_phone text, buyer_city text, buyer_state text, buyer_detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sa AS (
    SELECT s.*, regexp_replace(COALESCE(s.buyer_phone, ''), '\D', '', 'g') AS d
    FROM sa_sold_sales s
    WHERE is_staff()
  ),
  unioned AS (
    SELECT
      'smartauction'::text AS source, 'smartauction'::text AS channel_key,
      'SmartAuction'::text AS channel_label, 'online_auction'::text AS channel_kind,
      true AS per_buyer_data,
      upper(sa.vin) AS vin, sa.year, sa.make, sa.model, sa.odometer,
      COALESCE(sa.segment, sa_segment(sa.make, sa.model)) AS segment,
      sa.sale_date, sa.sale_price,
      CASE
        WHEN length(sa.d) = 10 THEN 'p:' || sa.d
        WHEN length(sa.d) = 11 AND left(sa.d, 1) = '1' THEN 'p:' || right(sa.d, 10)
        WHEN sa.buyer_email LIKE '%@%' THEN 'e:' || lower(btrim(sa.buyer_email))
        ELSE 'n:' || lower(btrim(regexp_replace(COALESCE(sa.buyer_name, ''), '\s+', ' ', 'g')))
      END AS buyer_key,
      sa.buyer_name, sa.buyer_email, sa.buyer_phone, sa.buyer_city, sa.buyer_state,
      NULL::text AS buyer_detail
    FROM sa
    WHERE sa.buyer_name IS NOT NULL AND btrim(sa.buyer_name) <> ''

    UNION ALL

    SELECT
      'frazer'::text, b.channel_key, c.label, c.kind, c.per_buyer_data,
      upper(b.vin), b.year, b.make, b.model, b.odometer,
      sa_segment(b.make, b.model),
      b.sale_date, b.sale_price,
      CASE WHEN c.per_buyer_data
           THEN 'n:' || lower(btrim(regexp_replace(b.buyer_label, '\s+', ' ', 'g')))
           ELSE 'c:' || b.channel_key END,
      b.buyer_label, NULL::text, NULL::text, NULL::text, b.customer_state,
      b.buyer_detail
    FROM sold_book b
    JOIN sale_channels c ON c.channel_key = b.channel_key
    WHERE is_staff()
      AND b.channel_key <> 'smartauction'
      AND b.buyer_label IS NOT NULL AND btrim(b.buyer_label) <> ''
      AND b.sale_date IS NOT NULL
      AND (p_include_arbitration OR NOT b.is_arbitration)
      AND NOT EXISTS (
        SELECT 1 FROM sa_sold_sales s2
        WHERE upper(s2.vin) = upper(b.vin)
          AND s2.sale_date IS NOT NULL
          AND abs(s2.sale_date - b.sale_date) <= 30)

    UNION ALL

    SELECT
      'outreach'::text, 'smartauction'::text, 'SmartAuction'::text, 'online_auction'::text, true,
      upper(o.vin), o.year, o.make, o.model, o.mileage,
      sa_segment(o.make, o.model),
      (o.sold_at AT TIME ZONE 'America/Chicago')::date, o.price,
      o.buyer_key, o.buyer_name, o.buyer_email, o.buyer_phone, o.buyer_city, o.buyer_state,
      'buyer outreach'::text
    FROM outreach_sales o
    WHERE is_staff()
      AND NOT EXISTS (
        SELECT 1 FROM sa_sold_sales s3
        WHERE upper(s3.vin) = upper(o.vin)
          AND s3.sale_date IS NOT NULL
          AND abs(s3.sale_date - (o.sold_at AT TIME ZONE 'America/Chicago')::date) <= 30)
      AND NOT EXISTS (
        SELECT 1 FROM sold_book b3
        WHERE upper(b3.vin) = upper(o.vin)
          AND b3.sale_date IS NOT NULL
          AND abs(b3.sale_date - (o.sold_at AT TIME ZONE 'America/Chicago')::date) <= 30)
  )
  SELECT source, channel_key, channel_label, channel_kind, per_buyer_data,
         vin, year, make, model, odometer, segment, sale_date, sale_price,
         buyer_key, buyer_name, buyer_email, buyer_phone, buyer_city,
         buyer_state, buyer_detail
  FROM unioned
  -- (sale_date, vin, buyer_key) is unique enough to page on: a VIN can sell
  -- twice, but not to two buyers on one day.
  ORDER BY sale_date, vin, buyer_key
  LIMIT p_limit OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

NOTIFY pgrst, 'reload schema';
