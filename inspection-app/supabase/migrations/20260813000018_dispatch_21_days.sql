-- Transport chases are for cars over 21 days old. Three days was my guess at
-- "late for a pickup"; the real rule is the same 21 days everything else in this
-- app treats as stuck.
UPDATE sms_nudges SET min_days = 21 WHERE bucket LIKE 'dispatch%';
