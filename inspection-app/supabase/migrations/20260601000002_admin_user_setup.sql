-- Ensure admin user with phone 9018319661 exists
INSERT INTO profiles (id, phone, name, role, created_at)
VALUES (
  gen_random_uuid(),
  '+19018319661',
  'Admin User',
  'admin',
  NOW()
)
ON CONFLICT (phone) 
DO UPDATE SET 
  role = 'admin',
  updated_at = NOW()
WHERE profiles.phone = '+19018319661';

-- Add to allowed_users table if not exists
INSERT INTO allowed_users (phone, name, role, created_at)
VALUES (
  '+19018319661',
  'Admin User',
  'admin',
  NOW()
)
ON CONFLICT (phone) DO NOTHING;

-- Create index for faster user lookups
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Add audit log table for tracking admin actions
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  target_user_id UUID,
  target_user_phone TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create function to log admin actions
CREATE OR REPLACE FUNCTION log_admin_action()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO admin_audit_log (admin_id, action, target_user_id, target_user_phone, details)
    VALUES (
      current_setting('app.current_user_id', true)::UUID,
      'DELETE_USER',
      OLD.id,
      OLD.phone,
      jsonb_build_object('deleted_user', row_to_json(OLD))
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.role != NEW.role THEN
    INSERT INTO admin_audit_log (admin_id, action, target_user_id, target_user_phone, details)
    VALUES (
      current_setting('app.current_user_id', true)::UUID,
      'ROLE_CHANGE',
      NEW.id,
      NEW.phone,
      jsonb_build_object('old_role', OLD.role, 'new_role', NEW.role)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for audit logging
DROP TRIGGER IF EXISTS audit_profile_changes ON profiles;
CREATE TRIGGER audit_profile_changes
  AFTER UPDATE OR DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION log_admin_action();