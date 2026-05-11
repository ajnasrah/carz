-- ============================================
-- CARZ INC INSPECTION APP - DATABASE SCHEMA
-- Run this in Supabase SQL Editor (supabase.com > your project > SQL Editor)
-- ============================================

-- 1. PROFILES TABLE (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT,
  name TEXT,
  role TEXT DEFAULT 'inspector' CHECK (role IN ('admin', 'inspector')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ALLOWED USERS (whitelist for who can sign up)
CREATE TABLE IF NOT EXISTS allowed_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'inspector' CHECK (role IN ('admin', 'inspector')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INSPECTIONS TABLE
CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('inbound', 'outbound')),
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'complete')),
  vin TEXT NOT NULL,
  vin_last6 TEXT,
  stock_number TEXT NOT NULL,
  year INTEGER,
  make TEXT,
  model TEXT,
  trim TEXT,
  mileage INTEGER,
  exterior_color TEXT,
  interior_color TEXT,
  drivetrain TEXT,
  checklist JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. INSPECTION PHOTOS TABLE
CREATE TABLE IF NOT EXISTS inspection_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. INDEXES
CREATE INDEX IF NOT EXISTS idx_inspections_user ON inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_vin ON inspections(vin);
CREATE INDEX IF NOT EXISTS idx_inspections_stock ON inspections(stock_number);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_type ON inspections(type);
CREATE INDEX IF NOT EXISTS idx_inspections_created ON inspections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_inspection ON inspection_photos(inspection_id);

-- 6. AUTO-CREATE PROFILE ON SIGNUP
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  allowed RECORD;
BEGIN
  -- Check if user's phone is in allowed list
  SELECT * INTO allowed FROM allowed_users WHERE phone = NEW.phone;

  IF allowed IS NOT NULL THEN
    INSERT INTO profiles (id, phone, name, role)
    VALUES (NEW.id, NEW.phone, allowed.name, allowed.role);
  ELSE
    INSERT INTO profiles (id, phone, name, role)
    VALUES (NEW.id, NEW.phone, '', 'inspector');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 7. ROW LEVEL SECURITY (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE allowed_users ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all profiles, update own
CREATE POLICY "Anyone can read profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Inspections: all authenticated users can CRUD
CREATE POLICY "Authenticated users can read inspections" ON inspections FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can insert inspections" ON inspections FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update inspections" ON inspections FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete inspections" ON inspections FOR DELETE USING (auth.role() = 'authenticated');

-- Photos: all authenticated users can CRUD
CREATE POLICY "Authenticated users can read photos" ON inspection_photos FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can insert photos" ON inspection_photos FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete photos" ON inspection_photos FOR DELETE USING (auth.role() = 'authenticated');

-- Allowed users: only admins can manage (via service role), everyone can read
CREATE POLICY "Authenticated users can read allowed_users" ON allowed_users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can insert allowed_users" ON allowed_users FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete allowed_users" ON allowed_users FOR DELETE USING (auth.role() = 'authenticated');

-- 8. STORAGE BUCKET FOR PHOTOS
INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-photos', 'inspection-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'inspection-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'inspection-photos');

CREATE POLICY "Authenticated users can delete photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'inspection-photos' AND auth.role() = 'authenticated');

-- 9. SEED: Add your phone as the first admin
-- IMPORTANT: Replace with your actual phone number!
-- INSERT INTO allowed_users (phone, name, role) VALUES ('+1XXXXXXXXXX', 'Abdullah', 'admin');
