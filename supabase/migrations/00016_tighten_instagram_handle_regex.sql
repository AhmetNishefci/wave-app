-- Tighten Instagram handle DB constraint to match client-side validation.
-- Old: '^[a-z0-9._]{1,30}$' (allows starting/ending with dots/underscores)
-- New: '^[a-z0-9]([a-z0-9._]{0,28}[a-z0-9])?$' (must start/end with alphanumeric)
-- This aligns server validation with the client regex in profile.ts.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS valid_instagram_handle;

ALTER TABLE public.profiles
  ADD CONSTRAINT valid_instagram_handle
  CHECK (
    instagram_handle IS NULL
    OR instagram_handle ~ '^[a-z0-9]([a-z0-9._]{0,28}[a-z0-9])?$'
  );
