-- Sold Reports access: an admin-granted per-user flag, plus a request queue for
-- everyone who doesn't have it yet.
--
-- WHY A DEDICATED COLUMN AND NOT profiles.roles[]
-- roles[] is writable by the owner of the row: guard_profile_privileges() only
-- pins role / approval_status / account_type, so a non-admin holding the public
-- anon key can PATCH their own roles array to anything. Gating the sold book on
-- roles[] would therefore be a flag anyone could set on themselves. This adds a
-- real column and extends the guard to pin it the same way approval_status is
-- pinned — only an admin (or the service key) can turn it on.
--
-- Admins are NOT stamped with the flag: the app treats admin as implying access,
-- so promoting someone grants it and demoting them takes it back without having
-- to keep two columns in step.

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sold_reports_access BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.sold_reports_access IS
  'Admin-granted: may view Sold Reports. Admins bypass it. Exporting is admin-only regardless.';

-- ---------------------------------------------------------------------------
-- 2. Extend the column guard so the flag can''t be self-granted.
--    Full body restated because CREATE OR REPLACE replaces the whole function;
--    everything except the sold_reports_access lines is 20260706000002 verbatim.
--    SECURITY INVOKER (no DEFINER) is still REQUIRED — see that migration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Trusted contexts (migrations, service_role, definer triggers) do anything.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- Authenticated admins do anything (promote, approve, reject, edit any row).
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A self-created profile can never start out privileged or pre-approved.
    IF NEW.role = 'admin' THEN
      NEW.role := 'inspector';
    END IF;
    NEW.approval_status := 'pending';
    NEW.sold_reports_access := false;
    RETURN NEW;
  END IF;

  -- UPDATE by a non-admin on their own row:
  --  · cannot self-promote to admin (other role labels like buyer/lot_manager are fine)
  IF NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin' THEN
    NEW.role := OLD.role;
  END IF;
  --  · cannot change their own approval status (no self-approve)
  NEW.approval_status := OLD.approval_status;
  --  · cannot grant themselves the sold book (that's what the request queue is for)
  NEW.sold_reports_access := OLD.sold_reports_access;
  --  · cannot flip buyer <-> employee once it has been chosen
  IF OLD.account_type IS NOT NULL THEN
    NEW.account_type := OLD.account_type;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself already exists and points at this name; recreate it anyway
-- so the migration is self-sufficient if run against a database that predates it.
DROP TRIGGER IF EXISTS guard_profile_privileges ON public.profiles;
CREATE TRIGGER guard_profile_privileges
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- 3. The request queue
--
-- Rows are written ONLY by /api/sold-report-access using the service key, which
-- bypasses RLS — hence no INSERT policy below. That's deliberate: the endpoint
-- verifies the caller's session token and stamps user_id itself, so a request
-- can't be filed in someone else's name and the queue can't be flooded from the
-- browser with rows for users who never asked.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sold_report_access_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Snapshot of who asked, so the queue still reads sensibly next to a profile
  -- that has since been renamed.
  name        TEXT,
  phone       TEXT,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'granted', 'denied')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ,
  decided_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- One open request per person: pressing the button twice, or on two devices,
-- must not put the same name in the admin's queue twice. Partial, so the history
-- of past granted/denied requests is kept.
CREATE UNIQUE INDEX IF NOT EXISTS sold_report_access_requests_one_open
  ON public.sold_report_access_requests (user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS sold_report_access_requests_pending
  ON public.sold_report_access_requests (created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.sold_report_access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sold_report_access_requests_select ON public.sold_report_access_requests;
DROP POLICY IF EXISTS sold_report_access_requests_update ON public.sold_report_access_requests;
DROP POLICY IF EXISTS sold_report_access_requests_delete ON public.sold_report_access_requests;

-- You can see your own request (so the button can say "requested" after a
-- reload); admins see the whole queue.
CREATE POLICY sold_report_access_requests_select
  ON public.sold_report_access_requests FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

-- Only an admin decides. No INSERT policy on purpose — see the note above.
CREATE POLICY sold_report_access_requests_update
  ON public.sold_report_access_requests FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY sold_report_access_requests_delete
  ON public.sold_report_access_requests FOR DELETE
  USING (public.is_admin());

-- Table privileges are separate from RLS: without these the policies above have
-- nothing to filter. INSERT is withheld from both public roles.
GRANT SELECT, UPDATE, DELETE ON public.sold_report_access_requests TO authenticated;
REVOKE ALL ON public.sold_report_access_requests FROM anon;
