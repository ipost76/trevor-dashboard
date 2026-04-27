"use client";

import { useEffect, useRef, useState } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import type { AutoTraderPosition } from "@/hooks/useAutoTraderStream";

// Active-position card (2026-04-26 redesign).
// 5-section layout:
//   1. Header row — ticker + direction + LIVE/PAPER + leverage + state-color border
//   2. "entered Xm ago at $price" sub-line
//   3. BIG P&L block — large numeric + progress bar (stop → target with current tick) + endpoint labels
//   4. Stats row — size · notional · conf · peak · BE · partials
//   5. Mini price chart — entry → now with reference lines for entry/stop/target
//   6. Exit logic line — "BE locked · timeout in 1h 23m"

const GREEN = "#00ff88";
const RED = "#ff4757";
const CYAN = "#00d4ff";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#0e1015";
const PILL = "#1e2030";

const TIMEOUT_MINUTES_DEFAULT = 120; // matches auto_trader.config.TIMEOUT_MINUTES

type PricePoint = { ts: number; price: number };

export function PositionCard({ p }: { p: AutoTraderPosition }) {
  const isProfit = p.live_pnl_pct >= 0;
  const be = !!p.breakeven_stop_active;
  const borderColor = be ? CYAN : isProfit ? GREEN : RED;
  const pnlColor = isProfit ? GREEN : RED;

  const hasPrice = p.current_price != null && !p.price_stale;
  const isLiveTrade = p.trade_mode === "live";
  const peakFadingDown =
    p.peak_pnl_pct > 0 && p.live_pnl_pct < p.peak_pnl_pct - 0.05;
  const confDisplay = p.adjusted_confidence ?? p.confidence;

  // Client-side price history for mini-chart. Persists across SSE updates
  // because AutoTraderPanel keys PositionCards by p.id.
  const historyRef = useRef<PricePoint[]>([]);
  const [, setHistoryTick] = useState(0);

  useEffect(() => {
    if (!hasPrice || p.current_price == null) return;
    const hist = historyRef.current;
    const last = hist[hist.length - 1];
    if (last && Math.abs(last.price - p.current_price) < 1e-9) return;

    // Seed with entry on first append
    if (hist.length === 0 && p.entry_price > 0) {
      const openedTs = Date.parse(
        p.opened_at.includes("T")
          ? p.opened_at
          : p.opened_at.replace(" ", "T") + "Z"
      );
      hist.push({
        ts: isFinite(openedTs) ? openedTs : Date.now() - 60000,
        price: p.entry_price,
      });
    }
    hist.push({ ts: Date.now(), price: p.current_price });
    while (hist.length > 60) hist.shift();
    setHistoryTick((t) => t + 1);
  }, [hasPrice, p.current_price, p.entry_price, p.opened_at]);

  const enteredAgo = formatEnteredAgo(p.opened_at, p.hold_minutes);
  const exitLogic = formatExitLogic(p, TIMEOUT_MINUTES_DEFAULT);

  return (
    <div
      className="rounded-lg p-3 sm:p-4"
      style={{
        background: SURFACE,
        borderTop: `1px solid ${BORDER}`,
        borderRight: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      {/* ── Section 1: Header row ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-[14px] sm:text-[15px] font-bold"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: TEXT,
            letterSpacing: "0.03em",
          }}
        >
          {p.ticker}
        </span>
        <DirectionBadge dir={p.direction} />
        <ModeBadge isLive={isLiveTrade} />
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: PILL,
            color: MUTED,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          }}
        >
          {p.leverage % 1 === 0
            ? p.leverage.toFixed(0)
            : p.leverage.toFixed(1)}
          x
        </span>
        <span className="flex-1 min-w-0" />
        {!hasPrice && (
          <span
            className="flex items-center gap-1 text-[10px]"
            style={{ color: AMBER }}
            title="price feed unavailable"
          >
            <span>⚠</span>
            <span>stale</span>
          </span>
        )}
      </div>

      {/* ── Section 2: "entered Xm ago at $price" ── */}
      <div
        className="mt-1 text-[11px]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        entered {enteredAgo} at <b style={{ color: TEXT }}>{fmtDollarPrice(p.entry_price)}</b>
      </div>

      {/* ── Section 3: BIG P&L block ── */}
      <div className="mt-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-[22px] sm:text-[26px] font-bold leading-none"
            style={{
              color: pnlColor,
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
            }}
          >
            {isProfit ? "+" : ""}${p.live_pnl_usd.toFixed(2)}
          </span>
          <span
            className="text-[13px] sm:text-[14px] font-semibold"
            style={{
              color: pnlColor,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
              opacity: 0.9,
            }}
          >
            {fmtPctSigned(p.live_pnl_pct)}%
          </span>
          {peakFadingDown && (
            <span
              className="text-[10px]"
              style={{ color: MUTED }}
              title={`peak ${fmtPctSigned(p.peak_pnl_pct)}%`}
            >
              ↓ from peak
            </span>
          )}
          <span className="flex-1 min-w-0" />
          <span
            className="text-[11px]"
            style={{
              color: MUTED,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {p.hold_display}
          </span>
        </div>
        <ProgressBar
          entry={p.entry_price}
          stop={p.stop_price}
          target={p.target_price}
          current={p.current_price}
          direction={p.direction}
          isProfit={isProfit}
        />
      </div>

      {/* ── Section 4: Stats row ── */}
      <div
        className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          <span className="opacity-70">size</span>{" "}
          <b style={{ color: TEXT }}>${(p.notional_usd / p.leverage).toFixed(2)}</b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">notional</span>{" "}
          <b style={{ color: TEXT }}>${p.notional_usd.toFixed(0)}</b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">conf</span>{" "}
          <b style={{ color: TEXT }}>{Math.round(Number(confDisplay) || 0)}</b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">peak</span>{" "}
          <b style={{ color: p.peak_pnl_pct > 0 ? GREEN : MUTED }}>
            {fmtPctSigned(p.peak_pnl_pct)}%
          </b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">BE</span>{" "}
          <b style={{ color: be ? CYAN : MUTED }}>{be ? "active" : "pending"}</b>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          <span className="opacity-70">partials</span>{" "}
          <b style={{ color: p.partial_exits_taken > 0 ? GREEN : TEXT }}>
            {p.partial_exits_taken === 0
              ? "none"
              : `${p.partial_exits_taken}/2`}
          </b>
        </span>
        {p.regime_at_entry && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>
              <span className="opacity-70">regime</span>{" "}
              <b style={{ color: TEXT }}>{p.regime_at_entry}</b>
            </span>
          </>
        )}
      </div>

      {/* ── Section 5: Mini chart entry → now ── */}
      <MiniChart
        history={historyRef.current}
        entry={p.entry_price}
        stop={p.stop_price}
        target={p.target_price}
        pnlColor={pnlColor}
        direction={p.direction}
      />

      {/* ── Section 6: Exit logic ── */}
      <div
        className="mt-2 text-[11px]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
        }}
      >
        <span className="opacity-70">exit logic:</span>{" "}
        <b style={{ color: be ? CYAN : TEXT }}>{exitLogic}</b>
      </div>
    </div>
  );
}

/* ── LIVE / PAPER micro badge ── */
function ModeBadge({ isLive }: { isLive: boolean }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
      style={{
        background: isLive ? `${GREEN}1a` : `${MUTED}22`,
        color: isLive ? GREEN : MUTED,
        border: `1px solid ${isLive ? `${GREEN}55` : `${MUTED}44`}`,
        letterSpacing: "0.1em",
        fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
      }}
      title={isLive ? "Real money trade" : "Simulated trade"}
    >
      {isLive ? "LIVE" : "PAPER"}
    </span>
  );
}

