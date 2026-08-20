-- Name every channel we sell through, so Buyer Match can learn from all of them.
--
-- WHAT WAS WRONG
-- The buyer-match engine trained on `sa_sold_sales` and nothing else: 1,236 rows,
-- every one of them `source = 'smartauction'`. Meanwhile the Frazer sold export
-- has 6,463 rows covering every sale the business has made since Jan 2025, and it
-- names the counterparty in `last_name`:
--
--     SMART AUCTION 1152 · DAA 1110 · UAX MEMPHIS 916 · UAX 481 · DAA MEMPHIS 474
--     ADESA 312 · MANHEIM NASHVILLE 300 · MT MORIAH 120 · THORNTON CHEVROLET 115
--     ACV 106 · DEALERS AUTO AUCTION 103 · ... 379 distinct values in all
--
-- So roughly 5,100 sales — the large majority of the business — were invisible to
-- the thing whose whole job is knowing who buys our cars.
--
-- WHAT THIS DOES
-- Two lookup tables and a resolver turn that free-text field into a channel plus a
-- customer. The rules follow the shape of the real data:
--
--   * The same lane is typed many ways. UAX, UAX MEMPHIS, UAX (OLIVE BRANCH) and
--     UAX ARB are one auction; SMART AUCTION, SMARTAUCTION and SMART AUCITON are
--     one marketplace. Aliases collapse them.
--   * For UAX / DAA / ADESA / Manheim / ACV / OpenLane we get no buyer list — the
--     lane sells the car and we never learn to whom. Each of those lanes therefore
--     becomes ONE customer, which is exactly how it behaves from our side: a place
--     that reliably takes a certain kind of car at a certain price. When we can
--     export real buyers from a lane, flip its `per_buyer_data` to true and the
--     engine starts profiling individuals instead.
--   * SmartAuction is the one lane where we DO have per-buyer data, and it already
--     lives in sa_sold_sales with names, phones and emails. So the Frazer copy of
--     a SmartAuction sale is dropped rather than double-counted.
--   * "UAX (B & J AUTO SALES LLC)" names the dealer who bought it inside the lane.
--     That is kept in `buyer_detail` but is NOT used as the training identity
--     while the lane is one customer — no data is lost, and the switch is one
--     column when the full buyer list arrives.
--   * "CARZ JACKSON SIPES" is our own Jackson store selling to a retail customer
--     named Sipes. Channel is the store, buyer is the customer.
--   * ARB / ARBITRATION marks a sale that came back. Flagged, and excluded from
--     training by default — an arbitrated sale is not evidence that anyone bought.

-- ---------------------------------------------------------------------------
-- 1. Who counts as staff. Financial and customer data must not reach a signed-in
--    marketplace BUYER, and `authenticated` includes them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND COALESCE(approval_status, 'approved') = 'approved'
      AND (role = 'admin' OR account_type = 'employee')
  );
$$;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The channels themselves.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_channels (
  channel_key    text PRIMARY KEY,
  label          text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('online_auction', 'physical_auction', 'retail', 'direct', 'unknown')),
  -- false = the lane sells to buyers we never see, so the lane IS the customer.
  -- Flip to true the day we can upload that lane's buyer list.
  per_buyer_data boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  note           text
);

INSERT INTO public.sale_channels (channel_key, label, kind, per_buyer_data, note) VALUES
  ('smartauction', 'SmartAuction',        'online_auction',   true,  'Per-buyer data lands in sa_sold_sales via the daily InventoryResults export.'),
  ('uax',          'UAX',                 'physical_auction', false, 'One customer until we can export UAX buyer lists.'),
  ('daa',          'DAA',                 'physical_auction', false, 'Includes DAA Memphis, DAA Jackson and DAA of the Rockies.'),
  ('adesa',        'ADESA',               'physical_auction', false, 'One customer until we can export ADESA buyer lists.'),
  ('manheim',      'Manheim',             'physical_auction', false, 'Nashville, Denver, Atlanta and the arbitration desk.'),
  ('acv',          'ACV',                 'online_auction',   false, NULL),
  ('openlane',     'OpenLane',            'online_auction',   false, NULL),
  ('daa_auto',     'Dealers Auto Auction','physical_auction', false, NULL),
  ('mycentral',    'MyCentral Auction',   'physical_auction', false, NULL),
  ('copart',       'Copart',              'online_auction',   false, NULL),
  ('americas_aa',  'America''s AA',       'physical_auction', false, 'AAA-Denver, AAA-Austin, Americas AA Austin.'),
  ('tupelo_aa',    'Tupelo AA',           'physical_auction', false, NULL),
  ('mountain_st',  'Mountain State AA',   'physical_auction', false, NULL),
  ('give_me_vin',  'Give Me The VIN',     'online_auction',   false, 'Online buying service; one counterparty by nature.'),
  ('carz_jackson', 'Carz Jackson',        'retail',           true,  'Our own Jackson store; the trailing name is the retail customer.'),
  ('direct',       'Direct',              'direct',           true,  'A named dealer or retail customer we sold to ourselves.')
ON CONFLICT (channel_key) DO UPDATE
  SET label = EXCLUDED.label, kind = EXCLUDED.kind, note = EXCLUDED.note;

ALTER TABLE public.sale_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_channels_read ON public.sale_channels;
CREATE POLICY sale_channels_read ON public.sale_channels FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.sale_channels TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Aliases. Every spelling we have actually seen, longest first so that
--    "DAA OF THE ROCKIES" is not swallowed by "DAA".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_channel_aliases (
  pattern     text PRIMARY KEY,
  match_type  text NOT NULL DEFAULT 'prefix' CHECK (match_type IN ('exact', 'prefix', 'contains')),
  channel_key text NOT NULL REFERENCES public.sale_channels(channel_key) ON DELETE CASCADE,
  priority    int  NOT NULL DEFAULT 100
);

