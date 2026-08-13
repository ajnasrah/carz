-- Omar is 9018268622. 9018319661 is Abdullah's own number — the primary admin
-- one — and it had been seeded under Omar's name, so Omar would have got nothing
-- and his texts would have gone to the owner instead.
--
-- Both want the stuck-21+ list, so this corrects Omar's number and adds Abdullah
-- as his own recipient rather than renaming the row out from under him.
UPDATE sms_nudges SET phone = '+19018268622' WHERE name = 'Omar';

INSERT INTO sms_nudges (name, phone, bucket)
SELECT 'Abdullah', '+19018319661', 'stuck21'
WHERE NOT EXISTS (
  SELECT 1 FROM sms_nudges WHERE phone = '+19018319661' AND bucket = 'stuck21'
);
