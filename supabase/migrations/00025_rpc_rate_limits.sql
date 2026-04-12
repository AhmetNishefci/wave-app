-- 00025: Rate limiting for client-callable RPCs
--
-- Adds a lightweight rate_limits table and helper function to prevent
-- abuse of directly-callable RPCs. Without this, a malicious actor with
-- a valid JWT could hammer resolve_peer_data (read amplification) or
-- claim_*_handle (handle squatting) at arbitrary rates.
--
-- Rate limits:
--   resolve_peer_data:    20/minute (legitimate: ~2/min, bursts to ~5 on foreground)
--   claim_instagram_handle: 5/minute (legitimate: 1-2 during onboarding/edit)
--   claim_snapchat_handle:  5/minute (same as above)

-- 1. Rate limits tracking table
CREATE TABLE IF NOT EXISTS public.rpc_rate_limits (
  user_id uuid NOT NULL,
  function_name text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  call_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, function_name)
);

ALTER TABLE public.rpc_rate_limits ENABLE ROW LEVEL SECURITY;
-- No RLS policies = no direct client access. Only SECURITY DEFINER functions.

-- 2. Shared rate limit helper
--    Returns true if allowed, raises exception if exceeded.
CREATE OR REPLACE FUNCTION public.check_rpc_rate_limit(
  p_user_id uuid,
  p_function_name text,
  p_max_calls integer,
  p_window_seconds integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_window_start timestamptz;
  v_call_count integer;
BEGIN
  -- Upsert: try insert first, update if exists
  INSERT INTO rpc_rate_limits (user_id, function_name, window_start, call_count)
  VALUES (p_user_id, p_function_name, now(), 1)
  ON CONFLICT (user_id, function_name) DO UPDATE
  SET
    -- Reset window if expired, otherwise increment
    window_start = CASE
      WHEN rpc_rate_limits.window_start + (p_window_seconds || ' seconds')::interval < now()
      THEN now()
      ELSE rpc_rate_limits.window_start
    END,
    call_count = CASE
      WHEN rpc_rate_limits.window_start + (p_window_seconds || ' seconds')::interval < now()
      THEN 1
      ELSE rpc_rate_limits.call_count + 1
    END
  RETURNING rpc_rate_limits.window_start, rpc_rate_limits.call_count
  INTO v_window_start, v_call_count;

  IF v_call_count > p_max_calls THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
END;
$$;

-- 3. Add rate limiting to resolve_peer_data
DROP FUNCTION IF EXISTS public.resolve_peer_data(text[]);

CREATE FUNCTION public.resolve_peer_data(p_tokens text[])
RETURNS TABLE(
  token text,
  note text,
  peer_user_id uuid,
  is_blocked boolean,
  peer_gender_preference text,
  peer_age_preference_min smallint,
  peer_age_preference_max smallint,
  has_waved_at_me boolean,
  i_waved_at_them boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Rate limit: 20 calls per 60 seconds
  PERFORM check_rpc_rate_limit(auth.uid(), 'resolve_peer_data', 20, 60);

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
    p.age_preference_max AS peer_age_preference_max,
    EXISTS (
      SELECT 1 FROM public.waves w
      JOIN public.ephemeral_ids my_e ON w.target_ephemeral_token = my_e.token
      WHERE w.waver_user_id = e.user_id
        AND my_e.user_id = auth.uid()
        AND w.is_consumed = false
        AND w.expires_at > now()
    ) AS has_waved_at_me,
    EXISTS (
      SELECT 1 FROM public.waves w
      JOIN public.ephemeral_ids target_e ON w.target_ephemeral_token = target_e.token
      WHERE w.waver_user_id = auth.uid()
        AND target_e.user_id = e.user_id
        AND w.is_consumed = false
        AND w.expires_at > now()
    ) AS i_waved_at_them
  FROM public.ephemeral_ids e
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE e.token = ANY(p_tokens)
    AND (e.is_active = true OR e.expires_at > now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_peer_data(text[]) TO authenticated;

-- 4. Add rate limiting to claim_instagram_handle
CREATE OR REPLACE FUNCTION public.claim_instagram_handle(p_handle text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Rate limit: 5 calls per 60 seconds
  PERFORM check_rpc_rate_limit(auth.uid(), 'claim_instagram_handle', 5, 60);

  UPDATE profiles
  SET instagram_handle = NULL
  WHERE LOWER(instagram_handle) = LOWER(p_handle)
    AND id != auth.uid()
    AND (
      NOT EXISTS (
        SELECT 1 FROM auth.users WHERE auth.users.id = profiles.id
      )
      OR
      EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = profiles.id
          AND u.is_anonymous = true
      )
    );

  INSERT INTO profiles (id, instagram_handle)
  VALUES (auth.uid(), p_handle)
  ON CONFLICT (id) DO UPDATE SET instagram_handle = p_handle;
END;
$$;

-- 5. Add rate limiting to claim_snapchat_handle
CREATE OR REPLACE FUNCTION public.claim_snapchat_handle(p_handle text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Rate limit: 5 calls per 60 seconds
  PERFORM check_rpc_rate_limit(auth.uid(), 'claim_snapchat_handle', 5, 60);

  UPDATE profiles
  SET snapchat_handle = NULL
  WHERE LOWER(snapchat_handle) = LOWER(p_handle)
    AND id != auth.uid()
    AND (
      NOT EXISTS (
        SELECT 1 FROM auth.users WHERE auth.users.id = profiles.id
      )
      OR
      EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = profiles.id
          AND u.is_anonymous = true
      )
    );

  INSERT INTO profiles (id, snapchat_handle)
  VALUES (auth.uid(), p_handle)
  ON CONFLICT (id) DO UPDATE SET snapchat_handle = p_handle;
END;
$$;

-- 6. Add cleanup for rate limit entries (stale entries older than 1 hour)
CREATE OR REPLACE FUNCTION public.cleanup_expired_data() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.ephemeral_ids
  WHERE expires_at < now() - interval '1 hour';

  DELETE FROM public.waves
  WHERE is_consumed = true
    AND created_at < now() - interval '24 hours';

  DELETE FROM public.waves
  WHERE is_consumed = false
    AND expires_at < now() - interval '1 hour';

  DELETE FROM public.proximity_notifications
  WHERE created_at < now() - interval '24 hours';

  UPDATE public.profiles
  SET last_latitude = NULL,
      last_longitude = NULL,
      last_location_at = NULL
  WHERE last_location_at IS NOT NULL
    AND last_location_at < now() - interval '24 hours';

  DELETE FROM public.engagement_notifications
  WHERE sent_at < now() - interval '14 days';

  DELETE FROM public.push_receipts
  WHERE created_at < now() - interval '2 hours';

  -- Clean up stale rate limit entries (window expired > 1 hour ago)
  DELETE FROM public.rpc_rate_limits
  WHERE window_start < now() - interval '1 hour';
END;
$$;
