"use client";
import * as React from "react";
import { EmptyState, Skeleton, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

type RegistryStatus = "ACTIVE" | "DORMANT" | "BROKEN" | "STALE";
type FunctionGroup = "Entry" | "Exit" | "Scoring" | "Risk" | "Data" | "Other";
type Promotion = "ready" | "accruing" | "na";

// H1 (2026-07-09) SHADOW slim: this tab is now a LIGHT inventory — "what shadows
// exist + are they alive" (name + function + a plain ACTIVE/DORMANT/STALE/BROKEN
// status pill + latest-write age). The deep analytical surfaces were CUT (the
// PromotionLeaderboard, the ShadowScoringHero readiness metrics, the
// PartialShadowCard footprint numbers, the per-card AggregateSummaryLine
// WR/μ/range/would-fire %, the divergence/promotion-verdict expand). Ghost drives
// all deep edge/tweak analysis through CC recon now — the Hub keeps only the
// glance. The registry read (/api/shadow/registry) is UNCHANGED — this is a
// display trim, not a data cut.
//
// The full ShadowRegistryTable shape is preserved and EXPORTED because the
// now-orphaned-but-on-disk promotion-leaderboard.tsx + shadow-scoring-hero.tsx
// still `import type { ShadowRegistryTable }` from here (H1 left those files on
// disk per repo convention; the project type-checks them). Do not trim it.
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
  // B2 stale-when-expected telemetry (null unless expected_active + rows + ts).
  median_gap_sec?: number | null;
  max_gap_sec?: number | null;
  stale_threshold_sec?: number | null;
  silence_sec?: number | null;
  auto_derived: boolean;
  divergence_col: string | null;
  divergent_n: number | null;
  divergence_pct: number | null;
  promotion: Promotion;
  promotion_n: number | null;
  // HUB-C2 realized-outcome aggregates (kept in the shape for the orphaned
  // type-importers; no longer rendered on this slim tab).
  outcome_col: string | null;
  outcome_linked_n: number | null;
  outcome_mean_pnl: number | null;
  outcome_min_pnl: number | null;
  outcome_max_pnl: number | null;
  outcome_win_rate: number | null;
  error?: string;
}

interface ShadowRegistryResponse {
  tables: ShadowRegistryTable[];
  total: number;
  stale_count?: number;
  replica_age_seconds: number | null;
  error?: string;
}

// Strip trailing internal code suffixes — (S3-Pxx)/(P06)/(HMM+DS)/(A-F)/(Guard+Gate)
// (RM-HUB-POLISH-B2, display-only). Proven safe: every base name is unique after
// stripping, so no two shadows collapse into an ambiguous name.
function plainName(display: string): string {
  return display.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

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

// One light row: dot + name (+ retired marker) + "function · latest-write age"
// + a plain status pill. No deep stats — identity + alive-ness only.
function ShadowRow({ t }: { t: ShadowRegistryTable }) {
  const { status } = t;
  const dot =
    status === "ACTIVE"
      ? "bg-accent-mint-strong"
      : status === "STALE" || status === "BROKEN"
        ? "bg-accent-gold"
        : "bg-fg-faint";
  const pill =
    status === "ACTIVE" ? (
      <Pill intent="active" size="sm">Running normally</Pill>
    ) : status === "STALE" ? (
      <Pill intent="warn" size="sm">Hasn&apos;t updated lately</Pill>
    ) : status === "BROKEN" ? (
      <Pill intent="warn" size="sm">Not recording</Pill>
    ) : (
      <Pill tone="neutral" size="sm" className="text-fg-faint">Inactive</Pill>
    );
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-fast",
        status === "STALE" || status === "BROKEN"
          ? "border-accent-gold/40 bg-bg-card"
          : status === "ACTIVE"
            ? "border-border-subtle bg-bg-card"
            : "border-border-subtle bg-bg-card opacity-75",
      )}
    >
      <span aria-hidden className={cn("mt-1 h-2 w-2 shrink-0 self-start rounded-pill", dot)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-caption">
          <span className="truncate font-sans font-semibold text-fg-primary">{plainName(t.display)}</span>
          {t.retired && (
            <span className="shrink-0 font-sans text-micro uppercase tracking-wider text-fg-faint">
              retired
            </span>
          )}
        </div>
        <span className="font-sans text-micro text-fg-muted">
          {t.function} · {fmtAge(t.latest_write)}
        </span>
      </div>
      <span className="mt-0.5 shrink-0 self-start">{pill}</span>
    </div>
  );
}

