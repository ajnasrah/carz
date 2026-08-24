# Moving the database to us-east-2

**Status: blocked on a decision. Do not run the cutover without reading "The blocker".**

## Why

The whole team is in Memphis. The database is in `us-west-2` (Oregon). Measured
from a Memphis machine, TCP round trip:

| Region | min | median |
|---|---|---|
| us-west-2 (current) | 76ms | 93ms |
| us-east-1 (Virginia) | 36ms | 39ms |
| us-east-2 (Ohio) | 37ms | 39ms |

End-to-end that is 252ms min / 324ms median for a one-row select today. Moving
east saves **~47ms on every round trip the app ever makes**, permanently.

## The blocker

Supabase has no in-place region change through the CLI or the management API —
`supabase projects` offers only `list`, `create`, `api-keys`, `delete`. Moving
region by ourselves therefore means a NEW project, which means a new project ref,
a new API URL, and a new JWT secret. Three consequences, in order of severity:

1. **Every installed iOS and Android app breaks.** The project ref is compiled
   into the shipped bundle — verified present in `ios/App/App/public/assets/`
   and `android/app/src/main/assets/public/assets/`. Phones already in the crew's
   hands keep talking to the old URL until a NEW BUILD CLEARS STORE REVIEW. That
   is days for Apple, separately for Play. The crew is on those phones, on the
   lot, all day.

2. **Everyone is logged out.** A new project has a new JWT secret, so every
   session dies and every user re-does SMS OTP — on a lot, on one bar. This app
   already had trouble with sessions being evicted mid-shift; see
   `src/native/storage.js`.

3. Storage, functions and integrations all have to be repointed: the
   `car-history`, `inspection-photos` and `db-backups` buckets (that last one
   holds the nightly snapshots from `api/db-backup.js` — do NOT leave the only
   copy of those behind in the old project), three edge functions
   (`frazer-ingest`, `ghl-lead-sync`, `purge-orphan-photos`), the Telegram
   webhook, the Chrome extension, API keys, and the Vercel env vars.

The data itself is the easy part — the whole database is roughly 32MB.

Note that `api/db-backup.js` already snapshots the ten unrecoverable tables
nightly at 08:00 into the `db-backups` bucket with 30-day retention. That covers
table DATA, but NOT schema, RLS policies, functions/RPCs, or auth.users — so it
is not sufficient on its own for a migration. Take a real `supabase db dump`
as well.

## The recommendation

**Ask Supabase support to migrate the project in place.** That keeps the ref, the
URL and the JWT secret, which erases all three problems above: no store builds,
nobody logged out, nothing repointed. It turns a multi-day crew-disrupting
cutover into a short maintenance window. This is a paid-plan support request;
draft is in `docs/region-migration-support-request.txt`.

Only fall back to the self-service path below if support declines.

## Self-service runbook (fallback only)

Do NOT start until new iOS and Android builds pointing at the new URL are
BUILT, SUBMITTED and APPROVED — sitting ready for release. The cutover is the
moment you release them, not before.

1. Freeze writes. Tell the crew, pause the Vercel crons, disable the Telegram
   webhook.
2. `supabase db dump --linked -f schema.sql` and `--data-only -f data.sql`.
   Verify row counts against `supabase inspect db table-stats` BEFORE restoring.
3. Create the new project in `us-east-2`. Restore schema, then data.
4. Copy both storage buckets. Object paths are recorded in
   `vehicle_photo_uploads` — reconcile every row against the new bucket, and do
   not proceed until the counts match.
5. Re-run `supabase db push` to confirm the migration ledger is consistent.
6. Redeploy the three edge functions.
7. Update `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Vercel (and `.env`),
   redeploy the web app. Remember the trailing-`\r` trap documented in
   `src/services/supabase.js` — trim at every env boundary.
8. Repoint the Telegram webhook and the Chrome extension. Rotate API keys.
9. Release the store builds. Expect a support wave: everyone re-does SMS OTP.
10. Keep the old project READ-ONLY for two weeks. Do not delete it until the
    store rollout has actually reached the crew's phones.

## Verification

Re-run the latency table above against the new host and confirm the median lands
near 39ms rather than 93ms. If it doesn't, the move bought nothing and should be
rolled back before the old project is deleted.
