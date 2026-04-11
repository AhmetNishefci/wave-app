-- Fix duplicate engagement notifications and cron job collision.
--
-- Problem 1: If the daily-engagement edge function is invoked twice in the
-- same cron tick (pg_net retry or Deno Deploy cold-start duplicate), both
-- invocations query eligible users before either records the cooldown,
-- resulting in duplicate push notifications.
--
-- Fix: Add a sent_date column + unique constraint so the database enforces
-- one engagement notification per user per calendar day. The edge function
-- is restructured to INSERT cooldown records BEFORE sending pushes —
-- the unique constraint blocks the second invocation's insert, and only
-- users whose insert succeeded receive a push.
--
-- Problem 2: Both cleanup and daily-engagement cron jobs fire at minute 0.
-- On the free tier (2 concurrent edge functions), they compete for slots.
-- If cleanup wins, daily-engagement is silently rejected.
--
-- Fix: Stagger cleanup to minute 5.

-- Step 1: Add sent_date column for the unique constraint
ALTER TABLE public.engagement_notifications
ADD COLUMN IF NOT EXISTS sent_date date DEFAULT CURRENT_DATE;

-- Backfill existing records
UPDATE public.engagement_notifications
SET sent_date = (sent_at AT TIME ZONE 'UTC')::date
WHERE sent_date IS NULL;

-- Make sent_date NOT NULL after backfill
ALTER TABLE public.engagement_notifications
ALTER COLUMN sent_date SET NOT NULL;

-- Clean up existing duplicates: keep the earliest record per (user_id, sent_date)
DELETE FROM public.engagement_notifications a
USING public.engagement_notifications b
WHERE a.user_id = b.user_id
  AND a.sent_date = b.sent_date
  AND a.sent_at > b.sent_at;

-- Step 2: Add unique constraint — one notification per user per day
ALTER TABLE public.engagement_notifications
ADD CONSTRAINT engagement_one_per_user_per_day UNIQUE (user_id, sent_date);

-- Step 3: Stagger cleanup cron to minute 5 (avoid competing with daily-engagement at minute 0)
SELECT cron.unschedule('cleanup-expired-data');
SELECT cron.schedule(
  'cleanup-expired-data',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1) || '/functions/v1/cleanup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
