-- The body shop group says far more than VINs, and none of it was kept.
--
-- WHAT WAS BROKEN
-- api/telegram.js read the body_shop group for one thing, a VIN, and threw the
-- rest of the sentence away. Of what the team actually types there:
--   * ~100 parts posts naming the car by MODEL, no VIN at all:
--       "Kona / Rear bumper assembly - Tristate Thursday"
--   * parts and status posts WITH a VIN, sometimes two cars in one message:
--       "364318 altima ordered arrive 9/11 // 570609 2023 1500 ordered arrive 9/14"
--   * decisions:  "Traverse as is no parts", "dont fix this its going to copart"
--   * which shop: "I ask Amera n she told me to take it to Jorge"
-- and in body_shop_out, "78419 / Still missing the fender liner" FINISHED the
-- car it was saying was not finished.
--
-- api/_lib/bodyShopChat.js now reads those. This migration is where it writes:
--
--   body_shop_parts.source_ref   the message a part came from; UNIQUE so a
--                                redelivered webhook or a re-run backfill cannot
--                                add the same bumper twice
--   body_shop_job_events         one row per automated change, carrying the
--                                message verbatim — the job card's "from the
--                                group chat" list, and the idempotency guard for
--                                every side effect that is not an insert
--   body_shop_chat_reads         which VIN-less messages have been bound to a car
--   finish_body_shop_job()       body_shop_out's close, which lifts a hold

-- ---------------------------------------------------------------- parts

ALTER TABLE body_shop_parts ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- A plain UNIQUE constraint, deliberately NOT a partial unique index.
-- PostgREST's upsert sends `ON CONFLICT (source_ref)`, and Postgres will only
-- infer a partial index for that when the statement repeats the index's WHERE
-- clause — which PostgREST never does. A partial index therefore fails every
-- upsert with "no unique or exclusion constraint matching the ON CONFLICT
-- specification", which is exactly what silently killed the mechanic chat.
-- NULLs never collide under UNIQUE, so the hand-added parts (no source_ref) are
-- unaffected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.body_shop_parts'::regclass
       AND conname = 'body_shop_parts_source_ref_key'
  ) THEN
    ALTER TABLE body_shop_parts
      ADD CONSTRAINT body_shop_parts_source_ref_key UNIQUE (source_ref);
  END IF;
END $$;

COMMENT ON COLUMN body_shop_parts.source_ref IS
'bsc:<telegram message key>:<segment>:part:<n> when read out of the body_shop
group by api/_lib/bodyShopChat.js; NULL when added by hand.';

-- ---------------------------------------------------------------- events

CREATE TABLE IF NOT EXISTS body_shop_job_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: an event is the record of what the chat said and did,
  -- and it outlives a job somebody deletes by hand.
  job_id       UUID REFERENCES body_shop_jobs(id) ON DELETE SET NULL,
  stock_number TEXT,
  vin6         TEXT,
  -- parts | parts_ordered | parts_received | eta | hold | moved | progress |
  -- waiting | instruction | fault | note | finish_blocked | finished |
  -- finished_no_job | hold_released | part_ordered | part_received
  kind         TEXT NOT NULL,
  note         TEXT,            -- the message, verbatim (tags included)
  tags         TEXT[],          -- coordinator tags (MH, Jr, M5…), uninterpreted
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ref   TEXT NOT NULL,
  message_id   TEXT,            -- wa_inbound_messages.message_id
  sender       TEXT,            -- wa_from
  event_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- the MESSAGE time
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Plain UNIQUE for the same reason as body_shop_parts.source_ref.
  CONSTRAINT body_shop_job_events_source_ref_key UNIQUE (source_ref)
);

