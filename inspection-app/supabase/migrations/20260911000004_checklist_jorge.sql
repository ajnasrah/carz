-- Jorge, body shop, first thing every weekday.
--
-- Pairs with Chris's 4:30pm row: Chris puts the five oldest keys in Jorge's hand
-- at the end of the day, and Jorge is told to pull the five oldest cars the next
-- morning. Same five cars, both ends of the handoff.
--
-- Same number as his body_shop nudge in sms_nudges, deliberately — that one
-- reads him his oldest cars, this one tells him what to do about them.
INSERT INTO sms_checklists (name, phone, title, items, send_at, days)
SELECT 'Jorge', '+19013544264', 'Body shop - first thing',
       ARRAY['Open the Carz Inc app, pull the 5 oldest cars and deal with them today'],
       '08:00'::time, '{1,2,3,4,5}'
WHERE NOT EXISTS (
  SELECT 1 FROM sms_checklists WHERE phone = '+19013544264' AND send_at = '08:00'
);
