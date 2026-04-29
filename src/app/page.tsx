"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Integration = {
  integration_id: string;
  integration_name: string;
  category: string | null;
  status: string | null;
  public_visibility: boolean | null;
  updated_at?: string | null;
};

type FeatureRecord = {
  feature_id: string;
  feature_name: string;
  display_order: number | null;
  section_id: string | null;
  description: string | null;
};

type SectionRecord = {
  section_id: string;
  section_name: string;
  display_order: number | null;
};

type SupportRecord = {
  integration_id: string;
  feature_id: string;
  support_status: string | null;
  customer_facing_override: string | null;
};

type FeatureStatus = "supported" | "planned" | "not_supported";

function toFeatureStatus(raw: string | null | undefined): FeatureStatus {
  if (raw === "supported") return "supported";
  if (raw === "planned") return "planned";
  return "not_supported";
}

type DisplayFeatureRow = {
  feature_id: string;
  feature_name: string;
  label: string;
  description: string | null;
  feature_order: number;
  section_name: string;
  section_order: number;
  status: FeatureStatus;
};

type ComparisonFeatureRow = {
  feature_id: string;
  feature_name: string;
  description: string | null;
  feature_order: number;
  section_name: string;
  section_order: number;
  firstStatus: FeatureStatus;
  secondStatus: FeatureStatus;
};

type GroupedRow = {
  section_name: string;
  section_order: number;
  items: DisplayFeatureRow[];
};

type ComparisonGroupedRow = {
  section_name: string;
  section_order: number;
  items: ComparisonFeatureRow[];
};

