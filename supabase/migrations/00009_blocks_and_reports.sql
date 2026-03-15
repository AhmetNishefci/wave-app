-- 00009: Block & Report system
--
-- Adds blocks table (bidirectional hiding on radar + wave rejection),
-- reports table (moderation queue), and modifies resolve_peer_notes
-- to return block status + user_id for client-side filtering.

-- 1. Blocks table
CREATE TABLE IF NOT EXISTS public.blocks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  blocked_display_name text,
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT blocks_pkey PRIMARY KEY (id),
  CONSTRAINT blocks_blocker_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT blocks_blocked_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT blocks_unique UNIQUE (blocker_id, blocked_id),
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX idx_blocks_blocker ON public.blocks (blocker_id);
CREATE INDEX idx_blocks_blocked ON public.blocks (blocked_id);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

-- Users can read and delete their own blocks (for unblock)
CREATE POLICY "Users can read own blocks"
  ON public.blocks FOR SELECT USING (auth.uid() = blocker_id);
CREATE POLICY "Users can delete own blocks"
  ON public.blocks FOR DELETE USING (auth.uid() = blocker_id);

-- 2. Reports table (admin-only read via service_role)
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  reporter_id uuid NOT NULL,
  reported_id uuid NOT NULL,
  reason text NOT NULL,
  details text,
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_reporter_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT reports_reported_fkey FOREIGN KEY (reported_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_reports_reported ON public.reports (reported_id, created_at DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
-- No client policies — reports are reviewed via service_role in dashboard

-- 3. Grant blocks table access to authenticated (for RLS-protected reads + deletes)
GRANT SELECT, DELETE ON TABLE public.blocks TO authenticated;

-- 4. Modified resolve_peer_notes → resolve_peer_data
-- Returns note, user_id, and is_blocked flag for each token.
-- is_blocked is true if EITHER user blocked the other (bidirectional).
CREATE OR REPLACE FUNCTION public.resolve_peer_data(p_tokens text[])
RETURNS TABLE(token text, note text, peer_user_id uuid, is_blocked boolean)
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
    ) AS is_blocked
  FROM public.ephemeral_ids e
  WHERE e.token = ANY(p_tokens)
    AND e.is_active = true
    AND e.expires_at > now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_peer_data(text[]) TO authenticated;

-- Keep the old resolve_peer_notes for backward compatibility
-- (old client versions still call it)

-- 5. Modify check_and_create_match to reject blocked pairs
CREATE OR REPLACE FUNCTION public.check_and_create_match(
  p_waver_id uuid,
  p_target_token character varying
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_target_user_id UUID;
  v_reciprocal_wave_id UUID;
  v_match_id UUID;
  v_existing_match_id UUID;
  v_recent_wave_count INT;
  v_lock_key BIGINT;
  v_matched_instagram TEXT;
  v_is_blocked BOOLEAN;
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

  -- Check if either user blocked the other
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = p_waver_id AND blocked_id = v_target_user_id)
       OR (blocked_id = p_waver_id AND blocker_id = v_target_user_id)
  ) INTO v_is_blocked;

  IF v_is_blocked THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'blocked');
  END IF;

  -- Step 2: Advisory lock on the ordered user pair
  v_lock_key := hashtext(
    LEAST(p_waver_id::text, v_target_user_id::text) ||
    GREATEST(p_waver_id::text, v_target_user_id::text)
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

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
    SELECT p.instagram_handle INTO v_matched_instagram
    FROM public.profiles p
    WHERE p.id = v_target_user_id;

    RETURN jsonb_build_object(
      'status', 'already_matched',
      'match_id', v_existing_match_id,
      'matched_user_id', v_target_user_id,
      'instagram_handle', COALESCE(v_matched_instagram, '')
    );
  END IF;

  -- Step 5: Insert the wave FIRST (before checking reciprocals)
  INSERT INTO public.waves (waver_user_id, target_ephemeral_token, expires_at)
  VALUES (p_waver_id, p_target_token, now() + INTERVAL '15 minutes')
  ON CONFLICT DO NOTHING;

  -- Step 6: Check if target has already waved at the waver
  SELECT w.id INTO v_reciprocal_wave_id
  FROM public.waves w
  JOIN public.ephemeral_ids e ON w.target_ephemeral_token = e.token
  WHERE w.waver_user_id = v_target_user_id
    AND e.user_id = p_waver_id
    AND (e.is_active = true OR e.expires_at > now())
    AND w.is_consumed = false
    AND w.expires_at > now()
  LIMIT 1
  FOR UPDATE OF w;

  -- Step 7: If reciprocal wave exists, create a match
  IF v_reciprocal_wave_id IS NOT NULL THEN
    UPDATE public.waves SET is_consumed = true
    WHERE id = v_reciprocal_wave_id;

    UPDATE public.waves SET is_consumed = true
    WHERE waver_user_id = p_waver_id
      AND target_ephemeral_token = p_target_token
      AND is_consumed = false;

    INSERT INTO public.matches (user_a, user_b)
    VALUES (
      LEAST(p_waver_id, v_target_user_id),
      GREATEST(p_waver_id, v_target_user_id)
    )
    ON CONFLICT (LEAST(user_a, user_b), GREATEST(user_a, user_b)) DO NOTHING
    RETURNING id INTO v_match_id;

    IF v_match_id IS NOT NULL THEN
      SELECT p.instagram_handle INTO v_matched_instagram
      FROM public.profiles p
      WHERE p.id = v_target_user_id;

      RETURN jsonb_build_object(
        'status', 'match',
        'match_id', v_match_id,
        'matched_user_id', v_target_user_id,
        'instagram_handle', COALESCE(v_matched_instagram, '')
      );
    ELSE
      RETURN jsonb_build_object('status', 'already_matched');
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'pending', 'target_user_id', v_target_user_id);
END;
$$;

-- 6. Unblock RPC
CREATE OR REPLACE FUNCTION public.unblock_user(p_blocked_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.blocks
  WHERE blocker_id = auth.uid() AND blocked_id = p_blocked_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;

-- 7. Get blocked users RPC
CREATE OR REPLACE FUNCTION public.get_blocked_users()
RETURNS TABLE(blocked_id uuid, blocked_display_name text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b.blocked_id, b.blocked_display_name, b.created_at
  FROM public.blocks b
  WHERE b.blocker_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_blocked_users() TO authenticated;
