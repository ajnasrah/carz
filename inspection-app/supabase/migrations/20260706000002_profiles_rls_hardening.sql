-- Enforce the approval gate + role system at the DATABASE level, not just the UI.
--
-- Before this, profiles RLS (migration 20260601000004) let ANY authenticated or anon
-- caller UPDATE/INSERT any profile row and column — so anyone with the public anon key
-- could self-approve (approval_status='approved') or self-promote (role='admin') via a
-- direct API call. This migration closes that hole with two layers:
--
--   1. RLS: you may only write your OWN profile row; only admins may write others' rows
--      or delete anyone.
--   2. A column guard trigger: even on your own row you cannot promote yourself to admin,
--      approve yourself, or flip your buyer/employee type once set. Admins and trusted
--      backends (migrations, service_role, SECURITY DEFINER triggers) bypass the guard.
--
-- Nothing legitimate relies on the wide-open policies: the browser extension never touches
-- profiles, ensurePrimaryAdmin() is dead code, and the primary-admin bootstrap runs inside
-- migrations (postgres role, which bypasses RLS). Verified before writing this.

-- ---------------------------------------------------------------------------
-- Admin check. SECURITY DEFINER so it reads profiles bypassing RLS — this both
-- avoids infinite recursion when called from a profiles policy and lets it see
-- the caller's role. Returns false when there is no authenticated user (anon).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Column guard. Fires for every insert/update. Trusted backends and admins pass
-- through untouched; public callers (anon / authenticated non-admins) cannot set
-- the privileged columns. current_user is 'anon' or 'authenticated' only for
-- requests coming through PostgREST with the public keys; migrations and
-- SECURITY DEFINER triggers run as 'postgres', service_role runs as 'service_role'.
-- ---------------------------------------------------------------------------
-- NOTE: SECURITY INVOKER (the default — no SECURITY DEFINER) is REQUIRED here.
-- Under SECURITY DEFINER, current_user would resolve to the function owner
-- (postgres) and the guard would always bypass. As invoker, current_user is the
-- real caller role ('authenticated' / 'anon' / 'service_role' / 'postgres').
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
    RETURN NEW;
  END IF;

  -- UPDATE by a non-admin on their own row:
  --  · cannot self-promote to admin (other role labels like buyer/lot_manager are fine)
  IF NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin' THEN
    NEW.role := OLD.role;
  END IF;
  --  · cannot change their own approval status (no self-approve)
  NEW.approval_status := OLD.approval_status;
  --  · cannot flip buyer <-> employee once it has been chosen
  IF OLD.account_type IS NOT NULL THEN
    NEW.account_type := OLD.account_type;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileges ON profiles;
CREATE TRIGGER guard_profile_privileges
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- Replace the wide-open policies with row-scoped ones.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Clear out every previously-defined profiles policy (from the initial schema and
-- the 20260601000004 "fix permissions" migration) so we start clean.
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Anyone can read profiles" ON profiles;
DROP POLICY IF EXISTS "Anon can read profiles" ON profiles;
DROP POLICY IF EXISTS "Authenticated can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Anon can upsert profiles" ON profiles;
DROP POLICY IF EXISTS "Authenticated can update profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Anon can update profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access" ON profiles;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_delete" ON profiles;

-- Read stays public: the app reads profiles for admin checks and rosters, and the
-- column guard already prevents any privileged write, so public read is not a hole.
CREATE POLICY "profiles_select"
  ON profiles FOR SELECT
  USING (true);

-- Insert only your own row (id = auth.uid()); admins may insert on anyone's behalf.
-- The column guard still forces new rows to role<>admin + approval_status='pending'.
CREATE POLICY "profiles_insert"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- Update only your own row; admins may update any row. Column guard blocks escalation.
CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- Only admins may delete users.
CREATE POLICY "profiles_delete"
  ON profiles FOR DELETE
  USING (public.is_admin());
