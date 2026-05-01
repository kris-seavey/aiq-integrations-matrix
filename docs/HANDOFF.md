# AIQ Integrations Matrix — Product Handoff Notes

A running collection of architectural details, behavioral assumptions, and future-proofing concerns that aren't obvious from reading the code. Updated incrementally as the system evolves.

**Audience:** Product owners and any future engineer picking this project up.

**How to use:** Each section lists items in `Concern → Fix path` format. "Concern" describes the gotcha or limitation; "Fix path" describes either the intended remediation, the workaround, or the conditions under which to revisit.

---

## Database Schema

### The `support_status` enum has six values, and adding a seventh requires synchronized changes in many places.

Current values: `supported`, `partial`, `planned`, `decommissioned`, `not_supported`, `unknown`.

**Concern:** Adding a new enum value (e.g., `beta`) requires touching at least seven places in lockstep, and forgetting any one breaks the publishing pipeline silently.

**Fix path:** Treat new statuses as a coordinated migration. Required updates:

1. `ALTER TYPE public.support_status ADD VALUE 'newvalue';` — must run alone, not in a transaction with statements that use the new value.
2. RLS policy on `integration_feature_support` — decide whether anon should see the new status; update the `support_status IN (...)` clause accordingly.
3. Both export views (`integrations_matrix_export`, `integration_docs_export`) — add to the WHERE clause to include the rows; add to the CASE statement to set the markdown label suffix.
4. Consumer page (`src/app/page.tsx`) — update the `FeatureStatus` type, the `toFeatureStatus()` helper, the `visibleRows` filter, the `FeatureList` badge rendering, and the comparison cell rendering.
5. Admin page (`src/app/admin/page.tsx`) — add the value to the `<select>` dropdown options.

### The `integration_change_log` table exists but is unused.

**Concern:** The schema includes a fully-formed audit-log table (`change_id`, `old_support_status`, `new_support_status`, `old_notes`, `new_notes`, `changed_by`, `changed_at`) but no triggers populate it. Anyone expecting an audit trail will be confused.

**Fix path:** Either wire it up with a trigger (write a function that captures OLD/NEW values into `integration_change_log` on every UPDATE of `integration_feature_support`), or drop the table. Don't let the half-built scaffold linger indefinitely.

### Four tables have RLS disabled entirely — anonymous read/write is wide open.

**Concern:** `integration_change_log`, `intercom_article_registry`, `intercom_master_article_registry`, and `product_areas` all show as `UNRESTRICTED` in the Supabase Table Editor — meaning Row Level Security is *off* on these tables. Combined with the default `GRANT ALL TO anon` permissions in `public` schema, this means anyone with the project's anon key (which is exposed in every shipped Vercel bundle, by design) can read and write to these tables via the Supabase REST API.

The exposure is mostly theoretical today — these table names aren't documented anywhere a customer would see them — but it's not a defensible long-term posture.

**Fix path:** Enable RLS on each, then add explicit policies for the access patterns those tables need.

```sql
-- Lock down the audit log: writes only via triggers (service role), reads only by authenticated.
ALTER TABLE public.integration_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read change log"
  ON public.integration_change_log FOR SELECT TO authenticated USING (true);

-- Lock down Intercom registries: writes only via edge functions (service role), reads only by authenticated.
ALTER TABLE public.intercom_article_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read intercom article registry"
  ON public.intercom_article_registry FOR SELECT TO authenticated USING (true);

ALTER TABLE public.intercom_master_article_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read intercom master article registry"
  ON public.intercom_master_article_registry FOR SELECT TO authenticated USING (true);

-- product_areas: enable RLS and add anon read + authenticated CRUD if/when surfaced.
ALTER TABLE public.product_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon can read product_areas"
  ON public.product_areas FOR SELECT TO anon USING (true);
CREATE POLICY "authenticated can read product_areas"
  ON public.product_areas FOR SELECT TO authenticated USING (true);
```

