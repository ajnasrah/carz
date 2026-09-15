-- Buyer Outreach: a reply goes to the buyer's most recent offer, and "most
-- recent" was sent_at alone. Two texts to one buyer in the same instant (a
-- manual "send next car" right after an automatic send) tie, and the reply
-- could land on the older car. The offer id breaks the tie. Found by the
-- rolled-back end-to-end run against prod, where every now() is one instant.

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
END $$;
