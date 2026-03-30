"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity, DollarSign, TrendingUp, TrendingDown,
  Pause, Play, AlertTriangle, Zap, Target, Clock,
} from "lucide-react";
import { fmtDollarPrice, fmtPctSigned, fmtPrice } from "@/lib/format";

type Position = {
  ticker: string; side: string; entry_price: number; qty: number;
  stop_price: number; target_price: number; entry_time: string; signal_score: number;
};
type Trade = {
  ticker: string; side: string; entry_price: number; exit_price: number;
  qty: number; pnl: number; pnl_pct: number; exit_reason: string;
  entry_time: string; exit_time: string; signal_score: number;
};
type Signal = {
  ticker: string; direction: string; tier3_score: number;
  action: string; created_at: string;
};

function formatET(ts: string): string {
  if (!ts) return "";
  // SQLite stores UTC without 'Z'; ensure proper parsing
  const d = new Date(ts.endsWith("Z") ? ts : ts.includes("+") ? ts : ts + "Z");
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/New_York",
  });
}

export default function AutoTraderPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/autotrader");
      if (res.ok) { setData(await res.json()); setError(false); }
      else setError(true);
    } catch { setError(true); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 30000);
    return () => clearInterval(iv);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading AutoTrader...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-muted-foreground text-sm">Failed to load AutoTrader data</div>
        <button onClick={fetchData} className="btn-primary text-xs px-4 py-2">Retry</button>
      </div>
    );
  }

  const stats = (data?.stats as Record<string, number>) || {};
  const budget = (data?.budget as Record<string, unknown>) || {};
  const positions = (data?.positions as Position[]) || [];
  const trades = (data?.recentTrades as Trade[]) || [];
  const signals = (data?.recentSignals as Signal[]) || [];
  const dailyPnl = (data?.dailyPnl as number) || 0;
  const lastScan = data?.lastScan as Record<string, unknown> | null;

  // Check if autotrader is paused via flag file
  const [atPaused, setAtPaused] = useState<{ active: boolean; reason?: string }>({ active: false });
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/system-health");
        if (res.ok) {
          const d = await res.json();
          setAtPaused(d.autotrader_paused || { active: false });
        }
      } catch { /* ignore */ }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* AutoTrader PAUSED banner */}
      {atPaused.active && (
        <div className="panel border-amber-500/50 bg-amber-500/5 p-4 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">&#x23F8;&#xFE0F;</span>
            <span className="text-sm font-bold neon-amber">AUTOTRADER PAUSED</span>
          </div>
          {atPaused.reason && (
            <p className="text-[11px] text-muted-foreground">{atPaused.reason}</p>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-[rgba(0,240,255,0.1)] border border-[rgba(0,240,255,0.3)]">
            <Zap className="h-4 w-4 neon-text" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-[0.1em] neon-text">AUTOTRADER</h1>
            <p className="text-[10px] text-muted-foreground tracking-wide uppercase">Paper Trading — Alpaca</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastScan && (
            <span className="text-[10px] text-muted-foreground">
              Last scan: {String(lastScan.duration_ms)}ms • {String(lastScan.mode)}
            </span>
          )}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Daily P&L" value={`$${fmtPctSigned(dailyPnl)}`}
          icon={dailyPnl >= 0 ? TrendingUp : TrendingDown}
          color={dailyPnl >= 0 ? "text-green-400" : "text-red-400"} />
        <StatCard label="Win Rate" value={`${stats.winRate || 0}%`}
          icon={Target} color="text-[var(--neon-cyan)]" />
        <StatCard label="Total P&L" value={`$${fmtPctSigned(stats.totalPnl || 0)}`}
          icon={DollarSign}
          color={(stats.totalPnl || 0) >= 0 ? "text-green-400" : "text-red-400"} />
        <StatCard label="Trades" value={String(stats.total || 0)}
          icon={Activity} color="text-[var(--neon-cyan)]"
          sub={`W:${stats.wins || 0} L:${stats.losses || 0}`} />
      </div>

      {/* Budget + Scan Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">API BUDGET</div>
          <div className="flex items-center justify-between">
            <span className="text-xs">
              ${Number(budget.spent || 0).toFixed(4)} / $0.15
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded ${budget.exceeded ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
              {budget.exceeded ? "EXCEEDED" : "OK"}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.05)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budget.exceeded ? "bg-red-500" : "bg-[var(--neon-cyan)]"}`}
              style={{ width: `${Math.min(100, (Number(budget.spent || 0) / 0.15) * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {String(budget.calls || 0)} calls today
          </div>
        </div>

        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">PERFORMANCE</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>Profit Factor: <span className="text-foreground font-mono">{fmtPrice(stats.profitFactor || 0)}</span></div>
            <div>Avg P&L: <span className="text-foreground font-mono">{fmtPctSigned((stats as Record<string, number>).avgPnlPct || 0)}%</span></div>
          </div>
        </div>
      </div>

      {/* Open Positions */}
      <div className="glass rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground">
            OPEN POSITIONS ({positions.length}/5)
          </div>
        </div>
        {positions.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No open positions</div>
        ) : (
          <div className="space-y-1.5">
            {positions.map((p) => (
              <div key={p.ticker} className="flex items-center justify-between py-1.5 px-2 rounded bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)]">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.side === "BUY" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {p.side === "BUY" ? "LONG" : "SHORT"}
                  </span>
                  <span className="text-xs font-bold">{p.ticker}</span>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                  <span>Entry: {fmtDollarPrice(p.entry_price)}</span>
                  <span>Qty: {p.qty}</span>
                  <span className="text-red-400">Stop: {fmtDollarPrice(p.stop_price)}</span>
                  <span className="text-green-400">Target: {fmtDollarPrice(p.target_price)}</span>
                  <span>Score: {p.signal_score?.toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two-Column: Signals + Recent Trades */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Recent Signals */}
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">
            RECENT SIGNALS
          </div>
          {signals.length === 0 ? (
            <div className="text-xs text-muted-foreground py-3 text-center">No signals yet</div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {signals.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1 rounded ${s.action === "EXECUTE" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                      {s.action}
                    </span>
                    <span className="font-bold">{s.ticker}</span>
                    <span className="text-muted-foreground">{s.direction}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{s.tier3_score?.toFixed(0)}/100</span>
                    <span className="text-muted-foreground">{formatET(s.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">
            RECENT TRADES
          </div>
          {trades.length === 0 ? (
            <div className="text-xs text-muted-foreground py-3 text-center">No trades yet</div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {trades.map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className={t.pnl > 0 ? "text-green-400" : t.pnl < 0 ? "text-red-400" : "text-muted-foreground"}>
                      {t.pnl > 0 ? "W" : t.pnl < 0 ? "L" : "S"}
                    </span>
                    <span className="font-bold">{t.ticker}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono ${t.pnl > 0 ? "text-green-400" : t.pnl < 0 ? "text-red-400" : ""}`}>
                      {fmtPctSigned(t.pnl_pct)}%
                    </span>
                    <span className="text-muted-foreground">{fmtDollarPrice(Math.abs(t.pnl || 0))}</span>
                    <span className="text-muted-foreground">{t.exit_reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>;
  color: string; sub?: string;
}) {
  return (
    <div className="glass rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