The edge function uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS, so locking these tables down doesn't break the publish flow. Triggers also run as the table owner, which bypasses RLS — so the audit log writes (if/when wired up) will work too.

### `is_active` boolean flags on `features`, `sections`, `product_areas`, `integrations` are unused.

**Concern:** These columns exist as a soft-delete escape hatch, but no view, query, or RLS policy filters by them. Setting `is_active = false` does nothing visible.

**Fix path:** If soft-delete is wanted, add `WHERE is_active = TRUE` to the views and the consumer-page queries. Otherwise drop these columns to remove the misleading affordance.

### The `product_areas` table is a hidden third level of hierarchy.

**Concern:** The schema has `product_areas → sections → features` as a three-tier hierarchy, but the UI only surfaces sections and features. Product areas are invisible to both admin and customers.

**Fix path:** If Product wants higher-level grouping in the matrix (e.g., "POS Capabilities" vs. "Email Capabilities" as super-sections), the data model already supports it — just needs UI and view changes. If it's not wanted, drop the column from `sections` and the table itself.

### No DELETE policies on integrations, features, or sections.

**Concern:** RLS allows authenticated users SELECT/INSERT/UPDATE on `integration_feature_support`, but no DELETE policy exists on any table. Removing an integration or feature requires service-role access (i.e., a developer running SQL).

**Fix path:** If admins should be able to delete via the UI, add `FOR DELETE TO authenticated` policies. Worth pairing with the soft-delete `is_active` approach above for safety.

### Integration metadata is not editable from the admin UI.

**Concern:** `integrations.category`, `integrations.status`, `integrations.notes`, `integrations.public_visibility`, `integrations.docs_slug`, `integrations.owner_team` all require SQL to change. The admin UI only edits the join table.

**Fix path:** Add a per-integration metadata-edit panel to `src/app/admin/page.tsx`. **High priority** for letting Product self-serve. Empirically, category reshuffles have come up at least four times during initial development (`sql/recategorize_integrations_pos.sql`, `sql/recategorize_ecom_only.sql`, the 365 Cannabis fix, `sql/recategorize_woo_bigcommerce.sql`) — strong signal this is a recurring workflow that shouldn't require an engineer.

### `features.description` was populated via one-time CSV import.

**Concern:** Feature descriptions live on `features.description`. They were backfilled from a Google Sheets cell-notes export. There's no in-app process for adding descriptions to net-new features.

**Fix path:** When new features are added, descriptions need to be added by hand via SQL (or via an admin UI extension that exposes the field). Worth noting in any "how to add a feature" runbook.

---

## Database Operations

### The `publish_matrix_on_support_change` trigger has hardcoded credentials.

**Concern:** The trigger function call includes a hardcoded Supabase project URL and a Bearer token in the Authorization header. If either rotates (key rotation, project migration, environment change), the trigger silently fails — `integration_feature_support` updates still persist, but Intercom doesn't update.

**Fix path:** Migrate the trigger to use Supabase Vault for the URL and token, or keep them external via environment variables. At minimum, add monitoring/alerting so silent failures surface.

### No INSERT trigger on `integrations` or `features` tables.

**Concern:** Adding a brand-new integration or feature does not trigger a republish to Intercom — only changes to `integration_feature_support` do. New integrations/features only appear in the article after the first support row is added/updated for them.

**Fix path:** If desired, add an `AFTER INSERT OR UPDATE` trigger to `integrations` and/or `features` that calls the same publish function. Beware of triggering excessive republishes during bulk imports.

### The two export views are the source of truth for Intercom content.

**Concern:** `integrations_matrix_export` (master article) and `integration_docs_export` (per-integration article — currently unused) generate the markdown. The edge function does NOT generate content; it just reads from the views and pushes. Future engineers may try to edit the edge function code expecting that's where the content lives.

**Fix path:** When changing what shows in articles, **edit the views**, not the edge function. The edge function only handles transport + markdown-to-HTML conversion.

### Both views filter `support_status IN ('supported', 'planned', 'decommissioned')`.

