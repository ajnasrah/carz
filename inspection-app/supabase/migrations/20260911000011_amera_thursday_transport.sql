-- Thursday is Amera's crowded day, so the transport calls move up to 14:30 on
-- that day only and stay at 15:00 the rest of the week.
--
-- A row carries ONE time, so a day that runs to a different clock has to be its
-- own row — the Mon-Sat row loses Thursday, and a Thursday-only twin is added at
-- the earlier time. Splitting is what keeps "every weekday except one" sayable
-- without a second time column nobody would need again.
--
-- Thursday now reads 14:00 list, 14:30 transport, 15:30 front-lot sweep.

-- Thursday comes out of the daily row: {1,2,3,4,5,6} -> {1,2,3,5,6}.
UPDATE sms_checklists
SET days = '{1,2,3,5,6}'
WHERE name = 'Amera' AND send_at = '15:00' AND days = '{1,2,3,4,5,6}';

-- ...and comes back as its own row half an hour earlier, copying the items from
-- the row it was split out of so the two can never drift apart in wording.
INSERT INTO sms_checklists (name, phone, title, items, send_at, days)
SELECT c.name, c.phone, 'Auction transport (Thu)', c.items, '14:30'::time, '{4}'
FROM sms_checklists c
WHERE c.name = 'Amera' AND c.send_at = '15:00' AND c.days = '{1,2,3,5,6}'
  AND NOT EXISTS (
    SELECT 1 FROM sms_checklists x WHERE x.name = 'Amera' AND x.send_at = '14:30'
  );
