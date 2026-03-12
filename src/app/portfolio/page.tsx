"use client";

import { useState, useCallback } from "react";
import { Briefcase, TrendingUp, TrendingDown, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { usePolling } from "@/lib/use-polling";

type Position = {
  id: number; ticker: string; asset_type: string; direction: string;
  quantity: number; entry_price: number; leverage: number;
  current_price: number | null; unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null; notes: string;
  status: string; exit_price: number | null; realized_pnl: number | null;
  realized_pnl_pct: number | null; opened_at: string; closed_at: string | null;
};

type Summary = {
  total_value: number; total_unrealized_pnl: number;
  total_unrealized_pnl_pct: number; position_count: number;
  by_category: Record<string, { count: number; value: number; pnl: number }>;
};

type PortfolioData = {
  stocks_etfs: Position[]; crypto_spot: Position[];
  crypto_perps: Position[]; summary: Summary;
};

type HistoryData = {
  positions: Position[]; total_realized_pnl: number;
  total_trades: number; win_count: number; loss_count: number;
};

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${v.toFixed(2)}`;
}

function pnlColor(v: number): string {
  return v > 0 ? "neon-green" : v < 0 ? "text-[var(--neon-red)]" : "text-muted-foreground";
}

function pnlStr(pnl: number, pct: number): string {
  const s = pnl >= 0 ? "+" : "";
  return `${s}${fmt(pnl)} (${s}${pct.toFixed(2)}%)`;
}

function estLiq(entry: number, leverage: number, direction: string): string {
  if (leverage <= 1) return "—";
  if (direction === "long") return fmt(entry * (1 - 1 / leverage) * 1.05);
  return fmt(entry * (1 + 1 / leverage) * 0.95);
}

function daysSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    return days === 0 ? "today" : `${days}d`;
  } catch { return "—"; }
}

export default function PortfolioPage() {
  const [tab, setTab] = useState<"stocks" | "crypto" | "perps" | "history">("stocks");
  const [data, setData] = useState<PortfolioData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [portfolio, hist] = await Promise.all([
      safeFetch<PortfolioData>("/api/portfolio", {
        stocks_etfs: [], crypto_spot: [], crypto_perps: [],
        summary: { total_value: 0, total_unrealized_pnl: 0, total_unrealized_pnl_pct: 0, position_count: 0, by_category: {} },
      }),
      safeFetch<HistoryData>("/api/portfolio/history", {
        positions: [], total_realized_pnl: 0, total_trades: 0, win_count: 0, loss_count: 0,
      }),
    ]);
    setData(portfolio);
    setHistory(hist);
    setLoading(false);
  }, []);

  usePolling(fetchData, 60000);

  const summary = data?.summary;

  const tabs = [
    { key: "stocks" as const, label: "Stocks/ETFs", count: summary?.by_category?.stocks_etfs?.count ?? 0 },
    { key: "crypto" as const, label: "Crypto Spot", count: summary?.by_category?.crypto_spot?.count ?? 0 },
    { key: "perps" as const, label: "Crypto Perps", count: summary?.by_category?.crypto_perps?.count ?? 0 },
    { key: "history" as const, label: "History", count: history?.total_trades ?? 0 },
  ];

  const positions: Position[] =
    tab === "stocks" ? (data?.stocks_etfs ?? []) :
    tab === "crypto" ? (data?.crypto_spot ?? []) :
    tab === "perps" ? (data?.crypto_perps ?? []) : [];

  return (
    <div className="flex flex-col gap-4 p-4 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Briefcase className="h-5 w-5 neon-green" />
        <h1 className="text-lg font-bold tracking-wide neon-green" style={{ fontFamily: "var(--font-display)" }}>
          PORTFOLIO
        </h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel p-3">
          <div className="stat-label">Total Value</div>
          <div className="stat-value">{loading ? "—" : fmt(summary?.total_value ?? 0)}</div>
        </div>
        <div className="panel p-3">
          <div className="stat-label">Unrealized P&L</div>
          <div className={cn("stat-value", pnlColor(summary?.total_unrealized_pnl ?? 0))}>
            {loading ? "—" : pnlStr(summary?.total_unrealized_pnl ?? 0, summary?.total_unrealized_pnl_pct ?? 0)}
          </div>
        </div>
        <div className="panel p-3">
          <div className="stat-label">Open Positions</div>
          <div className="stat-value">{loading ? "—" : summary?.position_count ?? 0}</div>
        </div>
        <div className="panel p-3">
          <div className="stat-label">Realized P&L</div>
          <div className={cn("stat-value", pnlColor(history?.total_realized_pnl ?? 0))}>
            {loading ? "—" : `${(history?.total_realized_pnl ?? 0) >= 0 ? "+" : ""}${fmt(history?.total_realized_pnl ?? 0)}`}
          </div>
          <div className="text-[9px] text-muted-foreground">
            {history ? `${history.win_count}W ${history.loss_count}L` : ""}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)] pb-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-[11px] font-medium tracking-wide border-b-2 transition-all -mb-[1px]",
              tab === t.key
                ? "border-[var(--neon-green)] text-[var(--neon-green)]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label} {t.count > 0 && <span className="text-[9px] opacity-60">({t.count})</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="panel">
        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 rounded-sm animate-skeleton" style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        ) : tab === "history" ? (
          <HistoryTable positions={history?.positions ?? []} />
        ) : positions.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No open positions in this category.
          </div>
        ) : tab === "perps" ? (
          <PerpsTable positions={positions} />
        ) : (
          <PositionsTable positions={positions} />
        )}
      </div>
    </div>
  );
}

function PositionsTable({ positions }: { positions: Position[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground border-b border-[var(--border)]">
            <th className="px-3 py-2">Ticker</th>
            <th className="px-3 py-2">Dir</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Entry</th>
            <th className="px-3 py-2 text-right">Current</th>
            <th className="px-3 py-2 text-right">P&L</th>
            <th className="px-3 py-2 text-right">Held</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => {
            const pnl = p.unrealized_pnl ?? 0;
            const pct = p.unrealized_pnl_pct ?? 0;
            const current = p.current_price ?? p.entry_price;
            return (
              <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--muted)] transition-colors">
                <td className="px-3 py-2 font-bold">{p.ticker}</td>
                <td className="px-3 py-2">
                  <span className={p.direction === "long" ? "badge-long" : "badge-short"}>
                    {p.direction.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{p.quantity.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{fmt(p.entry_price)}</td>
                <td className="px-3 py-2 text-right">{fmt(current)}</td>
                <td className={cn("px-3 py-2 text-right font-medium", pnlColor(pnl))}>
                  {pnlStr(pnl, pct)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">{daysSince(p.opened_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PerpsTable({ positions }: { positions: Position[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground border-b border-[var(--border)]">
            <th className="px-3 py-2">Ticker</th>
            <th className="px-3 py-2">Dir</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="px-3 py-2 text-right">Lev</th>
            <th className="px-3 py-2 text-right">Entry</th>
            <th className="px-3 py-2 text-right">Current</th>
            <th className="px-3 py-2 text-right">P&L</th>
            <th className="px-3 py-2 text-right">Est. Liq</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => {
            const pnl = p.unrealized_pnl ?? 0;
            const pct = p.unrealized_pnl_pct ?? 0;
            const current = p.current_price ?? p.entry_price;
            return (
              <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--muted)] transition-colors">
                <td className="px-3 py-2 font-bold">{p.ticker}</td>
                <td className="px-3 py-2">
                  <span className={p.direction === "long" ? "badge-long" : "badge-short"}>
                    {p.direction.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{p.quantity.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{p.leverage}x</td>
                <td className="px-3 py-2 text-right">{fmt(p.entry_price)}</td>
                <td className="px-3 py-2 text-right">{fmt(current)}</td>
                <td className={cn("px-3 py-2 text-right font-medium", pnlColor(pnl))}>
                  {pnlStr(pnl, pct)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {estLiq(p.entry_price, p.leverage, p.direction)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        No closed positions yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground border-b border-[var(--border)]">
            <th className="px-3 py-2">Ticker</th>
            <th className="px-3 py-2">Dir</th>
            <th className="px-3 py-2 text-right">Entry</th>
            <th className="px-3 py-2 text-right">Exit</th>
            <th className="px-3 py-2 text-right">P&L</th>
            <th className="px-3 py-2 text-right">Held</th>
            <th className="px-3 py-2 text-right">Closed</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => {
            const pnl = p.realized_pnl ?? 0;
            const pct = p.realized_pnl_pct ?? 0;
            return (
              <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--muted)] transition-colors">
                <td className="px-3 py-2 font-bold">{p.ticker}</td>
                <td className="px-3 py-2">
                  <span className={p.direction === "long" ? "badge-long" : "badge-short"}>
                    {p.direction.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{fmt(p.entry_price)}</td>
                <td className="px-3 py-2 text-right">{fmt(p.exit_price ?? 0)}</td>
                <td className={cn("px-3 py-2 text-right font-medium", pnlColor(pnl))}>
                  {pnlStr(pnl, pct)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">{daysSince(p.opened_at)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {p.closed_at ? new Date(p.closed_at).toLocaleDateString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
