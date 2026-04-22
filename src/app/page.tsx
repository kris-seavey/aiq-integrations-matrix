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
  integration_id: string;
  feature_id: string;
  support_status: string | null;
  customer_facing_override: string | null;
  feature:
    | {
        feature_name: string;
        display_order: number | null;
        section:
          | {
              section_name: string;
              display_order: number | null;
            }[]
          | null;
      }[]
    | null;
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
  if (!category) return "Integration";
  return category;
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
    setLoading(false);
    setStatus(`Loaded ${list.length} public integrations.`);

    if (list.length > 0) {
      loadIntegration(list[0]);
    }
  }

  async function loadIntegration(integration: Integration) {
    setSelectedIntegration(integration);
    setStatus(`Loading ${integration.integration_name}...`);

    const { data, error } = await supabase
      .from("integration_feature_support")
      .select(`
        integration_id,
        feature_id,
        support_status,
        customer_facing_override,
        feature:features(
          feature_name,
          display_order,
          section:sections(
            section_name,
            display_order
          )
        )
      `)
      .eq("integration_id", integration.integration_id)
      .eq("support_status", "supported");

    if (error) {
      setStatus(`Failed to load feature support: ${error.message}`);
      return;
    }

   setRows((data || []) as unknown as PublicFeatureRow[]);
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
    const aFeature = Array.isArray(a.feature) ? a.feature[0] : null;
    const bFeature = Array.isArray(b.feature) ? b.feature[0] : null;

    const aSection = Array.isArray(aFeature?.section) ? aFeature?.section[0] : null;
    const bSection = Array.isArray(bFeature?.section) ? bFeature?.section[0] : null;

    const aSectionOrder = aSection?.display_order ?? 9999;
    const bSectionOrder = bSection?.display_order ?? 9999;
    if (aSectionOrder !== bSectionOrder) return aSectionOrder - bSectionOrder;

    const aFeatureOrder = aFeature?.display_order ?? 9999;
    const bFeatureOrder = bFeature?.display_order ?? 9999;
    if (aFeatureOrder !== bFeatureOrder) return aFeatureOrder - bFeatureOrder;

    return (aFeature?.feature_name || "").localeCompare(bFeature?.feature_name || "");
  });

  for (const row of sorted) {
    const featureRow = Array.isArray(row.feature) ? row.feature[0] : null;
    const sectionRow = Array.isArray(featureRow?.section) ? featureRow?.section[0] : null;

    const sectionName = sectionRow?.section_name || "Other";
    const sectionOrder = sectionRow?.display_order ?? 9999;
    const label =
      row.customer_facing_override?.trim() || featureRow?.feature_name || "";

    if (!map.has(sectionName)) {
      map.set(sectionName, {
        section_name: sectionName,
        section_order: sectionOrder,
        items: [],
      });
    }

    if (label) {
      map.get(sectionName)!.items.push(label);
    }
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
                <div className="mb-3 flex items-center gap-3">
                  <img
  src="/aiq-logo.svg"
  alt="Alpine IQ"
  className="h-11 w-auto object-contain"
/>
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-white/50">
                      Alpine IQ
                    </p>
                    <h1 className="text-3xl font-semibold">Integrations Matrix</h1>
                  </div>
                </div>

                <p className="max-w-3xl text-sm text-white/70">
                  Explore supported integration capabilities across Alpine IQ.
                  This public view is powered by the same source of truth that updates
                  internal documentation and Intercom automatically.
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