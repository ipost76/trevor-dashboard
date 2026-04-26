"use client";

import { Bot } from "lucide-react";
import type { AutoTraderSummary } from "@/hooks/useAutoTraderStream";
import { KillSwitch } from "./KillSwitch";

// Premium live trading dashboard hero (2026-04-26):
//   Row 1 (sticky on scroll): Mode badge (LIVE / PAPER) + KILL ALL switch
//   Row 2: 4 stat cards (Equity, Total P&L, Today P&L, Open positions)
//   Row 3: warning chips (SDK errors, consecutive losses) + SSE conn dot
//
// Card grid: 2×2 on phones (<sm), 4×1 from sm: up.

const GREEN = "#00ff88";
const RED = "#ff4757";
const AMBER = "#ffa502";
const CYAN = "#00d4ff";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";
const CARD = "#0e1015";

type Connection = "connecting" | "connected" | "reconnecting" | "offline";

type Props = {
  summary: AutoTraderSummary | null;
  connection: Connection;
};

function connColor(s: Connection): string {
  if (s === "connected") return GREEN;
  if (s === "reconnecting" || s === "connecting") return AMBER;
  return RED;
}

function connLabel(s: Connection): string {
  if (s === "connected") return "LIVE";
  if (s === "connecting") return "CONNECTING";
  if (s === "reconnecting") return "RECONNECTING";
  return "OFFLINE";
}

function fmtMoney(value: number): string {
  if (!isFinite(value)) return "$0.00";
  const abs = Math.abs(value);
  // Scale precision: <1 → 4dp, <100 → 2dp, else whole
  const precision = abs < 1 ? 4 : abs < 100 ? 2 : 2;
  return `${value < 0 ? "-" : ""}$${abs.toFixed(precision)}`;
}

function fmtSignedMoney(value: number): string {
  if (!isFinite(value) || value === 0) return "$0.00";
  const sign = value > 0 ? "+" : "-";
  const abs = Math.abs(value);
  const precision = abs < 1 ? 4 : 2;
  return `${sign}$${abs.toFixed(precision)}`;
}

