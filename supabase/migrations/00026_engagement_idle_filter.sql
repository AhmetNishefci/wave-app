-- 00026: Add minimum idle period to engagement push targeting
--
-- Previously, a user who opened the app at 2 PM could receive an
-- engagement push at 7 PM the same day — only 5 hours after being active.
-- That's not re-engagement, it's spam. The 24h cooldown only checks time
-- since the last PUSH, not last activity.
--
-- Fix: add p_min_idle_hours parameter. Users must be inactive for at least
-- this many hours before they're eligible for a re-engagement push.
-- Default: 20 hours (user who opened at 10 PM won't get pushed until 6 PM
-- next day at earliest, aligning with the 6-8 PM target window).

DROP FUNCTION IF EXISTS public.get_engagement_eligible_users(integer, integer, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.get_engagement_eligible_users(
  p_target_hour_start integer,
  p_target_hour_end integer,
  p_active_within_days integer,
  p_engagement_cooldown_hours integer,
  p_max_ignored_sends integer,
  p_min_idle_hours integer DEFAULT 20,
  p_max_results integer DEFAULT 500
) RETURNS TABLE(user_id uuid, push_token text, is_local_weekend boolean, local_dow integer)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH
  valid_timezones AS (
    SELECT name FROM pg_timezone_names
  ),
  base_eligible AS (
    SELECT DISTINCT ON (p.id)
      p.id AS uid,
      pt.token AS ptoken,
      p.timezone AS tz,
      p.last_active_at
    FROM public.profiles p
    INNER JOIN public.push_tokens pt ON pt.user_id = p.id
    INNER JOIN valid_timezones vt ON vt.name = p.timezone
    WHERE
      p.daily_pushes_enabled = true
      AND p.timezone IS NOT NULL
      AND p.last_active_at IS NOT NULL
      AND p.last_active_at > now() - make_interval(days => p_active_within_days)
      AND p.last_active_at < now() - make_interval(hours => p_min_idle_hours)
      AND EXTRACT(HOUR FROM now() AT TIME ZONE p.timezone)
          BETWEEN p_target_hour_start AND p_target_hour_end
    ORDER BY p.id, pt.updated_at DESC
  ),
  no_recent_engagement AS (
    SELECT be.uid, be.ptoken, be.tz, be.last_active_at
    FROM base_eligible be
    WHERE NOT EXISTS (
      SELECT 1 FROM public.engagement_notifications en
      WHERE en.user_id = be.uid
        AND en.sent_at > now() - make_interval(hours => p_engagement_cooldown_hours)
    )
  ),
  not_ignoring AS (
    SELECT nre.uid, nre.ptoken, nre.tz
    FROM no_recent_engagement nre
    WHERE (
      SELECT COUNT(*) FROM public.engagement_notifications en
      WHERE en.user_id = nre.uid
        AND en.sent_at > nre.last_active_at
    ) < p_max_ignored_sends
  )
  SELECT
    ni.uid AS user_id,
    ni.ptoken AS push_token,
    EXTRACT(DOW FROM now() AT TIME ZONE ni.tz) IN (0, 6) AS is_local_weekend,
    EXTRACT(DOW FROM now() AT TIME ZONE ni.tz)::INT AS local_dow
  FROM not_ignoring ni
  LIMIT p_max_results;
END;
$$;
