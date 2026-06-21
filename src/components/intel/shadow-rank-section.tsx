"use client";
import * as React from "react";
import { EmptyState, Skeleton, Pill } from "@/components/ui";
import { CompactShadowCard } from "@/components/ui/compact-shadow-card";
import { fmtUsd } from "@/lib/shadow-aggregate";
import { cn } from "@/lib/utils";

// $-Rank Hub Intel View (E1) — the "what to flip next" page. Every shadow
// sorted by its DOLLAR impact so the most-profitable rule to flip live is
// obvious at a glance. Read-and-display only — reads the extended
// /api/shadow/registry; never writes a shadow, never flips a live rule.
//
// HONESTY (the load-bearing constraint):
//   • outcome_sum_pnl is Σ realized $ over DISTINCT trades (dedup per trade) —
//     NEVER the raw per-cycle Σ, which is a counting artifact (a per-cycle
//     shadow stamps the same realized value on every row, so a raw SUM
//     multiplies by rows-per-trade). Per-cycle sums are never realizable money.
//   • metric_type "flip_delta" = the shadow logs a true would-vs-actual
//     counterfactual (a stronger evidence class). "footprint" = ranked by the
//     realized $ its observed trades made/lost — NOT proven "$ if flipped".
//     The UI marks the two distinctly and never implies a footprint is a flip.

type RegistryStatus = "ACTIVE" | "DORMANT" | "BROKEN" | "STALE";
type FunctionGroup = "Entry" | "Exit" | "Scoring" | "Risk" | "Data" | "Other";
type Promotion = "ready" | "accruing" | "na";
type MetricType = "flip_delta" | "footprint" | null;
type ConfidenceTag = "HIGH" | "MED" | "LOW" | "WEAK" | null;

interface RankTable {
  table_name: string;
  display: string;
  function: FunctionGroup;
  rows: number;
  rows_48h: number;
  latest_write: string | null;
  status: RegistryStatus;
  expected_active: boolean;
  retired: boolean;
  silence_sec?: number | null;
  median_gap_sec?: number | null;
  stale_threshold_sec?: number | null;
  auto_derived: boolean;
  divergence_col: string | null;
  divergent_n: number | null;
  divergence_pct: number | null;
  promotion: Promotion;
  promotion_n: number | null;
  outcome_col: string | null;
  outcome_linked_n: number | null;
  outcome_mean_pnl: number | null;
  outcome_min_pnl: number | null;
  outcome_max_pnl: number | null;
  outcome_win_rate: number | null;
  // E1 $-impact fields.
  outcome_sum_pnl: number | null;
  footprint_n: number | null;
  confidence_tag: ConfidenceTag;
  metric_type: MetricType;
  error?: string;
}

interface RankResponse {
  tables: RankTable[];
  total: number;
  replica_age_seconds: number | null;
  replica_mtime: string | null;
  error?: string;
}

const HERO_TABLE = "shadow_scoring";

