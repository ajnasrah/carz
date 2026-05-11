-- Add demo photos to existing inspections for marketplace display
UPDATE inspections 
SET checklist = jsonb_set(
  COALESCE(checklist, '{}'::jsonb),
  '{photos}',
  '{
    "driver_front_corner": {
      "url": "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=800",
      "path": "demo/driver_front_corner.jpg"
    },
    "pass_front_corner": {
      "url": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800",
      "path": "demo/pass_front_corner.jpg"
    },
    "driver_rear_corner": {
      "url": "https://images.unsplash.com/photo-1542362567-b07e54358753?w=800",
      "path": "demo/driver_rear_corner.jpg"  
    },
    "pass_rear_corner": {
      "url": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=800",
      "path": "demo/pass_rear_corner.jpg"
    }
  }'::jsonb,
  true
)
WHERE completed_at IS NOT NULL
AND (checklist->'photos' IS NULL OR checklist->'photos' = '{}'::jsonb);