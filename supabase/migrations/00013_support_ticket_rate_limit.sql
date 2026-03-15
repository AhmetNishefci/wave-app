-- 00013: Rate-limit support tickets to 5 per hour per user.
-- Prevents spam while still allowing legitimate follow-ups.

CREATE OR REPLACE FUNCTION public.create_support_ticket(p_category text, p_details text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recent_count INT;
BEGIN
  SELECT COUNT(*) INTO v_recent_count
  FROM support_tickets
  WHERE user_id = auth.uid()
    AND created_at > now() - interval '1 hour';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited: maximum 5 tickets per hour';
  END IF;

  INSERT INTO support_tickets (user_id, category, details)
  VALUES (auth.uid(), p_category, p_details);
END;
$$;
