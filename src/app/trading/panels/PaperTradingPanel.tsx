"use client";

import { useEffect, useState, useCallback } from "react";
import { StyledLineChart } from "@/components/charts/StyledLineChart";

/* ─── Types ─────────────────────────────────────────────── */

type OpenTrade = {
  id: number;
  signal_id: number | null;
  ticker: string;
  direction: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  leverage: number;
  confidence: number;
  position_size_usd: number;
  margin_usd: number;
  regime: string | null;
  opened_at: string;
  entry_slippage_bps: number | null;
};

type ClosedTrade = {
  id: number;
  ticker: string;
  direction: string;
  confidence: number;
  leverage: number;
  entry_price: number;
  exit_price: number;
  exit_reason: string;
  raw_pnl_pct: number;
  leveraged_pnl_pct: number;
  net_pnl_usd: number;
  fees_bps: number;
  hold_minutes: number;
  opened_at: string;
  closed_at: string;
  regime: string | null;
};

type TickerRow = { ticker: string; n: number; wins: number; pnl: number; avg_pct: number };
type ConfRow = { bucket: string; n: number; wins: number; pnl: number; avg_pct: number };
type RegimeRow = { regime: string; n: number; wins: number; pnl: number };
type EqPoint = { id: number; closed_at: string; equity: number };

type PaperData = {
  enabled: boolean;
  starting_equity: number;
  equity: number;
  total_pnl_usd: number;
  closed_positions: number;
  open_positions: number;
  wins: number;
  losses: number;
  win_rate: number;
  position_size_usd: number;
  max_concurrent: number;
  max_daily: number;
  open_trades: OpenTrade[];
  recent_closed: ClosedTrade[];
  by_ticker: TickerRow[];
  by_confidence_bucket: ConfRow[];
  by_regime: RegimeRow[];
  equity_curve: EqPoint[];
  error?: string;
};

/* ─── Helpers ───────────────────────────────────────────── */

