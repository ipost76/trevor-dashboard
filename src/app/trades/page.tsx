"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeftRight, TrendingUp, Plus, Trash2, Pencil, Check, X,
  ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronExpand,
  Filter, Target, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type HistoryTrade = {
  id: number; ticker: string; direction: string; entry_price: number; exit_price: number;
  pnl_pct: number; leveraged_pnl_pct?: number; leverage?: number;
  exit_reason: string; created_at: string;
};
type TradeStats = {
  total: number; wins: number; losses: number; scratches: number;
  winRate: number; avgPnl: number; totalPnl: number;
};
type WatchItem = {
  id: number; ticker: string; strategy: string; category: string;
  description: string; asset_type: string; original_reason: string;
  priority: number; hasJunkDescription: boolean;
};
type CategoryInfo = { label: string; count: number };

const CATEGORY_ORDER = ["crypto_perp", "crypto_spot", "equity", "etf", "speculative"];
const CATEGORY_COLORS: Record<string, string> = {
  crypto_perp: "text-[var(--neon-red)]",
  crypto_spot: "text-[var(--neon-cyan)]",
  equity: "text-[var(--neon-green)]",
  etf: "text-[var(--neon-amber)]",
  speculative: "text-[#a855f7]",
};

export default function TradesPage() {
  const [tab, setTab] = useState<"active" | "history" | "watchlist">("active");
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [history, setHistory] = useState<HistoryTrade[]>([]);
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
  const [watchCategories, setWatchCategories] = useState<Record<string, CategoryInfo>>({});
  const [loading, setLoading] = useState(true);
  const [histPage, setHistPage] = useState(1);
  const [histTotal, setHistTotal] = useState(0);

  // Watchlist add form
  const [newTicker, setNewTicker] = useState("");
  const [newCategory, setNewCategory] = useState("equity");
  const [newMode, setNewMode] = useState("lt");
  const [newDesc, setNewDesc] = useState("");

  // Inline editing
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savedTicker, setSavedTicker] = useState<string | null>(null);

  // Collapsed groups
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // Cleanup
  const [cleanupCount, setCleanupCount] = useState<number | null>(null);

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
      const d = await safeFetch<{ items?: WatchItem[]; categories?: Record<string, CategoryInfo> }>(
        "/api/watchlist/meta", {}
      );
      setWatchItems(d.items || []);
      setWatchCategories(d.categories || {});
    }
    setLoading(false);
  }, [tab, histPage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hasJunkDescriptions = watchItems.some(w => w.hasJunkDescription);

  const addToWatchlist = async () => {
    if (!newTicker.trim()) return;
    const ticker = newTicker.toUpperCase().trim();
    // Add to trevor.db via existing endpoint
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, mode: newMode }),
    });
    // Save metadata
    await fetch("/api/watchlist/meta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, category: newCategory, description: newDesc || undefined }),
    });
    setNewTicker("");
    setNewDesc("");
    fetchData();
  };

  const removeFromWatchlist = async (id: number, ticker: string) => {
    await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    fetchData();
  };

  const saveDescription = async (ticker: string) => {
    await fetch("/api/watchlist/meta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, description: editValue }),
    });
    setEditingTicker(null);
    setSavedTicker(ticker);
    setTimeout(() => setSavedTicker(null), 1500);
    fetchData();
  };

  const runCleanup = async () => {
    const res = await fetch("/api/watchlist/meta", { method: "POST" });
    const data = await res.json();
    setCleanupCount(data.cleaned || 0);
    setTimeout(() => setCleanupCount(null), 3000);
    fetchData();
  };

  const toggleGroup = (cat: string) => {
    setCollapsed(c => ({ ...c, [cat]: !c[cat] }));
  };

  // Group watchlist items by category
  const grouped = CATEGORY_ORDER
    .filter(cat => watchItems.some(w => w.category === cat))
    .map(cat => ({
      category: cat,
      label: watchCategories[cat]?.label || cat,
      count: watchCategories[cat]?.count || watchItems.filter(w => w.category === cat).length,
      items: watchItems.filter(w => w.category === cat),
    }));

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
            {/* ===== ACTIVE TAB ===== */}
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

            {/* ===== HISTORY TAB ===== */}
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
                      <div key={t.id || i} className={cn("flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]", i % 2 === 0 ? "bg-[#0e0f18]" : "bg-[#12131a]")}>
                        <span className="w-16 font-bold truncate">{t.ticker}</span>
                        <span className="w-12"><span className={t.direction?.toLowerCase() === "long" ? "badge-long" : "badge-short"}>{t.direction?.toUpperCase()}</span></span>
                        <span className="w-16 text-right font-mono text-muted-foreground">${t.entry_price?.toFixed(2)}</span>
                        <span className="w-16 text-right font-mono text-muted-foreground">{t.exit_price ? `$${t.exit_price.toFixed(2)}` : "-"}</span>
                        <span className={cn("w-14 text-right font-bold font-mono", pnl >= 0 ? "neon-green" : "neon-red")}>{pnl >= 0 ? "+" : ""}{pnl?.toFixed(2)}%</span>
                        <span className="w-10 text-right text-[10px] text-muted-foreground">{t.leverage || 1}x</span>
                        <span className="flex-1 text-right text-[10px] text-muted-foreground truncate">{t.exit_reason}</span>
                        <span className="w-20 text-right text-[10px] text-muted-foreground">{t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}</span>
                      </div>
                    );
                  })
                )}
                {histTotal > pageSize && (
                  <div className="flex items-center justify-center gap-3 py-2 border-t border-[var(--border)]">
                    <button onClick={() => setHistPage(p => Math.max(1, p - 1))} disabled={histPage <= 1} className="btn-primary disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                    <span className="text-[10px] text-muted-foreground">{histPage} / {Math.ceil(histTotal / pageSize)}</span>
                    <button onClick={() => setHistPage(p => p + 1)} disabled={histPage >= Math.ceil(histTotal / pageSize)} className="btn-primary disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                  </div>
                )}
              </>
            )}

            {/* ===== WATCHLIST TAB ===== */}
            {tab === "watchlist" && (
              <div className="p-2 space-y-1">
                {/* Header with cleanup */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{watchItems.length} tickers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {cleanupCount !== null && (
                      <span className="text-[10px] neon-green animate-in fade-in">Cleaned {cleanupCount} descriptions</span>
                    )}
                    {hasJunkDescriptions && (
                      <button onClick={runCleanup} className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground border border-[var(--border)] rounded px-2 py-1 transition-colors">
                        <Sparkles className="h-3 w-3" />
                        Clean Up
                      </button>
                    )}
                  </div>
                </div>

                {/* Grouped items */}
                {grouped.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <Filter className="h-6 w-6 opacity-20" />
                    <span className="text-[11px]">Watchlist is empty</span>
                  </div>
                ) : (
                  grouped.map(group => (
                    <div key={group.category} className="mb-1">
                      {/* Category Header */}
                      <button
                        onClick={() => toggleGroup(group.category)}
                        className="flex items-center gap-2 w-full py-1.5 px-1 text-left group"
                      >
                        {collapsed[group.category]
                          ? <ChevronExpand className="h-3 w-3 text-muted-foreground" />
                          : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground opacity-60" style={{ fontFamily: "var(--font-display)" }}>
                          {group.label}
                        </span>
                        <span className="text-[9px] text-muted-foreground opacity-40">{group.count}</span>
                      </button>

                      {/* Items */}
                      {!collapsed[group.category] && group.items.map((w, i) => (
                        <div key={w.id} className={cn(
                          "flex items-center gap-2 py-1.5 px-2 rounded-sm group/row transition-colors",
                          i % 2 === 0 ? "bg-[#0e0f18]" : "bg-[#12131a]",
                          "hover:bg-[rgba(0,240,255,0.03)]"
                        )}>
                          {/* Ticker */}
                          <span className="font-bold text-[11px] w-24 truncate">{w.ticker}</span>

                          {/* Strategy pill */}
                          <span className={cn("text-[8px] px-1.5 py-0 rounded border font-bold uppercase",
                            w.strategy === "scalp"
                              ? "bg-[rgba(255,0,255,0.08)] text-[var(--neon-magenta)] border-[rgba(255,0,255,0.2)]"
                              : "bg-[rgba(0,212,255,0.08)] text-[var(--neon-cyan)] border-[rgba(0,212,255,0.2)]"
                          )}>
                            {w.strategy === "scalp" ? "SCALP" : "LT"}
                          </span>

                          {/* Asset type */}
                          <span className={cn("text-[9px] w-10", CATEGORY_COLORS[w.category] || "text-muted-foreground")}>
                            {w.asset_type}
                          </span>

                          {/* Description (inline editable) */}
                          <div className="flex-1 min-w-0">
                            {editingTicker === w.ticker ? (
                              <div className="flex items-center gap-1">
                                <input
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") saveDescription(w.ticker);
                                    if (e.key === "Escape") setEditingTicker(null);
                                  }}
                                  autoFocus
                                  className="input-terminal flex-1 text-[10px] py-0.5 px-1"
                                />
                                <button onClick={() => saveDescription(w.ticker)} className="text-[var(--neon-green)]"><Check className="h-3 w-3" /></button>
                                <button onClick={() => setEditingTicker(null)} className="text-muted-foreground"><X className="h-3 w-3" /></button>
                              </div>
                            ) : (
                              <span className={cn(
                                "text-[10px] truncate block",
                                savedTicker === w.ticker ? "neon-green" : "text-muted-foreground"
                              )}>
                                {savedTicker === w.ticker ? "Saved!" : w.description}
                              </span>
                            )}
                          </div>

                          {/* Action icons */}
                          <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity" style={{ opacity: undefined }}>
                            <button
                              onClick={() => { setEditingTicker(w.ticker); setEditValue(w.description); }}
                              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                              title="Edit description"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            {confirmDelete === w.id ? (
                              <span className="flex items-center gap-1 text-[9px]">
                                <span className="text-[var(--neon-red)]">Remove?</span>
                                <button onClick={() => removeFromWatchlist(w.id, w.ticker)} className="text-[var(--neon-red)] font-bold">Y</button>
                                <button onClick={() => setConfirmDelete(null)} className="text-muted-foreground">N</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(w.id)}
                                className="text-muted-foreground hover:text-[var(--neon-red)] transition-colors p-0.5"
                                title="Remove from watchlist"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}

                {/* Add Form */}
                <div className="border-t border-[var(--border)] pt-3 mt-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2" style={{ fontFamily: "var(--font-display)" }}>
                    Add Ticker
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={newTicker}
                      onChange={e => setNewTicker(e.target.value.toUpperCase())}
                      placeholder="TICKER"
                      className="input-terminal w-28"
                      onKeyDown={e => e.key === "Enter" && addToWatchlist()}
                    />
                    <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className="input-terminal text-[10px]">
                      <option value="crypto_perp">Crypto Perp</option>
                      <option value="crypto_spot">Crypto Spot</option>
                      <option value="equity">Equity</option>
                      <option value="etf">ETF</option>
                      <option value="speculative">Speculative</option>
                    </select>
                    <select value={newMode} onChange={e => setNewMode(e.target.value)} className="input-terminal text-[10px]">
                      <option value="scalp">Scalp</option>
                      <option value="lt">Long Term</option>
                    </select>
                    <input
                      value={newDesc}
                      onChange={e => setNewDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className="input-terminal flex-1 min-w-[120px]"
                    />
                    <button onClick={addToWatchlist} className="btn-primary flex items-center gap-1">
                      <Plus className="h-3 w-3" /> ADD
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
