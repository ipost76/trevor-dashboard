"use client";

import { useMemo } from "react";
import { Card, Pill, Skeleton } from "@/components/ui";
import { Activity, AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { fetchMacro, fetchSectors } from "./api";
import type { Tone } from "./format";

const SECTOR_NAME: Record<string, string> = {
  XLK: "Technology",
  XLF: "Financials",
  XLE: "Energy",
  XLV: "Health Care",
  XLI: "Industrials",
  XLP: "Consumer Staples",
  XLY: "Consumer Discretionary",
  XLU: "Utilities",
  XLB: "Materials",
  XLRE: "Real Estate",
  XLC: "Communication Services",
};

const REGIME_TONE: Record<string, Tone> = {
  "RISK-ON": "green",
  "RISK-OFF": "red",
  NEUTRAL: "amber",
  UNKNOWN: "neutral",
};

function regimeColor(label: string | null | undefined): Tone {
  if (!label) return "neutral";
  return REGIME_TONE[label.toUpperCase()] ?? "neutral";
}

function rankToneFor(rank: number, total: number): Tone {
  if (rank <= 4) return "green";
  if (rank > total - 4) return "red";
  return "amber";
}

export function SectorRotation() {
  const sectors = useScoutFetch((s) => fetchSectors(s), [], { refreshMs: 5 * 60_000 });
  const macro = useScoutFetch((s) => fetchMacro(s), [], { refreshMs: 5 * 60_000 });

  const ranked = useMemo(() => {
    const rotation = sectors.data?.sector_rotation;
    if (!rotation) return [];
    const total = Object.keys(rotation).length;
    return Object.entries(rotation)
      .map(([etf, rank]) => ({
        etf,
        name: SECTOR_NAME[etf] ?? etf,
        rank,
        total,
        tone: rankToneFor(rank, total),
      }))
      .sort((a, b) => a.rank - b.rank);
  }, [sectors.data]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Macro regime — left column */}
      <Card padding="none" className="overflow-hidden lg:col-span-1">
        <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-h3 text-fg-primary">REGIME</h2>
            {sectors.data?.date && (
              <span className="text-caption text-fg-muted">{sectors.data.date.slice(0, 10)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              sectors.refresh();
              macro.refresh();
            }}
            className="rounded-pill border border-border-subtle px-2 py-0.5 text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </header>

        {sectors.loading && !sectors.data ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : (
          <div className="p-4">
            <RegimeBadge label={sectors.data?.regime_label ?? "UNKNOWN"} />
            <div className="mt-4 space-y-2 text-caption">
              <Indicator
                icon={<ShieldCheck className="h-3 w-3 text-accent-cyan" />}
                label="Yield curve (10Y-3M)"
                value={fmtNumber(sectors.data?.yield_curve, 2)}
                hint="positive = normal, negative = inverted"
              />
              <Indicator
                icon={<AlertTriangle className="h-3 w-3 text-accent-amber" />}
                label="Financial stress (STLFSI4)"
                value={fmtNumber(sectors.data?.financial_stress, 2)}
                hint="≥1 = stressed, ≤0 = calm"
              />
              <Indicator
                icon={<Activity className="h-3 w-3 text-accent-violet" />}
                label="VIX"
                value="—"
                hint="not exposed via API"
              />
            </div>

            <div className="mt-4 border-t border-border-subtle pt-3">
              <div className="text-micro uppercase tracking-wider text-fg-muted">
                Regime history (90d)
              </div>
              <RegimeHistory rows={macro.data?.macro_history ?? []} loading={macro.loading} />
            </div>
          </div>
        )}
      </Card>

      {/* Sector rotation — right two columns */}
      <Card padding="none" className="overflow-hidden lg:col-span-2">
        <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-h3 text-fg-primary">SECTOR ROTATION</h2>
            <span className="text-caption text-fg-muted">11 ETFs · ranked vs SPY</span>
          </div>
        </header>

        {sectors.error && (
          <div className="border-b border-border-red bg-accent-red/5 px-4 py-2 text-caption text-accent-red">
            {sectors.error}
          </div>
        )}

        {sectors.loading && !sectors.data ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 11 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : ranked.length === 0 ? (
          <div className="p-6 text-center text-caption text-fg-muted">
            No sector ranking yet — re-run the weekly refresh job.
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {ranked.map((s) => (
              <li
                key={s.etf}
                className="relative flex items-center gap-3 px-4 py-2 transition-colors duration-fast hover:bg-bg-elevated/60"
              >
                <span className="w-6 text-right tabular-nums text-fg-dim">{s.rank}</span>
                <span className="w-12 font-medium text-fg-primary">{s.etf}</span>
                <span className="flex-1 truncate text-caption text-fg-muted">{s.name}</span>
                <div className="relative h-2 w-32 overflow-hidden rounded-pill bg-bg-elevated md:w-48">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-pill",
                      s.tone === "green" && "bg-accent-green",
                      s.tone === "amber" && "bg-accent-amber",
                      s.tone === "red" && "bg-accent-red",
                    )}
                    style={{
                      width: `${Math.max(8, ((s.total + 1 - s.rank) / s.total) * 100)}%`,
                    }}
                  />
                </div>
                <Pill tone={s.tone} size="sm">
                  {s.tone === "green" ? "TOP" : s.tone === "red" ? "BOT" : "MID"}
                </Pill>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border-subtle px-4 py-2 text-micro text-fg-muted">
          Bar length encodes rank (top sector full width); actual return magnitude not yet exposed by the API.
        </div>
      </Card>
    </div>
  );
}

function RegimeBadge({ label }: { label: string }) {
  const tone = regimeColor(label);
  return (
    <div
      className={cn(
        "rounded-md border-2 px-4 py-3 text-center font-bold tracking-widest",
        tone === "green" && "border-accent-green bg-accent-green/10 text-accent-green shadow-glow-green",
        tone === "red" && "border-accent-red bg-accent-red/10 text-accent-red shadow-glow-red",
        tone === "amber" && "border-accent-amber bg-accent-amber/10 text-accent-amber shadow-glow-amber",
        tone === "neutral" && "border-border-subtle bg-bg-elevated text-fg-muted",
      )}
    >
      <div className="text-h2">{label || "UNKNOWN"}</div>
      <div className="mt-1 text-micro uppercase tracking-wider opacity-70">macro regime</div>
    </div>
  );
}

function Indicator({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0">{icon}</span>
      <span className="text-fg-muted">{label}</span>
      <span className="ml-auto tabular-nums text-fg-primary">{value}</span>
      {hint && <span className="hidden text-micro text-fg-dim md:inline">· {hint}</span>}
    </div>
  );
}

function RegimeHistory({
  rows,
  loading,
}: {
  rows: { date: string; regime_label: string | null }[];
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="mt-1 h-3 w-full" />;
  if (!rows.length) {
    return (
      <div className="mt-1 text-micro text-fg-dim">
        no history yet — only one snapshot stored
      </div>
    );
  }
  // newest-last for left-to-right reading
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="mt-1 flex h-3 gap-px overflow-hidden rounded-sm" role="img" aria-label="Regime history">
      {sorted.map((r) => {
        const tone = regimeColor(r.regime_label);
        return (
          <span
            key={r.date}
            title={`${r.date.slice(0, 10)}: ${r.regime_label ?? "—"}`}
            className={cn(
              "block flex-1",
              tone === "green" && "bg-accent-green/70",
              tone === "amber" && "bg-accent-amber/70",
              tone === "red" && "bg-accent-red/70",
              tone === "neutral" && "bg-bg-elevated",
            )}
          />
        );
      })}
    </div>
  );
}

function fmtNumber(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}