CREATE INDEX IF NOT EXISTS idx_body_shop_job_events_job  ON body_shop_job_events (job_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_body_shop_job_events_vin6 ON body_shop_job_events (vin6);
CREATE INDEX IF NOT EXISTS idx_body_shop_job_events_msg  ON body_shop_job_events (message_id);

ALTER TABLE body_shop_job_events ENABLE ROW LEVEL SECURITY;

-- Read: employees, the same gate as body_shop_jobs. NOT plain `TO authenticated`
-- with USING (true) — buyers are authenticated too. Nobody but the server writes.
REVOKE ALL ON body_shop_job_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON body_shop_job_events TO authenticated;
GRANT ALL ON body_shop_job_events TO service_role;

DROP POLICY IF EXISTS body_shop_job_events_read ON body_shop_job_events;
CREATE POLICY body_shop_job_events_read ON body_shop_job_events
  FOR SELECT TO authenticated USING (is_employee());

-- ---------------------------------------------------------------- reads

-- A VIN-less message ("Back to George") that has been bound to a car. Messages
-- that are not here and say something actionable are still waiting for the next
-- VIN from the group to claim them (sweepUnboundBodyShopChat).
CREATE TABLE IF NOT EXISTS body_shop_chat_reads (
  message_id TEXT PRIMARY KEY,
  vin6       TEXT,
  job_id     UUID REFERENCES body_shop_jobs(id) ON DELETE SET NULL,
  binding    TEXT,              -- vin | reply | model | sender | next_vin
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_shop_chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON body_shop_chat_reads FROM PUBLIC, anon, authenticated;
GRANT ALL ON body_shop_chat_reads TO service_role;

-- ---------------------------------------------------------------- finishing

-- body_shop_out's close. Differs from close_body_shop_job() in exactly one way:
-- it also closes a job that is ON HOLD.
--
-- close_body_shop_job() skips held jobs on purpose, because it is fired by the
-- location trigger — a junk car pushed round the back of the lot must not be
-- stamped done. But body_shop_out is a person typing this car's VIN and "good to
-- go". 152102 was posted exactly that on 2026-08-26, the day after its job was
-- held, and the job is still on hold three weeks later with the car at the
-- auction. A statement about this car outranks a parking decision made the day
-- before; the release is written down (hold_released) so it is never silent.
--
-- A car finished with no job at all (250768) is the normal case for a car that
-- never came through the group, and is recorded as finished_no_job.
--
-- Idempotent on p_source_ref: a redelivered webhook finds no open job and its
-- event row already there, and does nothing.
CREATE OR REPLACE FUNCTION finish_body_shop_job(
  p_vin6       TEXT,
  p_event      TIMESTAMPTZ DEFAULT NOW(),
  p_source_ref TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock   TEXT;
  v_id      UUID;
  v_entered TIMESTAMPTZ;
  v_status  TEXT;
  v_held    TIMESTAMPTZ;
  v_ref     TEXT := COALESCE(p_source_ref, 'finish:' || COALESCE(p_vin6, '') || ':' || COALESCE(p_event, NOW())::text);
BEGIN
  IF p_vin6 IS NOT NULL THEN
    SELECT stock_number INTO v_stock FROM lookup_vin_by_last6(p_vin6) LIMIT 1;
  END IF;

  SELECT id, entered_at, status, held_at INTO v_id, v_entered, v_status, v_held
  FROM body_shop_jobs
  WHERE status <> 'done'
    AND (
      (v_stock IS NOT NULL AND stock_number = v_stock)
      OR (p_vin6 IS NOT NULL AND upper(COALESCE(vin6, '')) = upper(p_vin6))
    )
  ORDER BY entered_at ASC
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO body_shop_job_events (job_id, stock_number, vin6, kind, detail, source_ref, event_at)
    VALUES (NULL, v_stock, upper(p_vin6), 'finished_no_job',
            jsonb_build_object('station', 'body_shop_out'), v_ref, COALESCE(p_event, NOW()))
    ON CONFLICT (source_ref) DO NOTHING;
    RETURN NULL;
  END IF;

  IF v_status = 'on_hold' THEN
    INSERT INTO body_shop_job_events (job_id, stock_number, vin6, kind, detail, source_ref, event_at)
    VALUES (v_id, v_stock, upper(p_vin6), 'hold_released',
            jsonb_build_object('station', 'body_shop_out', 'held_at', v_held), v_ref || ':hold',
            COALESCE(p_event, NOW()))
    ON CONFLICT (source_ref) DO NOTHING;
  END IF;

  -- Event time, floored at arrival — same rule as close_body_shop_job(). The
  -- status trigger clears held_at on the way out of on_hold.
  UPDATE body_shop_jobs
     SET status       = 'done',
         completed_at = GREATEST(COALESCE(p_event, NOW()), v_entered)
   WHERE id = v_id;

  INSERT INTO body_shop_job_events (job_id, stock_number, vin6, kind, detail, source_ref, event_at)
  VALUES (v_id, v_stock, upper(p_vin6), 'finished',
          jsonb_build_object('station', 'body_shop_out', 'was', v_status), v_ref,
          COALESCE(p_event, NOW()))
  ON CONFLICT (source_ref) DO NOTHING;

  RETURN v_id;
END;
$$;

-- Server only. PUBLIC gets EXECUTE on every new function by default, and
-- `authenticated` includes buyers.
REVOKE ALL ON FUNCTION finish_body_shop_job(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finish_body_shop_job(TEXT, TIMESTAMPTZ, TEXT) TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.finish_body_shop_job(text,timestamptz,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot EXECUTE finish_body_shop_job';
  END IF;
  IF has_function_privilege('anon', 'public.finish_body_shop_job(text,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finish_body_shop_job(text,timestamptz,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'finish_body_shop_job must be service_role only';
  END IF;
  IF has_table_privilege('anon', 'public.body_shop_job_events', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read body_shop_job_events';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
