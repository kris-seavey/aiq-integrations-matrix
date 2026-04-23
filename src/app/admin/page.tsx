"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

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

type EditorRow = {
  feature_id: string;
  feature_name: string;
  feature_order: number;
  section_id: string;
  section_name: string;
  section_order: number;
  support_status: string;
  customer_facing_override: string;
};

type DirtyMap = Record<
  string,
  {
    support_status?: string;
    customer_facing_override?: string;
  }
>;

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toISOString().slice(0, 10);
}

function categoryLabel(category?: string | null) {
  return category || "Integration";
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null);
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [dirty, setDirty] = useState<DirtyMap>({});
  const [statusMessage, setStatusMessage] = useState("Loading integrations...");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setAuthLoading(false);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      loadIntegrations();
    }
  }, [session]);

  async function signIn() {
    setAuthMessage("Signing in...");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    setAuthMessage("Signed in.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setIntegrations([]);
    setSelectedIntegration(null);
    setRows([]);
    setDirty({});
    setSearch("");
  }

  async function loadIntegrations() {
    setLoading(true);

    const { data, error } = await supabase
      .from("integrations")
      .select(
        "integration_id, integration_name, category, status, public_visibility, updated_at"
      )
      .order("integration_name");

    if (error) {
      setStatusMessage(`Failed to load integrations: ${error.message}`);
      setLoading(false);
      return;
    }

    const list = (data || []) as Integration[];
    setIntegrations(list);
    setStatusMessage(`Loaded ${list.length} integrations.`);
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
    setDirty({});
    setStatusMessage(`Loading ${integration.integration_name}...`);

    const [
      { data: featureData, error: featureError },
      { data: supportData, error: supportError },
      { data: sectionData, error: sectionError },
    ] = await Promise.all([
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
        .from("integration_feature_support")
        .select(`
          integration_id,
          feature_id,
          support_status,
          customer_facing_override
        `)
        .eq("integration_id", integration.integration_id),
      supabase
        .from("sections")
        .select(`
          section_id,
          section_name,
          display_order
        `)
        .order("display_order", { ascending: true }),
    ]);

    if (featureError) {
      setStatusMessage(`Failed to load features: ${featureError.message}`);
      setRows([]);
      return;
    }

    if (supportError) {
      setStatusMessage(`Failed to load support rows: ${supportError.message}`);
      setRows([]);
      return;
    }

    if (sectionError) {
      setStatusMessage(`Failed to load sections: ${sectionError.message}`);
      setRows([]);
      return;
    }

    const features = (featureData || []) as FeatureRecord[];
    const supportRows = (supportData || []) as SupportRecord[];
    const sections = (sectionData || []) as SectionRecord[];

    const supportMap = new Map(
      supportRows.map((row) => [row.feature_id, row])
    );

    const sectionMap = new Map(
      sections.map((section) => [section.section_id, section])
    );

    const mapped: EditorRow[] = features.map((feature) => {
      const support = supportMap.get(feature.feature_id);
      const section = feature.section_id
        ? sectionMap.get(feature.section_id)
        : null;

      return {
        feature_id: feature.feature_id,
        feature_name: feature.feature_name,
        feature_order: feature.display_order ?? 9999,
        section_id: feature.section_id ?? "unsectioned",
        section_name: section?.section_name ?? "Unsectioned",
        section_order: section?.display_order ?? 9999,
        support_status: support?.support_status ?? "not_supported",
        customer_facing_override: support?.customer_facing_override ?? "",
      };
    });

    setRows(mapped);
    setStatusMessage(`Loaded ${integration.integration_name}.`);
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
    const sorted = [...rows].sort((a, b) => {
      if (a.section_order !== b.section_order) return a.section_order - b.section_order;
      if (a.feature_order !== b.feature_order) return a.feature_order - b.feature_order;
      return a.feature_name.localeCompare(b.feature_name);
    });

    const groups = new Map<
      string,
      {
        section_name: string;
        rows: EditorRow[];
      }
    >();

    for (const row of sorted) {
      if (!groups.has(row.section_id)) {
        groups.set(row.section_id, {
          section_name: row.section_name,
          rows: [],
        });
      }
      groups.get(row.section_id)!.rows.push(row);
    }

    return [...groups.values()];
  }, [rows]);

  function updateRow(
    feature_id: string,
    field: "support_status" | "customer_facing_override",
    value: string
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.feature_id === feature_id ? { ...r, [field]: value } : r
      )
    );

    setDirty((prev) => ({
      ...prev,
      [feature_id]: {
        ...prev[feature_id],
        [field]: value,
      },
    }));
  }

  async function saveChanges() {
    if (!selectedIntegration) return;

    const payload = Object.entries(dirty).map(([feature_id, changes]) => {
      const current = rows.find((r) => r.feature_id === feature_id);

      return {
        integration_id: selectedIntegration.integration_id,
        feature_id,
        support_status:
          changes.support_status ??
          current?.support_status ??
          "not_supported",
        customer_facing_override:
          changes.customer_facing_override ??
          current?.customer_facing_override ??
          null,
      };
    });

    if (payload.length === 0) {
      setStatusMessage("No changes to save.");
      return;
    }

    setStatusMessage(`Saving ${payload.length} change(s)...`);

    const { error } = await supabase
      .from("integration_feature_support")
      .upsert(payload, { onConflict: "integration_id,feature_id" });

    if (error) {
      setStatusMessage(`Save failed: ${error.message}`);
      return;
    }

    setDirty({});
    setStatusMessage(
      "Saved. Registry updated successfully. Intercom should refresh automatically."
    );
  }

  const preview = useMemo(() => {
    if (!selectedIntegration) return "Select an integration.";

    const lines: string[] = [`# ${selectedIntegration.integration_name}`, ""];

    for (const group of grouped) {
      const supported = group.rows.filter((r) => r.support_status === "supported");
      if (supported.length === 0) continue;

      lines.push(`## ${group.section_name}`);
      for (const row of supported) {
        lines.push(`- ${row.customer_facing_override || row.feature_name}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }, [selectedIntegration, grouped]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#6262F5] px-6 py-10">
        <div className="rounded-2xl border border-[#E2E6ED] bg-white px-6 py-4 text-[#626875] shadow-sm">
          Loading...
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#6262F5] px-6 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[#E2E6ED] bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-4">
            <img
              src="/aiq-logo.svg"
              alt="AIQ"
              className="h-14 w-auto object-contain"
            />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[#626875]">
                AIQ
              </p>
              <h1 className="text-3xl font-semibold text-[#080808]">Admin Login</h1>
            </div>
          </div>

          <p className="mb-6 text-sm text-[#626875]">
            Sign in to access the capability registry editor.
          </p>

          <div className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-[#E2E6ED] bg-white px-4 py-3 text-[#080808] placeholder:text-[#A2A6AE] outline-none focus:border-[#6262F5]"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[#E2E6ED] bg-white px-4 py-3 text-[#080808] placeholder:text-[#A2A6AE] outline-none focus:border-[#6262F5]"
            />
            <button
              onClick={signIn}
              className="w-full rounded-full bg-[#6262F5] px-4 py-3 font-semibold text-white transition hover:bg-[#5555E8]"
            >
              Sign in
            </button>
          </div>

          {authMessage && (
            <p className="mt-4 text-sm text-[#626875]">{authMessage}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#6262F5]">
      <header className="border-b border-[#E2E6ED] bg-white">
        <div className="mx-auto max-w-[1600px] px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <img
                src="/aiq-logo.svg"
                alt="AIQ"
                className="h-12 w-auto object-contain"
              />
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#626875]">
                  AIQ
                </p>
                <h1 className="text-3xl font-semibold text-[#080808]">
                  Integrations Matrix Admin
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-[#626875]">
                  Manage integration support status and documentation wording from a
                  single source of truth. Changes saved here update the registry and
                  can automatically flow into Intercom.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-[#080808]">{session.user.email}</p>
                <p className="text-xs text-[#626875]">Authenticated admin session</p>
              </div>
              <button
                onClick={signOut}
                className="rounded-full border border-[#D7DCE5] bg-white px-4 py-2 text-sm font-medium text-[#626875] transition hover:bg-[#F4F6FA]"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 px-6 py-6 xl:grid-cols-[300px_minmax(0,1fr)_380px]">
        <aside className="rounded-2xl border border-white/15 bg-white p-5 text-[#080808] shadow-sm">
          <div className="mb-4">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-[#626875]">
              Search integrations
            </h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or category"
              className="w-full rounded-xl border border-[#E2E6ED] bg-white px-4 py-3 text-sm text-[#080808] placeholder:text-[#A2A6AE] outline-none focus:border-[#6262F5]"
            />
          </div>

          <div className="mb-3 flex items-center justify-between border-t border-[#E2E6ED] pt-4">
            <h2 className="text-xs uppercase tracking-wide text-[#626875]">
              Integrations
            </h2>
            <span className="text-xs text-[#626875]">{filteredIntegrations.length}</span>
          </div>

          <div className="space-y-2">
            {filteredIntegrations.map((integration) => (
              <button
                key={integration.integration_id}
                onClick={() => loadIntegration(integration)}
                className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                  selectedIntegration?.integration_id === integration.integration_id
                    ? "border-[#6262F5] bg-[#6262F5] text-white"
                    : "border-[#E2E6ED] bg-white text-[#080808] hover:border-[#C9D2E3] hover:bg-[#F4F6FA]"
                }`}
              >
                <div className="font-semibold">{integration.integration_name}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      selectedIntegration?.integration_id === integration.integration_id
                        ? "border-white/20 bg-white/10 text-white/90"
                        : "border-[#E2E6ED] bg-[#FAFBFC] text-[#626875]"
                    }`}
                  >
                    {categoryLabel(integration.category)}
                  </span>
                  {integration.public_visibility ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        selectedIntegration?.integration_id === integration.integration_id
                          ? "border-white/20 bg-white/10 text-white/90"
                          : "border-[#E2E6ED] bg-[#FAFBFC] text-[#626875]"
                      }`}
                    >
                      Public
                    </span>
                  ) : (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        selectedIntegration?.integration_id === integration.integration_id
                          ? "border-white/20 bg-white/10 text-white/75"
                          : "border-[#E2E6ED] bg-[#FAFBFC] text-[#8B93A1]"
                      }`}
                    >
                      Internal
                    </span>
                  )}
                </div>
              </button>
            ))}

            {!loading && filteredIntegrations.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#D7DCE5] bg-[#FAFBFC] px-4 py-5 text-sm text-[#626875]">
                No integrations match your search.
              </div>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-white/15 bg-white p-6 text-[#080808] shadow-sm">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-4xl font-semibold text-[#080808]">
                  {selectedIntegration?.integration_name || "Select an integration"}
                </h2>

                {selectedIntegration && (
                  <>
                    <span className="rounded-full border border-[#E2E6ED] bg-[#FAFBFC] px-3 py-1 text-xs text-[#626875]">
                      {categoryLabel(selectedIntegration.category)}
                    </span>

                    {selectedIntegration.status && (
                      <span className="rounded-full border border-[#E2E6ED] bg-[#FAFBFC] px-3 py-1 text-xs text-[#626875]">
                        {selectedIntegration.status}
                      </span>
                    )}

                    <span className="rounded-full border border-[#E2E6ED] bg-[#FAFBFC] px-3 py-1 text-xs text-[#626875]">
                      Last updated: {formatDate(selectedIntegration.updated_at)}
                    </span>
                  </>
                )}
              </div>

              <p className="text-sm text-[#626875]">{statusMessage}</p>
            </div>

            <button
              onClick={saveChanges}
              className="rounded-full bg-[#6262F5] px-5 py-3 font-semibold text-white transition hover:bg-[#5555E8]"
            >
              Save changes
            </button>
          </div>

          {loading ? (
            <div className="rounded-xl border border-[#E2E6ED] bg-[#FAFBFC] px-5 py-6 text-[#626875]">
              Loading...
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => {
                const supportedCount = group.rows.filter(
                  (r) => r.support_status === "supported"
                ).length;

                return (
                  <div
                    key={group.section_name}
                    className="rounded-2xl border border-[#E2E6ED] bg-[#FAFBFC] p-5"
                  >
                    <div className="mb-4 flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-[#080808]">
                        {group.section_name}
                      </h3>
                      <span className="rounded-full bg-[#EDF0FF] px-2.5 py-1 text-xs text-[#6262F5]">
                        {supportedCount} supported
                      </span>
                    </div>

                    <div className="space-y-3">
                      {group.rows.map((row) => (
                        <div
                          key={row.feature_id}
                          className="grid grid-cols-1 gap-4 rounded-xl border border-[#E2E6ED] bg-white p-4 2xl:grid-cols-[minmax(260px,1.5fr)_170px_minmax(260px,1.4fr)]"
                        >
                          <div>
                            <div className="font-semibold text-[#080808]">
                              {row.feature_name}
                            </div>
                            <div className="mt-1 text-xs text-[#8B93A1]">
                              Canonical feature label
                            </div>
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[#626875]">
                              Status
                            </label>
                            <select
                              value={row.support_status}
                              onChange={(e) =>
                                updateRow(
                                  row.feature_id,
                                  "support_status",
                                  e.target.value
                                )
                              }
                              className="w-full rounded-xl border border-[#E2E6ED] bg-white px-3 py-2 text-sm text-[#080808] outline-none focus:border-[#6262F5]"
                            >
                              <option value="supported">supported</option>
                              <option value="partial">partial</option>
                              <option value="planned">planned</option>
                              <option value="not_supported">not_supported</option>
                              <option value="unknown">unknown</option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[#626875]">
                              Docs wording override
                            </label>
                            <input
                              value={row.customer_facing_override}
                              onChange={(e) =>
                                updateRow(
                                  row.feature_id,
                                  "customer_facing_override",
                                  e.target.value
                                )
                              }
                              placeholder="Optional customer-facing wording"
                              className="w-full rounded-xl border border-[#E2E6ED] bg-white px-3 py-2 text-sm text-[#080808] placeholder:text-[#A2A6AE] outline-none focus:border-[#6262F5]"
                            />
                            <p className="mt-1 text-[11px] text-[#8B93A1]">
                              Leave blank to use the canonical feature label.
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-white/15 bg-white p-6 text-[#080808] shadow-sm">
          <div className="mb-6">
            <h3 className="mb-2 text-lg font-semibold text-[#080808]">Preview</h3>
            <p className="text-sm text-[#626875]">
              This is the integration-level documentation output based on the current
              saved and unsaved edits in the editor.
            </p>
          </div>

          <pre className="whitespace-pre-wrap rounded-2xl border border-[#E2E6ED] bg-[#FAFBFC] p-4 text-sm text-[#4E5562]">
            {preview}
          </pre>

          <div className="mt-6 rounded-2xl border border-[#E2E6ED] bg-[#FAFBFC] p-4">
            <h4 className="mb-2 text-sm font-semibold text-[#080808]">
              Publishing flow
            </h4>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-[#626875]">
              <li>Save changes to registry tables</li>
              <li>Webhook triggers article regeneration</li>
              <li>Intercom updates automatically</li>
            </ol>
          </div>
        </aside>
      </div>
    </main>
  );
}