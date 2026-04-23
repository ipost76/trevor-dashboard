import { Bot } from "lucide-react";
import type { AutoTraderSummary } from "@/hooks/useAutoTraderStream";

// Hero bar: status pill + equity hero + 7D stats + SSE connection dot.

const GREEN = "#00ff88";
const RED = "#ff4757";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";

type Props = {
  summary: AutoTraderSummary | null;
  connection: "connecting" | "connected" | "reconnecting" | "offline";
};

function connColor(s: Props["connection"]): string {
  if (s === "connected") return GREEN;
  if (s === "reconnecting" || s === "connecting") return AMBER;
  return RED;
}

function connLabel(s: Props["connection"]): string {
  if (s === "connected") return "LIVE";
  if (s === "connecting") return "CONNECTING";
  if (s === "reconnecting") return "RECONNECTING";
  return "OFFLINE";
}

export function HeaderBar({ summary, connection }: Props) {
  const enabled = !!summary?.enabled;
  const equity = Number(summary?.equity ?? 0);
  const starting = Number(summary?.starting_capital ?? 50);
  const pnlAbs = equity - starting;
  const pnlPct = starting > 0 ? (pnlAbs / starting) * 100 : 0;
  const pnlColor = pnlAbs >= 0 ? GREEN : RED;

  const stats = summary?.stats_7d;
  const wr = stats?.win_rate ?? 0;
  const wrColor = wr >= 55 ? GREEN : wr >= 45 ? AMBER : RED;

  const dotColor = connColor(connection);
  const dotPulse = connection === "connected" || connection === "connecting";

  return (
    <div
      className="rounded-lg"
      style={{
        background: SURFACE,
        border: `1px solid ${enabled ? GREEN : BORDER}`,
      }}
    >
      {/* ── Top row: title + equity hero ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:gap-4">
        <Bot size={22} style={{ color: enabled ? GREEN : MUTED }} />

        <div className="flex-shrink-0">
          <div
            className="text-[10px] uppercase tracking-[0.12em]"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: MUTED,
            }}
          >
            Auto Trader
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                enabled ? "at-pulse" : ""
              }`}
              style={{ background: enabled ? GREEN : RED }}
              aria-hidden
            />
            <span
              className="text-sm font-semibold"
              style={{
                color: enabled ? GREEN : RED,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                letterSpacing: "0.08em",
              }}
            >
              {enabled ? "ENABLED" : "DISABLED"}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0" />

        <div className="text-right">
          <div
            className="text-[10px] uppercase tracking-[0.12em]"
            style={{ color: MUTED }}
          >
            Equity
          </div>
          <div
            className="text-2xl sm:text-3xl font-bold leading-tight"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: pnlColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ${equity.toFixed(2)}
          </div>
          <div
            className="text-[11px]"
            style={{
              color: pnlColor,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pnlAbs >= 0 ? "+" : ""}${pnlAbs.toFixed(2)}{" "}
            <span className="opacity-70">
              ({pnlAbs >= 0 ? "+" : ""}
              {pnlPct.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      {/* ── Bottom row: 7D stats + SSE indicator ── */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px]"
        style={{
          borderColor: BORDER,
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          <span className="opacity-70">7D:</span>{" "}
          <b style={{ color: TEXT }}>{stats?.total_trades ?? 0}</b>{" "}
          <span className="opacity-70">trades</span>
        </span>
        <span>
          <b style={{ color: GREEN }}>{stats?.wins ?? 0}W</b>
          <span className="opacity-70"> / </span>
          <b style={{ color: RED }}>{stats?.losses ?? 0}L</b>
        </span>
        <span>
          <span className="opacity-70">WR:</span>{" "}
          <b style={{ color: wrColor }}>{wr.toFixed(1)}%</b>
        </span>
        <span>
          <span className="opacity-70">P&L:</span>{" "}
          <b
            style={{
              color: (stats?.total_pnl ?? 0) >= 0 ? GREEN : RED,
            }}
          >
            {(stats?.total_pnl ?? 0) >= 0 ? "+" : ""}$
            {(stats?.total_pnl ?? 0).toFixed(2)}
          </b>
        </span>

        <span className="opacity-30">·</span>

        <span>
          <span className="opacity-70">Open:</span>{" "}
          <b style={{ color: TEXT }}>
            {summary?.open_count ?? 0}/{summary?.max_concurrent ?? 5}
          </b>
        </span>
        <span>
          <span className="opacity-70">Today:</span>{" "}
          <b style={{ color: TEXT }}>
            {summary?.trades_today ?? 0}/{summary?.max_daily ?? 15}
          </b>
        </span>

        <span className="flex-1 min-w-0" />

        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              dotPulse ? "at-pulse" : ""
            }`}
            style={{ background: dotColor }}
            aria-hidden
          />
          <span style={{ color: dotColor, letterSpacing: "0.08em" }}>
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
