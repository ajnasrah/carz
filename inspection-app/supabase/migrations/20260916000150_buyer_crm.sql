-- The buyer book: one screen for a buyer, instead of GoHighLevel plus four tabs.
--
-- Everything about a buyer already exists, in pieces nobody can see together:
-- what he has bought lives in buyer_training_rows() (every channel, not just
-- SmartAuction), his number in sa_sold_sales, what we texted him in
-- sms_messages, what we pitched him in buyer_pitches and outreach_offers, and
-- whether he told us to stop in outreach_opt_outs.
--
-- Staff only, both functions: they return phone numbers and what buyers pay.

-- One row per buyer, newest business first. p_q matches name, phone or email.
CREATE OR REPLACE FUNCTION public.buyer_crm_list(p_q text DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (
  buyer_key text, buyer_name text, phone text, email text, city text, state text,
  cars_total integer, cars_365 integer, spend_365 numeric, last_sale_date date,
  last_vehicle text, channels text[], do_not_text boolean,
  last_texted_at timestamptz, pitches_30d integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH rows AS (
    SELECT * FROM buyer_training_rows(false, 1000000, 0) WHERE buyer_key IS NOT NULL
  ), agg AS (
    SELECT r.buyer_key,
           (array_agg(r.buyer_name ORDER BY r.sale_date DESC NULLS LAST))[1]  AS buyer_name,
           (array_agg(r.buyer_phone ORDER BY r.sale_date DESC NULLS LAST)
              FILTER (WHERE nullif(btrim(r.buyer_phone), '') IS NOT NULL))[1]  AS phone,
           (array_agg(r.buyer_email ORDER BY r.sale_date DESC NULLS LAST)
              FILTER (WHERE nullif(btrim(r.buyer_email), '') IS NOT NULL))[1]  AS email,
           (array_agg(r.buyer_city  ORDER BY r.sale_date DESC NULLS LAST)
              FILTER (WHERE nullif(btrim(r.buyer_city), '') IS NOT NULL))[1]   AS city,
           (array_agg(r.buyer_state ORDER BY r.sale_date DESC NULLS LAST)
              FILTER (WHERE nullif(btrim(r.buyer_state), '') IS NOT NULL))[1]  AS state,
           count(*)::int                                                       AS cars_total,
           count(*) FILTER (WHERE r.sale_date >= current_date - 365)::int       AS cars_365,
           COALESCE(sum(r.sale_price) FILTER (WHERE r.sale_date >= current_date - 365), 0) AS spend_365,
           max(r.sale_date)                                                    AS last_sale_date,
           (array_agg(concat_ws(' ', r.year, r.make, r.model) ORDER BY r.sale_date DESC NULLS LAST))[1] AS last_vehicle,
           array_agg(DISTINCT COALESCE(r.channel_label, r.channel_key))        AS channels
      FROM rows r
     GROUP BY r.buyer_key
  )
  SELECT a.buyer_key, a.buyer_name, a.phone, a.email, a.city, a.state,
         a.cars_total, a.cars_365, a.spend_365, a.last_sale_date, a.last_vehicle, a.channels,
         EXISTS (SELECT 1 FROM outreach_opt_outs x
                  WHERE x.phone = right(regexp_replace(COALESCE(a.phone, ''), '\D', '', 'g'), 10)
                    AND nullif(a.phone, '') IS NOT NULL),
         (SELECT max(m.created_at) FROM sms_messages m
           WHERE right(regexp_replace(m.phone, '\D', '', 'g'), 10)
               = right(regexp_replace(COALESCE(a.phone, '~'), '\D', '', 'g'), 10)),
         (SELECT count(*)::int FROM buyer_pitches b
           WHERE b.buyer_key = a.buyer_key AND b.pitched_at >= now() - interval '30 days')
    FROM agg a
   WHERE is_staff()
     AND (
       p_q IS NULL OR btrim(p_q) = ''
       OR a.buyer_name ILIKE '%' || btrim(p_q) || '%'
       OR COALESCE(a.email, '') ILIKE '%' || btrim(p_q) || '%'
       OR (regexp_replace(COALESCE(p_q, ''), '\D', '', 'g') <> ''
           AND regexp_replace(COALESCE(a.phone, ''), '\D', '', 'g')
               LIKE '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
     )
   ORDER BY a.last_sale_date DESC NULLS LAST, a.cars_total DESC
   LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;
REVOKE ALL ON FUNCTION public.buyer_crm_list(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_crm_list(text, integer) TO authenticated, service_role;

-- One buyer, everything: what he bought, every text either way, and every car
-- we put in front of him — by hand (buyer_pitches) or by queue (outreach_offers).
CREATE OR REPLACE FUNCTION public.buyer_crm_detail(p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH rows AS (
    SELECT * FROM buyer_training_rows(false, 1000000, 0) WHERE buyer_key = p_key
  ), ph AS (
    SELECT right(regexp_replace(
             (SELECT r.buyer_phone FROM rows r
               WHERE nullif(btrim(r.buyer_phone), '') IS NOT NULL
               ORDER BY r.sale_date DESC NULLS LAST LIMIT 1), '\D', '', 'g'), 10) AS p
  )
  SELECT CASE WHEN NOT is_staff() THEN NULL ELSE jsonb_build_object(
    'buyer_key', p_key,
    'phone', (SELECT p FROM ph),
    'do_not_text', EXISTS (SELECT 1 FROM outreach_opt_outs x WHERE x.phone = (SELECT p FROM ph)),
    'purchases', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vin', r.vin, 'sale_date', r.sale_date, 'sale_price', r.sale_price,
        'vehicle', concat_ws(' ', r.year, r.make, r.model),
        'segment', r.segment, 'odometer', r.odometer,
        'channel', COALESCE(r.channel_label, r.channel_key))
        ORDER BY r.sale_date DESC NULLS LAST)
      FROM rows r), '[]'::jsonb),
    'texts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'direction', m.direction, 'body', m.body, 'status', m.status,
        'created_at', m.created_at, 'source', m.source) ORDER BY m.created_at DESC)
      FROM sms_messages m
      WHERE (SELECT p FROM ph) IS NOT NULL
        AND right(regexp_replace(m.phone, '\D', '', 'g'), 10) = (SELECT p FROM ph)), '[]'::jsonb),
    'pitches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vin', b.vin, 'stock_number', b.stock_number, 'pitched_at', b.pitched_at,
        'by', (SELECT nullif(pr.name, '') FROM profiles pr WHERE pr.id = b.pitched_by),
        'source', 'marketplace') ORDER BY b.pitched_at DESC)
      FROM buyer_pitches b WHERE b.buyer_key = p_key), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vin', o.vin, 'status', o.status, 'created_at', o.created_at,
        'replied_at', o.replied_at, 'reply', o.reply_body, 'source', 'outreach')
        ORDER BY o.created_at DESC)
      FROM outreach_offers o
      WHERE o.buyer_key = p_key
         OR ((SELECT p FROM ph) IS NOT NULL AND o.phone = (SELECT p FROM ph))), '[]'::jsonb)
  ) END;
$$;
REVOKE ALL ON FUNCTION public.buyer_crm_detail(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_crm_detail(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
