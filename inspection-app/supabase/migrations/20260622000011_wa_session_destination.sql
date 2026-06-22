-- Remember a transport destination across messages: a worker can send the
-- destination once ("back pro") then a list of VINs, each in its own message.
ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS last_destination TEXT;
NOTIFY pgrst, 'reload schema';
