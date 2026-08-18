-- Remove the CarMax list created while verifying the create-link path end to
-- end. It was never sent to anyone; it should not sit in prod looking like real
-- outreach.
DELETE FROM buyer_share_lists WHERE slug = '9c774b7d60';
