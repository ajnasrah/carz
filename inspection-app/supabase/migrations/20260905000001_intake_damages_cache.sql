-- Damage rows read out of the Ready-to-Sell group's damage line.
--
-- The lot tech types one run-on sentence per car — "Gap in front bumper around
-- driver side headlight. Small scratches and chips on rear bumper. Scratch on
-- passenger side quarter panel rear." — and /api/parse-damages turns it into
-- SmartAuction damage rows so the listing form fills itself.
--
-- Cached here keyed on a hash of the source text, not a TTL: opening the popup
-- must not re-bill a parse of a message that hasn't changed, and re-shooting a
-- car (a new damage line, a new hash) must re-read it. One row per car — the
-- newest damage line is the one that describes the car as it stands now.
CREATE TABLE IF NOT EXISTS intake_damages (
  vin6       TEXT PRIMARY KEY,
  source_sha TEXT NOT NULL,
  damages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  model      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_damages_sha ON intake_damages (vin6, source_sha);

-- Written only by the endpoint, which holds the service key. The extension
-- reads its damages through that same endpoint (it needs the Anthropic call
-- anyway), so nothing else needs access — and the anon key ships in the
-- extension and in the web bundle.
ALTER TABLE intake_damages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE intake_damages FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
