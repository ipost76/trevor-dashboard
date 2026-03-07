"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeftRight, TrendingUp, RefreshCw, Plus, Trash2,
  ChevronLeft, ChevronRight, Filter, Target
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type HistoryTrade = {
  id: number; ticker: string; direction: string; entry_price: number; exit_price: number;
  pnl_pct: number; leveraged_pnl_pct?: number; leverage?: number;
  exit_reason: string; created_at: string;
};
type WatchItem = {
  id: number; ticker: string; reason?: string; priority: number;
  mode: string; asset_type: string; notes?: string; added_at?: string;
};
type TradeStats = {
  total: number; wins: number; losses: number; scratches: number;
  winRate: number; avgPnl: number; totalPnl: number;
};

export default function TradesPage() {
  const [tab, setTab] = useState<"active" | "history" | "watchlist">("active");
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [history, setHistory] = useState<HistoryTrade[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [histPage, setHistPage] = useState(1);
  const [histTotal, setHistTotal] = useState(0);
  const [newTicker, setNewTicker] = useState("");
  const [newMode, setNewMode] = useState("scalp");
  const pageSize = 25;

  const fetchData = useCallback(async () => {
    setLoading(true);
    if (tab === "active") {
      const d = await safeFetch<{ trades?: unknown[]; stats?: TradeStats }>("/api/trades?scope=active", {});
      setStats(d.stats || null);
    } else if (tab === "history") {
      const offset = (histPage - 1) * pageSize;
      const d = await safeFetch<{ records?: HistoryTrade[]; total?: number }>(
        `/api/trades?scope=history&limit=${pageSize}&offset=${offset}`, {}
      );
      setHistory(d.records || []);
      setHistTotal(d.total || 0);
    } else {
      const d = await safeFetch<{ items?: WatchItem[] }>("/api/trades?scope=watchlist", {});
      setWatchlist(d.items || []);
    }
    setLoading(false);
  }, [tab, histPage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addToWatchlist = async () => {
    if (!newTicker.trim()) return;
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: newTicker.toUpperCase(), mode: newMode }),
    });
    setNewTicker("");
    fetchData();
  };

  const removeFromWatchlist = async (id: number) => {
    await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
    fetchData();
  };

  const tabs = [
    { key: "active" as const, label: "OVERVIEW", icon: TrendingUp },
    { key: "history" as const, label: "HISTORY", icon: ArrowLeftRight },
    { key: "watchlist" as const, label: "WATCHLIST", icon: Filter },
  ];

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="panel h-full flex flex-col">
        <div className="flex items-center border-b border-[var(--border)] bg-[var(--panel-header)]">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors border-b-2",
                  tab === t.key
                    ? "text-[var(--neon-cyan)] border-[var(--neon-cyan)]"
                    : "text-muted-foreground border-transparent hover:text-foreground"
                )}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex-1 p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-7 rounded bg-[rgba(0,240,255,0.03)] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {tab === "active" && (
              <div className="p-3 space-y-4">
                {stats ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="panel p-3"><div className="stat-label">Total Trades</div><div className="stat-value neon-text mt-1">{stats.total}</div></div>
                    <div className="panel p-3"><div className="stat-label">Win Rate</div><div className={cn("stat-value mt-1", stats.winRate >= 50 ? "neon-green" : "neon-red")}>{stats.winRate}%</div></div>
                    <div className="panel p-3"><div className="stat-label">Wins / Losses</div><div className="stat-value mt-1"><span className="neon-green">{stats.wins}W</span> <span className="neon-red">{stats.losses}L</span> <span className="text-muted-foreground text-xs">{stats.scratches}S</span></div></div>
                    <div className="panel p-3"><div className="stat-label">Total P&L</div><div className={cn("stat-value mt-1", stats.totalPnl >= 0 ? "neon-green" : "neon-red")}>{stats.totalPnl >= 0 ? "+" : ""}{stats.totalPnl.toFixed(2)}%</div></div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <Target className="h-6 w-6 opacity-20" />
                    <span className="text-[11px]">No trade data available</span>
                  </div>
                )}
              </div>
            )}

            {tab === "history" && (
              <>
                <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
                  <span className="w-16">Ticker</span>
                  <span className="w-12">Dir</span>
                  <span className="w-16 text-right">Entry</span>
                  <span className="w-16 text-right">Exit</span>
                  <span className="w-14 text-right">P&L</span>
                  <span className="w-10 text-right">Lev</span>
                  <span className="flex-1 text-right">Exit Reason</span>
                  <span className="w-20 text-right">Date</span>
                </div>
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <ArrowLeftRight className="h-6 w-6 opacity-20" />
                    <span className="text-[11px]">No trade history</span>
                  </div>
                ) : (
                  history.map((t, i) => {
                    const pnl = t.leveraged_pnl_pct ?? t.pnl_pct;
                    return (
                      <div key={t.id || i} className={cn(
                        "flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]",
                        i % 2 === 0 ? "bg-[#0e0f18]" : "bg-[#12131a]"
                      )}>
                        <span className="w-16 font-bold truncate">{t.ticker}</span>
                        <span className="w-12">
                          <span className={t.direction?.toLowerCase() === "long" ? "badge-long" : "badge-short"}>
                            {t.direction?.toUpperCase()}
                          </span>
                        </span>
                        <span className="w-16 text-right font-mono text-muted-foreground">${t.entry_price?.toFixed(2)}</span>
                        <span className="w-16 text-right font-mono text-muted-foreground">{t.exit_price ? `$${t.exit_price.toFixed(2)}` : "-"}</span>
                        <span className={cn("w-14 text-right font-bold font-mono", pnl >= 0 ? "neon-green" : "neon-red")}>
                          {pnl >= 0 ? "+" : ""}{pnl?.toFixed(2)}%
                        </span>
                        <span className="w-10 text-right text-[10px] text-muted-foreground">{t.leverage || 1}x</span>
                        <span className="flex-1 text-right text-[10px] text-muted-foreground truncate">{t.exit_reason}</span>
                        <span className="w-20 text-right text-[10px] text-muted-foreground">
                          {t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}
                        </span>
                      </div>
                    );
                  })
                )}
                {histTotal > pageSize && (
                  <div className="flex items-center justify-center gap-3 py-2 border-t border-[var(--border)]">
                    <button onClick={() => setHistPage(p => Math.max(1, p - 1))} disabled={histPage <= 1} className="btn-primary disabled:opacity-30">
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <span className="text-[10px] text-muted-foreground">
                      {histPage} / {Math.ceil(histTotal / pageSize)}
                    </span>
                    <button onClick={() => setHistPage(p => p + 1)} disabled={histPage >= Math.ceil(histTotal / pageSize)} className="btn-primary disabled:opacity-30">
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </>
            )}

            {tab === "watchlist" && (
              <div className="p-2">
                <div className="flex items-center gap-2 mb-3">
                  <input value={newTicker} onChange={e => setNewTicker(e.target.value)} placeholder="TICKER" className="input-terminal w-32" onKeyDown={e => e.key === "Enter" && addToWatchlist()} />
                  <select value={newMode} onChange={e => setNewMode(e.target.value)} className="input-terminal">
                    <option value="scalp">Scalp</option>
                    <option value="lt">Long Term</option>
                  </select>
                  <button onClick={addToWatchlist} className="btn-primary flex items-center gap-1"><Plus className="h-3 w-3" /> ADD</button>
                </div>
                {watchlist.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <Filter className="h-6 w-6 opacity-20" />
                    <span className="text-[11px]">Watchlist is empty</span>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {watchlist.map(w => (
                      <div key={w.id} className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]">
                        <span className="font-bold w-20">{w.ticker}</span>
                        <span className={cn("text-[9px] px-1.5 rounded border",
                          w.mode === "scalp" ? "bg-[rgba(255,0,255,0.08)] text-[var(--neon-magenta)] border-[rgba(255,0,255,0.2)]"
                            : "bg-[rgba(0,240,255,0.08)] text-[var(--neon-cyan)] border-[rgba(0,240,255,0.2)]"
                        )}>{w.mode === "scalp" ? "SCALP" : "LT"}</span>
                        <span className="text-[10px] text-muted-foreground flex-1">{w.asset_type} | {w.reason || ""}</span>
                        <button onClick={() => removeFromWatchlist(w.id)} className="text-muted-foreground hover:text-[var(--neon-red)] transition-colors">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
