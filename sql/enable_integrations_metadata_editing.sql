-- =============================================================
-- Phase 1: enable authenticated users to edit integration metadata
-- =============================================================
--
-- Adds a single UPDATE policy on public.integrations so the admin
-- UI can write changes to category, public_visibility, status,
-- notes, etc. for any logged-in admin.
--
-- After this runs, the new metadata-editing panel in /admin will
-- be functional. Without this, save calls return success but
-- update zero rows because RLS blocks them silently.
-- =============================================================


DROP POLICY IF EXISTS "authenticated can update integrations"
  ON public.integrations;

CREATE POLICY "authenticated can update integrations"
  ON public.integrations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- -------------------------------------------------------------
-- Verification
-- -------------------------------------------------------------

-- Should return the new policy plus the existing read policies.
SELECT policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'integrations'
ORDER BY policyname;
