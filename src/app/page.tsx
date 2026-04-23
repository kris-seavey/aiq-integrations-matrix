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

type DisplayFeatureRow = {
  feature_id: string;
  feature_name: string;
  label: string;
  feature_order: number;
  section_name: string;
  section_order: number;
  isSupported: boolean;
};

type GroupedRow = {
  section_name: string;
  section_order: number;
  items: DisplayFeatureRow[];
};

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toISOString().slice(0, 10);
}

function categoryLabel(category?: string | null) {
  return category || "Integration";
}

export default function PublicIntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [allFeatures, setAllFeatures] = useState<FeatureRecord[]>([]);
  const [allSections, setAllSections] = useState<SectionRecord[]>([]);
  const [rows, setRows] = useState<DisplayFeatureRow[]>([]);
  const [status, setStatus] = useState("Loading public integrations...");
  const [loading, setLoading] = useState(true);
  const [loadingIntegration, setLoadingIntegration] = useState(false);
  const [search, setSearch] = useState("");
  const [viewAllFeatures, setViewAllFeatures] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

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
        .select(`
          feature_id,
          feature_name,
          display_order,
          section_id
        `)
        .order("display_order", { ascending: true }),
      supabase
        .from("sections")
        .select(`
          section_id,
          section_name,
          display_order
        `)
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

    const integrationsList = (integrationData || []) as Integration[];
    const featuresList = (featureData || []) as FeatureRecord[];
    const sectionsList = (sectionData || []) as SectionRecord[];

    setIntegrations(integrationsList);
    setAllFeatures(featuresList);
    setAllSections(sectionsList);
    setSelectedIntegration(null);
    setRows([]);
    setViewAllFeatures(false);
    setStatus(`Loaded ${integrationsList.length} public integrations.`);
    setLoading(false);
  }

  async function loadIntegration(integration: Integration) {
    setSelectedIntegration(integration);
    setViewAllFeatures(false);
    setLoadingIntegration(true);
    setStatus(`Loading ${integration.integration_name}...`);

    const { data: supportData, error: supportError } = await supabase
      .from("integration_feature_support")
      .select(`
        integration_id,
        feature_id,
        support_status,
        customer_facing_override
      `)
      .eq("integration_id", integration.integration_id);

    if (supportError) {
      setStatus(`Failed to load support rows: ${supportError.message}`);
      setRows([]);
      setLoadingIntegration(false);
      return;
    }

    const supportRows = (supportData || []) as SupportRecord[];
    const supportMap = new Map(
      supportRows.map((row) => [row.feature_id, row])
    );

    const sectionMap = new Map(
      allSections.map((section) => [section.section_id, section])
    );

    const mapped: DisplayFeatureRow[] = allFeatures.map((feature) => {
      const support = supportMap.get(feature.feature_id);
      const section = feature.section_id ? sectionMap.get(feature.section_id) : null;
      const isSupported = support?.support_status === "supported";

      return {
        feature_id: feature.feature_id,
        feature_name: feature.feature_name,
        label: support?.customer_facing_override?.trim() || feature.feature_name,
        feature_order: feature.display_order ?? 9999,
        section_name: section?.section_name ?? "Other",
        section_order: section?.display_order ?? 9999,
        isSupported,
      };
    });

    setRows(mapped);
    setStatus(`Loaded ${integration.integration_name}.`);
    setLoadingIntegration(false);
  }

  function clearSelection() {
    setSelectedIntegration(null);
    setRows([]);
    setViewAllFeatures(false);
    setStatus(`Loaded ${integrations.length} public integrations.`);
  }

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
    const sectionMap = new Map(
      allSections.map((section) => [section.section_id, section])
    );

    return allFeatures.map((feature) => {
      const section = feature.section_id ? sectionMap.get(feature.section_id) : null;

      return {
        feature_id: feature.feature_id,
        feature_name: feature.feature_name,
        label: feature.feature_name,
        feature_order: feature.display_order ?? 9999,
        section_name: section?.section_name ?? "Other",
        section_order: section?.display_order ?? 9999,
        isSupported: true,
      } satisfies DisplayFeatureRow;
    });
  }, [allFeatures, allSections]);

  const visibleRows = useMemo(() => {
    if (!selectedIntegration) return overviewRows;
    if (viewAllFeatures) return rows;
    return rows.filter((row) => row.isSupported);
  }, [overviewRows, rows, selectedIntegration, viewAllFeatures]);

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedRow>();

    const sorted = [...visibleRows].sort((a, b) => {
      if (a.section_order !== b.section_order) {
        return a.section_order - b.section_order;
      }
      if (a.feature_order !== b.feature_order) {
        return a.feature_order - b.feature_order;
      }
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

  const supportedCount = useMemo(() => {
    return rows.filter((row) => row.isSupported).length;
  }, [rows]);

  const unsupportedCount = useMemo(() => {
    return rows.filter((row) => !row.isSupported).length;
  }, [rows]);

  return (
    <main className="min-h-screen bg-[#6262F5]">
<header className="border-b border-[#E2E6ED] bg-white">
  <div className="mx-auto max-w-7xl px-6 py-6">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-4">
        <img
          src="/aiq-logo.svg"
          alt="AIQ"
          className="h-10 w-auto object-contain"
        />

        <div className="min-w-0">
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#626875]">
            AIQ
          </p>
          <h1 className="mt-1 text-[30px] font-bold leading-tight text-[#080808]">
            Integrations Matrix
          </h1>
          <p className="mt-2 max-w-3xl text-[16px] leading-6 text-[#626875]">
            Browse public integrations and review features by section. Select
            an integration from the sidebar to compare supported features
            against the full feature reference.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {selectedIntegration && (
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

            <div className="mt-3 space-y-2">
              {filteredIntegrations.map((integration) => {
                const isSelected =
                  selectedIntegration?.integration_id === integration.integration_id;

                return (
                  <button
                    key={integration.integration_id}
                    onClick={() => loadIntegration(integration)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      isSelected
                        ? "border-[#6262F5] bg-[#6262F5] text-white"
                        : "border-[#E2E6ED] bg-white text-[#080808] hover:border-[#C9D2E3] hover:bg-[#F4F6FA]"
                    }`}
                  >
                    <div className="text-[16px] font-semibold leading-5">
                      {integration.integration_name}
                    </div>
                    <div
                      className={`mt-1 text-[13px] ${
                        isSelected ? "text-white/90" : "text-[#626875]"
                      }`}
                    >
                      {categoryLabel(integration.category)}
                    </div>
                  </button>
                );
              })}

              {!loading && filteredIntegrations.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#D7DCE5] bg-[#FAFBFC] px-4 py-5 text-[14px] text-[#626875]">
                  No integrations match your search.
                </div>
              )}
            </div>
          </aside>

          <section className="rounded-2xl border border-white/15 bg-white p-6 text-[#080808] shadow-sm lg:p-8">
            {loading ? (
              <div className="rounded-xl border border-[#E2E6ED] bg-[#FAFBFC] px-5 py-6 text-[16px] text-[#626875]">
                Loading...
              </div>
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

                        <span className="rounded-full border border-[#E2E6ED] bg-[#FAFBFC] px-3 py-1.5 text-[13px] font-medium text-[#626875]">
                          Updated {formatDate(selectedIntegration.updated_at)}
                        </span>
                      </div>
                    </div>

                    <p className="text-[14px] leading-6 text-[#626875]">{status}</p>

                    <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-[#EDF0FF] px-3 py-1.5 text-[13px] font-medium text-[#6262F5]">
                          {supportedCount} supported
                        </span>

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
                  </div>
                </div>

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
                            {group.items.filter((item) => item.isSupported).length} supported
                            {viewAllFeatures ? ` · ${group.items.length} total` : ""}
                          </span>
                        </div>

                        <ul className="space-y-2 pl-5">
                          {group.items.map((item) => (
                            <li
                              key={item.feature_id}
                              className={`text-[16px] leading-6 ${
                                item.isSupported
                                  ? "text-[#080808] marker:text-[#6262F5]"
                                  : "text-[#7F8794] marker:text-[#C0C7D4]"
                              }`}
                            >
                              <span>{item.label}</span>
                              {!item.isSupported && (
                                <span className="ml-2 rounded-full bg-[#F4F6FA] px-2 py-0.5 text-[12px] font-medium text-[#7F8794]">
                                  Not supported
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-[#D7DCE5] bg-[#FAFBFC] px-5 py-8 text-[16px] text-[#626875]">
                      No supported features available to display.
                    </div>
                  )}
                </div>
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
                    matrix. Select an integration from the left to view supported
                    features only, or compare against the full feature set.
                  </p>
                </div>

                <div className="mt-8 space-y-8">
                  {grouped.map((group) => (
                    <section key={group.section_name} className="space-y-4">
                      <div className="flex flex-col gap-2 border-b border-[#E2E6ED] pb-3 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-[24px] font-bold leading-tight text-[#080808]">
                          {group.section_name}
                        </h3>
                        <span className="text-[13px] font-medium text-[#626875]">
                          {group.items.length} features
                        </span>
                      </div>

                      <ul className="space-y-2 pl-5">
                        {group.items.map((item) => (
                          <li
                            key={item.feature_id}
                            className="text-[16px] leading-6 text-[#080808] marker:text-[#6262F5]"
                          >
                            {item.label}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}

                  {grouped.length === 0 && (
                    <div className="rounded-xl border border-dashed border-[#D7DCE5] bg-[#FAFBFC] px-5 py-8 text-[16px] text-[#626875]">
                      No features available to display.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}