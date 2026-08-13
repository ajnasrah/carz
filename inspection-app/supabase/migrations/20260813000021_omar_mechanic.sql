-- Omar watches the mechanic shops alongside Qasim. Same 14-day floor the other
-- shop lists use, so it's the cars genuinely sitting, not everything in there.
INSERT INTO sms_nudges (name, phone, bucket, min_days)
SELECT 'Omar', '+19018268622', 'mechanic', 14
WHERE NOT EXISTS (
  SELECT 1 FROM sms_nudges WHERE phone = '+19018268622' AND bucket = 'mechanic'
);
