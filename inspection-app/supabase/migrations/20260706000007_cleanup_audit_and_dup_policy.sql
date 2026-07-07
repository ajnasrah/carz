-- Drop the temporary audit helper from migration ...0006 (verification done).
DROP FUNCTION IF EXISTS public._audit_profiles_security();

-- Remove the redundant leftover INSERT policy from the original schema. It only allowed
-- own-row inserts (auth.uid()=id), which our profiles_insert policy already covers, so
-- this is a cleanup — not a permission change.
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
