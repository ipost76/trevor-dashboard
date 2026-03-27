"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Briefcase, TrendingDown, DollarSign, Layers,
  Plus, Pencil, X, Trash2, BarChart3,
  Eye, EyeOff, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { Panel } from "@/components/ui/panel";
import { StatBlock } from "@/components/ui/stat-block";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { TabBar, type TabDef } from "@/components/ui/tab-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StatStripSkeleton, PanelSkeleton } from "@/components/ui/skeleton";
import { PositionForm } from "@/components/holdings/position-form";
import { CloseDialog } from "@/components/holdings/close-dialog";
import { AllocationChart } from "@/components/holdings/allocation-chart";
import { LeverageWidget } from "@/components/holdings/leverage-widget";

/* ── Types ── */
export type Position = {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  exit_price?: number;
  quantity: number;
  leverage: number;
  asset_type: string;
  status: string;
  notes?: string;
  pnl_pct?: number;
  created_at?: string;
  closed_at?: string;
};

type Analytics = {
  categories: { asset_type: string; count: number; total_value: number }[];
  total_value: number;
  leverage_exposure: number;
  total_pnl_usd: number;
  totals: {
    total: number;
    open: number;
    closed: number;
    winners: number;
    losers: number;
    breakeven: number;
    win_rate: number;
  };
};

type WatchItem = {
  id: number;
  ticker: string;
  priority: string;
  mode: string;
  asset_type: string;
  notes?: string;
};

/* ── Tabs ── */
type TabKey = "all" | "stock_etf" | "crypto_spot" | "crypto_perp" | "watchlist" | "closed";

const TAB_DEFS: TabDef<TabKey>[] = [
  { key: "all", label: "All", icon: Layers },
  { key: "stock_etf", label: "Stocks/ETFs", icon: BarChart3 },
  { key: "crypto_spot", label: "Crypto Spot", icon: DollarSign },
  { key: "crypto_perp", label: "Crypto Perps", icon: TrendingUp },
  { key: "watchlist", label: "Watchlist", icon: Eye },
  { key: "closed", label: "Closed", icon: EyeOff },
];

/* ── Helpers ── */
function calcPnlPct(pos: Position): number {
  if (!pos.exit_price && !pos.pnl_pct) return 0;
  if (pos.pnl_pct !== undefined && pos.pnl_pct !== null) return pos.pnl_pct;
  const exit = pos.exit_price ?? pos.entry_price;
  const dirMult = pos.direction === "long" ? 1 : -1;
  return ((exit - pos.entry_price) / pos.entry_price) * dirMult * (pos.leverage || 1) * 100;
}

function assetTypeLabel(t: string): string {
  const map: Record<string, string> = {
    stock: "Stock",
    etf: "ETF",
    crypto_spot: "Crypto Spot",
    crypto_perp: "Crypto Perp",
    auto: "Auto",
  };
  return map[t] || t;
}

