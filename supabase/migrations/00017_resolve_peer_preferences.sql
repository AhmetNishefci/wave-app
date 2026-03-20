-- 00017: Return peer preferences from resolve_peer_data
--
-- Extends resolve_peer_data to include the peer's gender_preference,
-- age_preference_min, and age_preference_max. This enables mutual
-- visibility filtering on the client — users only see peers whose
-- preferences would also include them.

-- Must drop first because the return type is changing (adding new columns).
-- PostgreSQL does not allow CREATE OR REPLACE to change a function's return type.
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
    AND e.is_active = true
    AND e.expires_at > now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_peer_data(text[]) TO authenticated;
