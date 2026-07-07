-- GHL lead-sync hourly safety-net.
-- Sweeps sa_buyers for reachable, un-synced buyers and re-fires ghl-lead-sync,
-- catching anything the on-upload trigger missed (closed tab, transient webhook
-- failure, script upload). The function is idempotent, so this is safe to repeat.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Make re-running this migration idempotent: drop the old schedule if present.
do $$
begin
  perform cron.unschedule('ghl-lead-sync-hourly');
exception when others then null;
end $$;

select cron.schedule(
  'ghl-lead-sync-hourly',
  '17 * * * *',                       -- hourly, at :17
  $cron$
  select net.http_post(
    url     := 'https://yprihgygmreibcuybwoy.supabase.co/functions/v1/ghl-lead-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwcmloZ3lnbXJlaWJjdXlid295Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODYzNTAsImV4cCI6MjA4ODk2MjM1MH0.L1oDMq7wYnyZwjZOYcYhNvrP0I5wFxf5BZPAwRM3m0o'
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
