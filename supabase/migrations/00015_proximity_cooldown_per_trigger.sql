-- Fix proximity notification cooldown to be per-triggering-user, not global.
-- Previously: User B gets no proximity notifications for 1 hour after ANY trigger.
-- Now: User B gets no proximity notifications from User A specifically for 1 hour,
-- but can still receive from User C.

CREATE OR REPLACE FUNCTION public.find_nearby_users(
  p_user_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters integer DEFAULT 300,
  p_max_results integer DEFAULT 50
)
RETURNS TABLE(user_id uuid, push_token text, platform text, distance_meters double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS user_id,
    pt.token AS push_token,
    pt.platform,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(p.last_longitude, p.last_latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
    ) AS distance_meters
  FROM public.profiles p
  JOIN public.push_tokens pt ON pt.user_id = p.id
  WHERE p.id != p_user_id
    AND p.last_latitude IS NOT NULL
    AND p.last_longitude IS NOT NULL
    AND p.last_location_at > now() - interval '2 hours'
    AND p.nearby_alerts_enabled = true
    AND ST_DWithin(
      ST_SetSRID(ST_MakePoint(p.last_longitude, p.last_latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
      p_radius_meters
    )
    -- Cooldown: skip if THIS SPECIFIC user already triggered a notification
    -- to the target within the last hour (not any user globally)
    AND NOT EXISTS (
      SELECT 1 FROM public.proximity_notifications pn
      WHERE pn.user_id = p.id
        AND pn.triggered_by = p_user_id
        AND pn.created_at > now() - interval '1 hour'
    )
  ORDER BY distance_meters ASC
  LIMIT p_max_results;
END;
$$;