function fmtPx(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtPct(v: number, dp = 2): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

function fmtDollar(v: number): string {
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
}

function fmtHold(mins: number): string {
  if (!mins) return "0m";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins - h * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function pnlColor(v: number): string {
  return v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-muted-foreground";
}

function wrColor(wr: number): string {
  if (wr >= 55) return "text-green-400";
  if (wr >= 40) return "text-yellow-400";
  return "text-red-400";
}

/* ─── Component ─────────────────────────────────────────── */

export default function PaperTradingPanel() {
  const [data, setData] = useState<PaperData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const resp = await fetch("/api/paper", { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const j = (await resp.json()) as PaperData;
      setData(j);
      setError(j.error || null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 30_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  if (loading) {
    return <div className="p-6 text-muted-foreground font-mono">Loading paper trading data…</div>;
  }

  if (error && !data) {
    return <div className="p-6 text-red-400 font-mono">Paper data error: {error}</div>;
  }

  if (!data) return null;

  const pnlPct = data.starting_equity ? (data.total_pnl_usd / data.starting_equity) * 100 : 0;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header + status badge */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-display text-[#00ff88]">📄 PAPER TRADING</h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Shadow data-acquisition — zero real capital at risk. Pure simulation via Hyperliquid L2 book.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`px-3 py-1.5 rounded border font-mono text-xs ${
              data.enabled
                ? "bg-[#00ff88]/10 border-[#00ff88] text-[#00ff88]"
                : "bg-gray-800/40 border-gray-600 text-gray-400"
            }`}
          >
            {data.enabled ? "● ENABLED" : "○ DISABLED"}
          </div>
        </div>
      </div>

      {/* Equity hero + stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-[#1e2030] bg-[#12131a] rounded p-3">
          <div className="text-[10px] text-muted-foreground uppercase font-display">Equity</div>
          <div className="text-2xl font-display text-[#e8e8f0]">${data.equity.toFixed(2)}</div>
          <div className={`text-xs font-mono ${pnlColor(pnlPct)}`}>{fmtPct(pnlPct)}</div>
        </div>
        <div className="border border-[#1e2030] bg-[#12131a] rounded p-3">
          <div className="text-[10px] text-muted-foreground uppercase font-display">Total P&amp;L</div>
          <div className={`text-2xl font-display ${pnlColor(data.total_pnl_usd)}`}>
            {fmtDollar(data.total_pnl_usd)}
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            start: ${data.starting_equity.toFixed(0)}
          </div>
        </div>
        <div className="border border-[#1e2030] bg-[#12131a] rounded p-3">
          <div className="text-[10px] text-muted-foreground uppercase font-display">Win Rate</div>
          <div className={`text-2xl font-display ${wrColor(data.win_rate)}`}>
            {data.win_rate.toFixed(1)}%
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {data.wins}W · {data.losses}L
          </div>
        </div>
        <div className="border border-[#1e2030] bg-[#12131a] rounded p-3">
          <div className="text-[10px] text-muted-foreground uppercase font-display">Positions</div>
          <div className="text-2xl font-display text-[#e8e8f0]">
            {data.open_positions} / {data.closed_positions}
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            open / closed
          </div>
        </div>
      </div>

      {/* Equity curve */}
      {data.equity_curve.length > 1 && (
        <div className="border border-[#1e2030] bg-[#12131a] rounded p-3">
          <div className="text-xs font-display text-muted-foreground uppercase mb-2">Equity Curve</div>
          <StyledLineChart
            data={data.equity_curve.map((p, i) => ({ trade: i + 1, equity: p.equity }))}
            xKey="trade"
            lines={[{ dataKey: "equity", color: "#00ff88", name: "Equity" }]}
            height={160}
            showArea={true}
          />
        </div>
      )}

      {/* Open positions */}
      <div>
        <div className="text-xs font-display text-muted-foreground uppercase mb-2">
          Open Positions ({data.open_trades.length})
        </div>
        {data.open_trades.length === 0 ? (
          <div className="border border-dashed border-[#1e2030] rounded p-4 text-center text-xs text-muted-foreground font-mono">
            No open paper positions. Enable via <code className="bg-[#1e2030] px-1 rounded">!paper on</code> in #qa-agent.
          </div>
        ) : (
          <div className="space-y-2">
            {data.open_trades.map((t) => (
              <div key={t.id} className="border border-[#1e2030] bg-[#12131a] rounded p-3 font-mono text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-[#00ff88] font-display">#{t.id}</span>{" "}
                    <span className={t.direction === "LONG" ? "text-green-400" : "text-red-400"}>
                      {t.ticker} {t.direction}
                    </span>{" "}
                    <span className="text-muted-foreground">{t.leverage}x · conf {t.confidence.toFixed(1)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Entry: ${fmtPx(t.entry_price)}{" "}
                    {t.entry_slippage_bps != null && (
                      <span className="text-[10px]">({t.entry_slippage_bps >= 0 ? "+" : ""}{t.entry_slippage_bps.toFixed(1)}bps)</span>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Stop: ${fmtPx(t.stop_price)} · Target: ${fmtPx(t.target_price)} · Size: ${t.position_size_usd.toFixed(0)} · Margin: ${t.margin_usd.toFixed(0)}
                  {t.regime && <span> · {t.regime}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* By confidence bucket (critical for Optuna) */}
      {data.by_confidence_bucket.length > 0 && (
        <div>
          <div className="text-xs font-display text-muted-foreground uppercase mb-2">
            Win Rate by Confidence Bucket
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {data.by_confidence_bucket.map((b) => {
              const wr = b.n ? (b.wins / b.n) * 100 : 0;
              return (
                <div key={b.bucket} className="border border-[#1e2030] bg-[#12131a] rounded p-3">
                  <div className="text-[10px] text-muted-foreground uppercase font-display">conf {b.bucket}</div>
                  <div className={`text-lg font-display ${wrColor(wr)}`}>{wr.toFixed(0)}%</div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {b.n} trades · {fmtDollar(b.pnl)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By ticker */}
      {data.by_ticker.length > 0 && (
        <div>
          <div className="text-xs font-display text-muted-foreground uppercase mb-2">By Ticker</div>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-[#1e2030]">
                  <th className="text-left py-1.5 pr-3">Ticker</th>
                  <th className="text-right py-1.5 pr-3">Trades</th>
                  <th className="text-right py-1.5 pr-3">WR</th>
                  <th className="text-right py-1.5 pr-3">Avg%</th>
                  <th className="text-right py-1.5">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {data.by_ticker.map((r) => {
                  const wr = r.n ? (r.wins / r.n) * 100 : 0;
                  return (
                    <tr key={r.ticker} className="border-b border-[#1e2030]/30">
                      <td className="py-1.5 pr-3 text-[#e8e8f0]">{r.ticker}</td>
                      <td className="py-1.5 pr-3 text-right">{r.n}</td>
                      <td className={`py-1.5 pr-3 text-right ${wrColor(wr)}`}>{wr.toFixed(0)}%</td>
                      <td className={`py-1.5 pr-3 text-right ${pnlColor(r.avg_pct)}`}>{fmtPct(r.avg_pct, 1)}</td>
                      <td className={`py-1.5 text-right ${pnlColor(r.pnl)}`}>{fmtDollar(r.pnl)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent closed */}
      {data.recent_closed.length > 0 && (
        <div>
          <div className="text-xs font-display text-muted-foreground uppercase mb-2">
            Recent Closed (last {data.recent_closed.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-[#1e2030]">
                  <th className="text-left py-1.5 pr-2">#</th>
                  <th className="text-left py-1.5 pr-2">Ticker</th>
                  <th className="text-left py-1.5 pr-2">Reason</th>
                  <th className="text-right py-1.5 pr-2">Raw%</th>
                  <th className="text-right py-1.5 pr-2">Lev%</th>
                  <th className="text-right py-1.5 pr-2">Net</th>
                  <th className="text-right py-1.5">Hold</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_closed.map((t) => (
                  <tr key={t.id} className="border-b border-[#1e2030]/30">
                    <td className="py-1.5 pr-2 text-muted-foreground">#{t.id}</td>
                    <td className={`py-1.5 pr-2 ${t.direction === "LONG" ? "text-green-400" : "text-red-400"}`}>
                      {t.ticker} {t.direction}
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{t.exit_reason}</td>
                    <td className={`py-1.5 pr-2 text-right ${pnlColor(t.raw_pnl_pct)}`}>{fmtPct(t.raw_pnl_pct)}</td>
                    <td className={`py-1.5 pr-2 text-right ${pnlColor(t.leveraged_pnl_pct)}`}>
                      {fmtPct(t.leveraged_pnl_pct)}
                    </td>
                    <td className={`py-1.5 pr-2 text-right ${pnlColor(t.net_pnl_usd)}`}>{fmtDollar(t.net_pnl_usd)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtHold(t.hold_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground font-mono text-center pt-4">
        Paper size: ${data.position_size_usd.toFixed(0)} · Max concurrent: {data.max_concurrent} · Max daily: {data.max_daily}
      </div>
    </div>
  );
}
