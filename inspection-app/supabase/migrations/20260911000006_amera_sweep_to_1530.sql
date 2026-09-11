-- Amera's weekly Openlane/ACV/Manheim sweep moves 15:00 -> 15:30.
--
-- It was landing in the same minute as her daily transport call every Thursday,
-- and two texts arriving together read as one: the second gets skimmed. At 15:30
-- it follows the transport calls instead of competing with them.
--
-- Matched on the Thursday-only days array, which is what separates this row from
-- the Mon-Sat transport row sharing its time.
UPDATE sms_checklists
SET send_at = '15:30'
WHERE name = 'Amera' AND send_at = '15:00' AND days = '{4}';
