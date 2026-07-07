-- New-user approval gate + buyer/employee account type.
--
-- Every new signup now lands in approval_status='pending' and is blocked from the
-- app until an admin approves them (see ProtectedRoute + Admin panel). At signup the
-- Setup page asks whether they're a 'buyer' (external, marketplace-only) or an
-- 'employee' (internal staff, full app once approved).
--
-- IMPORTANT: existing users are grandfathered in as approved employees so this
-- change never locks out anyone who already has access.

-- account_type: 'buyer' | 'employee' (NULL until the user picks in Setup)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS account_type TEXT;

-- approval_status: 'pending' | 'approved' | 'rejected'. New rows default to pending.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';

-- Grandfather every profile that already existed before this migration: approve them
-- and tag them as employees (all current accounts are internal staff). This runs once;
-- rows created after this point keep the 'pending' default.
UPDATE profiles
SET approval_status = 'approved',
    account_type = COALESCE(account_type, 'employee')
WHERE created_at < NOW();

-- Primary admin is always an approved employee, belt-and-suspenders.
UPDATE profiles
SET approval_status = 'approved',
    account_type = 'employee'
WHERE phone = '+19018319661';

-- Constrain to known values (allow NULL account_type for freshly-created profiles
-- that haven't been through Setup yet).
DO $$
BEGIN
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_approval_status_check;
  ALTER TABLE profiles ADD CONSTRAINT profiles_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_account_type_check;
  ALTER TABLE profiles ADD CONSTRAINT profiles_account_type_check
    CHECK (account_type IS NULL OR account_type IN ('buyer', 'employee'));
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_approval_status ON profiles(approval_status);