**Concern:** Rows with status `partial`, `unknown`, or `not_supported` (or no row at all) are excluded from views. If Product later wants to surface "partial" as a public-facing third state, the view WHERE clause needs to be updated, alongside the related RLS/UI changes listed above.

**Fix path:** Documented in the support_status enum section.

### The `customer_facing_override` field works invisibly via view substitution.

**Concern:** The override mechanism (`COALESCE(NULLIF(customer_facing_override, ''), feature_name)`) lives entirely in the views. The edge function has no awareness of it. Future engineers debugging "why does this feature show this label" won't find the answer in TypeScript code.

**Fix path:** Document the override pattern in any internal runbook. The admin UI's placeholder ("Custom label for this integration") is the only in-app surface that hints at how it works.

### Anon RLS policy on `integration_feature_support`.

Currently allows reading rows where `support_status IN ('supported', 'planned')` AND the parent integration has `public_visibility = TRUE`. Decommissioned, partial, unknown, not_supported are hidden from anonymous (logged-out) users by design.

**Concern:** Adding a new public-visible status requires updating this policy. Forgetting means the new status's rows return as empty for anon, even if the consumer page is updated to render them.

**Fix path:** Documented in the support_status enum section.

---

## Edge Functions

### The `publish-integrations-matrix` edge function is not auto-deployed from the repo.

**Concern:** A canonical copy of the source lives at `supabase/functions/publish-integrations-matrix/index.ts` for reference, but this file is not connected to any deploy pipeline. Editing the file in the repo and pushing does NOT update the deployed function. Deploys happen manually via the Supabase dashboard.

**Fix path:** Either set up the Supabase CLI to deploy from CI on push to `main`, or write a procedure that requires anyone editing the file to manually re-paste it into the dashboard and click Deploy. The latter is fragile but functional today.

### `tsconfig.json` excludes the `supabase/` directory.

**Concern:** Edge functions use Deno-specific imports (`npm:@supabase/supabase-js@2`) and globals (`Deno.env.get`) that don't compile under Next.js's Node-flavored TypeScript. The `supabase/` directory is excluded from `tsc --noEmit` to avoid spurious errors. This means edge function source is **not type-checked locally** — only at deploy time, when Supabase bundles it.

**Fix path:** If type-checking edge functions is desired, set up a separate `tsconfig.json` inside `supabase/functions/` with Deno types. Otherwise rely on careful deploys.

### The markdown-to-HTML converter only supports a subset of markdown.

Currently handles: `# / ## / ###` headings, `- ` bullet points, `**bold**` (added recently), and paragraphs.

**Concern:** Italics (`*text*`), links (`[text](url)`), code blocks, tables, blockquotes — none of these are supported. If they appear in markdown emitted by the views, they will be HTML-escaped and rendered literally in the article.

**Fix path:** Extend `inlineFormat()` and the main loop in `markdownToIntercomHtml()` as more formatting is needed. Or replace the hand-rolled converter with a lightweight markdown library (e.g., `micromark`).

### The per-integration article publisher (`publish-integration-doc`) is not currently triggered.

**Concern:** A second edge function exists/existed for publishing one Intercom article per integration. It reads from `integration_docs_export` and writes to `intercom_article_registry`. It's not wired to any trigger today — would need manual invocation.

**Fix path:** If Product later wants per-integration help center articles, this function (or an updated version of it) can be revived. The supporting view and registry table are still in the schema.

### The `intercom_article_registry` table is currently orphaned.

**Concern:** Table exists, has `integration_id` as PK, but no rows are written by any active code path. Will likely confuse future engineers who see it and try to derive its purpose.

**Fix path:** Either revive the per-integration publisher, or drop the table along with the unused edge function.

---

## Consumer Page (`src/app/page.tsx`)

### `MAX_COMPARE` constant controls comparison cap.

**Worth flagging for handoff:** Currently `3`. Bumping to 4 or higher is a one-line change. Beyond ~4 the table will become unreadable on standard desktop widths and start scrolling horizontally — that's by design (the comparison container is wrapped in `overflow-x-auto`), but worth a UX review before bumping.

