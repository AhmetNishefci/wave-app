-- Add terms_accepted_at column for Apple App Store guideline 1.2 compliance.
-- Users must explicitly accept the Terms of Service and Privacy Policy
-- before using the app. NULL = not yet accepted.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