export function HeaderBar({ summary, connection }: Props) {
  const enabled = !!summary?.enabled;
  const mode = summary?.mode ?? "paper";
  const isLive = mode === "live";

  const equity = Number(summary?.equity ?? 0);
  const starting = Number(summary?.starting_capital ?? 50);
  const equitySrc = summary?.equity_source ?? (isLive ? "hyperliquid" : "simulated");

  const pnlAbs = equity - starting;
  const pnlPct = starting > 0 ? (pnlAbs / starting) * 100 : 0;
  const pnlColor = pnlAbs >= 0 ? GREEN : RED;

  const todayPnl = Number(summary?.today_pnl ?? 0);
  const todayCount = Number(summary?.today_count ?? 0);
  const todayColor = todayPnl > 0 ? GREEN : todayPnl < 0 ? RED : MUTED;

  const openCount = Number(summary?.open_count ?? 0);
  const openNotional = Number(summary?.open_notional ?? 0);

  const wins = summary?.stats_7d?.wins ?? 0;
  const losses = summary?.stats_7d?.losses ?? 0;
  const wr = summary?.stats_7d?.win_rate ?? 0;
  const total7d = (summary?.stats_7d?.total_trades ?? 0) || 0;

  const sdkErrors = Number(summary?.sdk_errors ?? 0);
  const consecLosses = Number(summary?.consecutive_losses ?? 0);
  const liveCap = Number(summary?.live_hard_cap ?? 50);

  const dotColor = connColor(connection);
  const dotPulse = connection === "connected" || connection === "connecting";

  // Warning surface
  const warnSdk = isLive && sdkErrors > 0;
  const warnLossStreak = consecLosses >= 2;
  const warnCapNear = isLive && equity > 0 && equity / liveCap >= 0.9;

  return (
    <div
      className="rounded-lg"
      style={{
        background: SURFACE,
        border: `1px solid ${enabled ? (isLive ? GREEN : MUTED) : BORDER}`,
        position: "relative",
      }}
    >
      {/* ── Sticky control row: mode badge + kill switch ── */}
      <div
        className="flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3"
        style={{
          background: SURFACE,
          borderBottom: `1px solid ${BORDER}`,
          position: "sticky",
          top: 0,
          zIndex: 21,
          // Tab strip in TabContainer is `top-0 z-[19]`, plus PriceStrip is fixed
          // height. We push above with z-[21] so we float over both during scroll.
        }}
      >
        <Bot
          size={20}
          style={{ color: enabled ? (isLive ? GREEN : CYAN) : MUTED, flexShrink: 0 }}
        />

        {/* Mode badge */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isLive && enabled ? "at-pulse" : ""
            }`}
            style={{
              background: isLive ? GREEN : MUTED,
              boxShadow: isLive ? `0 0 10px ${GREEN}` : "none",
              flexShrink: 0,
            }}
            aria-hidden
          />
          <div className="flex flex-col">
            <span
              className="text-[9px] uppercase tracking-[0.14em]"
              style={{
                color: MUTED,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              }}
            >
              {enabled ? "Auto Trader" : "Auto Trader · OFF"}
            </span>
            <span
              className="text-base sm:text-xl font-bold leading-none"
              style={{
                color: isLive ? GREEN : TEXT,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                letterSpacing: "0.12em",
                textShadow: isLive ? `0 0 14px ${GREEN}66` : "none",
              }}
            >
              {isLive ? "🟢 LIVE" : "📄 PAPER"}
            </span>
          </div>
        </div>

        {/* Connection dot */}
        <span className="hidden sm:flex items-center gap-1.5 text-[10px]">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              dotPulse ? "at-pulse" : ""
            }`}
            style={{ background: dotColor }}
            aria-hidden
          />
          <span
            style={{
              color: dotColor,
              letterSpacing: "0.1em",
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            }}
          >
            {connLabel(connection)}
          </span>
        </span>

        {/* Kill switch */}
        <KillSwitch />
      </div>

      {/* ── 4 hero stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 pt-3">
        <StatCard
          label="Equity"
          value={fmtMoney(equity)}
          sub={
            isLive
              ? `${equitySrc === "hyperliquid" ? "Hyperliquid" : "—"} · cap $${liveCap.toFixed(0)}`
              : "simulated"
          }
          color={pnlColor}
          glow={pnlAbs >= 0 ? GREEN : RED}
          big
        />
        <StatCard
          label="Total P&L"
          value={fmtSignedMoney(pnlAbs)}
          sub={
            total7d > 0
              ? `${wins}W / ${losses}L · ${wr.toFixed(1)}% WR`
              : "no trades yet"
          }
          color={pnlColor}
          tinyValue={`(${pnlAbs >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`}
        />
        <StatCard
          label="Today's P&L"
          value={todayCount > 0 ? fmtSignedMoney(todayPnl) : "—"}
          sub={
            todayCount > 0
              ? `${todayCount} trade${todayCount === 1 ? "" : "s"} closed`
              : "0 trades today"
          }
          color={todayColor}
        />
        <StatCard
          label="Open Positions"
          value={`${openCount}/${summary?.max_concurrent ?? 5}`}
          sub={
            openCount > 0
              ? `$${openNotional.toFixed(2)} exposure`
              : "no exposure"
          }
          color={openCount > 0 ? CYAN : MUTED}
        />
      </div>

      {/* ── Warning + status row ── */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2 mt-2 text-[11px]"
        style={{
          borderTop: `1px solid ${BORDER}`,
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          <span className="opacity-70">Today:</span>{" "}
          <b style={{ color: TEXT }}>
            {summary?.trades_today ?? 0}/{summary?.max_daily ?? 15}
          </b>
        </span>
        {summary?.last_trade_at && (
          <span className="opacity-80">
            <span className="opacity-70">Last:</span> {fmtAgo(summary.last_trade_at)}
          </span>
        )}

        {warnSdk && (
          <WarnChip color={AMBER}>
            ⚠ {sdkErrors} SDK error{sdkErrors === 1 ? "" : "s"}
          </WarnChip>
        )}
        {warnLossStreak && (
          <WarnChip color={RED}>❄️ {consecLosses}-loss streak</WarnChip>
        )}
        {warnCapNear && (
          <WarnChip color={AMBER}>
            ⚠ near hard cap (${liveCap.toFixed(0)})
          </WarnChip>
        )}

        <span className="flex-1 min-w-0" />

        {/* Mobile-only conn label (hidden when sticky bar shows it) */}
        <span className="sm:hidden flex items-center gap-1.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              dotPulse ? "at-pulse" : ""
            }`}
            style={{ background: dotColor }}
            aria-hidden
          />
          <span
            style={{
              color: dotColor,
              letterSpacing: "0.08em",
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            }}
          >
            {connLabel(connection)}
          </span>
        </span>
      </div>

      {/* Pulse animation — plain <style> tag is RSC-safe */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes at-pulse-kf{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.85)}}.at-pulse{animation:at-pulse-kf 1.8s ease-in-out infinite}",
        }}
      />
    </div>
  );
}

/* ── Stat card ── */
function StatCard({
  label,
  value,
  sub,
  color,
  glow,
  big,
  tinyValue,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  glow?: string;
  big?: boolean;
  tinyValue?: string;
}) {
  return (
    <div
      className="rounded-md p-2 sm:p-3 flex flex-col justify-between min-h-[68px] sm:min-h-[78px]"
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        boxShadow: glow ? `inset 0 0 18px ${glow}10` : "none",
      }}
    >
      <span
        className="text-[9px] sm:text-[10px] uppercase tracking-[0.12em]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
        }}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1.5 mt-1 flex-wrap">
        <span
          className={big ? "text-xl sm:text-2xl font-bold" : "text-lg sm:text-xl font-bold"}
          style={{
            color,
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
            lineHeight: 1.05,
          }}
        >
          {value}
        </span>
        {tinyValue && (
          <span
            className="text-[10px] sm:text-[11px] opacity-80"
            style={{
              color,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {tinyValue}
          </span>
        )}
      </div>
      {sub && (
        <span
          className="text-[10px] mt-0.5 truncate"
          style={{
            color: MUTED,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function WarnChip({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{
        background: `${color}1a`,
        color,
        border: `1px solid ${color}55`,
        fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
      }}
    >
      {children}
    </span>
  );
}

function fmtAgo(iso: string): string {
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!isFinite(t)) return "—";
  const ms = Date.now() - t;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

