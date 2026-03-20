-- 00018: Add mutual preference filtering to proximity alerts
--
-- Prevents phantom "A Wave user is nearby" notifications when the
-- triggering user and the nearby user have incompatible gender/age
-- preferences. Only notifies users who would actually see each other
-- on the radar.

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
DECLARE
  v_trigger_gender text;
  v_trigger_dob date;
  v_trigger_age int;
  v_trigger_gender_pref text;
  v_trigger_age_min smallint;
  v_trigger_age_max smallint;
BEGIN
  -- Fetch the triggering user's profile for mutual preference checks
  SELECT
    gender, date_of_birth,
    gender_preference, age_preference_min, age_preference_max
  INTO
    v_trigger_gender, v_trigger_dob,
    v_trigger_gender_pref, v_trigger_age_min, v_trigger_age_max
  FROM public.profiles
  WHERE id = p_user_id;

  v_trigger_age := CASE
    WHEN v_trigger_dob IS NOT NULL
    THEN EXTRACT(YEAR FROM age(now(), v_trigger_dob))::int
    ELSE NULL
  END;

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
    -- Mutual preference check: does the nearby user's gender preference include the trigger?
    AND (
      p.gender_preference IS NULL
      OR p.gender_preference = 'both'
      OR v_trigger_gender IS NULL
      OR p.gender_preference = v_trigger_gender
    )
    -- Does the trigger's gender preference include the nearby user?
    AND (
      v_trigger_gender_pref IS NULL
      OR v_trigger_gender_pref = 'both'
      OR p.gender IS NULL
      OR v_trigger_gender_pref = p.gender
    )
    -- Does the nearby user's age preference include the trigger's age?
    AND (
      p.age_preference_min IS NULL
      OR p.age_preference_max IS NULL
      OR v_trigger_age IS NULL
      OR (v_trigger_age >= p.age_preference_min AND v_trigger_age <= p.age_preference_max)
    )
    -- Does the trigger's age preference include the nearby user's age?
    AND (
      v_trigger_age_min IS NULL
      OR v_trigger_age_max IS NULL
      OR p.date_of_birth IS NULL
      OR (
        EXTRACT(YEAR FROM age(now(), p.date_of_birth))::int >= v_trigger_age_min
        AND EXTRACT(YEAR FROM age(now(), p.date_of_birth))::int <= v_trigger_age_max
      )
    )
  ORDER BY distance_meters ASC
  LIMIT p_max_results;
END;
$$;