export function ShadowOverview() {
  const [registry, setRegistry] = React.useState<ShadowRegistryResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [showDormant, setShowDormant] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/shadow/registry", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setRegistry(await res.json());
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
  const byName = (a: ShadowRegistryTable, b: ShadowRegistryTable) =>
    a.display.localeCompare(b.display);

  // Alarms first: registered-active writers that went silent (STALE) or never
  // wrote (BROKEN) — the "are they alive?" problems, most-silent first.
  const alarms = tables
    .filter((t) => t.status === "STALE" || t.status === "BROKEN")
    .sort((a, b) => (b.silence_sec ?? 0) - (a.silence_sec ?? 0));
  const active = tables.filter((t) => t.status === "ACTIVE").sort(byName);
  const dormant = tables.filter((t) => t.status === "DORMANT").sort(byName);

  const replicaAge = registry?.replica_age_seconds ?? null;
  const alarmCount = alarms.length;

  if (registry?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState title="Couldn't load" body={registry.error} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Replica freshness — the WSL litestream replica refreshes every ~15 min. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-accent-cyan-soft" />
          replica {fmtReplicaAge(replicaAge)} · refreshes ~15 min
        </span>
        <span className="text-fg-faint">·</span>
        <span>
          {registry?.total ?? tables.length} background tests
          {alarmCount > 0 ? (
            <span className="text-accent-gold"> · {alarmCount} worth a look</span>
          ) : (
            <span> · all running normally</span>
          )}
        </span>
      </div>

      {/* Honest framing of the slimmed view. */}
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        A quick list of every background test and whether it&apos;s still running.
        Detailed stats are done elsewhere.
      </p>

      {loading && tables.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : tables.length === 0 ? (
        <EmptyState title="No background tests" body="No background tests found." />
      ) : (
        <div className="space-y-4">
          {/* ── Alarms: registered active but not writing ────────────────── */}
          {alarms.length > 0 && (
            <section className="space-y-1.5 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-3">
              <h3 className="flex items-center gap-2 font-sans text-caption font-semibold text-accent-gold">
                <span aria-hidden>⚠</span>
                {alarms.length} worth a look — should be running but hasn&apos;t updated
              </h3>
              <p className="font-sans text-micro leading-relaxed text-fg-muted">
                &ldquo;Hasn&apos;t updated lately&rdquo; doesn&apos;t always mean broken — a quick
                check on the source will tell.
              </p>
              <div className="space-y-1.5">
                {alarms.map((t) => (
                  <ShadowRow key={t.table_name} t={t} />
                ))}
              </div>
            </section>
          )}

          {/* ── Active (alive) ───────────────────────────────────────────── */}
          <section className="space-y-1.5">
            <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Running normally ({active.length})
            </h3>
            {active.length > 0 ? (
              active.map((t) => <ShadowRow key={t.table_name} t={t} />)
            ) : (
              <p className="font-sans text-micro text-fg-faint">Nothing running right now.</p>
            )}
          </section>

          {/* ── Dormant behind a toggle (default off) ────────────────────── */}
          {dormant.length > 0 && (
            <section className="space-y-1.5">
              <button
                type="button"
                aria-expanded={showDormant}
                onClick={() => setShowDormant((x) => !x)}
                className={cn(
                  "tap-target flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2",
                  "border-border-subtle bg-bg-card font-sans text-caption text-fg-muted",
                  "transition-colors duration-fast hover:border-accent-cyan-soft/40",
                )}
              >
                {showDormant ? "Hide inactive" : `Show inactive (${dormant.length})`}
              </button>
              {showDormant && (
                <div className="space-y-1.5">
                  {dormant.map((t) => (
                    <ShadowRow key={t.table_name} t={t} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