/* ── Page ── */
export default function HoldingsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [tab, setTab] = useState<TabKey>("all");
  const [loading, setLoading] = useState(true);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Partial<Position> | undefined>(undefined);
  const [closeTarget, setCloseTarget] = useState<Position | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    const [pRes, aRes, wRes, tRes] = await Promise.all([
      safeFetch<{ positions?: Position[] }>("/api/portfolio", { positions: [] }),
      safeFetch<Analytics>("/api/portfolio/analytics", {
        categories: [],
        total_value: 0,
        leverage_exposure: 0,
        total_pnl_usd: 0,
        totals: { total: 0, open: 0, closed: 0, winners: 0, losers: 0, breakeven: 0, win_rate: 0 },
      }),
      safeFetch<{ watchlist?: WatchItem[]; items?: WatchItem[] }>("/api/watchlist", {}),
      safeFetch<{ trades?: Array<Record<string, unknown>> }>("/api/trades?scope=active", { trades: [] }),
    ]);
    // Bridge: merge active trades into positions if portfolio is empty
    const portfolioPositions = pRes.positions || [];
    const activeTrades = (tRes.trades || []).map((t, i) => ({
      id: 90000 + i,
      ticker: String(t.ticker || ""),
      direction: String(t.direction || "LONG"),
      entry_price: Number(t.entry_price) || 0,
      quantity: 1,
      leverage: Number(t.leverage) || 1,
      asset_type: "crypto_perp",
      status: "open",
      created_at: String(t.opened_at || ""),
    })) as Position[];
    setPositions(portfolioPositions.length > 0 ? portfolioPositions : activeTrades);
    setAnalytics(aRes);
    setWatchlist(wRes.watchlist || wRes.items || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  /* ── Mutations ── */
  const addPosition = async (body: Record<string, unknown>) => {
    await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchAll();
  };

  const updatePosition = async (body: Record<string, unknown>) => {
    await fetch("/api/portfolio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchAll();
  };

  const closePosition = async (id: number, exitPrice: number) => {
    await fetch(`/api/portfolio/${id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exit_price: exitPrice }),
    });
    setCloseTarget(null);
    fetchAll();
  };

  const removePosition = async (id: number) => {
    await fetch("/api/portfolio", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setRemoveConfirm(null);
    fetchAll();
  };

  /* ── Derived data ── */
  const openPositions = positions.filter((p) => p.status !== "closed");
  const closedPositions = positions.filter((p) => p.status === "closed");

  const filtered = (() => {
    switch (tab) {
      case "all":
        return openPositions;
      case "stock_etf":
        return openPositions.filter(
          (p) => p.asset_type === "stock" || p.asset_type === "etf"
        );
      case "crypto_spot":
        return openPositions.filter((p) => p.asset_type === "crypto_spot");
      case "crypto_perp":
        return openPositions.filter((p) => p.asset_type === "crypto_perp");
      case "closed":
        return closedPositions;
      case "watchlist":
        return []; // handled separately
      default:
        return openPositions;
    }
  })();

  const unrealizedPnl = openPositions.reduce((sum, p) => sum + calcPnlPct(p), 0);
  const realizedPnl = closedPositions.reduce((sum, p) => sum + calcPnlPct(p), 0);

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="flex-1 overflow-hidden p-2 flex flex-col gap-2">
        <StatStripSkeleton />
        <div className="grid grid-cols-2 gap-2 flex-1">
          <PanelSkeleton title="ALLOCATION" />
          <PanelSkeleton title="LEVERAGE EXPOSURE" />
        </div>
        <PanelSkeleton title="POSITIONS" />
      </div>
    );
  }

  const totals = analytics?.totals ?? {
    total: 0,
    open: 0,
    closed: 0,
    winners: 0,
    losers: 0,
    breakeven: 0,
    win_rate: 0,
  };

  return (
    <div className="flex-1 overflow-auto p-2 flex flex-col gap-2">
      {/* ── Summary Stats ── */}
      <div className="panel shrink-0">
        <div className="flex items-center gap-5 px-3 py-1.5 flex-wrap">
          <StatBlock
            label="Total Positions"
            value={String(totals.total)}
            sub={`${totals.open} open / ${totals.closed} closed`}
            color="neon-text"
          />
          <StatBlock
            label="Unrealized P&L"
            value={
              openPositions.length > 0
                ? `${unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}%`
                : "--"
            }
            color={
              openPositions.length === 0
                ? "text-muted-foreground"
                : unrealizedPnl >= 0
                ? "neon-green"
                : "neon-red"
            }
            sub="sum of open P&L%"
          />
          <StatBlock
            label="Open Positions"
            value={String(totals.open)}
            color="neon-text"
          />
          <StatBlock
            label="Realized P&L"
            value={
              totals.closed > 0
                ? `${realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}%`
                : "--"
            }
            color={
              totals.closed === 0
                ? "text-muted-foreground"
                : realizedPnl >= 0
                ? "neon-green"
                : "neon-red"
            }
            sub={
              totals.closed > 0
                ? `${totals.winners}W ${totals.losers}L (${totals.win_rate.toFixed(0)}%)`
                : "no closed trades"
            }
          />
        </div>
      </div>

      {/* ── Analytics Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 shrink-0">
        <Panel title="ALLOCATION" className="min-h-[200px]">
          {openPositions.length > 0 ? (
            <AllocationChart positions={openPositions} />
          ) : (
            <EmptyState icon={BarChart3} message="No open positions to chart" />
          )}
        </Panel>
        <Panel title="LEVERAGE EXPOSURE">
          <LeverageWidget positions={openPositions} />
        </Panel>
      </div>

      {/* ── Tab Bar + Table ── */}
      <div className="panel flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center justify-between pr-2">
          <TabBar tabs={TAB_DEFS} active={tab} onChange={setTab} />
          <button
            onClick={() => {
              setEditTarget(undefined);
              setFormOpen(true);
            }}
            className="btn-primary flex items-center gap-1 shrink-0"
          >
            <Plus className="h-3 w-3" /> Add Position
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {tab === "watchlist" ? (
            /* ── Watchlist view ── */
            watchlist.length === 0 ? (
              <EmptyState icon={Eye} message="Watchlist is empty" sub="Add tickers from the Trades page" />
            ) : (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
                  <span className="w-20">Ticker</span>
                  <span className="w-16">Mode</span>
                  <span className="w-20">Type</span>
                  <span className="w-16">Priority</span>
                  <span className="flex-1">Notes</span>
                </div>
                {watchlist.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)] transition-colors"
                  >
                    <span className="w-20 font-bold text-foreground truncate">
                      {w.ticker}
                    </span>
                    <span className="w-16">
                      <span
                        className={cn(
                          "text-[9px] px-1.5 rounded border",
                          w.mode === "scalp"
                            ? "bg-[rgba(255,0,255,0.08)] text-[var(--neon-magenta)] border-[rgba(255,0,255,0.2)]"
                            : "bg-[rgba(0,240,255,0.08)] text-[var(--neon-cyan)] border-[rgba(0,240,255,0.2)]"
                        )}
                      >
                        {w.mode === "scalp" ? "SCALP" : "LT"}
                      </span>
                    </span>
                    <span className="w-20 text-[10px] text-muted-foreground">
                      {w.asset_type}
                    </span>
                    <span className="w-16 text-[10px] text-muted-foreground">
                      {w.priority}
                    </span>
                    <span className="flex-1 text-[10px] text-muted-foreground truncate">
                      {w.notes || "--"}
                    </span>
                  </div>
                ))}
              </>
            )
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              message={
                tab === "closed"
                  ? "No closed positions"
                  : "No positions in this category"
              }
              sub="Click + Add Position to get started"
            />
          ) : (
            /* ── Position table ── */
            <>
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
                <span className="w-20">Ticker</span>
                <span className="w-14">Dir</span>
                <span className="w-12 text-right">Qty</span>
                <span className="w-20 text-right">Entry</span>
                <span className="w-20 text-right">
                  {tab === "closed" ? "Exit" : "Current"}
                </span>
                <span className="w-16 text-right">P&L%</span>
                <span className="w-10 text-right">Lev</span>
                <span className="w-20">Type</span>
                <span className="flex-1 text-right">Actions</span>
              </div>
              {filtered.map((p) => {
                const pnl = calcPnlPct(p);
                const displayPrice =
                  tab === "closed" ? p.exit_price : undefined;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)] transition-colors group"
                  >
                    <span className="w-20 font-bold text-foreground truncate">
                      {p.ticker}
                    </span>
                    <span className="w-14">
                      <DirectionBadge dir={p.direction} />
                    </span>
                    <span className="w-12 text-right font-mono text-muted-foreground">
                      {p.quantity}
                    </span>
                    <span className="w-20 text-right font-mono text-muted-foreground">
                      ${p.entry_price.toFixed(2)}
                    </span>
                    <span className="w-20 text-right font-mono text-muted-foreground">
                      {displayPrice !== undefined
                        ? `$${displayPrice.toFixed(2)}`
                        : "--"}
                    </span>
                    <span
                      className={cn(
                        "w-16 text-right font-bold font-mono",
                        pnl > 0
                          ? "neon-green"
                          : pnl < 0
                          ? "neon-red"
                          : "text-muted-foreground"
                      )}
                    >
                      {pnl !== 0
                        ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`
                        : "--"}
                    </span>
                    <span className="w-10 text-right text-[10px] text-muted-foreground">
                      {p.leverage > 1 ? (
                        <span className="neon-amber">{p.leverage}x</span>
                      ) : (
                        `${p.leverage}x`
                      )}
                    </span>
                    <span className="w-20 text-[10px] text-muted-foreground truncate">
                      {assetTypeLabel(p.asset_type)}
                    </span>
                    <span className="flex-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {p.status !== "closed" && (
                        <>
                          <button
                            onClick={() => {
                              setEditTarget(p);
                              setFormOpen(true);
                            }}
                            className="p-1 rounded hover:bg-[rgba(0,240,255,0.08)] text-muted-foreground hover:text-[var(--neon-cyan)] transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setCloseTarget(p)}
                            className="p-1 rounded hover:bg-[rgba(0,255,136,0.08)] text-muted-foreground hover:text-[var(--neon-green)] transition-colors"
                            title="Close"
                          >
                            <TrendingDown className="h-3 w-3" />
                          </button>
                        </>
                      )}
                      {removeConfirm === p.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => removePosition(p.id)}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(255,51,102,0.15)] text-[var(--neon-red)] border border-[rgba(255,51,102,0.3)] hover:bg-[rgba(255,51,102,0.25)] transition-colors"
                          >
                            CONFIRM
                          </button>
                          <button
                            onClick={() => setRemoveConfirm(null)}
                            className="p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRemoveConfirm(p.id)}
                          className="p-1 rounded hover:bg-[rgba(255,51,102,0.08)] text-muted-foreground hover:text-[var(--neon-red)] transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      <PositionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(undefined);
        }}
        onSave={async (data) => {
          if (editTarget?.id) {
            await updatePosition({ id: editTarget.id, ...data });
          } else {
            await addPosition(data);
          }
          setFormOpen(false);
          setEditTarget(undefined);
        }}
        initial={editTarget}
      />

      {closeTarget && (
        <CloseDialog
          open={!!closeTarget}
          onClose={() => setCloseTarget(null)}
          onConfirm={(exitPrice) => closePosition(closeTarget.id, exitPrice)}
          position={closeTarget}
        />
      )}
    </div>
  );
}
