-- Do-not-text: catch the way people actually say it.
--
-- outreach_record_reply() opted a buyer out only when their whole message,
-- squashed to letters, was one carrier keyword: STOP, UNSUBSCRIBE, CANCEL...
-- "Stop texting me" squashes to STOPTEXTINGME and sailed through; so did "don't
-- text me", "remove me", "wrong number" and "fuck off". The owner's rule
-- (2026-09-15): any of those puts the number on do-not-text.
--
-- The opposite mistake matters as much. A buyer who writes "I'll stop by
-- tomorrow" or "don't text, call me" is a sale, not an opt-out, so bare STOP
-- only counts when it IS the message (or nearly), and "don't text" only when it
-- isn't followed by an offer to talk another way.
--
-- One list, outreach_opt_outs, is what every sender reads: the outreach queue
-- already skips it, and marketplace_buyer_picks() now does too.

CREATE OR REPLACE FUNCTION public.is_opt_out_message(p_body text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  -- Curly apostrophes to straight, lower case, one space between words.
  t text := btrim(regexp_replace(lower(translate(COALESCE(p_body, ''), '’‘`´', '''''''''')), '\s+', ' ', 'g'));
  squashed text := regexp_replace(t, '[^a-z]', '', 'g');
  words text[] := regexp_split_to_array(btrim(regexp_replace(t, '[^a-z'' ]', ' ', 'g')), '\s+');
BEGIN
  IF t = '' THEN RETURN false; END IF;

  -- 1. Carrier keywords, as the whole message ("STOP", "Stop.", "UNSUBSCRIBE!").
  IF squashed IN ('stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke',
                  'stopplease', 'pleasestop', 'stopit', 'stopnow', 'stoppls', 'plsstop') THEN
    RETURN true;
  END IF;

  -- 2. A short message that starts with "stop", unless it's "stop by / in / over".
  IF words[1] = 'stop' AND array_length(words, 1) <= 4
     AND COALESCE(words[2], '') NOT IN ('by', 'in', 'over', 'through', 'thru', 'past', 'at', 'off', 'the', 'and', 'on') THEN
    RETURN true;
  END IF;

  -- 2b. ...or ends with it: "lol stop", "omg STOP", "pls stop" — but not
  --     "bus stop", "next stop", "one stop".
  IF array_length(words, 1) BETWEEN 2 AND 3 AND words[array_length(words, 1)] = 'stop'
     AND words[array_length(words, 1) - 1] NOT IN ('bus', 'pit', 'one', 'next', 'last', 'first', 'full', 'non', 'truck', 'no', 'the', 'a', 'to', 'will', 'can', 'll', 'i''ll', 'gonna', 'quick') THEN
    RETURN true;
  END IF;

  -- 3. Asking to be left alone, anywhere in the message.
  IF t ~ '\m(stop|quit|cease|no more|enough) (texting|txting|texing|messaging|msging|sending|contacting|spamming|blowing up|hitting me up|(with )?(the |these |your )?(texts?|messages?|msgs?|spam)\M)'
     OR t ~ '\m(unsubscribe|opt ?-? ?out|remove me|remove my (number|name|info)|take me off|delete my (number|info)|lose my number|leave me alone|wrong (number|#|person)|no more (texts?|messages?)|not a dealer|do not contact|don''?t contact|dont contact|never contact)'
  THEN
    RETURN true;
  END IF;

  -- 4. "Don't text me" — but not "don't text, call me", which is a buyer
  --    choosing the phone over a text.
  IF t ~ '\m(don''?t|dont|do not|pls don''?t|please don''?t|never) (text|txt|message|msg|sms|send)( me\M| this\M| these\M| anything\M| any more\M| anymore\M|$|[^a-z ])'
     AND t !~ '\m(call|ring|phone|email|e-mail|whatsapp) (me|us)\M'
  THEN
    RETURN true;
  END IF;

  -- 5. Swearing at us, or calling it spam. Someone who answers a car with
  --    "fuck off" is not a buyer to text again. Not "scam": "is this a scam?"
  --    is a buyer checking us out.
  IF t ~ '(f+u+c+k|\mf\*+c?k|\mf\*\*k|\mfck|\mfuk|\mfuq|\mphuck|\mstfu\M|\mgtfo\M|\mmotherf|\mpiss off|\mgo to hell|\masshole|\mbitch|\mdickhead|\mspam(mer|ming)?\M)'
  THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.is_opt_out_message(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_opt_out_message(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The reply handler, identical to 20260915000031 except for the opt-out test.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_record_reply(p_phone text, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
  v_word text := upper(btrim(regexp_replace(COALESCE(p_body, ''), '[^A-Za-z]', '', 'g')));
  o outreach_offers;
  c outreach_cars;
  v_paused boolean := false;
BEGIN
  IF length(v_phone) <> 10 THEN RETURN NULL; END IF;

  IF public.is_opt_out_message(p_body) THEN
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
   ORDER BY sent_at DESC, id DESC LIMIT 1;
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
END $function$;

-- ---------------------------------------------------------------------------
-- The marketplace Text button reads the same do-not-text list, at read time,
-- so an opt-out takes effect on the next page load rather than the next hourly
-- recompute. (The recompute also skips them, so #2 and #3 move up.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_buyer_picks()
RETURNS TABLE (
  vin text, rank integer, stock_number text, buyer_key text, buyer_name text,
  buyer_phone text, buyer_email text, buyer_city text, buyer_state text,
  predicted_price integer, confidence text, reason text, total_buys integer,
  days_since integer, computed_at timestamptz,
  last_pitched_at timestamptz, last_pitched_by text, pitch_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.vin, p.rank, p.stock_number, p.buyer_key, p.buyer_name, p.buyer_phone,
         p.buyer_email, p.buyer_city, p.buyer_state, p.predicted_price, p.confidence,
         p.reason, p.total_buys, p.days_since, p.computed_at,
         lp.pitched_at, lp.who, COALESCE(lp.n, 0)::int
  FROM marketplace_buyer_picks p
  LEFT JOIN LATERAL (
    SELECT max(b.pitched_at) AS pitched_at, count(*) AS n,
           (SELECT coalesce(nullif(pr.name, ''), 'someone')
              FROM buyer_pitches b2 LEFT JOIN profiles pr ON pr.id = b2.pitched_by
             WHERE b2.vin = p.vin AND b2.buyer_key = p.buyer_key
             ORDER BY b2.pitched_at DESC LIMIT 1) AS who
    FROM buyer_pitches b
    WHERE b.vin = p.vin AND b.buyer_key = p.buyer_key
  ) lp ON true
  WHERE is_staff()
    AND NOT EXISTS (SELECT 1 FROM outreach_opt_outs x WHERE x.phone = p.buyer_phone)
  ORDER BY p.vin, p.rank;
$$;
REVOKE ALL ON FUNCTION public.marketplace_buyer_picks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_buyer_picks() TO authenticated, service_role;

-- The list itself, for everything else that texts a buyer: the hourly
-- recompute (service key), and the by-hand Text buttons on Buyer Match and the
-- marketplace's Send-to-a-buyer sheet (staff). Numbers only — not what they said.
CREATE OR REPLACE FUNCTION public.opted_out_phones()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT phone FROM outreach_opt_outs WHERE is_staff() $$;
REVOKE ALL ON FUNCTION public.opted_out_phones() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opted_out_phones() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
