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

**Fix path:** Add a per-integration metadata-edit panel to `src/app/admin/page.tsx`. Lower priority than feature support editing, but high-value for letting Product self-serve label cleanups (like the "POS / Ecommerce" recategorization we did manually).

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
