-- Two fixes so the new DB-level admin gate (migration ...0002) recognizes the owner.
--
-- Reality check (verified against prod): NO profile row has role='admin' — the primary
-- admin (Abdullah, phone 19018319661) has role='inspector' and was only ever "admin"
-- via the frontend's phone check (isPrimaryAdmin). With the new is_admin() gating all
-- admin writes on role='admin', the owner would be unable to approve/promote/delete users.
--
-- Phones are stored as '19018319661' (11 digits, leading 1, no '+').

-- 1) Make the data correct: the owner is a real admin.
UPDATE profiles
SET role = 'admin'
WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('9018319661', '19018319661');

-- 2) Belt-and-suspenders: is_admin() also recognizes the primary admin by phone, so a
--    stray role reset can never lock the owner out. Mirrors frontend isPrimaryAdmin().
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('9018319661', '19018319661')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