### `CATEGORY_ORDER` constant controls sidebar Type-mode section order.

**Worth flagging for handoff:** Lives at the top of `page.tsx`. Adding a new category to the database without adding it to this list means the new category will appear in Type mode at the *end* of the sidebar in alphabetical order — visible but possibly mis-ordered. Edit the array to reorder.

### Status visibility is split between RLS and the page filter.

**Concern:** Decommissioned features are hidden from the consumer page **by RLS** — anon never receives those rows. Planned features are filtered/styled **in the page code**. This split is easy to lose track of when debugging "why doesn't X feature show on the public page."

**Fix path:** Trace from the `loadIntegration()` query forward. If the row is missing entirely from the response, RLS is blocking it. If the row arrives but doesn't render, the page filter is hiding it.

### The "View All Features" toggle relies on missing-row inference.

**Concern:** Features with no `integration_feature_support` row at all are treated as "not_supported" by `toFeatureStatus()`. This works because all integrations are expected to have rows for all features they care about, but it's a fragile assumption.

**Fix path:** If an integration is missing a feature row, the page silently treats it as "not_supported." This is intentional today, but if Product later wants distinct visual treatment for "no row vs. explicit not_supported," the page would need to track row-presence as a separate signal.

---

## Admin Page (`src/app/admin/page.tsx`)

### Admin page only edits `integration_feature_support`.

**Concern:** The admin can change `support_status` and `customer_facing_override` per (integration, feature) cell. Cannot change feature names, section names, integration names, integration categories, public visibility, or anything else. Those require SQL.

**Fix path:** See "Integration metadata is not editable from the admin UI" above for the natural extension point.

### The status dropdown options are hand-coded.

**Concern:** `<option value="supported">supported</option>` etc. — these are static JSX, not derived from the enum. If a new enum value is added and forgotten here, admins won't see it as an option.

**Fix path:** Either keep them in lockstep manually (current approach), or fetch the enum values from the database at load time and render options dynamically. The latter is overkill unless statuses change frequently.

### Save flow is upsert.

The admin's save action does `upsert(payload, { onConflict: 'integration_id,feature_id' })` — INSERTs new rows or UPDATEs existing ones. Both paths fire the publish trigger (since we updated it to fire on INSERT OR UPDATE). Empty `customer_facing_override` is saved as empty string and reverts to the canonical feature name via the view's `NULLIF`.

---

## Operations / Workflow

### Two repo clones on the developer's machine.

**Concern:** Kris has both `~/aiq-integrations-matrix/` and `~/aiq-admin/` as working clones. This created divergent state once during our session (a stale lock, a behind-remote branch). Multiple working copies of the same repo is a known footgun.

**Fix path:** Canonicalize on `~/aiq-integrations-matrix/` going forward; archive or delete `~/aiq-admin/`.

### Vercel auto-deploys from `main`.

**Concern:** No staging branch, no preview deployments, no review process. A buggy push to `main` deploys directly to production.

**Fix path:** Optional: introduce a `staging` branch with its own Vercel project and a `develop → staging → main` PR flow if the project's velocity demands it. Likely overkill until multiple engineers are working on it.

### SQL migrations are tracked by file presence, not by application history.

**Concern:** Migrations live in `sql/`. There's no record in the database of which files have been applied. If a script is run twice unintentionally, it may error (e.g., creating a duplicate policy) or silently re-do work (idempotent CREATE OR REPLACE).

