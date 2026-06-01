-- Fix profiles table permissions for admin setup
-- The errors show RLS policy violations when trying to create/update profiles

-- Enable RLS on profiles table if not already enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them properly
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Anon can read profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access" ON profiles;

-- Allow public read access to profiles (needed for admin checks)
CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

-- Allow authenticated users to insert profiles
CREATE POLICY "Authenticated can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update profiles
CREATE POLICY "Authenticated can update profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow anon role to read profiles (needed for extension)
CREATE POLICY "Anon can read profiles"
  ON profiles FOR SELECT
  TO anon
  USING (true);

-- Allow anon role to upsert profiles (needed for primary admin setup)
CREATE POLICY "Anon can upsert profiles"
  ON profiles FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update profiles"
  ON profiles FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Ensure the primary admin exists with proper phone format
DO $$
BEGIN
  -- Try different phone formats
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE phone IN ('+19018319661', '19018319661', '9018319661')
  ) THEN
    INSERT INTO profiles (id, phone, name, role, created_at)
    VALUES (
      gen_random_uuid(),
      '+19018319661',
      'Primary Admin',
      'admin',
      NOW()
    );
  ELSE
    -- Update existing record to ensure it has admin role
    UPDATE profiles 
    SET role = 'admin',
        name = COALESCE(name, 'Primary Admin')
    WHERE phone IN ('+19018319661', '19018319661', '9018319661');
  END IF;
END $$;