/* ── Progress bar (unchanged from prior version) ── */
function ProgressBar({
  entry,
  stop,
  target,
  current,
  direction,
  isProfit,
}: {
  entry: number;
  stop: number;
  target: number;
  current: number | null;
  direction: string;
  isProfit: boolean;
}) {
  if (!entry || !stop || !target) return null;
  const isLong = direction.toUpperCase() !== "SHORT";

  const range = target - stop;
  if (range === 0) return null;
  const entryFrac = clamp01((entry - stop) / range);

  let curFrac: number | null = null;
  if (current != null && isFinite(current)) {
    curFrac = clamp01((current - stop) / range);
  }

  const profitColor = isProfit ? GREEN : RED;
  const stopColor = isLong ? RED : GREEN;
  const targetColor = isLong ? GREEN : RED;

  return (
    <div className="mt-2.5 mb-1">
      <div
        className="relative h-1.5 rounded-full overflow-visible"
        style={{
          background: `linear-gradient(90deg, ${stopColor}55 0%, ${MUTED}33 ${(
            entryFrac * 100
          ).toFixed(2)}%, ${targetColor}55 100%)`,
          border: `1px solid ${BORDER}`,
        }}
      >
        <div
          className="absolute top-1/2"
          style={{
            left: `${(entryFrac * 100).toFixed(2)}%`,
            transform: "translate(-50%, -50%)",
            width: 1,
            height: 8,
            background: MUTED,
            opacity: 0.6,
          }}
          aria-hidden
        />
        {curFrac != null && (
          <div
            className="absolute"
            style={{
              left: `${(curFrac * 100).toFixed(2)}%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: profitColor,
              boxShadow: `0 0 8px ${profitColor}`,
              border: `2px solid #0a0a0f`,
              zIndex: 1,
            }}
            aria-hidden
          />
        )}
      </div>
      <div
        className="mt-1 flex justify-between text-[9px]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: stopColor, opacity: 0.85 }}>
          stop {fmtCompact(stop)}
        </span>
        <span style={{ opacity: 0.6 }}>
          {current != null ? fmtCompact(current) : "—"}
        </span>
        <span style={{ color: targetColor, opacity: 0.85 }}>
          tgt {fmtCompact(target)}
        </span>
      </div>
    </div>
  );
}

