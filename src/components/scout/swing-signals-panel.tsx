"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, Pill, Skeleton } from "@/components/ui";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { fetchHistory, fetchSignals } from "./api";
import {
  finvizUrl,
  formatDateOnly,
  formatScore,
  mcapTone,
  rsColor,
  scoreColor,
  SUB_SIGNAL_LABEL,
  SUB_SIGNAL_TONE,
  type Tone,
} from "./format";
import type { Signal } from "./types";
import { HistoryBars } from "./history-bars";

type SortKey = "ticker" | "final_score" | "rs_pct" | "mom_pct" | "mcap";
type SortDir = "asc" | "desc";

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; align?: "left" | "right" }> = [
  { key: "ticker", label: "Ticker" },
  { key: "final_score", label: "Score", align: "right" },
  { key: "rs_pct", label: "RS", align: "right" },
  { key: "mom_pct", label: "Mom", align: "right" },
  { key: "mcap", label: "Cap", align: "right" },
];

export function SwingSignalsPanel() {
  const signals = useScoutFetch(
    (signal) => fetchSignals("swing", { limit: 50, signal }),
    [],
    { refreshMs: 60_000 },
  );
  const history = useScoutFetch(
    (signal) => fetchHistory("swing", { days: 30, signal }),
    [],
    { refreshMs: 5 * 60_000 },
  );
  const [sortKey, setSortKey] = useState<SortKey>("final_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const rows = useMemo(() => {
    const items = signals.data?.signals ?? [];
    return [...items].sort((a, b) => {
      const cmp = compareValues(pickSortValue(a, sortKey), pickSortValue(b, sortKey), sortKey === "ticker");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [signals.data, sortKey, sortDir]);

  const scoreRange = useMemo(() => {
    const items = signals.data?.signals ?? [];
    if (!items.length) return null;
    const scores = items.map((s) => s.final_score);
    return { min: Math.min(...scores), max: Math.max(...scores) };
  }, [signals.data]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const toggle = (ticker: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  return (
    <Card padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-h3 text-fg-primary">ENGINE B</h2>
          <span className="text-caption uppercase tracking-wider text-fg-muted">
            Swing Finder
          </span>
        </div>
        <div className="flex items-center gap-2 text-micro text-fg-muted">
          {signals.data?.run_date && <span>Run {formatDateOnly(signals.data.run_date)}</span>}
          {signals.data?.count ? <span>· {signals.data.count} signals</span> : null}
          {scoreRange && (
            <span>
              · {scoreRange.min.toFixed(1)}–{scoreRange.max.toFixed(1)}
            </span>
          )}
          <button
            type="button"
            onClick={signals.refresh}
            className="ml-2 rounded-pill border border-border-subtle px-2 py-0.5 text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </header>

      {signals.error && (
        <div className="border-b border-border-red bg-accent-red/5 px-4 py-2 text-caption text-accent-red">
          {signals.error}
        </div>
      )}

      <div className="overflow-x-auto">
        {signals.loading && !signals.data ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-8 w-8 opacity-30" />}
            title="No signals yet"
            body="Engine B has not run, or no Stage-2 tickers fired any sub-signal."
          />
        ) : (
          <table className="w-full text-caption">
            <thead className="sticky top-0 bg-bg-card text-micro uppercase tracking-wider text-fg-muted">
              <tr className="border-b border-border-subtle">
                <th className="w-8 px-2 py-2" />
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      "cursor-pointer select-none px-2 py-2",
                      c.align === "right" ? "text-right" : "text-left",
                    )}
                    onClick={() => onSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortKey === c.key && (
                        <span aria-hidden className="text-accent-cyan">
                          {sortDir === "desc" ? "▼" : "▲"}
                        </span>
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 text-left">Signals</th>
                <th className="px-2 py-2 text-left">Sector</th>
                <th className="w-12 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <SwingRow
                  key={s.ticker}
                  signal={s}
                  expanded={expanded.has(s.ticker)}
                  onToggle={() => toggle(s.ticker)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-border-subtle p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-micro uppercase tracking-wider text-fg-muted">
            30d signal count
          </span>
          {history.data && (
            <span className="text-micro text-fg-dim">{history.data.count} rows</span>
          )}
        </div>
        <HistoryBars rows={history.data?.history ?? []} loading={history.loading} />
      </div>
    </Card>
  );
}

function SwingRow({
  signal,
  expanded,
  onToggle,
}: {
  signal: Signal;
  expanded: boolean;
  onToggle: () => void;
}) {
  const c = signal.components;
  const rs = c?.rs_pct ?? null;
  const mom = c?.mom_pct ?? null;
  const tone = mcapTone(c?.mcap_label);
  const active = c?.active ?? [];
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-border-subtle transition-colors duration-fast hover:bg-bg-elevated",
          signal.is_new && "bg-accent-green/5",
        )}
      >
        <td className="px-2 py-1.5 text-fg-muted">
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </td>
        <td className="px-2 py-1.5 font-medium">
          <div className="flex items-center gap-2">
            <span className="text-fg-primary">{signal.ticker}</span>
            {signal.is_new && <Pill tone="green" size="sm">NEW</Pill>}
          </div>
        </td>
        <td
          className="px-2 py-1.5 text-right tabular-nums"
          style={{ color: scoreColor(signal.final_score, 50) }}
        >
          {formatScore(signal.final_score)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: rsColor(rs) }}>
          {rs ?? "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: rsColor(mom) }}>
          {mom ?? "—"}
        </td>
        <td className="px-2 py-1.5 text-right">
          <Pill tone={tone} size="sm">{c?.mcap_label ?? "—"}</Pill>
        </td>
        <td className="px-2 py-1.5">
          <div className="flex flex-wrap gap-1">
            {active.length === 0 ? (
              <span className="text-fg-muted">—</span>
            ) : (
              active.map((sig) => (
                <Pill key={sig} tone={(SUB_SIGNAL_TONE[sig] ?? "neutral") as Tone} size="sm">
                  {SUB_SIGNAL_LABEL[sig] ?? sig.toUpperCase()}
                </Pill>
              ))
            )}
          </div>
        </td>
        <td className="max-w-[140px] truncate px-2 py-1.5 text-caption text-fg-muted">
          {signal.sector ?? c?.sector ?? "—"}
        </td>
        <td className="px-2 py-1.5">
          <a
            href={finvizUrl(signal.ticker)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center text-fg-muted transition-colors duration-fast hover:text-accent-cyan"
            aria-label={`Open ${signal.ticker} on Finviz`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </td>
      </tr>
      {expanded && c && (
        <tr className="border-b border-border-subtle bg-bg-elevated/40">
          <td colSpan={9} className="px-4 py-3">
            <SwingDetail signal={signal} />
          </td>
        </tr>
      )}
    </>
  );
}

function SwingDetail({ signal }: { signal: Signal }) {
  const c = signal.components;
  if (!c) return <span className="text-fg-muted">No detail available.</span>;
  const scored = Object.entries(c.scores).filter(([, v]) => (v ?? 0) > 0);
  const d = c.details ?? {};
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <div className="mb-1 text-micro uppercase tracking-wider text-fg-muted">Sub-signals</div>
        <div className="flex flex-wrap gap-1.5">
          {scored.length ? (
            scored.map(([k, v]) => (
              <Pill key={k} tone={(SUB_SIGNAL_TONE[k] ?? "cyan") as Tone} size="sm">
                {SUB_SIGNAL_LABEL[k] ?? k.toUpperCase()} +{v}
              </Pill>
            ))
          ) : (
            <span className="text-caption text-fg-muted">no sub-signals</span>
          )}
        </div>
        <div className="mt-2 text-micro text-fg-muted">
          raw {signal.raw_score.toFixed(0)} × mult {signal.size_multiplier.toFixed(2)} ={" "}
          {signal.final_score.toFixed(1)}
        </div>
      </div>
      <div>
        <div className="mb-1 text-micro uppercase tracking-wider text-fg-muted">Details</div>
        <ul className="space-y-1 text-caption text-fg-primary">
          {d.pead && <li>· PEAD: {d.pead}</li>}
          {d.vcp && <li>· VCP: {d.vcp}</li>}
          {d.insider && <li>· Insider: {d.insider}</li>}
          {d.squeeze && <li>· Squeeze: {d.squeeze}</li>}
          {d.filing && <li>· 8-K: {d.filing}</li>}
          {!d.pead && !d.vcp && !d.insider && !d.squeeze && !d.filing && (
            <li className="text-fg-muted">no specific details</li>
          )}
        </ul>
        {signal.name && (
          <div className="mt-2 truncate text-micro text-fg-dim" title={signal.name}>
            {signal.name}
          </div>
        )}
      </div>
    </div>
  );
}

function pickSortValue(s: Signal, key: SortKey): number | string | null {
  if (key === "ticker") return s.ticker;
  if (key === "final_score") return s.final_score;
  if (key === "rs_pct") return s.components?.rs_pct ?? null;
  if (key === "mom_pct") return s.components?.mom_pct ?? null;
  if (key === "mcap") return s.market_cap ?? s.components?.mcap ?? null;
  return null;
}

function compareValues(a: unknown, b: unknown, alpha: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (alpha || (typeof a === "string" && typeof b === "string")) {
    return String(a).localeCompare(String(b));
  }
  return (a as number) - (b as number);
}