INSERT INTO public.sale_channel_aliases (pattern, match_type, channel_key, priority) VALUES
  -- SmartAuction, including the two long-standing typos.
  ('SMART AUCTION',        'prefix',   'smartauction', 10),
  ('SMARTAUCTION',         'prefix',   'smartauction', 10),
  ('SMART AUCITON',        'prefix',   'smartauction', 10),
  ('SMART AUCTIO',         'prefix',   'smartauction', 11),
  ('SMART ARB',            'exact',    'smartauction', 10),
  ('STREAMLINE AUTO SMART','prefix',   'smartauction', 10),
  -- Physical lanes.
  ('UAX',                  'prefix',   'uax',          20),
  ('DAA OF THE ROCKIES',   'prefix',   'daa',          15),
  ('DAA',                  'prefix',   'daa',          20),
  ('ADESA',                'prefix',   'adesa',        20),
  ('MANHEIM',              'prefix',   'manheim',      20),
  ('DEALERS AUTO AUCTION', 'prefix',   'daa_auto',     15),
  ('MY CENTRAL',           'prefix',   'mycentral',    20),
  ('MYCENTRAL',            'prefix',   'mycentral',    20),
  ('COPART',               'prefix',   'copart',       20),
  ('AAA-',                 'prefix',   'americas_aa',  20),
  ('AMERICAS AA',          'prefix',   'americas_aa',  20),
  ('TUPELO AA',            'prefix',   'tupelo_aa',    20),
  ('MOUNTAIN STATE',       'prefix',   'mountain_st',  20),
  -- Online services.
  ('ACV',                  'prefix',   'acv',          20),
  ('OPEN LANE',            'prefix',   'openlane',     20),
  ('OPENLANE',             'prefix',   'openlane',     20),
  ('GIVE ME THE VIN',      'prefix',   'give_me_vin',  20),
  -- Our own second store.
  ('CARZ JACKSON',         'prefix',   'carz_jackson', 20)
ON CONFLICT (pattern) DO UPDATE
  SET channel_key = EXCLUDED.channel_key, match_type = EXCLUDED.match_type, priority = EXCLUDED.priority;

CREATE INDEX IF NOT EXISTS sale_channel_aliases_priority ON public.sale_channel_aliases (priority, pattern);
ALTER TABLE public.sale_channel_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_channel_aliases_read ON public.sale_channel_aliases;
CREATE POLICY sale_channel_aliases_read ON public.sale_channel_aliases FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.sale_channel_aliases TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The resolver. Free-text counterparty in, (channel, customer, flags) out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_sale_channel(p_customer text)
RETURNS TABLE (channel_key text, buyer_label text, buyer_detail text, is_arbitration boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  u     text;
  base  text;
  paren text;
  arb   boolean;
  ch    public.sale_channels%ROWTYPE;
  hit   text;
  rest  text;
BEGIN
  u := btrim(regexp_replace(upper(COALESCE(p_customer, '')), '\s+', ' ', 'g'));
  IF u = '' THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  -- "UAX (B & J AUTO SALES LLC" — Frazer truncates at 25 chars, so the closing
  -- paren is often missing. Take everything after the opening one.
  paren := NULLIF(btrim(COALESCE(substring(u from '\(([^)]*)\)'), substring(u from '\((.*)$'))), '');
  base  := btrim(regexp_replace(regexp_replace(u, '\(.*$', '', 'g'), '\s+', ' ', 'g'));

  -- ARB / ARBITRATION anywhere as a whole word means the sale came back.
  arb  := (u ~ '(^|\s)ARB(ITRATION)?(\s|$)');
  base := btrim(regexp_replace(base, '(^|\s)ARB(ITRATION)?(\s|$)', ' ', 'g'));
  IF base = '' THEN base := u; END IF;

  SELECT a.channel_key INTO hit
  FROM public.sale_channel_aliases a
  WHERE (a.match_type = 'exact'    AND base = a.pattern)
     OR (a.match_type = 'prefix'   AND base LIKE a.pattern || '%')
     OR (a.match_type = 'contains' AND base LIKE '%' || a.pattern || '%')
  ORDER BY a.priority, length(a.pattern) DESC
  LIMIT 1;

  IF hit IS NULL THEN
    -- Nothing matched: a dealer or a retail customer we sold to directly.
    RETURN QUERY SELECT 'direct'::text, base, paren, arb;
    RETURN;
  END IF;

  SELECT * INTO ch FROM public.sale_channels WHERE public.sale_channels.channel_key = hit;

  IF hit = 'smartauction' THEN
    -- The real buyer lives in sa_sold_sales; nothing useful here.
    RETURN QUERY SELECT hit, NULL::text, paren, arb;
  ELSIF hit = 'carz_jackson' THEN
    -- "CARZ JACKSON SIPES" -> our store, customer Sipes.
    rest := btrim(regexp_replace(base, '^CARZ JACKSON', '', 'g'));
    RETURN QUERY SELECT hit, NULLIF(rest, ''), paren, arb;
  ELSIF ch.per_buyer_data THEN
    RETURN QUERY SELECT hit, base, paren, arb;
  ELSE
    -- The lane is the customer, by design, until its buyer list can be uploaded.
    RETURN QUERY SELECT hit, ch.label, paren, arb;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.resolve_sale_channel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_sale_channel(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
