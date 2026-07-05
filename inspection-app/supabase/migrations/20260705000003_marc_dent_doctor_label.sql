-- Marc is the Denver paintless-dent-repair guy ("Dent Doctor"). Sync the
-- location_keywords label and add a "dent doctor" alias so a driver posting
-- "dent doctor" (without the name Marc) still routes to marc_pdr. Existing
-- keywords marc/marcpdr are unchanged.
UPDATE location_keywords SET label = 'Marc Dent Doctor (Denver)'
  WHERE location_code = 'marc_pdr';

INSERT INTO location_keywords (keyword, location_code, label) VALUES
  ('dentdoctor',     'marc_pdr', 'Marc Dent Doctor (Denver)'),
  ('marcdentdoctor', 'marc_pdr', 'Marc Dent Doctor (Denver)')
ON CONFLICT (keyword) DO NOTHING;

NOTIFY pgrst, 'reload schema';
