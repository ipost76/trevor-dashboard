"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, Pill, Skeleton } from "@/components/ui";
import { LineChart as LineIcon, RefreshCw, Target, Trophy } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { fetchOutcomes } from "./api";
import { formatPct } from "./format";
import type {
  Engine,
  OutcomeRow,
  OutcomesEngineSummary,
  OutcomesResponse,
} from "./types";

const ENGINE_COLOR: Record<Engine, string> = {
  position: "var(--color-accent-cyan)",
  swing: "var(--color-accent-violet)",
};

const RETURN_BUCKETS = [
  { label: "<-10%", lo: -Infinity, hi: -10 },
  { label: "-10 to -5%", lo: -10, hi: -5 },
  { label: "-5 to 0%", lo: -5, hi: 0 },
  { label: "0 to 5%", lo: 0, hi: 5 },
  { label: "5 to 10%", lo: 5, hi: 10 },
  { label: ">10%", lo: 10, hi: Infinity },
];

function bucketIndex(pct: number): number {
  for (let i = 0; i < RETURN_BUCKETS.length; i++) {
    const b = RETURN_BUCKETS[i];
    if (pct >= b.lo && pct < b.hi) return i;
  }
  return RETURN_BUCKETS.length - 1;
}

export function PerformanceTracker() {
  const [days, setDays] = useState(30);
  const { data, error, loading, refresh } = useScoutFetch(
    (signal) => fetchOutcomes({ days, signal }),
    [days],
    { refreshMs: 5 * 60_000 },
  );

  const totalCount = data?.outcomes.length ?? 0;
  const summaryHasData = data && Object.keys(data.summary).length > 0;

  return (
    <Card padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-h3 text-fg-primary">PERFORMANCE</h2>
          <span className="text-caption text-fg-muted">
            {totalCount.toLocaleString()} tracked signals · last {days}d
          </span>
        </div>
        <div className="flex items-center gap-2">
          <DaysChips days={days} setDays={setDays} />
          <button
            type="button"
            onClick={refresh}
            className="rounded-pill border border-border-subtle px-2 py-0.5 text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-border-red bg-accent-red/5 px-4 py-2 text-caption text-accent-red">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !summaryHasData || totalCount === 0 ? (
        <PerformanceEmpty totalCount={totalCount} />
      ) : (
        <PerformanceFull data={data!} />
      )}
    </Card>
  );
}

function PerformanceEmpty({ totalCount }: { totalCount: number }) {
  return (
    <div className="p-6">
      <EmptyState
        icon={<LineIcon className="h-8 w-8 opacity-30" />}
        title={
          totalCount === 0
            ? "Outcome tracking not started"
            : `Only ${totalCount} tracked signal(s)`
        }
        body="Forward returns are recorded for each signal at T+5, T+20, T+60 trading days. Once Wave-E ships outcome backfill, this panel will populate."
      />
      <div className="mx-auto mt-6 max-w-2xl">
        <div className="text-micro uppercase tracking-wider text-fg-muted">
          What this panel will show
        </div>
        <ul className="mt-2 space-y-1 text-caption text-fg-primary">
          <li>· Per-engine summary cards: count · avg 5d/20d/60d returns · win rate at 20d · best/worst.</li>
          <li>· Distribution of 20-day forward returns, bucketed (Engine A vs Engine B).</li>
          <li>· Rolling 30-day win rate timeline with a 50% break-even reference line.</li>
          <li>· Factor-contribution table — average return when each scoring factor fires vs not.</li>
        </ul>
        <div className="mt-4 text-micro text-fg-dim">
          API: <code className="text-fg-muted">GET /api/scout/outcomes</code> currently returns{" "}
          <code className="text-fg-muted">{`{outcomes: [], summary: {}}`}</code> — no signals tracked.
        </div>
      </div>
    </div>
  );
}

