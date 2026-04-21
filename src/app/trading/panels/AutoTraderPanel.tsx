"use client";

import { useEffect, useState, useCallback } from "react";
import { Bot, PauseCircle } from "lucide-react";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import { safeFetch } from "@/lib/fetch";
import { Panel } from "@/components/ui/panel";
import { StatBlock } from "@/components/ui/stat-block";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatStripSkeleton, PanelSkeleton } from "@/components/ui/skeleton";

/* ── Types ── */
type OpenPosition = {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  leverage: number;
  confidence: number;
  notional_usd: number;
  opened_at: string;
  unrealized_pnl_pct?: number | null;
};

type RecentTrade = {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  pnl_usd: number;
  pnl_pct: number;
  exit_reason: string;
  hold_duration_minutes: number;
  closed_at: string;
};

type Stats7d = {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
};

type Snapshot = {
  enabled: boolean;
  equity: number;
  open_positions: OpenPosition[];
  recent_trades: RecentTrade[];
  stats_7d: Stats7d;
  config: Record<string, string>;
  error?: string;
};

const FALLBACK: Snapshot = {
  enabled: false,
  equity: 0,
  open_positions: [],
  recent_trades: [],
  stats_7d: {
    total_trades: 0,
    wins: 0,
    losses: 0,
    win_rate: 0,
    total_pnl: 0,
  },
  config: {},
};

