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

type PublicFeatureRow = {
  feature_id: string;
  feature_name: string;
  feature_order: number;
  section_name: string;
  section_order: number;
  label: string;
};

type FeatureRecord = {
  feature_id: string;
  feature_name: string;
  display_order: number | null;
  section_id: string | null;
  section:
    | {
        section_id: string;
        section_name: string;
        display_order: number | null;
      }[]
    | null;
};

type SupportRecord = {
  integration_id: string;
  feature_id: string;
  support_status: string | null;
  customer_facing_override: string | null;
};

type GroupedRow = {
  section_name: string;
  section_order: number;
  items: string[];
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
  const [rows, setRows] = useState<PublicFeatureRow[]>([]);
  const [status, setStatus] = useState("Loading public integrations...");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadIntegrations();
  }, []);

  async function loadIntegrations() {
    setLoading(true);

    const { data, error } = await supabase
      .from("integrations")
      .select("integration_id, integration_name, category, status, public_visibility, updated_at")
      .eq("public_visibility", true)
      .order("integration_name");

    if (error) {
      setStatus(`Failed to load integrations: ${error.message}`);
      setLoading(false);
      return;
    }

    const list = (data || []) as Integration[];
    setIntegrations(list);
    setStatus(`Loaded ${list.length} public integrations.`);
    setLoading(false);

    if (list.length > 0) {
      loadIntegration(list[0]);
    } else {
      setSelectedIntegration(null);
      setRows([]);
    }
  }

  async function loadIntegration(integration: Integration) {
    setSelectedIntegration(integration);
    setStatus(`Loading ${integration.integration_name}...`);

    const [
      { data: featureData, error: featureError },
      { data: supportData, error: supportError },
    ] = await Promise.all([
      supabase
        .from("features")
        .select(`
          feature_id,
          feature_name,
          display_order,
          section_id,
          section:sections!features_section_id_fkey(
            section_id,
            section_name,
            display_order
          )
        `)
        .order("display_order", { ascending: true }),
      supabase
        .from("integration_feature_support")
        .select(`
          integration_id,
          feature_id,
          support_status,
          customer_facing_override
        `)
        .eq("integration_id", integration.integration_id)
        .eq("support_status", "supported"),
    ]);

    if (featureError) {
      setStatus(`Failed to load features: ${featureError.message}`);
      setRows([]);
      return;
    }

    if (supportError) {
      setStatus(`Failed to load support rows: ${supportError.message}`);
      setRows([]);
      return;
    }

    const features = (featureData || []) as unknown as FeatureRecord[];
    const supportRows = (supportData || []) as SupportRecord[];

    const supportMap = new Map(
      supportRows.map((row) => [row.feature_id, row])
    );

    const mapped = features
      .map((feature) => {
        const support = supportMap.get(feature.feature_id);
        if (!support) return null;

        const sectionRow = Array.isArray(feature.section)
          ? feature.section[0]
          : null;

        return {
          feature_id: feature.feature_id,
          feature_name: feature.feature_name,
          feature_order: feature.display_order ?? 9999,
          section_name: sectionRow?.section_name ?? "Other",
          section_order: sectionRow?.display_order ?? 9999,
          label: support.customer_facing_override?.trim() || feature.feature_name,
        };
      })
      .filter(Boolean) as PublicFeatureRow[];

    setRows(mapped);
    setStatus(`Loaded ${integration.integration_name}.`);
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

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedRow>();

    const sorted = [...rows].sort((a, b) => {
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

      map.get(row.section_name)!.items.push(row.label);
    }

    return [...map.values()].sort((a, b) => a.section_order - b.section_order);
  }, [rows]);

  return (
    <main className="min-h-screen bg-[#0B0B1F] text-white">
      <header className="border-b border-white/10 bg-[#0B0B1F]">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-[#6C63FF]/20 via-[#6C63FF]/5 to-transparent px-6 py-5">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="mb-3 flex items-center gap-4">
                  <img
                    src="/aiq-logo.svg"
                    alt="Alpine IQ"
                    className="h-14 w-auto object-contain"
                  />
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-white/50">
                      ALPINE IQ
                    </p>
                    <h1 className="text-3xl font-semibold">Integrations Matrix</h1>
                  </div>
                </div>

                <p className="max-w-3xl text-sm text-white/70">
                  Explore supported integration capabilities across Alpine IQ.
                  This public view is powered by the same source of truth that
                  updates internal documentation and Intercom automatically.
                </p>
              </div>

              <Link
                href="/admin"
                className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                Admin login
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-[300px_1fr] gap-6 px-6 py-6">
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="mb-4">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-white/50">
              Search integrations
            </h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or category"
              className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/40"
            />
          </div>

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wide text-white/50">
              Integrations
            </h2>
            <span className="text-xs text-white/40">{filteredIntegrations.length}</span>
          </div>

          <div className="space-y-1">
            {filteredIntegrations.map((integration) => (
              <button
                key={integration.integration_id}
                onClick={() => loadIntegration(integration)}
                className={`w-full rounded-xl px-3 py-3 text-left text-sm transition ${
                  selectedIntegration?.integration_id === integration.integration_id
                    ? "bg-[#6C63FF] text-white"
                    : "bg-transparent text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <div className="font-medium">{integration.integration_name}</div>
                <div className="mt-1 text-xs opacity-75">
                  {categoryLabel(integration.category)}
                </div>
              </button>
            ))}

            {!loading && filteredIntegrations.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/40">
                No integrations match your search.
              </div>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          {loading ? (
            <p className="text-white/60">Loading...</p>
          ) : selectedIntegration ? (
            <>
              <div className="mb-8">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-4xl font-semibold">
                    {selectedIntegration.integration_name}
                  </h2>

                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80">
                    {categoryLabel(selectedIntegration.category)}
                  </span>

                  {selectedIntegration.status && (
                    <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80">
                      {selectedIntegration.status}
                    </span>
                  )}

                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80">
                    Public
                  </span>

                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/70">
                    Last updated: {formatDate(selectedIntegration.updated_at)}
                  </span>
                </div>

                <p className="text-sm text-white/60">{status}</p>
              </div>

              <div className="space-y-8">
                {grouped.map((group) => (
                  <div key={group.section_name}>
                    <div className="mb-3 flex items-center gap-2">
                      <h3 className="text-xl font-semibold">{group.section_name}</h3>
                      <span className="rounded-full bg-[#6C63FF]/20 px-2.5 py-1 text-xs text-[#B6B2FF]">
                        {group.items.length} supported
                      </span>
                    </div>

                    <ul className="list-disc space-y-2 pl-6 text-white/80">
                      {group.items.map((item, idx) => (
                        <li key={`${group.section_name}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}

                {grouped.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-white/50">
                    No supported features available to display.
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-white/60">Select an integration.</p>
          )}
        </section>
      </div>
    </main>
  );
}