function PerformanceFull({ data }: { data: OutcomesResponse }) {
  const engines = Object.keys(data.summary) as Engine[];

  const distribution = useMemo(() => {
    const buckets = RETURN_BUCKETS.map((b) => ({
      label: b.label,
      position: 0,
      swing: 0,
    }));
    for (const o of data.outcomes) {
      const r = o.fwd_return_20d;
      if (r == null || !Number.isFinite(r)) continue;
      const idx = bucketIndex(r);
      const eng = (o.engine ?? "").toLowerCase();
      if (eng === "position") buckets[idx].position += 1;
      else if (eng === "swing") buckets[idx].swing += 1;
    }
    return buckets;
  }, [data]);

  const winRateTimeline = useMemo(() => {
    return rollingWinRate(data.outcomes, 30);
  }, [data]);

  return (
    <div className="space-y-4 p-4">
      {/* Section A — summary cards */}
      <div className="grid gap-3 md:grid-cols-2">
        {engines.length === 0 && (
          <div className="md:col-span-2 text-caption text-fg-muted">
            No per-engine summary returned.
          </div>
        )}
        {engines.map((eng) => (
          <EngineSummaryCard
            key={eng}
            engine={eng}
            summary={data.summary[eng]!}
            outcomes={data.outcomes.filter((o) => o.engine === eng)}
          />
        ))}
      </div>

      {/* Section B — return distribution */}
      <Section title="20-day return distribution">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distribution} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border-subtle)",
                  fontSize: 12,
                  color: "var(--color-fg-primary)",
                }}
              />
              <Bar dataKey="position" name="Engine A" fill={ENGINE_COLOR.position} />
              <Bar dataKey="swing" name="Engine B" fill={ENGINE_COLOR.swing} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* Section C — win-rate timeline */}
      <Section title="Rolling 30-day win rate (20d > 0%)">
        {winRateTimeline.length === 0 ? (
          <div className="py-4 text-center text-caption text-fg-muted">
            no rolling history yet
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={winRateTimeline}
                margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-bg-card)",
                    border: "1px solid var(--color-border-subtle)",
                    fontSize: 12,
                    color: "var(--color-fg-primary)",
                  }}
                />
                <ReferenceLine
                  y={50}
                  stroke="var(--color-fg-dim)"
                  strokeDasharray="4 4"
                  label={{ value: "50%", position: "right", fill: "var(--color-fg-dim)", fontSize: 11 }}
                />
                <Line
                  type="monotone"
                  dataKey="position"
                  stroke={ENGINE_COLOR.position}
                  dot={false}
                  strokeWidth={1.5}
                />
                <Line
                  type="monotone"
                  dataKey="swing"
                  stroke={ENGINE_COLOR.swing}
                  dot={false}
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* Section D — factor contribution (placeholder until enough data) */}
      <Section title="Factor contribution">
        <div className="text-caption text-fg-muted">
          Available after ≥60 days of live signals — currently {data.outcomes.length} tracked.
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border-subtle bg-bg-elevated/30 p-3">
      <div className="mb-2 text-micro uppercase tracking-wider text-fg-muted">{title}</div>
      {children}
    </section>
  );
}

