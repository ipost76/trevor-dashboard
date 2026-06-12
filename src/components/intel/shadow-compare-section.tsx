"use client";
import * as React from "react";
import {
  Card,
  MetricTile,
  Pill,
  EmptyState,
  Skeleton,
  CollapsibleSection,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  HelpCircle,
  MinusCircle,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";

// S3-P07 — Signal-Overlay Shadow Comparison panel (Intel→Promote).
//
// READ-ONLY go/no-go read for promoting Stage-2/3 shadow overlays to live.
// One COMPACT, tap-to-expand card per overlay: verdict + gating reason +
// glance metrics first; full prose + metric breakdown + recent decisions on
// tap. Underperformers are flagged loudly; overlays with too few resolved
// divergent decisions honestly show "needs more data" (never a fabricated
// number); overlay #6 (S3-P06) shows "metric wiring pending" until its
// schema lands.
//
// W3-P1 (2026-06-12): display-only overhaul — tall prose blocks → compact
// glance-readable readiness cards. Data source, read route, verdict
// thresholds and bucket math are UNCHANGED (all computed in
// query_shadow_compare.py; this component only renders what it returns).
//
// Data via /api/shadow/compare only (no browser storage). Matches the repo's
// data-fetching convention — raw fetch + setInterval; the dashboard has no
// react-query/SWR dependency (see profit-risk-panel.tsx).

const ENDPOINT = "/api/shadow/compare";
const POLL_MS = 15_000;

type Readiness =
  | "insufficient_data"
  | "not_reporting"
  | "underperforms"
  | "candidate";

interface RecentRow {
  created_at: string | null;
  ticker: string | null;
  direction: string | null;
  would_be: string | null;
  live: string | null;
  divergent: boolean;
  outcome: number | null;
  helped: boolean | null;
}

interface Overlay {
  key: string;
  table: string;
  display: string;
  stage: string;
  function: string;
  present: boolean;
  decisions_total: number;
  decisions_7d: number;
  resolved: number;
  divergent: number;
  divergent_resolved: number;
  helped_pct: number | null;
  est_pnl_delta: number | null;
  delta_unit: "R" | null;
  metric_basis: string;
  latest_write: string | null;
  readiness: Readiness;
  readiness_note: string;
  recent: RecentRow[];
  error?: string;
}

interface CompareResponse {
  min_samples: number;
  overlays: Overlay[];
  summary: Record<Readiness, number>;
  error?: string;
}

// ── readiness presentation ───────────────────────────────────────────────────
// Compact buckets: short pill label + bucket-colored left edge + gating-reason
// text color. Pill labels mirror the header SummaryLegend (Candidate /
// Underperforms / Needs data / Not reporting).
const READINESS: Record<
  Readiness,
  {
    label: string;
    pill: React.ComponentProps<typeof Pill>;
    Icon: typeof CheckCircle2;
    border: string;
    reasonText: string;
    noteText: string;
  }
> = {
  candidate: {
    label: "Candidate",
    pill: { intent: "active" },
    Icon: CheckCircle2,
    border: "border-l-accent-mint",
    reasonText: "text-accent-mint",
    noteText: "text-accent-mint",
  },
  underperforms: {
    label: "Underperforms",
    pill: { intent: "error" },
    Icon: TrendingDown,
    border: "border-l-accent-red",
    reasonText: "text-accent-red",
    noteText: "text-accent-red",
  },
  insufficient_data: {
    label: "Needs data",
    pill: { intent: "warn" },
    Icon: HelpCircle,
    border: "border-l-accent-gold",
    reasonText: "text-accent-gold",
    noteText: "text-fg-muted",
  },
  not_reporting: {
    label: "Not reporting",
    pill: { tone: "neutral" },
    Icon: MinusCircle,
    border: "border-l-border-subtle",
    reasonText: "text-fg-muted",
    noteText: "text-fg-muted",
  },
};

function fmtAge(iso: string | null): string {
  if (!iso) return "never";
  // SQLite emits naive UTC ("YYYY-MM-DD HH:MM:SS"); append Z so the browser
  // parses it as UTC. Matches shadow-overview.tsx.
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? iso.replace(" ", "T")
    : iso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtDelta(v: number, unit: "R" | null): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2)}${unit ?? ""}`;
}

// One-line gating reason — derived from STRUCTURED fields only (no prose
// re-parse, no fabrication). The full readiness_note prose still renders
// verbatim in the expanded detail. Returns null for candidate/underperforms
// (the verdict pill carries those).
function gatingReason(o: Overlay, minSamples: number): string | null {
  if (o.readiness === "not_reporting") return "Not reporting yet";
  if (o.readiness === "candidate" || o.readiness === "underperforms") return null;
  // insufficient_data ↓
  // S3-P06 schema-pending probe: the backend flags it explicitly. Keying on the
  // authoritative note self-corrects — once the metric is wired the note
  // changes and this special-case stops firing, falling to the logic below.
  if (/metric wiring pending/i.test(o.readiness_note)) return "Metric wiring pending";
  // Linkage gap: divergence well past threshold but no derivable outcome metric.
  if (o.helped_pct === null && o.divergent_resolved >= minSamples) {
    return "No outcome metric derivable yet";
  }
  // Threshold countdown.
  if (o.divergent_resolved < minSamples) {
    const need = minSamples - o.divergent_resolved;
    return `Needs ${need.toLocaleString()} more divergent decision${need === 1 ? "" : "s"}`;
  }
  return "Verdict pending";
}

// Inline est-P&L-delta for the glance row. Honest: null → muted "n/a", never a
// fabricated number.
function GlanceDelta({ overlay }: { overlay: Overlay }) {
  if (overlay.est_pnl_delta === null) {
    return <span className="text-fg-muted">Δ n/a</span>;
  }
  const d = overlay.est_pnl_delta;
  const tone = d > 0 ? "text-accent-mint" : d < 0 ? "text-accent-red" : "text-fg-muted";
  return <span className={tone}>Δ {fmtDelta(d, overlay.delta_unit)}</span>;
}

function DeltaTile({ overlay }: { overlay: Overlay }) {
  const { est_pnl_delta: d, delta_unit } = overlay;
  if (d === null) {
    return (
      <MetricTile
        label="Est. P&L delta"
        value="n/a"
        sub={overlay.helped_pct !== null ? "directional — hit-rate only" : "no metric"}
        tone="neutral"
        size="sm"
      />
    );
  }
  const tone = d > 0 ? "positive" : d < 0 ? "negative" : "neutral";
  return (
    <MetricTile
      label="Est. P&L delta"
      value={fmtDelta(d, delta_unit)}
      sub="would-be vs actual"
      tone={tone}
      size="sm"
    />
  );
}

function HelpedTile({ overlay }: { overlay: Overlay }) {
  const { helped_pct: h, divergent_resolved: n, est_pnl_delta } = overlay;
  // Honest: below a verdict we still show the raw % but never imply it's
  // conclusive — the readiness pill carries the go/no-go. When null, show —.
  const isHitRate = est_pnl_delta === null && h !== null;
  if (h === null) {
    return (
      <MetricTile
        label="Would-have-helped"
        value="—"
        sub={n > 0 ? `${n.toLocaleString()} divergent` : "no divergent decisions"}
        tone="neutral"
        size="sm"
      />
    );
  }
  const tone = h >= 50 ? "positive" : "negative";
  return (
    <MetricTile
      label={isHitRate ? "Signal hit-rate" : "Would-have-helped"}
      value={`${h.toFixed(0)}%`}
      sub={`of ${n.toLocaleString()} ${isHitRate ? "resolved" : "divergent"}`}
      tone={tone}
      size="sm"
    />
  );
}

function RecentList({ rows }: { rows: RecentRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-2 text-caption text-fg-muted">
        No decisions logged yet.
      </div>
    );
  }
  return (
    <div className="divide-y divide-border-subtle">
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-2 px-3 py-2 text-caption"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-fg-primary">{r.ticker ?? "—"}</span>
            {r.direction && (
              <span className="text-micro uppercase text-fg-muted">{r.direction}</span>
            )}
            <span className="truncate text-fg-muted">
              {r.would_be ?? "—"}
              <span className="text-fg-faint"> vs </span>
              {r.live ?? "—"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {r.outcome !== null && (
              <span className="font-mono tabular-nums text-fg-muted">
                {Number(r.outcome).toFixed(2)}
              </span>
            )}
            {r.helped === null ? (
              <span className="text-fg-faint">·</span>
            ) : r.helped ? (
              <TrendingUp className="h-3.5 w-3.5 text-accent-green" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-accent-red" />
            )}
            <span className="text-micro text-fg-faint">{fmtAge(r.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── compact, tap-to-expand readiness card ────────────────────────────────────
function OverlayCard({
  overlay,
  minSamples,
}: {
  overlay: Overlay;
  minSamples: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const meta = READINESS[overlay.readiness];
  const { Icon } = meta;
  const reason = gatingReason(overlay, minSamples);

  return (
    <Card
      padding="sm"
      className={cn("flex flex-col border-l-2", meta.border)}
    >
      {/* ── collapsed glance (the toggle) ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-1.5 text-left"
      >
        {/* Line 1 — lead + verdict pill + chevron */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body font-semibold text-fg-primary">
              {overlay.display}
            </span>
            <span className="flex items-center gap-1.5 text-micro text-fg-muted">
              <span className="font-mono text-accent-cyan">{overlay.stage}</span>
              <span className="text-fg-faint">·</span>
              <span className="uppercase tracking-wide">{overlay.function}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Pill {...meta.pill} size="sm">
              <span className="inline-flex items-center gap-1">
                <Icon className="h-3 w-3" />
                {meta.label}
              </span>
            </Pill>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-fg-muted transition-transform",
                expanded && "rotate-180",
              )}
            />
          </div>
        </div>

        {/* Line 2 — glance metrics */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-caption tabular-nums text-fg-muted">
          <span>
            <span className="text-fg-primary">
              {overlay.decisions_total.toLocaleString()}
            </span>{" "}
            dec
          </span>
          <span className="text-fg-faint">·</span>
          <span>
            <span className="text-fg-primary">
              {overlay.divergent.toLocaleString()}
            </span>{" "}
            div
          </span>
          <span className="text-fg-faint">·</span>
          <GlanceDelta overlay={overlay} />
        </div>

        {/* Line 3 — gating reason (left) + last write (right) */}
        <div className="flex items-baseline justify-between gap-2">
          {reason ? (
            <span className={cn("text-caption", meta.reasonText)}>{reason}</span>
          ) : (
            <span />
          )}
          <span className="shrink-0 text-micro text-fg-faint">
            {overlay.latest_write ? `last write ${fmtAge(overlay.latest_write)}` : ""}
          </span>
        </div>
      </button>

      {/* ── expanded detail ── */}
      {expanded && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border-subtle pt-3">
          <p className={cn("text-caption leading-relaxed", meta.noteText)}>
            {overlay.readiness_note}
          </p>

          <div className="grid grid-cols-3 gap-2">
            <MetricTile
              label="Decisions"
              value={overlay.decisions_total.toLocaleString()}
              sub={`${overlay.decisions_7d.toLocaleString()} in 7d`}
              tone="neutral"
              size="sm"
            />
            <HelpedTile overlay={overlay} />
            <DeltaTile overlay={overlay} />
          </div>

          {overlay.error && (
            <p className="text-micro text-accent-amber">⚠ {overlay.error}</p>
          )}

          <CollapsibleSection
            title={`Recent decisions (${overlay.recent.length})`}
            defaultOpen={false}
          >
            <RecentList rows={overlay.recent} />
            <p className="border-t border-border-subtle px-3 py-2 text-micro leading-relaxed text-fg-faint">
              {overlay.metric_basis}
            </p>
          </CollapsibleSection>
        </div>
      )}
    </Card>
  );
}

function SummaryLegend({ summary }: { summary: Record<Readiness, number> }) {
  const items: Array<{ k: Readiness; label: string; cls: string }> = [
    { k: "candidate", label: "Candidate", cls: "text-accent-green" },
    { k: "underperforms", label: "Underperforms", cls: "text-accent-red" },
    { k: "insufficient_data", label: "Needs data", cls: "text-accent-amber" },
    { k: "not_reporting", label: "Not reporting", cls: "text-fg-muted" },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
      {items.map(({ k, label, cls }) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={cn("font-mono font-bold tabular-nums", cls)}>
            {summary[k] ?? 0}
          </span>
          <span className="text-fg-muted">{label}</span>
        </span>
      ))}
    </div>
  );
}

export function ShadowCompareSection() {
  const [data, setData] = React.useState<CompareResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setData(await res.json());
      } catch {
        // network error — keep last-good snapshot
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:p-6 lg:px-8">
        <Skeleton className="h-6 w-64" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState title="Failed to load" body={data.error} />
      </div>
    );
  }

  const overlays = data?.overlays ?? [];
  if (overlays.length === 0) {
    return (
      <div className="p-4 md:p-6 lg:px-8">
        <EmptyState
          title="No overlays tracked"
          body="The comparison route returned no overlays."
        />
      </div>
    );
  }

  const minSamples = data?.min_samples ?? 20;

  return (
    <div className="space-y-4 p-4 md:p-6 lg:px-8 animate-fade-in">
      {/* compact header band: title + count pills on one row, threshold caption below */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-h3 text-fg-primary">Promote Readiness</h2>
          {data?.summary && <SummaryLegend summary={data.summary} />}
        </div>
        <p className="text-micro text-fg-muted">
          ≥{minSamples} divergent decisions for a verdict · tap a card for detail
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {overlays.map((o) => (
          <OverlayCard key={o.key} overlay={o} minSamples={minSamples} />
        ))}
      </div>
    </div>
  );
}
