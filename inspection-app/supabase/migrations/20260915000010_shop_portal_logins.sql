-- The shop's own logins for the parts portals (PartsTech, RepairLink).
--
-- One login per portal, shared by the shop: an admin types it once in the Admin
-- panel, and the parts panel on the body shop and mechanic screens signs every
-- tech in with it, so nobody on the floor has to know or type the password.
--
-- THE TABLE IS UNREACHABLE FROM THE APP. RLS on, no policies, every grant
-- revoked from anon and authenticated — only the service role in
-- api/portal-login.js reads or writes it, and that function decides who may
-- (admins write; admins and shop roles read). The password is stored AES-GCM
-- encrypted with a key that lives in the function's environment, not the
-- database, so a leaked backup (api/db-backup.js) carries ciphertext only.

CREATE TABLE IF NOT EXISTS shop_portal_logins (
  portal        TEXT PRIMARY KEY CHECK (portal IN ('partstech', 'repairlink')),
  username      TEXT NOT NULL,
  password_enc  TEXT NOT NULL,          -- base64(iv || tag || ciphertext)
  updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_portal_logins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shop_portal_logins FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
