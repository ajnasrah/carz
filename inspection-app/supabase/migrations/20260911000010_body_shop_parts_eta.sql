-- Parts Ordered had no clock on it.
--
-- Twenty-odd cars sat in that lane in days-owned order, which is the right sort
-- for every other lane and the wrong one for this one: what matters about a car
-- waiting on a bumper is WHEN THE BUMPER COMES, and the board had no idea. The
-- date existed — Jorge types "eta monday" into the car's notes the moment the
-- counter tells him — it just lived in a sentence nobody could sort by. So the
-- car arriving tomorrow sat below the one whose vendor went quiet three weeks
-- ago, and the only way to tell them apart was to open all twenty.
--
-- These four columns are that sentence, read (src/services/partsEta.js) and
-- written down:
--
--   parts_eta       the first delivery date in the note — what to chase
--   parts_eta_last  the last one, when a car is waiting on more than one part,
--                   because that is when the car can actually start
--   parts_eta_text  the words it came from, so the board can show its working
--                   and nobody has to trust a date they can't check
--   parts_eta_key   a fingerprint of the note it read, so the app knows when
--                   the sentence has changed underneath the answer
--
-- The read happens in the client, not here, because "next tuesday" needs a
-- calendar and a notion of what the person meant, and plpgsql is a bad place to
-- keep either. The client writes the answer on save; anything already in the
-- database with a note it has never read gets caught on the next board load
-- (syncPartsEta in services/bodyShop.js), which is also the backfill — there is
-- no one-off migration script to run and nothing to re-run if a phrasing gets
-- better later.
--
-- Nothing here changes a car's stage. The parts checklist still owns that
-- (sync_body_shop_job_parts_stage): a date is a promise, and a promise is not a
-- part arriving. A car whose ETA has gone by stays in Parts Ordered — that is
-- precisely the pile this exists to make visible.

ALTER TABLE body_shop_jobs
  ADD COLUMN IF NOT EXISTS parts_eta      DATE,
  ADD COLUMN IF NOT EXISTS parts_eta_last DATE,
  ADD COLUMN IF NOT EXISTS parts_eta_text TEXT,
  ADD COLUMN IF NOT EXISTS parts_eta_key  TEXT;

COMMENT ON COLUMN body_shop_jobs.parts_eta IS
  'First delivery date read out of notes. Written by the client, not a trigger.';
COMMENT ON COLUMN body_shop_jobs.parts_eta_last IS
  'Last delivery date in the note when several were given — when the car can start.';
COMMENT ON COLUMN body_shop_jobs.parts_eta_text IS
  'The phrase the date was read from, shown on the board so the read is checkable.';
COMMENT ON COLUMN body_shop_jobs.parts_eta_key IS
  'Fingerprint of the note that was read; a mismatch means re-read it.';

-- Appended at the end, which is what keeps CREATE OR REPLACE legal on the
-- existing view. Everything above is unchanged from 20260824000010.
CREATE OR REPLACE VIEW body_shop_board AS
 SELECT j.id,
    j.stock_number,
    j.vin,
    j.vin6,
    j.status,
    j.price,
    j.notes,
    j.assigned_tech,
    j.entered_at,
    j.started_at,
    j.completed_at,
    j.source,
    j.created_at,
    j.updated_at,
    i.vehicle_year,
    i.vehicle_make,
    i.vehicle_model,
    i.vehicle_color,
    i.mileage,
    COALESCE(p.name, ti.name) AS tech_name,
    j.stock_number IS NULL AS awaiting_inventory,
    GREATEST(0, (EXTRACT(epoch FROM COALESCE(j.completed_at, now()) - j.entered_at) / 86400::numeric)::integer) AS days_in_shop,
    GREATEST(0, COALESCE(now()::date - frazer_date(i.purchase_date), frazer_num(i.days_on_lot)::integer)) AS days_owned,
    COALESCE(pc.parts_total, 0::bigint) AS parts_total,
    COALESCE(pc.parts_needed, 0::bigint) AS parts_needed,
    COALESCE(pc.parts_ordered, 0::bigint) AS parts_ordered,
    COALESCE(pc.parts_received, 0::bigint) AS parts_received,
    COALESCE(pc.parts_cost, 0::numeric) AS parts_cost,
    j.charge_status,
    j.agreed_amount,
    j.counter_amount,
    j.counter_note,
    cb.name AS counter_by_name,
    j.payout_id IS NOT NULL AS paid,
    j.paid_amount,
    j.approved_at,
    j.counter_at,
    j.agreed_at,
    ab.name AS agreed_by_name,
    j.final_check_at,
    j.assigned_tech_invite,
    j.parts_in_at,
    j.held_at,
    prev.visit_since,
    j.parts_eta,
    j.parts_eta_last,
    j.parts_eta_text,
    j.parts_eta_key
   FROM body_shop_jobs j
     LEFT JOIN inventory i ON j.stock_number IS NOT NULL AND i.stock_number = j.stock_number OR j.stock_number IS NULL AND j.vin6 IS NOT NULL AND upper("right"(i.vehicle_vin, 6)) = upper(j.vin6)
     LEFT JOIN profiles p ON p.id = j.assigned_tech
     LEFT JOIN body_shop_tech_invites ti ON ti.id = j.assigned_tech_invite
     LEFT JOIN profiles cb ON cb.id = j.counter_by
     LEFT JOIN profiles ab ON ab.id = j.agreed_by
     LEFT JOIN LATERAL ( SELECT count(*) AS parts_total,
            count(*) FILTER (WHERE bp.status = 'needed'::text) AS parts_needed,
            count(*) FILTER (WHERE bp.status = 'ordered'::text) AS parts_ordered,
            count(*) FILTER (WHERE bp.status = 'received'::text) AS parts_received,
            COALESCE(sum(bp.cost), 0::numeric) AS parts_cost
           FROM body_shop_parts bp
          WHERE bp.job_id = j.id) pc ON true
     LEFT JOIN LATERAL ( SELECT max(pj.completed_at) AS visit_since
           FROM body_shop_jobs pj
          WHERE upper(pj.vin6) = upper(j.vin6)
            AND pj.id <> j.id
            AND pj.completed_at IS NOT NULL
            AND pj.completed_at <= j.entered_at) prev ON true
  WHERE is_employee();

REVOKE ALL ON body_shop_board FROM PUBLIC, anon;
GRANT SELECT ON body_shop_board TO authenticated;

NOTIFY pgrst, 'reload schema';