**Fix path:** Either move to a managed migration tool (e.g., Supabase CLI's migration system, sqitch, dbmate), or maintain a manual changelog at the top of each SQL file noting when/whether it was applied. Keep verification queries at the bottom of every migration file as a self-documenting check.

### No alerting on edge function failures.

**Concern:** If the publish fails (Intercom API down, key invalid, view error, etc.), the change to `integration_feature_support` still persists locally. The article just doesn't update. There's no notification.

**Fix path:** Wire the edge function to log failures to a notification channel (Slack webhook, email, Intercom support inbox). Alternatively, periodically reconcile the article markdown against the view's current output and alert on drift.

---

## Admin CRUD Build-Out

A four-phase rollout that turns the admin from a feature-support-only tool into a full Product self-service surface. Each phase ships independently.

### Architectural decisions (locked in)

These are the answers to the five upfront decisions documented during Phase 1 planning. Any future engineer or Product owner picking up this work should be aware of them.

**1. Soft delete by default.** Hard `DELETE` cascades through `integration_feature_support` and republishes pruned articles to Intercom. Instead, "remove" actions in the admin UI should set `is_active = false` on the relevant table. Queries that drive the consumer page and Intercom views should filter `WHERE is_active = TRUE`. The `is_active` columns already exist on `features`, `sections`, `product_areas`, and `integrations` (this finally puts them to use). Hard delete remains available for engineers via service-role SQL for the rare scrub case.

**2. Auto-slugify with duplicate check** for ID generation. New integration/feature/section IDs are auto-generated from the name (`"Blaze Ecom" → "blaze-ecom"`). Before insert, the UI checks the database for collision. If a duplicate exists, the user is prompted to either edit the proposed slug or pick a different name. IDs remain immutable after creation — renaming an integration changes its display name only, not its slug. A standard `slugify(name)` helper should live in `src/lib/slug.ts` once Phase 2 begins.

**3. Separate routes per CRUD area.** `/admin` keeps the feature-support editor and integration metadata panel (Phase 1 surface). Phase 2+ adds `/admin/integrations`, `/admin/features`, `/admin/sections` as their own routes. A small dropdown nav at the top of the `/admin` shell lets admins switch between them.

**4. Empty-by-default new entries, with a friendly reminder prompt.** When an admin creates a new integration or feature, no `integration_feature_support` rows are auto-created — the new entity starts "supported by nothing" and admin fills in support rows from the existing `/admin` editor. To prevent admins from forgetting this last step, the create flow shows a confirmation toast/banner:
- After creating an integration: *"Make sure you update the status of the Features supported by your added Integration before you leave! :)"*
- After creating a feature: *"Make sure you update the status of your added Feature on its impacted Integrations before you leave! :)"*

**5. No DB-level uniqueness constraint on `integration_name`.** Different integrations can share base names (the existing data has multiple "POS" / "Ecom" suffix variants like `Blaze POS` and `Blaze Ecom`). Slug uniqueness (decision 2) provides enough collision protection for the primary key, and human-readable name collisions are handled by the user choosing a sufficiently distinct name. We may revisit this if Product wants stricter validation.

### Phase 1 — Edit existing integration metadata ✅

**What it ships:** A metadata panel inside `/admin` for editing `integrations.category` and `integrations.public_visibility` on the currently-selected integration.

**Files involved:**
- `sql/enable_integrations_metadata_editing.sql` — the single UPDATE policy on `public.integrations`.
- `src/app/admin/page.tsx` — `CATEGORY_OPTIONS` constant, `MetadataDraft` type, `metadataDraft` / `metadataSaving` state, `saveMetadata()` function, and the metadata-edit panel JSX.

**Status:** Built. Run the SQL once, push the code, test by editing a category in the UI and watching the consumer page sidebar update after refresh.

### Phase 2 — Full integration management (planned)

**What it ships:** A new `/admin/integrations` route with a table of all integrations (active + inactive), a "Create integration" form, and per-row "Mark inactive / Mark active" toggle.

**Required RLS policies (one-time):**
```sql
CREATE POLICY "authenticated can insert integrations"
  ON public.integrations FOR INSERT TO authenticated
  WITH CHECK (true);
-- UPDATE policy already exists from Phase 1; covers is_active toggle.
```
DELETE policy intentionally omitted — soft-delete via `is_active` is the supported pattern.

**Required schema work:**
- Update consumer page `loadInitialData()` query to include `WHERE is_active = TRUE` on integrations (or, better, push it into the query: `.eq('is_active', true)`).
- Update views (`integrations_matrix_export`, `integration_docs_export`) to include `AND i.is_active = TRUE` in their WHERE clauses, so the Intercom article excludes soft-deleted integrations.
- Update Phase 1 RLS policy to include `WITH CHECK (true)` to permit toggling `is_active`. (Already does; mentioned for completeness.)

**Required UI work:**
- New route `src/app/admin/integrations/page.tsx`.
- Navigation dropdown added to `/admin/page.tsx` header — "Edit Feature Support" (current page), "Edit Integrations", "Edit Features", "Edit Sections" (last two grayed out until Phase 3+4).
- `src/lib/slug.ts` helper: `slugify(name) → string`. Strip non-word characters, lowercase, hyphenate spaces.
- Create-integration form fields: `integration_name` (text), `category` (dropdown from CATEGORY_OPTIONS), `public_visibility` (toggle), `notes` (textarea, optional).
- Slug preview: as the user types `integration_name`, show the auto-generated `integration_id` next to it. Allow override before submit.
- Pre-insert duplicate check: query `integrations.integration_id` for the proposed slug; if it exists, surface "An integration with this ID already exists" and require the user to pick a different name/slug.
- Friendly post-create banner with the decision-4 reminder text.
- Per-row "Mark inactive" / "Mark active" button that calls `update({ is_active: false/true })`.
- Sort/filter controls similar to the consumer page sidebar (A-Z and by category).

**Effort estimate:** ~500 lines of new TypeScript, plus the `<ConfirmDialog>` and toast infrastructure that pays off across Phase 3+4.

### Phase 3 — Manage features (planned)

Same shape as Phase 2, but for the `features` table. Adds an extra concern: each feature has a `section_id` foreign key. The create form needs a section dropdown sourced from the `sections` table. Same soft-delete pattern. Same friendly reminder banner: "*Make sure you update the status of your added Feature on its impacted Integrations before you leave! :)*"

Phase 3 also reintroduces Product's ability to write `features.description`, the field we backfilled from the legacy spreadsheet during initial development. New features get descriptions filled in directly via this UI, eliminating the need for SQL-backed CSV imports.

### Phase 4 — Manage sections (planned, lowest priority)

CRUD for `sections` table. Including `display_order` editing for reordering sections in the matrix. Likely a drag-and-drop list in the UI; a fallback "edit display_order as a number" input is acceptable for v1. Could also be skipped indefinitely and handled via SQL for the rare case where sections genuinely change.

---

## Recently-Resolved Issues (kept here for historical context)

These were real bugs that existed at one point during development. They've been fixed; documenting them so future engineers don't re-introduce the same patterns.

### Trigger fired on UPDATE only, missing INSERT.

**Was:** `AFTER UPDATE ON integration_feature_support`. The admin's save uses upsert; if a row didn't previously exist, the upsert was an INSERT, which the trigger ignored, so Intercom didn't republish.

**Now:** `AFTER INSERT OR UPDATE`. See `sql/fix_decommissioned_publish.sql`.

### Bold markdown wasn't rendered in Intercom.

**Was:** The edge function's `markdownToIntercomHtml()` only handled headings, bullets, and paragraphs. `**bold**` markdown emitted by the views (used for `(Decommissioned)` labels) got HTML-escaped and shown as literal asterisks.

**Now:** An `inlineFormat()` pass converts `**text**` to `<strong>text</strong>` after escaping. Headings, paragraphs, and list items all get the inline format pass.

### Integration categories were imported as bulk "POS / Ecommerce".

**Was:** The original CSV-to-Supabase import bucketed every integration on the "POS + Ecom" sheet under one umbrella category, regardless of whether it actually had a POS or ecom side.

**Now:** Recategorized via `sql/recategorize_integrations_pos.sql` and `sql/recategorize_ecom_only.sql`. Categories are: POS, Ecommerce, POS / Ecommerce, Datalake / Files, 1st Party Data, Email, Other.
