-- =============================================================
-- Re-tag Ecom-only integrations from "POS / Ecommerce" to "Ecommerce"
-- =============================================================
--
-- These 8 integrations are pure Ecom (no POS side) per the source
-- spreadsheet's POS+Ecom tab. They were incorrectly bucketed under
-- "POS / Ecommerce" by the original data import. This script
-- updates them to the cleaner "Ecommerce" category label.
-- =============================================================


-- -------------------------------------------------------------
-- 1. Update the 8 Ecom-only integrations.
-- -------------------------------------------------------------

UPDATE public.integrations
SET category = 'Ecommerce',
    updated_at = now()
WHERE integration_name IN (
    'AIQ Ecom (fka Dispense)',
    'Blaze Ecom (fka Tymber)',
    'Breadstack',
    'Buddi',
    'Dutchie Ecom',
    'Jane Ecom',
    'Treez Ecom',
    'Weedmaps'
);


-- =============================================================
-- Verification queries
-- =============================================================

-- (a) Catch any name mismatches. Should return zero rows.
WITH expected_names AS (
    SELECT unnest(ARRAY[
        'AIQ Ecom (fka Dispense)',
        'Blaze Ecom (fka Tymber)',
        'Breadstack',
        'Buddi',
        'Dutchie Ecom',
        'Jane Ecom',
        'Treez Ecom',
        'Weedmaps'
    ]) AS expected_name
)
SELECT expected_name AS not_found_in_database
FROM expected_names e
WHERE NOT EXISTS (
    SELECT 1
    FROM public.integrations i
    WHERE i.integration_name = e.expected_name
)
ORDER BY expected_name;

-- (b) Final state, sorted by category for easy scanning.
SELECT integration_id, integration_name, category, public_visibility
FROM public.integrations
ORDER BY category, integration_name;