/* ── Helpers ── */
function fmtAgoShort(iso?: string): string {
  if (!iso) return "\u2014";
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return "\u2014";
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400)
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d`;
}

function fmtHold(mins?: number): string {
  if (mins == null || Number.isNaN(mins)) return "\u2014";
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}

/* ── Component ── */
export default function AutoTraderPanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await safeFetch<Snapshot>("/api/auto-trader", FALLBACK);
    setSnap(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !snap) {
    return (
      <div className="flex flex-col gap-4">
        <StatStripSkeleton />
        <PanelSkeleton title="Open Positions" />
      </div>
    );
  }

  if (!snap) return null;

  const enabled = !!snap.enabled;
  const equity = Number(snap.equity ?? 0);
  const startingCapital = Number(snap.config?.CAPITAL_USD ?? 50.0);
  const pnlAbs = equity - startingCapital;
  const equityColor = pnlAbs >= 0 ? "neon-green" : "neon-red";

  const maxConcurrent = Number(snap.config?.MAX_CONCURRENT ?? 5);
  const maxDaily = Number(snap.config?.MAX_TRADES_PER_DAY ?? 15);
  const stats = snap.stats_7d;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header row ─ status + equity + capacity ─ */}
      <div
        className="flex items-center gap-3 rounded-lg border px-4 py-3"
        style={{
          background: "#12131a",
          borderColor: enabled ? "#00ff88" : "#1e2030",
        }}
      >
        <Bot
          size={22}
          style={{ color: enabled ? "#00ff88" : "#8888a0" }}
        />
        <div className="flex-1">
          <div
            className="text-[11px] uppercase tracking-[0.08em]"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: "#8888a0",
            }}
          >
            Auto Trader
          </div>
          <div
            className="text-sm font-semibold"
            style={{
              color: enabled ? "#00ff88" : "#e8e8f0",
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            }}
          >
            {enabled ? "ENABLED" : "DISABLED"}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "#8888a0" }}
          >
            Equity
          </div>
          <div
            className="text-2xl font-bold leading-tight"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: pnlAbs >= 0 ? "#00ff88" : "#ff4757",
            }}
          >
            ${equity.toFixed(2)}
          </div>
          <div
            className="text-[11px]"
            style={{ color: pnlAbs >= 0 ? "#00ff88" : "#ff4757" }}
          >
            {pnlAbs >= 0 ? "+" : ""}${pnlAbs.toFixed(2)} from $
            {startingCapital.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ── Stat strip ── */}
      <div className="panel shrink-0">
        <div className="flex items-center gap-5 px-3 py-1.5 flex-wrap">
          <StatBlock
            label="Open"
            value={`${snap.open_positions.length} / ${maxConcurrent}`}
            color="neon-text"
          />
          <StatBlock
            label="7d Trades"
            value={`${stats.total_trades}`}
            sub={`${stats.wins}W / ${stats.losses}L`}
            color="neon-text"
          />
          <StatBlock
            label="7d Win Rate"
            value={`${stats.win_rate.toFixed(1)}%`}
            color={stats.win_rate >= 50 ? "neon-green" : "neon-amber"}
          />
          <StatBlock
            label="7d P&L"
            value={`${stats.total_pnl >= 0 ? "+" : ""}$${stats.total_pnl.toFixed(4)}`}
            color={stats.total_pnl >= 0 ? "neon-green" : "neon-red"}
          />
          <StatBlock
            label="Equity"
            value={equity.toFixed(2)}
            color={equityColor}
          />
        </div>
      </div>

      {/* ── Open positions ── */}
      <Panel title="Open Positions">
        {snap.open_positions.length === 0 ? (
          <EmptyState
            icon={PauseCircle}
            message="No open auto positions"
            sub={
              enabled
                ? "Watching for eligible scalp signals..."
                : "Auto Trader is disabled. Enable via !auto on in Discord."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-[12px]"
              style={{
                fontFamily:
                  "var(--font-mono, 'IBM Plex Mono', monospace)",
              }}
            >
              <thead>
                <tr
                  className="text-left border-b"
                  style={{ borderColor: "#1e2030", color: "#8888a0" }}
                >
                  <th className="py-2 pr-3">Ticker</th>
                  <th className="pr-3">Side</th>
                  <th className="pr-3">Entry</th>
                  <th className="pr-3">Stop</th>
                  <th className="pr-3">Target</th>
                  <th className="pr-3">Lev</th>
                  <th className="pr-3">Conf</th>
                  <th className="pr-3">Size</th>
                  <th>Held</th>
                </tr>
              </thead>
              <tbody>
                {snap.open_positions.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b"
                    style={{ borderColor: "#1a1b26" }}
                  >
                    <td className="py-2 pr-3 font-semibold">{p.ticker}</td>
                    <td className="pr-3">
                      <DirectionBadge dir={p.direction} />
                    </td>
                    <td className="pr-3">{fmtDollarPrice(p.entry_price)}</td>
                    <td className="pr-3">{fmtDollarPrice(p.stop_price)}</td>
                    <td className="pr-3">{fmtDollarPrice(p.target_price)}</td>
                    <td className="pr-3">{p.leverage.toFixed(0)}x</td>
                    <td className="pr-3">{p.confidence.toFixed(0)}</td>
                    <td className="pr-3">${p.notional_usd.toFixed(0)}</td>
                    <td style={{ color: "#8888a0" }}>
                      {fmtAgoShort(p.opened_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Recent closed trades ── */}
      <Panel title="Recent Closed (last 10)">
        {snap.recent_trades.length === 0 ? (
          <EmptyState
            icon={Bot}
            message="No closed trades yet"
            sub="Closed auto trades will appear here with P&L and exit reason."
          />
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-[12px]"
              style={{
                fontFamily:
                  "var(--font-mono, 'IBM Plex Mono', monospace)",
              }}
            >
              <thead>
                <tr
                  className="text-left border-b"
                  style={{ borderColor: "#1e2030", color: "#8888a0" }}
                >
                  <th className="py-2 pr-3">Ticker</th>
                  <th className="pr-3">Side</th>
                  <th className="pr-3">Entry → Exit</th>
                  <th className="pr-3">P&L</th>
                  <th className="pr-3">Reason</th>
                  <th className="pr-3">Held</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {snap.recent_trades.map((t) => {
                  const pnlUsd = Number(t.pnl_usd ?? 0);
                  const pnlPct = Number(t.pnl_pct ?? 0);
                  const ok = pnlUsd >= 0;
                  return (
                    <tr
                      key={t.id}
                      className="border-b"
                      style={{ borderColor: "#1a1b26" }}
                    >
                      <td className="py-2 pr-3 font-semibold">{t.ticker}</td>
                      <td className="pr-3">
                        <DirectionBadge dir={t.direction} />
                      </td>
                      <td className="pr-3">
                        {fmtDollarPrice(t.entry_price)} {"\u2192"}{" "}
                        {fmtDollarPrice(t.exit_price)}
                      </td>
                      <td
                        className="pr-3"
                        style={{
                          color: ok ? "#00ff88" : "#ff4757",
                          fontWeight: 600,
                        }}
                      >
                        {ok ? "+" : ""}${pnlUsd.toFixed(4)}{" "}
                        <span className="opacity-60">
                          ({fmtPctSigned(pnlPct)}%)
                        </span>
                      </td>
                      <td className="pr-3" style={{ color: "#8888a0" }}>
                        {t.exit_reason || "\u2014"}
                      </td>
                      <td className="pr-3">
                        {fmtHold(t.hold_duration_minutes)}
                      </td>
                      <td style={{ color: "#8888a0" }}>
                        {fmtAgoShort(t.closed_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Config strip ── */}
      <div
        className="rounded-lg border px-4 py-2 text-[11px] flex flex-wrap gap-x-4 gap-y-1"
        style={{
          background: "#12131a",
          borderColor: "#1e2030",
          color: "#8888a0",
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
        }}
      >
        <span>
          Threshold:{" "}
          <b style={{ color: "#e8e8f0" }}>
            {snap.config?.AGGRESSIVE_THRESHOLD ?? "\u2014"}
          </b>
        </span>
        <span>
          Per-trade:{" "}
          <b style={{ color: "#e8e8f0" }}>
            ${snap.config?.PER_TRADE_USD ?? "\u2014"}
          </b>
        </span>
        <span>
          Max daily: <b style={{ color: "#e8e8f0" }}>{maxDaily}</b>
        </span>
        <span>
          Max concurrent: <b style={{ color: "#e8e8f0" }}>{maxConcurrent}</b>
        </span>
        <span>
          Leverage:{" "}
          <b style={{ color: "#e8e8f0" }}>
            {snap.config?.LEVERAGE_DEFAULT ?? "\u2014"}x
          </b>
        </span>
      </div>

      <div
        className="text-[10px] text-center opacity-60"
        style={{ color: "#8888a0" }}
      >
        SHADOW / paper only \u00b7 No real Hyperliquid orders \u00b7 Toggle via{" "}
        <code>!auto on</code> / <code>!auto off</code> in Discord
      </div>
    </div>
  );
}
