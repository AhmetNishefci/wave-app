-- 00012: Return live handles for blocked users instead of stale snapshot.
--
-- Joins blocks with profiles to get the blocked user's current
-- Instagram/Snapchat handle. Falls back to blocked_display_name snapshot
-- if the user has deleted their profile (CASCADE sets it to NULL).

CREATE OR REPLACE FUNCTION public.get_blocked_users()
RETURNS TABLE(blocked_id uuid, blocked_display_name text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    b.blocked_id,
    COALESCE(
      CASE
        WHEN p.instagram_handle IS NOT NULL THEN '@' || p.instagram_handle
        WHEN p.snapchat_handle IS NOT NULL THEN p.snapchat_handle
        ELSE NULL
      END,
      b.blocked_display_name
    ) AS blocked_display_name,
    b.created_at
  FROM public.blocks b
  LEFT JOIN public.profiles p ON p.id = b.blocked_id
  WHERE b.blocker_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;
