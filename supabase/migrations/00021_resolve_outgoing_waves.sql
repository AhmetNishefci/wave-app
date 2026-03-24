-- 00021: Add i_waved_at_them to resolve_peer_data
--
-- When A opens the app, they need to know which nearby peers they have
-- pending outgoing waves to. This enables "Undo" to persist across app
-- restarts — the server is the source of truth for wave state.

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