function EngineSummaryCard({
  engine,
  summary,
  outcomes,
}: {
  engine: Engine;
  summary: OutcomesEngineSummary;
  outcomes: OutcomeRow[];
}) {
  const best = useMemo(() => bestOf(outcomes, "fwd_return_20d", "max"), [outcomes]);
  const worst = useMemo(() => bestOf(outcomes, "fwd_return_20d", "min"), [outcomes]);

  const winRatePct = summary.win_rate_20d != null ? summary.win_rate_20d * 100 : null;

  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated/30 p-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-h3 text-fg-primary">
            {engine === "position" ? "Engine A" : "Engine B"}
          </span>
          <span className="text-caption text-fg-muted">{summary.count} signals</span>
        </div>
        <Pill tone={engine === "position" ? "cyan" : "violet"} size="sm">
          {engine}
        </Pill>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-caption">
        <Metric label="5d" value={summary.avg_5d} pct />
        <Metric label="20d" value={summary.avg_20d} pct />
        <Metric label="60d" value={summary.avg_60d} pct />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-2 text-caption">
        <div className="flex items-center gap-2">
          <Target className="h-3 w-3 text-accent-cyan" />
          <span className="text-fg-muted">Win rate (20d)</span>
        </div>
        <span
          className="tabular-nums"
          style={{
            color:
              winRatePct == null
                ? "var(--color-fg-muted)"
                : winRatePct >= 50
                  ? "var(--color-accent-green)"
                  : "var(--color-accent-red)",
          }}
        >
          {winRatePct == null ? "—" : `${winRatePct.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-micro text-fg-muted">
        <div className="flex items-center gap-1.5">
          <Trophy className="h-3 w-3 text-accent-green" />
          <span>Best:</span>
          <span className="text-fg-primary">{best?.ticker ?? "—"}</span>
          <span className="ml-auto tabular-nums text-accent-green">
            {formatPct(best?.fwd_return_20d ?? null)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Trophy className="h-3 w-3 rotate-180 text-accent-red" />
          <span>Worst:</span>
          <span className="text-fg-primary">{worst?.ticker ?? "—"}</span>
          <span className="ml-auto tabular-nums text-accent-red">
            {formatPct(worst?.fwd_return_20d ?? null)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  pct = false,
}: {
  label: string;
  value: number | null | undefined;
  pct?: boolean;
}) {
  const formatted = pct ? formatPct(value) : value != null ? value.toFixed(2) : "—";
  const tone =
    value == null
      ? "var(--color-fg-muted)"
      : value >= 0
        ? "var(--color-accent-green)"
        : "var(--color-accent-red)";
  return (
    <div className="rounded-sm bg-bg-card/40 p-2 text-center">
      <div className="text-micro uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mt-0.5 tabular-nums" style={{ color: tone }}>
        {formatted}
      </div>
    </div>
  );
}

function bestOf(
  outcomes: OutcomeRow[],
  key: "fwd_return_5d" | "fwd_return_20d" | "fwd_return_60d",
  mode: "max" | "min",
): OutcomeRow | null {
  let best: OutcomeRow | null = null;
  for (const o of outcomes) {
    const v = o[key];
    if (v == null || !Number.isFinite(v)) continue;
    if (!best) {
      best = o;
      continue;
    }
    const bv = best[key];
    if (bv == null) continue;
    if (mode === "max" && v > bv) best = o;
    if (mode === "min" && v < bv) best = o;
  }
  return best;
}

function rollingWinRate(
  outcomes: OutcomeRow[],
  windowDays: number,
): { date: string; position: number | null; swing: number | null }[] {
  if (!outcomes.length) return [];
  // Group by signal_date + engine, compute (wins/total) on a rolling window.
  const byDate = new Map<string, { position: { w: number; t: number }; swing: { w: number; t: number } }>();
  for (const o of outcomes) {
    const d = (o.signal_date ?? "").slice(0, 10);
    if (!d || o.fwd_return_20d == null) continue;
    let entry = byDate.get(d);
    if (!entry) {
      entry = { position: { w: 0, t: 0 }, swing: { w: 0, t: 0 } };
      byDate.set(d, entry);
    }
    const eng = (o.engine ?? "").toLowerCase();
    const win = o.fwd_return_20d > 0;
    if (eng === "position") {
      entry.position.t += 1;
      if (win) entry.position.w += 1;
    } else if (eng === "swing") {
      entry.swing.t += 1;
      if (win) entry.swing.w += 1;
    }
  }
  const dates = Array.from(byDate.keys()).sort();
  const out: { date: string; position: number | null; swing: number | null }[] = [];
  for (let i = 0; i < dates.length; i++) {
    const lo = Math.max(0, i - windowDays + 1);
    let pw = 0,
      pt = 0,
      sw = 0,
      st = 0;
    for (let j = lo; j <= i; j++) {
      const e = byDate.get(dates[j])!;
      pw += e.position.w;
      pt += e.position.t;
      sw += e.swing.w;
      st += e.swing.t;
    }
    out.push({
      date: dates[i].slice(5),
      position: pt > 0 ? (pw / pt) * 100 : null,
      swing: st > 0 ? (sw / st) * 100 : null,
    });
  }
  return out;
}

function DaysChips({
  days,
  setDays,
}: {
  days: number;
  setDays: (n: number) => void;
}) {
  const opts = [7, 30, 60, 90] as const;
  return (
    <div className="flex items-center gap-1">
      {opts.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          className={cn(
            "rounded-pill border px-2 py-0.5 text-micro uppercase tracking-wider transition-colors duration-fast",
            d === days
              ? "border-border-accent bg-accent-cyan/10 text-accent-cyan"
              : "border-border-subtle text-fg-muted hover:border-border-strong hover:text-fg-primary",
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
