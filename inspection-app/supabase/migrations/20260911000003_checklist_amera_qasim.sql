-- Amera (auction lists and transport) and Qasim (as-is cars to wholesale).
--
-- "EVERY DAY" IS SEEDED AS MON-SAT, NOT ALL SEVEN.
-- The nudge cron next door refuses to chase anyone on a Sunday, which is the
-- house rule this follows. If Amera genuinely works Sundays, Sun is one tap on
-- the Checklists screen — but a standing Sunday text nobody reads is how the
-- whole system gets tuned out, so the default errs toward silence.
--
-- HEADS UP, THURSDAYS AT 3PM: Amera's daily transport call and her weekly
-- Openlane/ACV/Manheim sweep both land at 15:00, so on Thursday she gets two
-- texts in the same minute. Both times were asked for explicitly, so both are
-- seeded as asked; moving the weekly one to 15:30 is one edit on the screen.
INSERT INTO sms_checklists (name, phone, title, items, send_at, days)
SELECT 'Amera', '+15403555463', v.title, v.items, v.send_at, v.days
FROM (VALUES
  (
    'Auction list',
    ARRAY['Make a list of cars for all the auctions, divided by Adesa, UAX, and DAA'],
    '14:00'::time,
    '{1,2,3,4,5,6}'::integer[]
  ),
  (
    'Auction transport',
    ARRAY['Contact all the auction transport handlers and schedule pickup for anything you found'],
    '15:00'::time,
    '{1,2,3,4,5,6}'::integer[]
  ),
  (
    'Front lot sweep',
    ARRAY['Find cars for Openlane, ACV, and Manheim that are already in the front'],
    '15:00'::time,
    '{4}'::integer[]
  )
) AS v(title, items, send_at, days)
WHERE NOT EXISTS (
  SELECT 1 FROM sms_checklists c
  WHERE c.phone = '+15403555463' AND c.send_at = v.send_at AND c.days = v.days
);

-- Qasim already gets the mechanic-shop nudge on this same number; this is a
-- separate, dictated job and so a separate row, not a sixth bucket.
INSERT INTO sms_checklists (name, phone, title, items, send_at, days)
SELECT 'Qasim', '+19012830548', 'Wholesale as-is',
       ARRAY['Find cars to sell as-is on Openlane, ACV, or Copart'],
       '14:00'::time, '{4}'
WHERE NOT EXISTS (
  SELECT 1 FROM sms_checklists WHERE phone = '+19012830548' AND send_at = '14:00'
);
