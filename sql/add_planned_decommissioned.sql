-- =============================================================
-- Add visibility for "planned" and "decommissioned" feature statuses
-- =============================================================
--
-- Prerequisites:
--   1. ALTER TYPE public.support_status ADD VALUE 'decommissioned' must
--      already have been run in a prior session. Verify with:
--          SELECT unnest(enum_range(NULL::public.support_status));
--      You should see all six values including 'decommissioned'.
--
-- This script:
--   1. Replaces the anon RLS policy on integration_feature_support.
--      OLD: anon could read rows where status = 'supported'
--      NEW: anon can read rows where status IN ('supported','planned')
--           — decommissioned stays hidden from the public consumer page,
--             which is the explicit product decision.
--   2. Updates integrations_matrix_export so the master Intercom article
--      includes planned (labelled "(Planned)") and decommissioned
--      (labelled "(No longer available)") entries alongside supported.
--   3. Applies the same labelling logic to integration_docs_export for
--      consistency in case that per-integration view is ever revived.
--
-- Order is intentional: create the new policy BEFORE dropping the old
-- one, so anon read access is never momentarily empty if a step fails.
-- =============================================================


-- -------------------------------------------------------------
-- 1. Add the new RLS policy first.
-- -------------------------------------------------------------
CREATE POLICY "anon can read public-facing support rows for public integrations"
  ON public.integration_feature_support
  FOR SELECT
  TO anon
  USING (
    support_status IN (
      'supported'::public.support_status,
      'planned'::public.support_status
    )
    AND EXISTS (
      SELECT 1
      FROM public.integrations i
      WHERE i.integration_id = integration_feature_support.integration_id
        AND i.public_visibility = TRUE
    )
  );


-- -------------------------------------------------------------
-- 2. Drop the older, narrower policy.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "anon can read supported support rows for public integrations"
  ON public.integration_feature_support;


-- -------------------------------------------------------------
-- 3. Replace the master matrix view (used by the Intercom edge fn).
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.integrations_matrix_export AS
WITH section_blocks AS (
    SELECT
        i.integration_id,
        i.integration_name,
        s.display_order AS section_order,
        s.section_name,
        ('### ' || s.section_name) || E'\n' ||
        string_agg(
            '- '
            || COALESCE(NULLIF(ifs.customer_facing_override, ''), f.feature_name)
            || CASE ifs.support_status
                   WHEN 'planned'::public.support_status        THEN ' (Planned)'
                   WHEN 'decommissioned'::public.support_status THEN ' (No longer available)'
                   ELSE ''
               END,
            E'\n'
            ORDER BY
                CASE ifs.support_status
                    WHEN 'supported'::public.support_status      THEN 0
                    WHEN 'planned'::public.support_status        THEN 1
                    WHEN 'decommissioned'::public.support_status THEN 2
                    ELSE 3
                END,
                f.display_order,
                f.feature_name
        ) AS section_block
    FROM
        public.integration_feature_support ifs
        JOIN public.integrations i ON i.integration_id = ifs.integration_id
        JOIN public.features     f ON f.feature_id     = ifs.feature_id
        LEFT JOIN public.sections s ON s.section_id    = f.section_id
    WHERE
        ifs.support_status IN (
            'supported'::public.support_status,
            'planned'::public.support_status,
            'decommissioned'::public.support_status
        )
    GROUP BY
        i.integration_id,
        i.integration_name,
        s.display_order,
        s.section_name
),
integration_docs AS (
    SELECT
        sb.integration_id,
        sb.integration_name,
        ('## ' || sb.integration_name) || E'\n\n' ||
        string_agg(sb.section_block, E'\n\n' ORDER BY sb.section_order) AS integration_block
    FROM section_blocks sb
    GROUP BY sb.integration_id, sb.integration_name
)
SELECT
    '# AIQ Integrations Matrix' || E'\n\n' ||
    string_agg(integration_block, E'\n\n\n' ORDER BY integration_name) AS markdown_doc
FROM integration_docs;


-- -------------------------------------------------------------
-- 4. Replace the per-integration export view (consistency).
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.integration_docs_export AS
WITH section_blocks AS (
    SELECT
        i.integration_id,
        i.integration_name,
        s.display_order AS section_order,
        s.section_name,
        ('## ' || s.section_name) || E'\n' ||
        string_agg(
            '- '
            || COALESCE(NULLIF(ifs.customer_facing_override, ''), f.feature_name)
            || CASE ifs.support_status
                   WHEN 'planned'::public.support_status        THEN ' (Planned)'
                   WHEN 'decommissioned'::public.support_status THEN ' (No longer available)'
                   ELSE ''
               END,
            E'\n'
            ORDER BY
                CASE ifs.support_status
                    WHEN 'supported'::public.support_status      THEN 0
                    WHEN 'planned'::public.support_status        THEN 1
                    WHEN 'decommissioned'::public.support_status THEN 2
                    ELSE 3
                END,
                f.display_order,
                f.feature_name
        ) AS section_block
    FROM
        public.integration_feature_support ifs
        JOIN public.integrations i ON i.integration_id = ifs.integration_id
        JOIN public.features     f ON f.feature_id     = ifs.feature_id
        LEFT JOIN public.sections s ON s.section_id    = f.section_id
    WHERE
        ifs.support_status IN (
            'supported'::public.support_status,
            'planned'::public.support_status,
            'decommissioned'::public.support_status
        )
    GROUP BY
        i.integration_id,
        i.integration_name,
        s.display_order,
        s.section_name
)
SELECT
    integration_id,
    integration_name,
    ('# ' || integration_name) || E'\n\n' ||
    string_agg(section_block, E'\n\n' ORDER BY section_order) AS markdown_doc
FROM section_blocks
GROUP BY integration_id, integration_name;


-- =============================================================
-- Verification queries — run these after the changes above.
-- =============================================================

-- Confirm both anon and authenticated policies look right.
SELECT policyname, roles::text, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'integration_feature_support'
ORDER BY policyname;

-- Make sure the master matrix view still produces output.
SELECT length(markdown_doc) AS matrix_doc_length
FROM public.integrations_matrix_export;

-- Spot-check the per-integration view.
SELECT integration_id, length(markdown_doc) AS doc_length
FROM public.integration_docs_export
ORDER BY integration_id
LIMIT 5;

-- After this script runs, the next time anyone changes a row in
-- integration_feature_support (UPDATE), the trigger fires the edge
-- function, which reads the new view shape, and Intercom updates.
