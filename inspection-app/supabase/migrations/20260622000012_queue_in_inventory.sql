-- Add in_inventory flag (+ stock_number) to the ready-to-sell queue so the
-- extension can warn on cars that aren't matched in Frazer inventory.
DROP FUNCTION IF EXISTS ready_to_sell_queue();
CREATE OR REPLACE FUNCTION ready_to_sell_queue()
RETURNS TABLE (vin6 text, miles text, condition text, notes text,
               photo_count integer, status text, message_date timestamptz,
               stock_number text, in_inventory boolean)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    w.vin6,
    (array_agg(w.parsed->>'miles' ORDER BY w.received_at DESC) FILTER (WHERE w.parsed ? 'miles'))[1],
    (array_agg(w.parsed->>'condition' ORDER BY w.received_at DESC) FILTER (WHERE w.parsed ? 'condition'))[1],
    (array_agg(w.parsed->>'notes' ORDER BY w.received_at DESC) FILTER (WHERE w.parsed ? 'notes'))[1],
    count(*) FILTER (WHERE w.media_path IS NOT NULL)::int,
    COALESCE(s.status, 'queued'),
    max(w.received_at),
    max(inv.stock_number),
    bool_or(inv.stock_number IS NOT NULL)
  FROM wa_inbound_messages w
  LEFT JOIN sa_queue_status s ON s.vin6 = w.vin6
  LEFT JOIN inventory inv ON upper(inv.last_6_vin) = upper(w.vin6)
  WHERE w.station IN ('ready', 'seller') AND w.vin6 IS NOT NULL
  GROUP BY w.vin6, s.status
  ORDER BY max(w.received_at) DESC;
$$;
GRANT EXECUTE ON FUNCTION ready_to_sell_queue() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