function fmtReplicaAge(sec: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "unknown";
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// Compact "~Nm" form for the REPLICA badge (settled-but-delayed marker).
function fmtReplicaShort(sec: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "~?";
  if (sec < 60) return `~${Math.floor(sec)}s`;
  if (sec < 3600) return `~${Math.floor(sec / 60)}m`;
  return `~${Math.floor(sec / 3600)}h`;
}

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  // SQLite emits naive UTC; append Z so the browser parses as UTC (matches
  // shadow-overview.tsx / shadow-table-card.tsx).
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

function fmtDur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

// Map a registry row → CompactShadowCardProps (reuse, no forked card). Mirrors
// shadow-overview.tsx adaptCard, plus the E1 $-impact fields in extraMetrics.
function adaptCard(t: RankTable) {
  const cardStatus: "active" | "dormant" | "stale" =
    t.status === "ACTIVE" ? "active" : t.status === "STALE" ? "stale" : "dormant";
  const extra: Record<string, string | number> = {};
  if (t.metric_type) {
    extra["$ impact (distinct-trade)"] =
      t.outcome_sum_pnl === null ? "no footprint yet" : fmtUsd(t.outcome_sum_pnl);
    extra["footprint (trades)"] = t.footprint_n ?? 0;
    if (t.confidence_tag) extra["confidence"] = t.confidence_tag;
    extra["metric"] =
      t.metric_type === "flip_delta" ? "flip-delta (would vs actual)" : "footprint (not $-if-flipped)";
  }
  if (t.status === "STALE") {
    extra["silent for"] = fmtDur(t.silence_sec);
    extra["expected cadence"] = `~${fmtDur(t.median_gap_sec)}`;
  }
  if (t.error) extra["error"] = t.error;
  return {
    name: t.display,
    tableName: t.table_name,
    totalRows: t.rows,
    rows48h: t.rows_48h,
    latestAge: fmtAge(t.latest_write),
    status: cardStatus,
    function: t.function,
    divergentN: t.divergent_n,
    divergencePct: t.divergence_pct,
    divergenceCol: t.divergence_col,
    promotion: t.promotion,
    promotionN: t.promotion_n,
    retired: t.retired,
    outcomeCol: t.outcome_col,
    outcomeLinkedN: t.outcome_linked_n,
    outcomeMeanPnl: t.outcome_mean_pnl,
    outcomeMinPnl: t.outcome_min_pnl,
    outcomeMaxPnl: t.outcome_max_pnl,
    outcomeWinRate: t.outcome_win_rate,
    extraMetrics: Object.keys(extra).length ? extra : undefined,
  };
}

// $-impact descending (most-profitable-to-flip first). No-footprint rows sort
// LAST, tiebroken by footprint size — never a fabricated number.
function byImpact(a: RankTable, b: RankTable): number {
  const av = a.outcome_sum_pnl;
  const bv = b.outcome_sum_pnl;
  const ah = av !== null;
  const bh = bv !== null;
  if (ah !== bh) return ah ? -1 : 1; // has-footprint first
  if (ah && bh) {
    if (bv! !== av!) return bv! - av!; // descending signed $
  }
  return (b.footprint_n ?? 0) - (a.footprint_n ?? 0);
}

// One ranked entry — a prominent $-impact header line + the reused
// CompactShadowCard (full detail on tap). Left-edge colored by sign.
function RankRow({ t, rank }: { t: RankTable; rank: number }) {
  const sum = t.outcome_sum_pnl;
  const hasFootprint = sum !== null;
  const edge =
    !hasFootprint
      ? "border-l-border-subtle"
      : sum! > 0
        ? "border-l-accent-mint/60"
        : sum! < 0
          ? "border-l-accent-red/50"
          : "border-l-border-subtle";
  const dollarClass = !hasFootprint
    ? "text-fg-muted"
    : sum! > 0
      ? "text-accent-mint-strong"
      : sum! < 0
        ? "text-accent-red"
        : "text-fg-muted";
  return (
    <div className={cn("rounded-md border-l-2 pl-2", edge)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1 pt-1.5">
        <span className="font-mono text-caption tabular-nums text-fg-faint">#{rank}</span>
        <span className={cn("font-mono text-body font-bold tabular-nums", dollarClass)}>
          {hasFootprint ? fmtUsd(sum) : "no footprint yet"}
        </span>
        {hasFootprint && (
          <span className="font-mono text-micro tabular-nums text-fg-muted">
            · {t.footprint_n} trades{t.confidence_tag ? ` · ${t.confidence_tag}` : ""}
          </span>
        )}
        <span className="ml-auto">
          {t.metric_type === "flip_delta" ? (
            <Pill intent="active" size="sm">
              △ flip-delta
            </Pill>
          ) : (
            <Pill tone="neutral" size="sm">
              footprint
            </Pill>
          )}
        </span>
      </div>
      <CompactShadowCard {...adaptCard(t)} />
    </div>
  );
}

export function ShadowRankSection() {
  const [data, setData] = React.useState<RankResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/shadow/registry", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
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

  const tables = data?.tables ?? [];
  // Rankable = has a realized-outcome column (a $-impact concept), not the
  // scoring hero, not retired. Group-C shadows (no outcome col) are counted
  // separately, never fabricated into the rank.
  const rankable = tables.filter(
    (t) => t.metric_type !== null && t.table_name !== HERO_TABLE && !t.retired,
  );
  const ranked = [...rankable].sort(byImpact);
  const withFootprint = ranked.filter((t) => t.outcome_sum_pnl !== null);
  const noFootprint = ranked.filter((t) => t.outcome_sum_pnl === null);
  const noOutcomeCount = tables.filter(
    (t) => t.metric_type === null && t.table_name !== HERO_TABLE && !t.retired,
  ).length;
  const replicaAge = data?.replica_age_seconds ?? null;

  if (data?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState title="Failed" body={data.error} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* REPLICA badge — $ values come from the litestream replica (settled but
          delayed ~20-30 min), NEVER real-time ticks. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-micro text-fg-muted">
        <Pill intent="warn" size="sm">
          REPLICA {fmtReplicaShort(replicaAge)}
        </Pill>
        <span>settled $ · {fmtReplicaAge(replicaAge)} · refreshes ~15 min</span>
        <span className="text-fg-faint">·</span>
        <span>
          {withFootprint.length} ranked
          {noFootprint.length > 0 ? ` · ${noFootprint.length} no footprint yet` : ""}
        </span>
      </div>

      {/* Honest framing of the metric so the ranking is never misread. */}
      <p className="font-sans text-micro leading-relaxed text-fg-muted">
        Ranked by realized $ over <strong className="text-fg-primary">distinct trades</strong>{" "}
        (deduped per trade — never per-cycle sums).{" "}
        <span className="text-accent-mint-strong">△ flip-delta</span> logs a true
        would-vs-actual counterfactual (stronger signal);{" "}
        <span className="text-fg-muted">footprint</span> is the realized $ the rule&apos;s
        trades made/lost — <em>not</em> proven &ldquo;$ if flipped.&rdquo;
      </p>

      {loading && tables.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : ranked.length === 0 ? (
        <EmptyState
          title="No rankable shadows"
          body="No shadow currently carries a per-trade realized outcome to rank."
        />
      ) : (
        <div className="space-y-4">
          {/* Ranked by $ impact descending — most-profitable-to-flip at the top. */}
          <section className="space-y-1.5">
            {withFootprint.map((t, i) => (
              <RankRow key={t.table_name} t={t} rank={i + 1} />
            ))}
          </section>

          {/* No-footprint-yet shadows, last — honest empty state, never a fake $. */}
          {noFootprint.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                No footprint yet ({noFootprint.length}) · awaiting linked trades
              </h3>
              {noFootprint.map((t) => (
                <RankRow key={t.table_name} t={t} rank={0} />
              ))}
            </section>
          )}

          {noOutcomeCount > 0 && (
            <p className="font-sans text-micro text-fg-faint">
              + {noOutcomeCount} shadow{noOutcomeCount === 1 ? "" : "s"} have no per-trade
              outcome column to rank (count-only).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
