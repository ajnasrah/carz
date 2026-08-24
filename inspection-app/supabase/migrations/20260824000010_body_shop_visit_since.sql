-- "This visit" on a job card was anchored to entered_at — when the CARD was
-- made, not when the car arrived. That is only the same thing for a job the
-- Telegram bot opened as the photos landed. A card made by hand, by the
-- location sync, or by the history backfill is created days or weeks after the
-- shop actually shot the car, so every real photo fell before the window and
-- the card read "Nothing shot this visit yet" on a car with twelve pictures in
-- the archive. 11 open cards were showing zero of their photos that way.
--
-- The honest boundary for "this visit" is the last time the car LEFT the body
-- shop: everything shot since then belongs to the visit it is on now, whenever
-- somebody got round to making the card. A car that has never been here before
-- has no boundary at all, and every shop photo of it is from this visit.
--
-- Only completed jobs count, and only ones that closed at or before this job
-- opened — an open duplicate card is not a previous visit, and a job that
-- closed afterwards is a later one.
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
    prev.visit_since
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
