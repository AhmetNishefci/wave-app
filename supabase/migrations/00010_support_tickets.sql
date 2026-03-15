-- 00010: In-app support tickets
--
-- Stores user support requests submitted from Settings → Contact Support.
-- Reviewable via Supabase dashboard (service_role only).

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  category text NOT NULL,
  details text,
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT support_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT support_tickets_user_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_support_tickets_user ON public.support_tickets (user_id, created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
-- No client read policy — tickets are admin-only via service_role

-- RPC for creating a ticket
CREATE OR REPLACE FUNCTION public.create_support_ticket(p_category text, p_details text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO support_tickets (user_id, category, details)
  VALUES (auth.uid(), p_category, p_details);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text) TO authenticated;
