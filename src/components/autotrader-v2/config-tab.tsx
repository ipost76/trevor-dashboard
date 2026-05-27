"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  EditableField,
  CollapsibleSection,
  EmptyState,
} from "@/components/ui";
import {
  Search,
  X,
  Lock,
  Settings2,
  AlertCircle,
} from "lucide-react";
import { PerTickerPanel } from "./per-ticker-panel";

interface ConfigRow {
  key: string;
  value: string | null;
  updated_at: string | null;
  category: string;
  type: "int" | "float" | "json" | "str" | "bool";
  immutable: boolean;
  immutable_reason: string | null;
}

interface ConfigFullResponse {
  configs: ConfigRow[];
  total: number;
  by_category: Record<string, number>;
  live_edit_enabled: boolean;
  error?: string;
}

const CATEGORY_ORDER = [
  "Capital",
  "Signal",
  "Exit",
  "Risk",
  "Per-Ticker",
  "Calibration",
  "Execution",
  "Misc",
] as const;

const POLL_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 200;

function mapType(t: ConfigRow["type"]): "text" | "number" | "float" {
  if (t === "int") return "number";
  if (t === "float") return "float";
  return "text";
}

function validateJson(value: string): string | null {
  try {
    JSON.parse(value);
    return null;
  } catch (e) {
    return e instanceof Error
      ? `Invalid JSON: ${e.message.split("\n")[0]}`
      : "Invalid JSON";
  }
}

export function ConfigTab() {
  const [data, setData] = React.useState<ConfigFullResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    const handle = setTimeout(
      () => setSearch(searchInput.trim().toLowerCase()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [searchInput]);

  const fetchConfigs = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auto/config-full", { cache: "no-store" });
      if (!res.ok) {
        setFetchError(`API ${res.status}`);
        return;
      }
      const j = (await res.json()) as ConfigFullResponse;
      setData(j);
      setFetchError(j.error ?? null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchConfigs();
    const id = setInterval(() => void fetchConfigs(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchConfigs]);

  // Single save closure — used by every EditableField and by PerTickerPanel.
  // EditableField catches the thrown Error and surfaces it inline.
  const handleSave = React.useCallback(
    async (key: string, newValue: string): Promise<void> => {
      const res = await fetch(
        `/api/auto/config-full/${encodeURIComponent(key)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: newValue, author: "ghost" }),
        },
      );
      let payload: { error?: string; ok?: boolean } = {};
      try {
        payload = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (res.status === 423) {
        throw new Error("Editing disabled — flip LIVE_EDIT_ENABLED first.");
      }
      if (res.status === 400) {
        throw new Error(payload.error ?? "Invalid value");
      }
      if (!res.ok) {
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      await fetchConfigs();
    },
    [fetchConfigs],
  );

  const grouped = React.useMemo<Record<string, ConfigRow[]>>(() => {
    const out: Record<string, ConfigRow[]> = {};
    if (!data) return out;
    const q = search;
    for (const cfg of data.configs) {
      if (q) {
        const matches =
          cfg.key.toLowerCase().includes(q) ||
          cfg.category.toLowerCase().includes(q);
        if (!matches) continue;
      }
      (out[cfg.category] ||= []).push(cfg);
    }
    return out;
  }, [data, search]);

  const liveEditEnabled = !!data?.live_edit_enabled;
  const totalShown = Object.values(grouped).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const searching = search.length > 0;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {!loading && !liveEditEnabled && (
        <div className="flex items-start gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-3 font-sans text-caption text-accent-gold-strong">
          <Lock size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <div className="font-semibold">Live edit disabled</div>
            <div className="text-micro text-fg-muted">
              Set{" "}
              <code className="rounded bg-bg-elevated px-1 font-mono text-accent-cyan-soft">
                LIVE_EDIT_ENABLED=true
              </code>{" "}
              in <code className="font-mono">auto_config</code> to unlock
              inline saves. Edit attempts return HTTP 423 while locked.
            </div>
          </div>
        </div>
      )}

      {fetchError && (
        <div className="flex items-start gap-2 rounded-md border border-accent-red/40 bg-accent-red/10 p-3 font-sans text-caption text-accent-red">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <div className="font-semibold">Failed to load configs</div>
            <div className="break-all font-mono text-micro">{fetchError}</div>
          </div>
        </div>
      )}

      <Card padding="md" className="card-elevated">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Settings2
                size={18}
                className="text-accent-cyan-soft"
                aria-hidden
              />
              <CardTitle>Config Editor</CardTitle>
            </div>
            {data && (
              <span className="font-mono text-micro text-fg-muted tabular-nums">
                {searching
                  ? `${totalShown}/${data.total} keys`
                  : `${data.total} keys`}
              </span>
            )}
          </div>
        </CardHeader>

        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint"
            aria-hidden
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Filter by key or category…"
            aria-label="Filter configs"
            className="w-full rounded-md border border-border-subtle bg-bg-card py-2 pl-9 pr-10 font-mono text-caption text-fg-primary placeholder:text-fg-faint focus:border-accent-cyan-soft focus:outline-none focus:shadow-glow-focus"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear filter"
              className="tap-target absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg-primary"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>

        <div className="mt-3 font-sans text-micro text-fg-muted">
          {liveEditEnabled ? (
            <>
              Live editing{" "}
              <span className="text-accent-mint-strong">enabled</span> · changes
              write via{" "}
              <code className="font-mono text-accent-cyan-soft">
                PATCH /api/auto/config-full/[key]
              </code>{" "}
              and emit a <code className="font-mono">change_log</code> row.
            </>
          ) : (
            <>
              Read-only mode. {data?.total ?? 0} non-boolean{" "}
              <code className="font-mono text-accent-cyan-soft">
                auto_config
              </code>{" "}
              rows grouped by A1 §2 category. Booleans live in the Control tab.
            </>
          )}
        </div>
      </Card>

      {loading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!loading && data && totalShown === 0 && (
        <EmptyState
          title={searching ? "No matches" : "No configs loaded"}
          body={
            searching
              ? "Try a different search term or clear the filter."
              : "The /api/auto/config-full endpoint returned zero rows."
          }
        />
      )}

      {!loading && data && totalShown > 0 && (
        <div className="space-y-4">
          {CATEGORY_ORDER.map((cat) => {
            const rows = grouped[cat];
            if (!rows || rows.length === 0) return null;

            if (cat === "Per-Ticker") {
              return (
                <PerTickerPanel
                  key={cat}
                  configs={rows}
                  liveEditEnabled={liveEditEnabled}
                  onSave={handleSave}
                />
              );
            }

            // Force-open all sections during a search so matches are visible
            // without an extra tap. The key change remounts the section.
            return (
              <CollapsibleSection
                key={`${cat}-${searching ? "open" : "default"}`}
                title={cat}
                defaultOpen={true}
                rightSlot={<Pill size="sm">{rows.length}</Pill>}
              >
                <div className="px-4">
                  {rows.map((cfg) => (
                    <EditableField
                      key={cfg.key}
                      label={cfg.key}
                      value={cfg.value ?? ""}
                      type={mapType(cfg.type)}
                      immutable={cfg.immutable}
                      validate={cfg.type === "json" ? validateJson : undefined}
                      onSave={(v) => handleSave(cfg.key, v)}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            );
          })}
        </div>
      )}
    </div>
  );
}
