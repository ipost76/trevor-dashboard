"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { AutoTraderSummary } from "@/hooks/useAutoTraderStream";

// Premium AutoTrader header (2026-04-26 redesign):
//   Row 1 — identity bar (single line, ~40px):
//     [bot icon] [LIVE/PAPER pill] watching 5 tickers · N open · cap $X       last 14m ago [pulse dot]
//   Row 2 — equity hero (focal point):
//     ONE large number ($X.XX, Orbitron 36-48px) · "+$Y today" small inline
//     [30-trade sparkline ~100x24]
//   Row 3 — context strip (scannable, single line):
//     Total: ±$X · Today: N trades · Open: N/M · Win: X% · Streak: ❄️ NL
//
// Total height target: <200px on 375vw. Eye lands on equity, flows down.
// Kill button removed entirely (Discord !auto kill is the kill switch).

const GREEN = "#00ff88";
const RED = "#ff4757";
const AMBER = "#ffa502";
const CYAN = "#00d4ff";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";

const SCALP_TICKERS = 5; // BTC, ETH, SOL, HYPE, FARTCOIN — fixed whitelist

type Connection = "connecting" | "connected" | "reconnecting" | "offline";

type Props = {
  summary: AutoTraderSummary | null;
  connection: Connection;
};

type SparkPoint = { idx: number; equity: number };

type EquityCurveResponse = {
  points: Array<{
    trade_id: number;
    trade_mode: "live" | "paper";
    live_equity: number;
    paper_equity: number;
    closed_at: string;
  }>;
  starting_capital: number;
};

