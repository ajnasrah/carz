-- Fix inventory RLS policies to allow anon users to read
-- This is needed for the web app to fetch inventory data

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Auth users can read inventory" ON inventory;

-- Create new policy that allows both anon and authenticated users to read
CREATE POLICY "Anyone can read inventory" ON inventory
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Ensure vehicle_locations policies are also correct
DROP POLICY IF EXISTS "Anon can read vehicle_locations" ON vehicle_locations;
DROP POLICY IF EXISTS "Anon can upsert vehicle_locations" ON vehicle_locations;
DROP POLICY IF EXISTS "Authenticated can read vehicle_locations" ON vehicle_locations;
DROP POLICY IF EXISTS "Authenticated can upsert vehicle_locations" ON vehicle_locations;

-- Recreate vehicle_locations policies
CREATE POLICY "Anyone can read vehicle_locations" ON vehicle_locations
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Anyone can insert vehicle_locations" ON vehicle_locations
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Anyone can update vehicle_locations" ON vehicle_locations
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);