"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  MetricTile,
  EmptyState,
  Skeleton,
  CollapsibleSection,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, HelpCircle, MinusCircle, CheckCircle2 } from "lucide-react";

// S3-P07 — Signal-Overlay Shadow Comparison panel (Intel→Promote).
//
// READ-ONLY go/no-go read for promoting Stage-2/3 shadow overlays to live.
// One card per overlay: sample size, would-have-helped metric, estimated
// P&L delta vs actual, and a promote-readiness verdict. Underperformers are
// flagged loudly; overlays with too few samples honestly show "needs more
// data" (never a fabricated number); overlay #6 (S3-P06, built in parallel)
// shows "not reporting" until its shadow table lands.
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
const READINESS: Record<
  Readiness,
  { label: string; pill: React.ComponentProps<typeof Pill>; glow: React.ComponentProps<typeof Card>["glow"]; Icon: typeof CheckCircle2 }
> = {
  candidate: {
    label: "Beats baseline — candidate",
    pill: { intent: "active" },
    glow: "green",
    Icon: CheckCircle2,
  },
  underperforms: {
    label: "Underperforms baseline",
    pill: { intent: "error" },
    glow: "red",
    Icon: TrendingDown,
  },
  insufficient_data: {
    label: "Needs more data",
    pill: { intent: "warn" },
    glow: "none",
    Icon: HelpCircle,
  },
  not_reporting: {
    label: "Not reporting yet",
    pill: { tone: "neutral" },
    glow: "none",
    Icon: MinusCircle,
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
        sub={n > 0 ? `${n} divergent` : "no divergent decisions"}
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
      sub={`of ${n} ${isHitRate ? "resolved" : "divergent"}`}
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

function OverlayCard({ overlay }: { overlay: Overlay }) {
  const meta = READINESS[overlay.readiness];
  const { Icon } = meta;
  return (
    <Card glow={meta.glow} padding="sm" className="flex flex-col gap-3">
      <CardHeader className="mb-0 items-start">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-body font-semibold text-fg-primary">
            {overlay.display}
          </CardTitle>
          <div className="flex items-center gap-2 text-micro text-fg-muted">
            <span className="font-mono text-accent-cyan">{overlay.stage}</span>
            <span className="text-fg-faint">·</span>
            <span className="uppercase tracking-wide">{overlay.function}</span>
          </div>
        </div>
        <Pill {...meta.pill} size="sm">
          <span className="inline-flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {meta.label}
          </span>
        </Pill>
      </CardHeader>

      <div className="grid grid-cols-3 gap-2">
        <MetricTile
          label="Decisions"
          value={overlay.decisions_total.toLocaleString()}
          sub={`${overlay.decisions_7d} in 7d`}
          tone="neutral"
          size="sm"
        />
        <HelpedTile overlay={overlay} />
        <DeltaTile overlay={overlay} />
      </div>

      <p
        className={cn(
          "text-caption",
          overlay.readiness === "underperforms"
            ? "text-accent-red"
            : overlay.readiness === "candidate"
              ? "text-accent-green"
              : "text-fg-muted",
        )}
      >
        {overlay.readiness_note}
      </p>

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

      {overlay.latest_write && (
        <div className="text-micro text-fg-faint">
          last write {fmtAge(overlay.latest_write)}
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
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

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-h3 text-fg-primary">Promote Readiness</h2>
          <span className="text-micro text-fg-muted">
            ≥{data?.min_samples ?? 20} divergent decisions for a verdict
          </span>
        </div>
        <p className="max-w-2xl text-caption text-fg-muted">
          Would-be-vs-actual for every Stage-2/3 shadow overlay — the go/no-go
          read for promoting a shadow to live. Metrics stay blank until an
          overlay has enough resolved divergent decisions; no number is shown
          as conclusive below threshold.
        </p>
        {data?.summary && <SummaryLegend summary={data.summary} />}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {overlays.map((o) => (
          <OverlayCard key={o.key} overlay={o} />
        ))}
      </div>
    </div>
  );
}
