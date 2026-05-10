"use client";

import { useState } from "react";
import { Card, EmptyState, Pill, Skeleton } from "@/components/ui";
import { Bookmark, ExternalLink, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { addToWatchlist, fetchWatchlist, removeFromWatchlist } from "./api";
import {
  finvizUrl,
  formatDateOnly,
  formatMcap,
  formatRelativeDays,
} from "./format";
import type { Tone } from "./format";

export function WatchlistTable() {
  const { data, error, loading, refresh } = useScoutFetch(
    (signal) => fetchWatchlist(signal),
    [],
    { refreshMs: 60_000 },
  );
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  const rows = data?.watchlist ?? [];

  const onAdd = async () => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    setOpError(null);
    try {
      await addToWatchlist(sym, { engine: "manual", notes: "added from hub" });
      setTicker("");
      refresh();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sym: string) => {
    setBusy(true);
    setOpError(null);
    try {
      await removeFromWatchlist(sym);
      refresh();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-h3 text-fg-primary">WATCHLIST</h2>
          <span className="text-caption text-fg-muted">{rows.length} active</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="TICKER"
            maxLength={8}
            disabled={busy}
            className="w-28 rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-caption uppercase tracking-wider text-fg-primary placeholder:text-fg-dim focus:border-border-accent focus:outline-none disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={!ticker.trim() || busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1 text-caption uppercase tracking-wider transition-colors duration-fast",
              "text-accent-cyan hover:border-border-strong",
              "disabled:cursor-not-allowed disabled:opacity-30",
            )}
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </form>
      </header>

      {(error || opError) && (
        <div className="border-b border-border-red bg-accent-red/5 px-4 py-2 text-caption text-accent-red">
          {error ?? opError}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="h-8 w-8 opacity-30" />}
          title="Watchlist is empty"
          body="Promote signals from Engine A or B, or add a ticker manually above."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-caption">
            <thead className="text-micro uppercase tracking-wider text-fg-muted">
              <tr className="border-b border-border-subtle">
                <th className="px-2 py-2 text-left">Ticker</th>
                <th className="px-2 py-2 text-left">Engine</th>
                <th className="px-2 py-2 text-right">Entry</th>
                <th className="px-2 py-2 text-left">Added</th>
                <th className="px-2 py-2 text-left">Days</th>
                <th className="px-2 py-2 text-left">Sector</th>
                <th className="px-2 py-2 text-right">Cap</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="w-12 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.ticker}
                  className="border-b border-border-subtle transition-colors duration-fast hover:bg-bg-elevated"
                >
                  <td className="px-2 py-1.5 font-medium">
                    <a
                      href={finvizUrl(row.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-fg-primary hover:text-accent-cyan"
                    >
                      {row.ticker}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                  </td>
                  <td className="px-2 py-1.5">
                    <Pill tone={engineTone(row.source_engine)} size="sm">
                      {row.source_engine}
                    </Pill>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                    {row.entry_score.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-fg-muted">{formatDateOnly(row.added_date)}</td>
                  <td className="px-2 py-1.5 text-fg-muted">
                    {formatRelativeDays(row.added_date)}
                  </td>
                  <td className="max-w-[160px] truncate px-2 py-1.5 text-fg-muted">
                    {row.sector ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                    ${formatMcap(row.market_cap)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Pill tone={statusTone(row.status)} size="sm">
                      {row.status}
                    </Pill>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemove(row.ticker)}
                      className="text-fg-muted transition-colors duration-fast hover:text-accent-red disabled:opacity-30"
                      aria-label={`Remove ${row.ticker}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function engineTone(engine: string): Tone {
  if (engine === "position") return "cyan";
  if (engine === "swing") return "violet";
  if (engine === "manual") return "amber";
  return "neutral";
}

function statusTone(status: string): Tone {
  if (status === "active") return "green";
  if (status === "graduated") return "cyan";
  return "neutral";
}