/* ── Mini price chart entry → now ── */
function MiniChart({
  history,
  entry,
  stop,
  target,
  pnlColor,
  direction,
}: {
  history: PricePoint[];
  entry: number;
  stop: number;
  target: number;
  pnlColor: string;
  direction: string;
}) {
  if (history.length < 2) {
    return (
      <div
        className="mt-3 flex items-center justify-center rounded text-[10px]"
        style={{
          height: 80,
          background: "#0a0a0f",
          color: MUTED,
          border: `1px dashed ${BORDER}`,
        }}
      >
        accumulating price history…
      </div>
    );
  }

  const isLong = direction.toUpperCase() !== "SHORT";
  const stopColor = isLong ? RED : GREEN;
  const targetColor = isLong ? GREEN : RED;

  const allPrices = history.map((h) => h.price);
  const lo = Math.min(...allPrices, stop, target, entry);
  const hi = Math.max(...allPrices, stop, target, entry);
  const pad = (hi - lo) * 0.08 || hi * 0.001;

  return (
    <div className="mt-3" style={{ height: 80, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={history}
          margin={{ top: 4, right: 6, left: 6, bottom: 4 }}
        >
          <XAxis dataKey="ts" hide />
          <YAxis domain={[lo - pad, hi + pad]} hide />
          <ReferenceLine
            y={entry}
            stroke={MUTED}
            strokeDasharray="4 4"
            strokeOpacity={0.55}
          />
          <ReferenceLine y={stop} stroke={stopColor} strokeOpacity={0.45} />
          <ReferenceLine y={target} stroke={targetColor} strokeOpacity={0.45} />
          <Line
            type="monotone"
            dataKey="price"
            stroke={pnlColor}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Helpers ── */
function clamp01(v: number): number {
  if (!isFinite(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function fmtCompact(n: number): string {
  if (!isFinite(n)) return "—";
  return n.toFixed(3).replace(/\.?0+$/, "");
}

function formatEnteredAgo(openedAt: string, holdMinutes: number): string {
  // Prefer hold_minutes from server for accuracy
  if (holdMinutes < 1) return "<1m ago";
  if (holdMinutes < 60) return `${Math.round(holdMinutes)}m ago`;
  const h = Math.floor(holdMinutes / 60);
  const m = Math.round(holdMinutes % 60);
  if (h < 24) return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatExitLogic(
  p: AutoTraderPosition,
  timeoutMinutes: number
): string {
  const remaining = Math.max(0, timeoutMinutes - p.hold_minutes);
  let timeStr: string;
  if (remaining < 1) timeStr = "imminent";
  else if (remaining < 60) timeStr = `${Math.round(remaining)}m`;
  else {
    const h = Math.floor(remaining / 60);
    const m = Math.round(remaining % 60);
    timeStr = m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  if (p.breakeven_stop_active) {
    return `BE locked · timeout in ${timeStr}`;
  }
  if (p.partial_exits_taken > 0) {
    return `${p.partial_exits_taken}/2 partials taken · timeout in ${timeStr}`;
  }
  if (p.peak_pnl_pct > 5) {
    return `trailing engaged · timeout in ${timeStr}`;
  }
  return `timeout in ${timeStr}`;
}
