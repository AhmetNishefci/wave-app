-- Add idempotency detection to check_and_create_match.
--
-- The wave INSERT uses ON CONFLICT DO NOTHING, but previously the RPC
-- couldn't distinguish between "new wave created" and "wave already existed"
-- (client retry). This update uses RETURNING to detect which case occurred
-- and returns is_new_wave in the response. The edge function uses this to
-- skip duplicate push notifications on retries.

CREATE OR REPLACE FUNCTION public.check_and_create_match(
  p_waver_id uuid,
  p_target_token character varying
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
  v_lock_key bigint;
  v_recent_wave_count int;
  v_existing_match_id uuid;
  v_reciprocal_wave_id uuid;
  v_new_match_id uuid;
  v_matched_instagram text;
  v_matched_snapchat text;
  v_target_user_id_text text;
  v_is_blocked boolean;
  v_new_wave_id uuid;
BEGIN
  -- Step 1: Resolve target token to user ID
  SELECT user_id INTO v_target_user_id
  FROM public.ephemeral_ids
  WHERE token = p_target_token
    AND (is_active = true OR expires_at > now());

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'invalid_or_expired_token');
  END IF;

  -- Prevent self-wave
  IF v_target_user_id = p_waver_id THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'self_wave');
  END IF;

  -- Step 2: Advisory lock on the ordered user pair
  v_lock_key := hashtext(
    LEAST(p_waver_id::text, v_target_user_id::text) ||
    GREATEST(p_waver_id::text, v_target_user_id::text)
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Step 2b: Check blocks INSIDE the lock to prevent race condition
  -- (block created between check and lock acquisition)
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = p_waver_id AND blocked_id = v_target_user_id)
       OR (blocked_id = p_waver_id AND blocker_id = v_target_user_id)
  ) INTO v_is_blocked;

  IF v_is_blocked THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'blocked');
  END IF;

  -- Step 3: Rate limit INSIDE the lock so concurrent waves are serialized
  SELECT COUNT(*) INTO v_recent_wave_count
  FROM public.waves
  WHERE waver_user_id = p_waver_id
    AND created_at > now() - interval '1 minute';

  IF v_recent_wave_count >= 20 THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'rate_limited');
  END IF;

  -- Step 4: Early check — already matched?
  SELECT m.id INTO v_existing_match_id
  FROM public.matches m
  WHERE m.user_a = LEAST(p_waver_id, v_target_user_id)
    AND m.user_b = GREATEST(p_waver_id, v_target_user_id);

  IF v_existing_match_id IS NOT NULL THEN
    SELECT p.instagram_handle, p.snapchat_handle
    INTO v_matched_instagram, v_matched_snapchat
    FROM public.profiles p
    WHERE p.id = v_target_user_id;

    RETURN jsonb_build_object(
      'status', 'already_matched',
      'match_id', v_existing_match_id,
      'matched_user_id', v_target_user_id,
      'instagram_handle', v_matched_instagram,
      'snapchat_handle', v_matched_snapchat
    );
  END IF;

  -- Step 5: Insert wave (upsert — ignore if duplicate)
  -- RETURNING only returns rows that were actually inserted.
  -- If the conflict fires (duplicate wave), v_new_wave_id stays NULL.
  INSERT INTO public.waves (waver_user_id, target_ephemeral_token, expires_at)
  VALUES (p_waver_id, p_target_token, now() + interval '15 minutes')
  ON CONFLICT (waver_user_id, target_ephemeral_token) WHERE (is_consumed = false)
  DO NOTHING
  RETURNING id INTO v_new_wave_id;

  -- Step 6: Check for reciprocal wave
  SELECT w.id INTO v_reciprocal_wave_id
  FROM public.waves w
  INNER JOIN public.ephemeral_ids eid
    ON w.target_ephemeral_token = eid.token
  WHERE w.waver_user_id = v_target_user_id
    AND eid.user_id = p_waver_id
    AND w.is_consumed = false
    AND w.expires_at > now();

  IF v_reciprocal_wave_id IS NULL THEN
    -- No reciprocal wave — just a pending wave
    RETURN jsonb_build_object(
      'status', 'pending',
      'target_user_id', v_target_user_id,
      'is_new_wave', v_new_wave_id IS NOT NULL
    );
  END IF;

  -- Step 7: Mutual wave — create match!
  INSERT INTO public.matches (user_a, user_b)
  VALUES (LEAST(p_waver_id, v_target_user_id), GREATEST(p_waver_id, v_target_user_id))
  RETURNING id INTO v_new_match_id;

  -- Mark both waves as consumed
  UPDATE public.waves
  SET is_consumed = true
  WHERE id IN (
    (SELECT id FROM public.waves
     WHERE waver_user_id = p_waver_id
       AND target_ephemeral_token = p_target_token
       AND is_consumed = false
     LIMIT 1),
    v_reciprocal_wave_id
  );

  -- Get matched user's handles
  SELECT p.instagram_handle, p.snapchat_handle
  INTO v_matched_instagram, v_matched_snapchat
  FROM public.profiles p
  WHERE p.id = v_target_user_id;

  RETURN jsonb_build_object(
    'status', 'match',
    'match_id', v_new_match_id,
    'matched_user_id', v_target_user_id,
    'instagram_handle', v_matched_instagram,
    'snapchat_handle', v_matched_snapchat
  );
END;
$$;
