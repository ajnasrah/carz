-- Drop the CHECK constraint on vehicle_locations.physical_location.
-- Originally limited to {on_lot, uax, daa, adesa, in_transit, unknown} — but
-- the Carz Inc iMessage group chats surface many more destinations (summit_tire,
-- pro_auto, body_shop, mechanic_section, upholstery, tri_state_glass, city_auto,
-- jim_keras_chevy_service, 901_sound, …) and the set keeps growing as new shops
-- are added. Free-text is fine here since physical_location is a display field,
-- not a lookup key.

ALTER TABLE vehicle_locations DROP CONSTRAINT IF EXISTS vehicle_locations_physical_location_check;
