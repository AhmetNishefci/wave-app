-- 00019: Relax token expiry handling
--
-- Two fixes for the case where a user's app is backgrounded but iOS
-- keeps BLE advertising their token:
--
-- 1. resolve_peer_data: change AND to OR for is_active/expires_at.
--    Matches the lenient logic in check_and_create_match. An expired
--    but still-active token (user hasn't reopened the app) should still
--    resolve — BLE proves the peer is nearby.
--
-- 2. cleanup_expired_data: extend retention from 1 hour to 24 hours.
--    iOS can keep BLE advertising for hours after the app is backgrounded.
--    Deleting the token after 1 hour means waves to that peer fail even
--    though they're visible on radar.

-- 1. Update resolve_peer_data: AND → OR (match check_and_create_match)
DROP FUNCTION IF EXISTS public.resolve_peer_data(text[]);

CREATE FUNCTION public.resolve_peer_data(p_tokens text[])
RETURNS TABLE(
  token text,
  note text,
  peer_user_id uuid,
  is_blocked boolean,
  peer_gender_preference text,
  peer_age_preference_min smallint,
  peer_age_preference_max smallint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.token::TEXT,
    e.note::TEXT,
    e.user_id AS peer_user_id,
    EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = e.user_id)
         OR (b.blocked_id = auth.uid() AND b.blocker_id = e.user_id)
    ) AS is_blocked,
    p.gender_preference::TEXT AS peer_gender_preference,
    p.age_preference_min AS peer_age_preference_min,
    p.age_preference_max AS peer_age_preference_max
  FROM public.ephemeral_ids e
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE e.token = ANY(p_tokens)
    AND (e.is_active = true OR e.expires_at > now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_peer_data(text[]) TO authenticated;

-- 2. Extend cleanup retention from 1 hour to 24 hours
CREATE OR REPLACE FUNCTION public.cleanup_expired_data() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.ephemeral_ids
  WHERE expires_at < now() - interval '24 hours';

  DELETE FROM public.waves
  WHERE is_consumed = true AND created_at < now() - interval '24 hours';

  DELETE FROM public.waves
  WHERE is_consumed = false AND expires_at < now() - interval '1 hour';

  DELETE FROM public.proximity_notifications
  WHERE created_at < now() - interval '24 hours';

  -- Clear stale location data so find_nearby_users doesn't notify ghosts
  UPDATE public.profiles
  SET last_latitude = NULL, last_longitude = NULL, last_location_at = NULL
  WHERE last_location_at < now() - interval '24 hours'
    AND last_latitude IS NOT NULL;

  -- Clean up old engagement notification records (keep 14 days for analytics)
  DELETE FROM public.engagement_notifications
  WHERE sent_at < now() - interval '14 days';

  -- Clean up old push receipts (only need them for ~1 hour for deferred checking)
  DELETE FROM public.push_receipts
  WHERE created_at < now() - interval '2 hours';
END;
$$;
