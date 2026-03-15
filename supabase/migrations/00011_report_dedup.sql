-- 00011: Prevent duplicate reports from the same reporter for the same user.
-- First deduplicates any existing rows (keeps the most recent), then adds
-- a unique constraint so future duplicates are handled via ON CONFLICT.

-- Remove duplicates, keeping only the most recent report per pair
DELETE FROM public.reports a
USING public.reports b
WHERE a.reporter_id = b.reporter_id
  AND a.reported_id = b.reported_id
  AND a.created_at < b.created_at;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_unique_pair UNIQUE (reporter_id, reported_id);