function fmtMoney(value: number): string {
  if (!isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function fmtSignedMoney(value: number): string {
  if (!isFinite(value)) return "$0.00";
  if (Math.abs(value) < 0.005) return "$0.00";
  return `${value > 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "no signal yet";
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!isFinite(t)) return "—";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function HeaderBar({ summary, connection }: Props) {
  const [sparkline, setSparkline] = useState<SparkPoint[]>([]);

  // Fetch sparkline data — last 30 closed trades' running equity for current mode.
  // Polls equity-curve endpoint every 60s (server cache is 30s; this is comfortable).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auto-trader/equity-curve");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as EquityCurveResponse;
        const isLiveMode = summary?.mode === "live";
        const points = (data.points || []).slice(-30).map((p, i) => ({
          idx: i,
          equity: isLiveMode ? p.live_equity : p.paper_equity,
        }));
        if (!cancelled) setSparkline(points);
      } catch {
        /* swallow — sparkline is optional decoration */
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [summary?.mode]);

  const enabled = !!summary?.enabled;
  const mode = summary?.mode ?? "paper";
  const isLive = mode === "live";

  const equity = Number(summary?.equity ?? 0);
  const starting = Number(summary?.starting_capital ?? 50);
  const cap = isLive ? Number(summary?.live_hard_cap ?? 50) : starting;

  const pnlAbs = equity - starting;
  const pnlColor = Math.abs(pnlAbs) < 0.005 ? MUTED : pnlAbs > 0 ? GREEN : RED;
  const todayPnl = Number(summary?.today_pnl ?? 0);
  const todayCount = Number(summary?.today_count ?? 0);
  const todayColor =
    Math.abs(todayPnl) < 0.005 ? MUTED : todayPnl > 0 ? GREEN : RED;

  const openCount = Number(summary?.open_count ?? 0);
  const maxConcurrent = Number(summary?.max_concurrent ?? (isLive ? 3 : 5));
  const wins = summary?.stats_7d?.wins ?? 0;
  const losses = summary?.stats_7d?.losses ?? 0;
  const wr = summary?.stats_7d?.win_rate ?? null;
  const total7d = wins + losses;
  const consec = Number(summary?.consecutive_losses ?? 0);

  const isScanning = connection === "connected";
  const dotColor =
    connection === "connected"
      ? GREEN
      : connection === "offline"
      ? RED
      : AMBER;

  const lastSignalLabel = summary?.last_trade_at
    ? `last ${fmtAgo(summary.last_trade_at)}`
    : enabled
    ? "scanning…"
    : "off";

  return (
    <div
      className="rounded-lg"
      style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
    >
      {/* ── Row 1: Identity bar ── */}
      <div
        className="flex items-center gap-2 px-3 sm:px-4 py-2 text-[11px]"
        style={{
          borderBottom: `1px solid ${BORDER}`,
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
        }}
      >
        <Bot
          size={14}
          style={{
            color: enabled ? (isLive ? GREEN : CYAN) : MUTED,
            flexShrink: 0,
          }}
        />

        {/* Status pill */}
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold"
          style={{
            background: isLive ? `${GREEN}1a` : `${MUTED}22`,
            color: isLive ? GREEN : MUTED,
            border: `1px solid ${isLive ? `${GREEN}55` : `${MUTED}44`}`,
            letterSpacing: "0.12em",
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            flexShrink: 0,
          }}
          title={enabled ? "Auto Trader enabled" : "Auto Trader disabled"}
        >
          {isLive ? "🟢 LIVE" : "📄 PAPER"}
        </span>

        {/* Center context — desktop wider, mobile compact */}
        <span
          className="hidden sm:inline truncate min-w-0 flex-1"
          style={{ opacity: 0.85 }}
        >
          watching {SCALP_TICKERS} tickers · {openCount} open · cap ${cap.toFixed(0)}
        </span>
        <span
          className="sm:hidden truncate min-w-0 flex-1"
          style={{ opacity: 0.85 }}
        >
          {openCount}/{maxConcurrent} open · ${cap.toFixed(0)}
        </span>

        {/* Right: scanning / last signal indicator */}
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              isScanning && enabled ? "ht-pulse" : ""
            }`}
            style={{ background: dotColor }}
            aria-hidden
          />
          <span style={{ color: MUTED, opacity: 0.85 }}>{lastSignalLabel}</span>
        </span>
      </div>

      {/* ── Row 2: Equity hero ── */}
      <div className="px-3 sm:px-4 pt-3 pb-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-[36px] sm:text-[48px] font-bold leading-none"
            style={{
              color: TEXT,
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
              textShadow:
                pnlAbs > 0.5
                  ? `0 0 24px ${GREEN}33`
                  : pnlAbs < -0.5
                  ? `0 0 24px ${RED}33`
                  : "none",
            }}
          >
            {fmtMoney(equity)}
          </span>
          <span
            className="text-[12px] sm:text-[13px]"
            style={{
              color: todayColor,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {todayCount > 0 ? `${fmtSignedMoney(todayPnl)} today` : "no trades today"}
          </span>
        </div>

        {/* Inline 30-trade sparkline */}
        {sparkline.length >= 2 && (
          <div
            className="mt-1.5 ml-[2px]"
            style={{ height: 24, width: 100 }}
            aria-hidden
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={sparkline}
                margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
              >
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke={pnlColor}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Row 3: Context strip ── */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 pb-3 pt-1.5 text-[11px] sm:text-[12px]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          <span className="opacity-70">Total:</span>{" "}
          <b style={{ color: pnlColor }}>{fmtSignedMoney(pnlAbs)}</b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">Today:</span>{" "}
          <b style={{ color: TEXT }}>
            {todayCount} {todayCount === 1 ? "trade" : "trades"}
          </b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">Open:</span>{" "}
          <b style={{ color: openCount > 0 ? CYAN : TEXT }}>
            {openCount}/{maxConcurrent}
          </b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">Win:</span>{" "}
          <b
            style={{
              color:
                total7d === 0
                  ? MUTED
                  : (wr ?? 0) >= 55
                  ? GREEN
                  : (wr ?? 0) >= 45
                  ? AMBER
                  : RED,
            }}
          >
            {total7d > 0 && wr != null ? `${wr.toFixed(0)}%` : "—"}
          </b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">Streak:</span>{" "}
          <b style={{ color: consec >= 2 ? RED : MUTED }}>
            {consec >= 2 ? `❄️ ${consec}L` : "—"}
          </b>
        </span>
      </div>

      {/* CSS pulse animation — plain <style> tag is RSC-safe */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes ht-pulse-kf{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.85)}}.ht-pulse{animation:ht-pulse-kf 1.8s ease-in-out infinite}",
        }}
      />
    </div>
  );
}
