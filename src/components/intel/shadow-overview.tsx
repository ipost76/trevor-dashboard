"use client";
import * as React from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import { CompactShadowCard } from "@/components/ui/compact-shadow-card";
import { cn } from "@/lib/utils";
import { ShadowScoringHero, type IntelShadowState } from "./shadow-scoring-hero";
import { PartialShadowCard } from "@/components/autotrader-v2/partial-shadow-card";
import { PromotionLeaderboard } from "./promotion-leaderboard";

type RegistryStatus = "ACTIVE" | "DORMANT" | "BROKEN";
type FunctionGroup = "Entry" | "Exit" | "Scoring" | "Risk" | "Data" | "Other";
type Promotion = "ready" | "accruing" | "na";

export interface ShadowRegistryTable {
  table_name: string;
  display: string;
  function: FunctionGroup;
  rows: number;
  rows_48h: number;
  latest_write: string | null;
  status: RegistryStatus;
  expected_active: boolean;
  retired: boolean;
  auto_derived: boolean;
  divergence_col: string | null;
  divergent_n: number | null;
  divergence_pct: number | null;
  promotion: Promotion;
  promotion_n: number | null;
  error?: string;
}

interface ShadowRegistryResponse {
  tables: ShadowRegistryTable[];
  by_function: Record<string, string[]>;
  by_status: Record<string, number>;
  total: number;
  promotion_ready: number;
  stale_days: number;
  promotion_min_n: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

interface IntelShadowResponse {
  shadow?: IntelShadowState;
  error?: string;
}

const HERO_TABLE = "shadow_scoring";
// Phone-friendly leaderboard size — the headline "show me your best" view.
const LEADERBOARD_N = 6;

function fmtReplicaAge(sec: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "unknown";
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  // SQLite emits naive UTC ("YYYY-MM-DD HH:MM:SS"); append Z so the browser
  // parses it as UTC rather than local. Matches shadow-table-card.tsx.
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? iso.replace(" ", "T")
    : iso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  const ageSec = (Date.now() - d.getTime()) / 1000;
  if (ageSec < 0) return "just now";
  if (ageSec < 60) return `${Math.floor(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

function adaptCard(t: ShadowRegistryTable) {
  return {
    name: t.display,
    tableName: t.table_name,
    totalRows: t.rows,
    rows48h: t.rows_48h,
    latestAge: fmtAge(t.latest_write),
    status: (t.status === "ACTIVE" ? "active" : "dormant") as "active" | "dormant",
    function: t.function,
    divergentN: t.divergent_n,
    divergencePct: t.divergence_pct,
    divergenceCol: t.divergence_col,
    promotion: t.promotion,
    promotionN: t.promotion_n,
    retired: t.retired,
    extraMetrics: t.error ? { error: t.error } : undefined,
  };
}

const promoRank = (p: Promotion): number => (p === "ready" ? 0 : p === "accruing" ? 1 : 2);

// Default dense list + leaderboard ranking: ready → accruing, then
// divergence strength (%div desc), then recency (48h desc).
function bySignal(a: ShadowRegistryTable, b: ShadowRegistryTable): number {
  const r = promoRank(a.promotion) - promoRank(b.promotion);
  if (r !== 0) return r;
  const pd = (b.divergence_pct ?? 0) - (a.divergence_pct ?? 0);
  if (pd !== 0) return pd;
  return (b.rows_48h ?? 0) - (a.rows_48h ?? 0);
}

// Hidden set ordering: active-but-no-signal (na) first, then dormant/0-row,
// each by activity (48h desc, then total rows desc).
function byHidden(a: ShadowRegistryTable, b: ShadowRegistryTable): number {
  const sa = a.status === "ACTIVE" ? 0 : 1;
  const sb = b.status === "ACTIVE" ? 0 : 1;
  if (sa !== sb) return sa - sb;
  return (b.rows_48h ?? 0) - (a.rows_48h ?? 0) || (b.rows ?? 0) - (a.rows ?? 0);
}

export function ShadowOverview() {
  const [registry, setRegistry] = React.useState<ShadowRegistryResponse | null>(null);
  const [intel, setIntel] = React.useState<IntelShadowResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [showHidden, setShowHidden] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [registryRes, intelRes] = await Promise.all([
          fetch("/api/shadow/registry", { cache: "no-store" }),
          fetch("/api/intel/shadow", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (registryRes.ok) setRegistry(await registryRes.json());
        if (intelRes.ok) setIntel(await intelRes.json());
      } catch {
        // network errors swallow; keep last-good snapshot
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const tables = registry?.tables ?? [];
  const heroTable = tables.find((t) => t.table_name === HERO_TABLE) ?? null;
  // Hero owns shadow_scoring — strip it from every list (its surface is the hero).
  const tablesExHero = tables.filter((t) => t.table_name !== HERO_TABLE);

  // Signal-carriers = ACTIVE shadows with a real divergence/readiness signal,
  // ranked. The top N become the leaderboard; the rest are the dense default list.
  const ranked = tablesExHero
    .filter((t) => t.status === "ACTIVE" && t.promotion !== "na")
    .sort(bySignal);
  const leaderboardTables = ranked.slice(0, LEADERBOARD_N);
  const denseSignal = ranked.slice(LEADERBOARD_N);
  const readyCount = ranked.filter((t) => t.promotion === "ready").length;

  // Hidden behind the toggle: active-no-signal (na) + dormant + 0-row, together.
  const hidden = tablesExHero
    .filter((t) => t.status !== "ACTIVE" || t.promotion === "na")
    .sort(byHidden);

  const replicaAge = registry?.replica_age_seconds ?? null;

  const renderRow = (t: ShadowRegistryTable) => (
    <CompactShadowCard key={t.table_name} {...adaptCard(t)} />
  );

  if (registry?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState title="Failed" body={registry.error} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Replica freshness — the WSL litestream replica refreshes every ~15 min,
          so a glance knows the divergent counts may lag. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
          replica {fmtReplicaAge(replicaAge)} · refreshes ~15 min
        </span>
        <span className="text-fg-faint">·</span>
        <span>
          {registry?.total ?? tables.length} shadows · {readyCount} gate-ready
        </span>
      </div>

      {loading && tables.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-4">
          {/* ── Zone 1: leaderboard (the headline) ───────────────────────── */}
          <PromotionLeaderboard candidates={leaderboardTables} readyCount={readyCount} />

          {/* ── Hero feature cards (kept — distinct from the dense list) ──── */}
          <ShadowScoringHero
            registry={heroTable}
            intel={intel?.shadow ?? null}
            loading={loading && !registry}
          />
          <PartialShadowCard />

          {/* ── Zone 2: dense collapsed rows (active ready + accruing) ────── */}
          <section className="space-y-1.5">
            <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Active signal · tap a row for detail
            </h3>
            {denseSignal.length > 0 ? (
              denseSignal.map(renderRow)
            ) : ranked.length === 0 ? (
              <EmptyState
                title="No active signal"
                body="No ready/accruing shadows right now — everything is behind the toggle below."
              />
            ) : (
              <p className="font-sans text-micro text-fg-faint">
                All ready/accruing shadows are in the leaderboard above.
              </p>
            )}
          </section>

          {/* ── Zone 3: dormant / na hidden behind a toggle (default off) ─── */}
          {hidden.length > 0 && (
            <section className="space-y-1.5">
              <button
                type="button"
                aria-expanded={showHidden}
                onClick={() => setShowHidden((x) => !x)}
                className={cn(
                  "tap-target flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2",
                  "border-border-subtle bg-bg-card font-sans text-caption text-fg-muted",
                  "transition-colors duration-fast hover:border-accent-cyan-soft/40",
                )}
              >
                {showHidden
                  ? "Hide dormant / no-signal"
                  : `Show dormant / no-signal (${hidden.length})`}
              </button>
              {showHidden && <div className="space-y-1.5">{hidden.map(renderRow)}</div>}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
