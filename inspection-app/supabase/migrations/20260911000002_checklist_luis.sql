-- Luis, Fridays only: do the inventory in the morning, get asked about it after
-- lunch.
--
-- The 2pm one is a question, and nothing here reads answers — but it doesn't
-- need to. Inbound SMS to the Carz Inc number is forwarded to the owner's phone
-- by /api/sms-reply, so "yeah, done" arrives as a text from Luis like any other.
-- The asking is what makes it happen; the answer just has to land somewhere a
-- person reads.
--
-- days = {5} is Friday alone, on the ISO numbering the cron uses (1=Mon).
-- Number given by the owner directly, not looked up: Luis has no app account.
INSERT INTO sms_checklists (name, phone, title, items, send_at, days)
SELECT 'Luis', '+19015624361', v.title, v.items, v.send_at, '{5}'
FROM (VALUES
  ('Inventory - do it',   ARRAY['Do inventory first'],        '09:00'::time),
  ('Inventory - chase',   ARRAY['Did you complete inventory?'], '14:00'::time)
) AS v(title, items, send_at)
WHERE NOT EXISTS (
  SELECT 1 FROM sms_checklists c WHERE c.phone = '+19015624361' AND c.send_at = v.send_at
);