function categoryLabel(category?: string | null) {
  return category || "Integration";
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-[#6262F5] transition-transform duration-200 ${
        expanded ? "rotate-90" : ""
      }`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function PublicIntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);

  const [allFeatures, setAllFeatures] = useState<FeatureRecord[]>([]);
  const [allSections, setAllSections] = useState<SectionRecord[]>([]);

  const [rows, setRows] = useState<DisplayFeatureRow[]>([]);
  const [comparisonRows, setComparisonRows] = useState<ComparisonFeatureRow[]>([]);

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [viewAllFeatures, setViewAllFeatures] = useState(false);

  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());

  const [status, setStatus] = useState("Loading public integrations...");
  const [loading, setLoading] = useState(true);
  const [loadingIntegration, setLoadingIntegration] = useState(false);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (compareIds.length === 2) {
      loadComparison(compareIds);
    } else {
      setComparisonRows([]);
    }
  }, [compareIds, allFeatures, allSections]);

  function toggleExpanded(featureId: string) {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  }

  async function loadInitialData() {
    setLoading(true);
    setStatus("Loading public integrations...");

    const [
      { data: integrationData, error: integrationError },
      { data: featureData, error: featureError },
      { data: sectionData, error: sectionError },
    ] = await Promise.all([
      supabase
        .from("integrations")
        .select("integration_id, integration_name, category, status, public_visibility, updated_at")
        .eq("public_visibility", true)
        .order("integration_name"),
      supabase
        .from("features")
        .select("feature_id, feature_name, display_order, section_id, description")
        .order("display_order", { ascending: true }),
      supabase
        .from("sections")
        .select("section_id, section_name, display_order")
        .order("display_order", { ascending: true }),
    ]);

    if (integrationError) {
      setStatus(`Failed to load integrations: ${integrationError.message}`);
      setLoading(false);
      return;
    }

    if (featureError) {
      setStatus(`Failed to load features: ${featureError.message}`);
      setLoading(false);
      return;
    }

    if (sectionError) {
      setStatus(`Failed to load sections: ${sectionError.message}`);
      setLoading(false);
      return;
    }

    setIntegrations((integrationData || []) as Integration[]);
    setAllFeatures((featureData || []) as FeatureRecord[]);
    setAllSections((sectionData || []) as SectionRecord[]);
    setSelectedIntegration(null);
    setRows([]);
    setViewAllFeatures(false);
    setStatus(`Loaded ${(integrationData || []).length} public integrations.`);
    setLoading(false);
  }

  async function loadIntegration(integration: Integration) {
    setSelectedIntegration(integration);
    setViewAllFeatures(false);
    setLoadingIntegration(true);
    setStatus(`Loading ${integration.integration_name}...`);

    const { data: supportData, error: supportError } = await supabase
      .from("integration_feature_support")
      .select("integration_id, feature_id, support_status, customer_facing_override")
      .eq("integration_id", integration.integration_id);

    if (supportError) {
      setStatus(`Failed to load support rows: ${supportError.message}`);
      setRows([]);
      setLoadingIntegration(false);
      return;
    }

    const supportRows = (supportData || []) as SupportRecord[];
    const supportMap = new Map(supportRows.map((row) => [row.feature_id, row]));
    const sectionMap = new Map(allSections.map((section) => [section.section_id, section]));

    const mapped: DisplayFeatureRow[] = allFeatures.map((feature) => {
      const support = supportMap.get(feature.feature_id);
      const section = feature.section_id ? sectionMap.get(feature.section_id) : null;

      return {
        feature_id: feature.feature_id,
        feature_name: feature.feature_name,
        label: support?.customer_facing_override?.trim() || feature.feature_name,
        description: feature.description,
        feature_order: feature.display_order ?? 9999,
        section_name: section?.section_name ?? "Other",
        section_order: section?.display_order ?? 9999,
        status: toFeatureStatus(support?.support_status),
      };
    });

    setRows(mapped);
    setStatus(`Loaded ${integration.integration_name}.`);
    setLoadingIntegration(false);
  }

  async function loadComparison(ids: string[]) {
    if (ids.length !== 2 || allFeatures.length === 0) return;

    setLoadingComparison(true);

    const { data, error } = await supabase
      .from("integration_feature_support")
      .select("integration_id, feature_id, support_status")
      .in("integration_id", ids);

    if (error) {
      setStatus(`Failed to load comparison: ${error.message}`);
      setComparisonRows([]);
      setLoadingComparison(false);
      return;
    }

    const supportRows = (data || []) as SupportRecord[];
    const sectionMap = new Map(allSections.map((section) => [section.section_id, section]));

    const supportMap = new Map<string, SupportRecord>();
    for (const row of supportRows) {
      supportMap.set(`${row.integration_id}:${row.feature_id}`, row);
    }

    const mapped: ComparisonFeatureRow[] = allFeatures.map((feature) => {
      const section = feature.section_id ? sectionMap.get(feature.section_id) : null;

      return {
        feature_id: feature.feature_id,
        feature_name: feature.feature_name,
        description: feature.description,
        feature_order: feature.display_order ?? 9999,
        section_name: section?.section_name ?? "Other",
        section_order: section?.display_order ?? 9999,
        firstStatus: toFeatureStatus(
          supportMap.get(`${ids[0]}:${feature.feature_id}`)?.support_status
        ),
        secondStatus: toFeatureStatus(
          supportMap.get(`${ids[1]}:${feature.feature_id}`)?.support_status
        ),
      };
    });

    setComparisonRows(mapped);
    setStatus("Comparison loaded.");
    setLoadingComparison(false);
  }

  function clearSelection() {
    setSelectedIntegration(null);
    setRows([]);
    setViewAllFeatures(false);
    setStatus(`Loaded ${integrations.length} public integrations.`);
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((existingId) => existingId !== id);
      }

      if (prev.length >= 2) {
        return prev;
      }

      return [...prev, id];
    });
  }

  const isComparisonMode = compareIds.length === 2;

  const compareIntegrations = useMemo(() => {
    return compareIds
      .map((id) => integrations.find((integration) => integration.integration_id === id))
      .filter(Boolean) as Integration[];
  }, [compareIds, integrations]);

  const filteredIntegrations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return integrations;

    return integrations.filter((integration) => {
      const haystack = [
        integration.integration_name,
        integration.category || "",
        integration.status || "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [integrations, search]);

  const overviewRows = useMemo(() => {
    const sectionMap = new Map(allSections.map((section) => [section.section_id, section]));

    return allFeatures.map((feature) => {
      const section = feature.section_id ? sectionMap.get(feature.section_id) : null;

      return {
        feature_id: feature.feature_id,
        feature_name: feature.feature_name,
        label: feature.feature_name,
        description: feature.description,
        feature_order: feature.display_order ?? 9999,
        section_name: section?.section_name ?? "Other",
        section_order: section?.display_order ?? 9999,
        status: "supported",
      } satisfies DisplayFeatureRow;
    });
  }, [allFeatures, allSections]);

  const visibleRows = useMemo(() => {
    if (!selectedIntegration) return overviewRows;
    if (viewAllFeatures) return rows;
    return rows.filter(
      (row) => row.status === "supported" || row.status === "planned"
    );
  }, [overviewRows, rows, selectedIntegration, viewAllFeatures]);

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedRow>();

    const sorted = [...visibleRows].sort((a, b) => {
      if (a.section_order !== b.section_order) return a.section_order - b.section_order;
      if (a.feature_order !== b.feature_order) return a.feature_order - b.feature_order;
      return a.feature_name.localeCompare(b.feature_name);
    });

    for (const row of sorted) {
      if (!map.has(row.section_name)) {
        map.set(row.section_name, {
          section_name: row.section_name,
          section_order: row.section_order,
          items: [],
        });
      }

      map.get(row.section_name)!.items.push(row);
    }

    return [...map.values()].sort((a, b) => a.section_order - b.section_order);
  }, [visibleRows]);

  const comparisonGrouped = useMemo(() => {
    const map = new Map<string, ComparisonGroupedRow>();

    const sorted = [...comparisonRows].sort((a, b) => {
      if (a.section_order !== b.section_order) return a.section_order - b.section_order;
      if (a.feature_order !== b.feature_order) return a.feature_order - b.feature_order;
      return a.feature_name.localeCompare(b.feature_name);
    });

    for (const row of sorted) {
      if (!map.has(row.section_name)) {
        map.set(row.section_name, {
          section_name: row.section_name,
          section_order: row.section_order,
          items: [],
        });
      }

      map.get(row.section_name)!.items.push(row);
    }

    return [...map.values()].sort((a, b) => a.section_order - b.section_order);
  }, [comparisonRows]);

  const supportedCount = useMemo(() => {
    return rows.filter((row) => row.status === "supported").length;
  }, [rows]);

  const plannedCount = useMemo(() => {
    return rows.filter((row) => row.status === "planned").length;
  }, [rows]);

  const unsupportedCount = useMemo(() => {
    return rows.filter((row) => row.status === "not_supported").length;
  }, [rows]);

  return (
    <main className="min-h-screen bg-[#6262F5]">
      <header className="border-b border-[#E2E6ED] bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <img src="/aiq-logo.svg" alt="AIQ" className="h-10 w-auto object-contain" />

              <div className="min-w-0">
                <h1 className="mt-1 text-[30px] font-bold leading-tight text-[#080808]">
                  Integrations Matrix
                </h1>
                <p className="mt-2 max-w-3xl text-[16px] leading-6 text-[#626875]">
                  Browse public integrations, review feature sections, and compare
                  support across two integrations.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {selectedIntegration && !isComparisonMode && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="inline-flex items-center justify-center rounded-full border border-[#D7DCE5] bg-white px-4 py-2 text-[14px] font-semibold text-[#626875] transition hover:bg-[#F4F6FA]"
                >
                  Back to feature reference
                </button>
              )}

              <Link
                href="/admin"
                className="inline-flex items-center justify-center rounded-full border-2 border-[#6262F5] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#6262F5] transition hover:bg-[#6262F5] hover:text-white"
              >
                Admin login
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-white/15 bg-white p-5 text-[#080808] shadow-sm">
            <div>
              <label
                htmlFor="integration-search"
                className="mb-2 block text-[12px] font-bold uppercase tracking-[0.12em] text-[#626875]"
              >
                Search integrations
              </label>
              <input
                id="integration-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or category"
                className="w-full rounded-lg border border-[#E2E6ED] bg-white px-4 py-3 text-[16px] text-[#080808] outline-none transition placeholder:text-[#A2A6AE] focus:border-[#6262F5]"
              />
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-[#E2E6ED] pt-5">
              <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#626875]">
                Integrations
              </h2>
              <span className="text-[13px] font-medium text-[#626875]">
                {filteredIntegrations.length}
              </span>
            </div>

            <p className="mt-2 text-[12px] leading-5 text-[#626875]">
              Click an integration to view details. Check exactly two to compare.
            </p>

            <div className="mt-3 space-y-2">
              {filteredIntegrations.map((integration) => {
                const isSelected =
                  selectedIntegration?.integration_id === integration.integration_id;
                const isChecked = compareIds.includes(integration.integration_id);
                const isCompareDisabled = !isChecked && compareIds.length >= 2;

                return (
                  <div
                    key={integration.integration_id}
                    className={`rounded-xl border transition ${
                      isSelected && !isComparisonMode
                        ? "border-[#6262F5] bg-[#6262F5] text-white"
                        : "border-[#E2E6ED] bg-white text-[#080808] hover:border-[#C9D2E3] hover:bg-[#F4F6FA]"
                    }`}
                  >
                    <div className="flex items-start gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isCompareDisabled}
                        onChange={() => toggleCompare(integration.integration_id)}
                        className="mt-1 h-4 w-4 rounded border-[#C9D2E3] accent-[#6262F5]"
                        aria-label={`Compare ${integration.integration_name}`}
                      />

                      <button
                        type="button"
                        onClick={() => loadIntegration(integration)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="text-[16px] font-semibold leading-5">
                          {integration.integration_name}
                        </div>
                        <div
                          className={`mt-1 text-[13px] ${
                            isSelected && !isComparisonMode
                              ? "text-white/90"
                              : "text-[#626875]"
                          }`}
                        >
                          {categoryLabel(integration.category)}
                        </div>
                      </button>
                    </div>
                  </div>
                );
              })}

              {!loading && filteredIntegrations.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#D7DCE5] bg-[#FAFBFC] px-4 py-5 text-[14px] text-[#626875]">
                  No integrations match your search.
                </div>
              )}
            </div>

            {compareIds.length > 0 && (
              <button
                type="button"
                onClick={() => setCompareIds([])}
                className="mt-4 w-full rounded-full border border-[#D7DCE5] bg-white px-4 py-2 text-[13px] font-semibold text-[#626875] transition hover:bg-[#F4F6FA]"
              >
                Clear comparison
              </button>
            )}
          </aside>

          <section className="rounded-2xl border border-white/15 bg-white p-6 text-[#080808] shadow-sm lg:p-8">
            {loading ? (
              <div className="rounded-xl border border-[#E2E6ED] bg-[#FAFBFC] px-5 py-6 text-[16px] text-[#626875]">
                Loading...
              </div>
            ) : isComparisonMode ? (
              <>
                <div className="border-b border-[#E2E6ED] pb-6">
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#626875]">
                    Comparison view
                  </p>
                  <h2 className="mt-2 text-[30px] font-bold leading-tight text-[#080808]">
                    Compare integrations
                  </h2>
                  <p className="mt-3 text-[16px] leading-6 text-[#626875]">
                    Comparing{" "}
                    <span className="font-semibold text-[#080808]">
                      {compareIntegrations[0]?.integration_name}
                    </span>{" "}
                    and{" "}
                    <span className="font-semibold text-[#080808]">
                      {compareIntegrations[1]?.integration_name}
                    </span>
                    .
                  </p>
                  <p className="mt-3 text-[13px] text-[#626875]">
                    Click a feature name to see its description.
                  </p>
                </div>

                <div className="mt-8 space-y-8">
                  {loadingComparison ? (
                    <div className="rounded-xl border border-[#E2E6ED] bg-[#FAFBFC] px-5 py-6 text-[16px] text-[#626875]">
                      Loading comparison...
                    </div>
                  ) : (
                    comparisonGrouped.map((group) => (
                      <section key={group.section_name} className="space-y-4">
                        <div className="border-b border-[#E2E6ED] pb-3">
                          <h3 className="text-[24px] font-bold leading-tight text-[#080808]">
                            {group.section_name}
                          </h3>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-[#E2E6ED]">
                          <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-[#FAFBFC] text-[13px] font-bold uppercase tracking-[0.08em] text-[#626875]">
                            <div className="border-r border-[#E2E6ED] px-4 py-3">
                              Feature
                            </div>
                            <div className="border-r border-[#E2E6ED] px-4 py-3">
                              {compareIntegrations[0]?.integration_name}
                            </div>
                            <div className="px-4 py-3">
                              {compareIntegrations[1]?.integration_name}
                            </div>
                          </div>

                          {group.items.map((item) => {
                            const hasDescription = !!item.description?.trim();
                            const isExpanded = expandedFeatures.has(item.feature_id);
                            const descriptionId = `comparison-desc-${item.feature_id}`;

                            return (
                              <div
                                key={item.feature_id}
                                className="border-t border-[#E2E6ED]"
                              >
                                <div className="grid grid-cols-[1.4fr_1fr_1fr] text-[15px]">
                                  <div className="border-r border-[#E2E6ED]">
                                    {hasDescription ? (
                                      <button
                                        type="button"
                                        onClick={() => toggleExpanded(item.feature_id)}
                                        aria-expanded={isExpanded}
                                        aria-controls={descriptionId}
                                        className="flex h-full w-full items-center justify-between gap-3 px-4 py-3 text-left font-medium text-[#080808] transition hover:bg-[#FAFBFC]"
                                      >
                                        <span>{item.feature_name}</span>
                                        <ChevronIcon expanded={isExpanded} />
                                      </button>
                                    ) : (
                                      <div className="px-4 py-3 font-medium text-[#080808]">
                                        {item.feature_name}
                                      </div>
                                    )}
                                  </div>

                                  <div
                                    className={`border-r border-[#E2E6ED] px-4 py-3 font-medium ${
                                      item.firstStatus === "supported"
                                        ? "text-[#080808]"
                                        : item.firstStatus === "planned"
                                        ? "text-[#92400E]"
                                        : "text-[#7F8794]"
                                    }`}
                                  >
                                    {item.firstStatus === "supported"
                                      ? "Supported"
                                      : item.firstStatus === "planned"
                                      ? "Planned"
                                      : "Not Supported"}
                                  </div>

                                  <div
                                    className={`px-4 py-3 font-medium ${
                                      item.secondStatus === "supported"
                                        ? "text-[#080808]"
                                        : item.secondStatus === "planned"
                                        ? "text-[#92400E]"
                                        : "text-[#7F8794]"
                                    }`}
                                  >
                                    {item.secondStatus === "supported"
                                      ? "Supported"
                                      : item.secondStatus === "planned"
                                      ? "Planned"
                                      : "Not Supported"}
                                  </div>
                                </div>

                                {hasDescription && isExpanded && (
                                  <div
                                    id={descriptionId}
                                    className="border-t border-[#E2E6ED] bg-[#FAFBFC] px-4 py-3 text-[14px] leading-6 text-[#626875]"
                                  >
                                    {item.description}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              </>
            ) : selectedIntegration ? (
              <>
                <div className="border-b border-[#E2E6ED] pb-6">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#626875]">
                          Public integration
                        </p>
                        <h2 className="mt-2 text-[30px] font-bold leading-tight text-[#080808]">
                          {selectedIntegration.integration_name}
                        </h2>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-[#E2E6ED] bg-[#FAFBFC] px-3 py-1.5 text-[13px] font-medium text-[#626875]">
                          {categoryLabel(selectedIntegration.category)}
                        </span>

                        {selectedIntegration.status && (
                          <span className="rounded-full border border-[#E2E6ED] bg-[#FAFBFC] px-3 py-1.5 text-[13px] font-medium text-[#626875]">
                            {selectedIntegration.status}
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-[14px] leading-6 text-[#626875]">{status}</p>

                    <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-[#EDF0FF] px-3 py-1.5 text-[13px] font-medium text-[#6262F5]">
                          {supportedCount} supported
                        </span>

                        {plannedCount > 0 && (
                          <span className="rounded-full bg-[#FEF3C7] px-3 py-1.5 text-[13px] font-medium text-[#92400E]">
                            {plannedCount} planned
                          </span>
                        )}

                        {viewAllFeatures && (
                          <span className="rounded-full bg-[#F4F6FA] px-3 py-1.5 text-[13px] font-medium text-[#626875]">
                            {unsupportedCount} unsupported
                          </span>
                        )}
                      </div>

                      <label className="inline-flex items-center gap-3 text-[14px] font-medium text-[#626875]">
                        <span>View All Features</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={viewAllFeatures}
                          onClick={() => setViewAllFeatures((prev) => !prev)}
                          className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                            viewAllFeatures ? "bg-[#6262F5]" : "bg-[#D6DBE5]"
                          }`}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                              viewAllFeatures ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </label>
                    </div>

                    <p className="text-[13px] text-[#626875]">
                      Click a feature to see its description.
                    </p>
                  </div>
                </div>

                <FeatureList
                  grouped={grouped}
                  loadingIntegration={loadingIntegration}
                  viewAllFeatures={viewAllFeatures}
                  emptyMessage="No supported features available to display."
                  expandedFeatures={expandedFeatures}
                  onToggleExpand={toggleExpanded}
                />
              </>
            ) : (
              <>
                <div className="border-b border-[#E2E6ED] pb-6">
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#626875]">
                    Feature reference
                  </p>
                  <h2 className="mt-2 text-[30px] font-bold leading-tight text-[#080808]">
                    All feature sections
                  </h2>
                  <p className="mt-3 max-w-3xl text-[16px] leading-6 text-[#626875]">
                    Use this as a reference key for all available features in the
                    matrix. Click a feature to see its description, select an integration
                    from the left to view supported features, or check exactly two
                    integrations to compare them.
                  </p>
                </div>

                <FeatureList
                  grouped={grouped}
                  loadingIntegration={false}
                  viewAllFeatures={false}
                  emptyMessage="No features available to display."
                  expandedFeatures={expandedFeatures}
                  onToggleExpand={toggleExpanded}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function FeatureList({
  grouped,
  loadingIntegration,
  viewAllFeatures,
  emptyMessage,
  expandedFeatures,
  onToggleExpand,
}: {
  grouped: GroupedRow[];
  loadingIntegration: boolean;
  viewAllFeatures: boolean;
  emptyMessage: string;
  expandedFeatures: Set<string>;
  onToggleExpand: (featureId: string) => void;
}) {
  return (
    <div className="mt-8 space-y-8">
      {loadingIntegration ? (
        <div className="rounded-xl border border-[#E2E6ED] bg-[#FAFBFC] px-5 py-6 text-[16px] text-[#626875]">
          Loading integration details...
        </div>
      ) : grouped.length > 0 ? (
        grouped.map((group) => (
          <section key={group.section_name} className="space-y-4">
            <div className="flex flex-col gap-2 border-b border-[#E2E6ED] pb-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-[24px] font-bold leading-tight text-[#080808]">
                {group.section_name}
              </h3>
              <span className="text-[13px] font-medium text-[#626875]">
                {group.items.filter((item) => item.status === "supported").length} supported
                {group.items.filter((item) => item.status === "planned").length > 0
                  ? ` · ${group.items.filter((item) => item.status === "planned").length} planned`
                  : ""}
                {viewAllFeatures ? ` · ${group.items.length} total` : ""}
              </span>
            </div>

            <ul className="overflow-hidden rounded-xl border border-[#E2E6ED] bg-white">
              {group.items.map((item, idx) => {
                const hasDescription = !!item.description?.trim();
                const isExpanded = expandedFeatures.has(item.feature_id);
                const descriptionId = `feature-desc-${item.feature_id}`;
                const borderTop = idx === 0 ? "" : "border-t border-[#E2E6ED]";
                const labelClass =
                  item.status === "not_supported"
                    ? "text-[#7F8794]"
                    : "text-[#080808]";

                const statusBadge =
                  item.status === "planned" ? (
                    <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[12px] font-medium text-[#92400E]">
                      Planned
                    </span>
                  ) : item.status === "not_supported" ? (
                    <span className="rounded-full bg-[#F4F6FA] px-2 py-0.5 text-[12px] font-medium text-[#7F8794]">
                      Not supported
                    </span>
                  ) : null;

                return (
                  <li key={item.feature_id} className={borderTop}>
                    {hasDescription ? (
                      <button
                        type="button"
                        onClick={() => onToggleExpand(item.feature_id)}
                        aria-expanded={isExpanded}
                        aria-controls={descriptionId}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[#FAFBFC]"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`text-[16px] leading-6 ${labelClass}`}>
                            {item.label}
                          </span>
                          {statusBadge}
                        </span>
                        <ChevronIcon expanded={isExpanded} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-3">
                        <span className={`text-[16px] leading-6 ${labelClass}`}>
                          {item.label}
                        </span>
                        {statusBadge}
                      </div>
                    )}

                    {hasDescription && isExpanded && (
                      <div
                        id={descriptionId}
                        className="border-t border-[#E2E6ED] bg-[#FAFBFC] px-4 py-3 text-[14px] leading-6 text-[#626875]"
                      >
                        {item.description}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <div className="rounded-xl border border-dashed border-[#D7DCE5] bg-[#FAFBFC] px-5 py-8 text-[16px] text-[#626875]">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
