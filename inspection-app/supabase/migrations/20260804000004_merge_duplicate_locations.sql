-- Merge duplicate spellings of the same physical place.
--
-- vehicle_locations.physical_location lost its enum CHECK in
-- 20260421000001 (the chat groups surface an ever-growing set of shops), so the
-- vocabulary is now whatever anyone typed. An audit of all 2,466 rows found the
-- same shop spelled several ways — jk_nissan / j_k_nissan / jim_keras_nissan,
-- tristate / tri_state, santa / back_santamaria / santa_maria, and four spellings
-- of the mechanic shop. Every "where are my cars" count is split across them.
--
-- This ONLY merges spellings of a place that is unambiguously the same place.
-- Deliberately NOT merged:
--   jorge -> body_shop   the UI already folds these (Inventory.canonicalLoc) and
--                        a body shop Telegram group may carry location_code
--                        'jorge'; changing the data without changing the group
--                        would just let it drift back.
--   on_lot               retired in 20260423000001, 0 cars in inventory — history.
--   the free-text junk   ("why_is_this_not_scratched_off...") is handled in
--                        20260804000005, which is a different kind of fix.

-- The audit trigger records real physical moves. These rows are spelling
-- corrections — the cars did not go anywhere — so logging them would invent
-- moves that never happened and pollute every car's timeline.
ALTER TABLE vehicle_locations DISABLE TRIGGER vehicle_location_history_trigger;

-- location_updated_at is deliberately left alone: it's the arrival time at a
-- place the car never left, and the recency guard only reverts an update whose
-- timestamp is strictly OLDER than what's stored, so an unchanged timestamp
-- passes through.
WITH merges(from_code, to_code) AS (
  VALUES
    -- Jim Keras
    ('jk_nissan',          'jim_keras_nissan'),
    ('j_k_nissan',         'jim_keras_nissan'),
    ('jim_karis',          'jim_keras'),
    -- Tri State
    ('tristate',           'tri_state'),
    -- Santa Maria Tire & Alignment
    ('santa',              'santa_maria'),
    ('back_santamaria',    'santa_maria'),
    -- The mechanic shop. The UI already labels 'mechanic' and 'mechanic_section'
    -- identically ("Mechanic"); mechanic_section is the dominant spelling.
    ('mechanic',           'mechanic_section'),
    ('mechanic_shop',      'mechanic_section'),
    ('inside_mechanic_shop','mechanic_section'),
    -- Front lot
    ('front_lot',          'front'),
    -- DAA Rockies
    ('daa_of_the_rockies', 'daa_rockies'),
    -- Muffler C&S
    ('out_muffler_c_s',    'muffler_cs'),
    -- 901 Sound
    ('901_sounds',         '901_sound'),
    -- Arbitration
    ('arb_d',              'arb_section'),
    ('arb_d_out',          'arb_section'),
    ('arbitrated',         'arb_section'),
    ('putting_this_in_arb','arb_section')
)
UPDATE vehicle_locations vl
SET physical_location = m.to_code
FROM merges m
WHERE vl.physical_location = m.from_code;

ALTER TABLE vehicle_locations ENABLE TRIGGER vehicle_location_history_trigger;

-- Repoint the keyword table too, or the Telegram bot writes the old spelling
-- back the next time someone types it and the merge silently undoes itself.
WITH merges(from_code, to_code) AS (
  VALUES
    ('jk_nissan','jim_keras_nissan'), ('j_k_nissan','jim_keras_nissan'),
    ('jim_karis','jim_keras'), ('tristate','tri_state'),
    ('santa','santa_maria'), ('back_santamaria','santa_maria'),
    ('mechanic','mechanic_section'), ('mechanic_shop','mechanic_section'),
    ('inside_mechanic_shop','mechanic_section'), ('front_lot','front'),
    ('daa_of_the_rockies','daa_rockies'), ('out_muffler_c_s','muffler_cs'),
    ('901_sounds','901_sound'), ('arb_d','arb_section'),
    ('arb_d_out','arb_section'), ('arbitrated','arb_section'),
    ('putting_this_in_arb','arb_section')
)
UPDATE location_keywords lk
SET location_code = m.to_code
FROM merges m
WHERE lk.location_code = m.from_code;

-- Same for any Telegram group pinned to a retired spelling.
WITH merges(from_code, to_code) AS (
  VALUES
    ('mechanic','mechanic_section'), ('mechanic_shop','mechanic_section'),
    ('inside_mechanic_shop','mechanic_section'), ('front_lot','front'),
    ('jk_nissan','jim_keras_nissan'), ('j_k_nissan','jim_keras_nissan')
)
UPDATE tg_chats c
SET location_code = m.to_code
FROM merges m
WHERE c.location_code = m.from_code;

NOTIFY pgrst, 'reload schema';
