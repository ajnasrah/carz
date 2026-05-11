-- Update inspections with unique stock photos for each vehicle
-- Using different car photos for variety

-- 519842 - Ford Transit Connect
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=800", "path": "demo/519842_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800", "path": "demo/519842_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=800", "path": "demo/519842_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1664906525771-a3cff5b17c51?w=800", "path": "demo/519842_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '519842' OR vin = '519842';

-- S98133 - RAM ProMaster City  
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800", "path": "demo/S98133_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1573074406707-61c8b2103ef5?w=800", "path": "demo/S98133_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1559038465-e0ca2910a5b1?w=800", "path": "demo/S98133_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1606611013016-969c19ba178b?w=800", "path": "demo/S98133_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = 'S98133' OR vin = 'S98133';

-- 274121 - GMC Acadia
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800", "path": "demo/274121_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1581540222194-0def2dda95b8?w=800", "path": "demo/274121_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1609520778163-a16fb3862584?w=800", "path": "demo/274121_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=800", "path": "demo/274121_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '274121' OR vin = '274121';

-- 234036 - GMC Acadia
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1606664515524-ed8f30e654b0?w=800", "path": "demo/234036_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1614165936126-2ed18e471b3b?w=800", "path": "demo/234036_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1590362891991-54f458eb2c80?w=800", "path": "demo/234036_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1616422285623-13ff0162193c?w=800", "path": "demo/234036_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '234036' OR vin = '234036';

-- 143774 - Vehicle
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800", "path": "demo/143774_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800", "path": "demo/143774_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800", "path": "demo/143774_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1592198084033-aade902d1aae?w=800", "path": "demo/143774_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '143774' OR vin = '143774';

-- 335754 - GMC Terrain
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800", "path": "demo/335754_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1542362567-b07e54358753?w=800", "path": "demo/335754_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800", "path": "demo/335754_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=800", "path": "demo/335754_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '335754' OR vin = '335754';

-- 152117 - Ford Fusion
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=800", "path": "demo/152117_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1550355291-bbee04a92027?w=800", "path": "demo/152117_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800", "path": "demo/152117_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=800", "path": "demo/152117_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '152117' OR vin = '152117';

-- 557681 - Vehicle (if exists)
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=800", "path": "demo/557681_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1617469165780-8861eb8b28fe?w=800", "path": "demo/557681_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1605410341825-d21a34e88c24?w=800", "path": "demo/557681_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1614162691942-17c03e222cf5?w=800", "path": "demo/557681_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '557681' OR vin = '557681';

-- 123727 - Vehicle (if exists)
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {"url": "https://images.unsplash.com/photo-1588636142475-a62d56adf185?w=800", "path": "demo/123727_dfc.jpg"},
    "pass_front_corner": {"url": "https://images.unsplash.com/photo-1617704548623-340376564e68?w=800", "path": "demo/123727_pfc.jpg"},
    "driver_rear_corner": {"url": "https://images.unsplash.com/photo-1619362279968-62211f88e716?w=800", "path": "demo/123727_drc.jpg"},
    "pass_rear_corner": {"url": "https://images.unsplash.com/photo-1583267746897-2cf415761411?w=800", "path": "demo/123727_prc.jpg"}
  }'::jsonb
)
WHERE vin_last6 = '123727' OR vin = '123727';