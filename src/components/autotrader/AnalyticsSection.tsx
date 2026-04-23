"use client";

import { useEffect, useState } from "react";
import { BarChart2 } from "lucide-react";
import { EquityCurveChart } from "./EquityCurveChart";
import { WinRateByTickerChart } from "./WinRateByTickerChart";
import { PnlByExitReasonChart } from "./PnlByExitReasonChart";

const GREEN = "#00ff88";
const RED = "#ff4757";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";
const PANEL_BG = "#0b110c"; // slightly greenish dark for chart backgrounds

type EquityPoint = {
  trade_id: number;
  ticker: string;
  direction: string;
  pnl_usd: number;
  closed_at: string;
  equity: number;
  pnl_cumulative: number;
};

type EquityResponse = {
  points: EquityPoint[];
  starting_capital: number;
  current_equity: number;
  total_trades: number;
};

type TickerRow = {
  ticker: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl_pct: number;
};

type ExitReasonRow = {
  reason: string;
  count: number;
  total_pnl: number;
  avg_pnl_pct: number;
  color: string;
};

type Overall = {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  best_trade: { ticker: string; direction: string; pnl_usd: number; pnl_pct: number } | null;
  worst_trade: { ticker: string; direction: string; pnl_usd: number; pnl_pct: number } | null;
  avg_hold_minutes: number;
  avg_winner_pnl: number;
  avg_loser_pnl: number;
  profit_factor: number | null;
};

type AnalyticsResponse = {
  by_ticker: TickerRow[];
  by_exit_reason: ExitReasonRow[];
  overall: Overall;
};

export function AnalyticsSection() {
  const [equity, setEquity] = useState<EquityResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [eqRes, anRes] = await Promise.all([
          fetch("/api/auto-trader/equity-curve"),
          fetch("/api/auto-trader/analytics"),
        ]);
        if (cancelled) return;
        const eq = (await eqRes.json()) as EquityResponse;
        const an = (await anRes.json()) as AnalyticsResponse;
        setEquity(eq);
        setAnalytics(an);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    // refresh every 60s — charts change only when a trade closes
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const overall = analytics?.overall;

  return (
    <section>
      {/* Heading */}
      <div className="mb-2 flex items-center gap-2 px-1">
        <BarChart2 size={14} style={{ color: MUTED }} />
        <span
          className="text-[11px] uppercase tracking-[0.12em]"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: MUTED,
          }}
        >
          Analytics
        </span>
        {err && (
          <span className="text-[10px]" style={{ color: RED }}>
            · {err}
          </span>
        )}
      </div>

      {/* Overall summary strip */}
      {overall && overall.total_trades > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-2 text-[11px]"
          style={{
            background: SURFACE,
            borderColor: BORDER,
            color: MUTED,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>
            <span className="opacity-70">Total:</span>{" "}
            <b style={{ color: TEXT }}>{overall.total_trades}</b>
          </span>
          <span>
            <b style={{ color: GREEN }}>{overall.wins}W</b>
            <span className="opacity-70"> / </span>
            <b style={{ color: RED }}>{overall.losses}L</b>
          </span>
          <span>
            <span className="opacity-70">WR:</span>{" "}
            <b
              style={{
                color: overall.win_rate >= 55 ? GREEN : overall.win_rate >= 45 ? AMBER : RED,
              }}
            >
              {overall.win_rate.toFixed(1)}%
            </b>
          </span>
          <span>
            <span className="opacity-70">P&amp;L:</span>{" "}
            <b style={{ color: overall.total_pnl >= 0 ? GREEN : RED }}>
              {overall.total_pnl >= 0 ? "+" : ""}${overall.total_pnl.toFixed(2)}
            </b>
          </span>
          <span>
            <span className="opacity-70">PF:</span>{" "}
            <b style={{ color: TEXT }}>
              {overall.profit_factor == null
                ? "∞"
                : overall.profit_factor.toFixed(2)}
            </b>
          </span>
          {overall.best_trade && (
            <span className="flex items-center gap-1">
              <span className="opacity-70">Best:</span>
              <b style={{ color: GREEN }}>
                {overall.best_trade.ticker} +{overall.best_trade.pnl_pct.toFixed(1)}%
              </b>
            </span>
          )}
          {overall.worst_trade && (
            <span className="flex items-center gap-1">
              <span className="opacity-70">Worst:</span>
              <b style={{ color: RED }}>
                {overall.worst_trade.ticker} {overall.worst_trade.pnl_pct.toFixed(1)}%
              </b>
            </span>
          )}
          <span>
            <span className="opacity-70">Avg hold:</span>{" "}
            <b style={{ color: TEXT }}>{fmtMinutes(overall.avg_hold_minutes)}</b>
          </span>
        </div>
      )}

      {/* Equity curve — full width */}
      <div
        className="rounded-lg border p-3"
        style={{ background: PANEL_BG, borderColor: BORDER }}
      >
        <div
          className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.1em]"
          style={{ color: MUTED }}
        >
          <span>Equity Curve</span>
          {equity && (
            <span className="opacity-70">
              {equity.total_trades} trades · $
              {equity.current_equity.toFixed(2)} current
            </span>
          )}
        </div>
        {loading && !equity ? (
          <ChartSkeleton height={200} />
        ) : (
          <EquityCurveChart
            points={equity?.points || []}
            startingCapital={equity?.starting_capital ?? 50}
          />
        )}
      </div>

      {/* Two-column: WR by ticker | P&L by exit reason */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div
          className="rounded-lg border p-3"
          style={{ background: PANEL_BG, borderColor: BORDER }}
        >
          <div
            className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.1em]"
            style={{ color: MUTED }}
          >
            <span>Win Rate by Ticker</span>
            <span className="opacity-70 normal-case tracking-normal">
              ref 50%
            </span>
          </div>
          {loading && !analytics ? (
            <ChartSkeleton height={180} />
          ) : (
            <WinRateByTickerChart data={analytics?.by_ticker || []} />
          )}
        </div>

        <div
          className="rounded-lg border p-3"
          style={{ background: PANEL_BG, borderColor: BORDER }}
        >
          <div
            className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.1em]"
            style={{ color: MUTED }}
          >
            <span>P&amp;L by Exit Reason</span>
            <span className="opacity-70 normal-case tracking-normal">
              green/red split
            </span>
          </div>
          {loading && !analytics ? (
            <ChartSkeleton height={150} />
          ) : (
            <PnlByExitReasonChart data={analytics?.by_exit_reason || []} />
          )}
        </div>
      </div>
    </section>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="rounded"
      style={{
        height,
        background:
          "linear-gradient(90deg, rgba(0,255,136,0.02) 0%, rgba(0,255,136,0.06) 50%, rgba(0,255,136,0.02) 100%)",
        animation: "at-skel 1.4s linear infinite",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes at-skel{0%{background-position:-200% 0}100%{background-position:200% 0}}",
        }}
      />
    </div>
  );
}

function fmtMinutes(m: number): string {
  if (!isFinite(m) || m <= 0) return "—";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return `${h}h ${rem}m`;
}
