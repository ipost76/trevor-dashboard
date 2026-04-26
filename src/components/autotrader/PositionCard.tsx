import { DirectionBadge } from "@/components/ui/direction-badge";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import type { AutoTraderPosition } from "@/hooks/useAutoTraderStream";

// Single open position card — two logical rows:
//   Row 1 (primary): ticker, direction, entry → current, P&L, leverage, hold
//   Row 2 (exit engine state): trail, BE, peak, partials, R-multiple, regime
//
// Left border color is the at-a-glance state indicator:
//   green  = live profit
//   red    = live loss
//   cyan   = breakeven stop active (risk retired)

const GREEN = "#00ff88";
const RED = "#ff4757";
const CYAN = "#00d4ff";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#0e1015";
const PILL = "#1e2030";

export function PositionCard({ p }: { p: AutoTraderPosition }) {
  const isProfit = p.live_pnl_pct >= 0;
  const be = !!p.breakeven_stop_active;
  const borderColor = be ? CYAN : isProfit ? GREEN : RED;
  const pnlColor = isProfit ? GREEN : RED;

  const hasPrice = p.current_price != null && !p.price_stale;
  const peakFadingDown = p.peak_pnl_pct > 0 && p.live_pnl_pct < p.peak_pnl_pct;
  const confDisplay = p.adjusted_confidence ?? p.confidence;
  const isLiveTrade = p.trade_mode === "live";

  const rColor =
    p.r_multiple >= 1 ? GREEN : p.r_multiple < 0 ? RED : TEXT;

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
      {/* ── Primary row ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div
          className="text-sm sm:text-base font-bold"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: TEXT,
            letterSpacing: "0.02em",
          }}
        >
          {p.ticker}
        </div>
        <DirectionBadge dir={p.direction} />
        <ModeBadge isLive={isLiveTrade} />

        <div
          className="flex items-center gap-1.5 text-[12px] sm:text-[13px]"
          style={{
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ color: MUTED }}>{fmtDollarPrice(p.entry_price)}</span>
          <span style={{ color: MUTED }}>→</span>
          <span style={{ color: hasPrice ? TEXT : MUTED }}>
            {hasPrice ? fmtDollarPrice(p.current_price!) : "—"}
          </span>
        </div>

        <div className="flex-1 min-w-0" />

        <div
          className="flex items-baseline gap-1.5 text-[13px] sm:text-sm font-semibold"
          style={{
            color: pnlColor,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>
            {isProfit ? "+" : ""}${p.live_pnl_usd.toFixed(4)}
          </span>
          <span className="opacity-70 text-[11px]">
            ({fmtPctSigned(p.live_pnl_pct)}%)
          </span>
        </div>

        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: PILL,
            color: MUTED,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          }}
        >
          {p.leverage % 1 === 0 ? p.leverage.toFixed(0) : p.leverage.toFixed(1)}x
        </span>

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

      {/* ── Progress bar: stop → target ── */}
      <ProgressBar
        entry={p.entry_price}
        stop={p.stop_price}
        target={p.target_price}
        current={p.current_price}
        direction={p.direction}
        isProfit={isProfit}
      />

      {/* ── Exit engine row ── */}
      <div
        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {be ? (
          <span className="flex items-center gap-1">
            <span>🎯</span>
            <span>
              Trail:{" "}
              <b style={{ color: CYAN }}>{fmtDollarPrice(p.stop_price)}</b>
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span>🛑</span>
            <span>
              Stop:{" "}
              <b style={{ color: TEXT }}>{fmtDollarPrice(p.stop_price)}</b>
            </span>
          </span>
        )}

        <span className="flex items-center gap-1">
          <span>⚡</span>
          <span>
            BE:{" "}
            <b style={{ color: be ? GREEN : "#5a5a6a" }}>
              {be ? "Active" : "Pending"}
            </b>
          </span>
        </span>

        <span className="flex items-center gap-1">
          <span>📈</span>
          <span>
            Peak:{" "}
            <b style={{ color: p.peak_pnl_pct > 0 ? GREEN : MUTED }}>
              {fmtPctSigned(p.peak_pnl_pct)}%
            </b>
            {peakFadingDown && (
              <span className="ml-0.5 opacity-60" title="fading from peak">
                ↓
              </span>
            )}
          </span>
        </span>

        <span className="flex items-center gap-1">
          <span>📊</span>
          <span>
            Partials:{" "}
            <b style={{ color: p.partial_exits_taken > 0 ? GREEN : TEXT }}>
              {p.partial_exits_taken}/2
            </b>
          </span>
        </span>

        <span className="flex items-center gap-1">
          <span>R:</span>
          <b style={{ color: rColor }}>
            {p.r_multiple > 0 ? "+" : ""}
            {p.r_multiple.toFixed(2)}
          </b>
        </span>

        <span className="flex items-center gap-1">
          <span className="opacity-60">Conf:</span>
          <b style={{ color: TEXT }}>{Math.round(Number(confDisplay) || 0)}</b>
        </span>

        {p.regime_at_entry && (
          <span className="flex items-center gap-1">
            <span className="opacity-60">·</span>
            <span>{p.regime_at_entry}</span>
          </span>
        )}

        {!hasPrice && (
          <span
            className="flex items-center gap-1"
            style={{ color: AMBER }}
            title="price feed unavailable"
          >
            <span>⚠</span>
            <span>stale</span>
          </span>
        )}
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

/* ── Stop → Target progress bar ──
   Visual ribbon with 3 anchors: stop (left/red), entry (mid-tick), target (right/green).
   A vertical "current" tick floats based on price position.
   For LONG: stop < entry < target. For SHORT: stop > entry > target (we flip the math). */
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

  // Map [stop → target] to [0 → 1]. Same formula works for both directions
  // because we just normalize against the absolute travel.
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
        aria-label={`Stop ${stop} entry ${entry} target ${target} current ${current ?? "n/a"}`}
      >
        {/* Entry tick */}
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            left: `${(entryFrac * 100).toFixed(2)}%`,
            transform: "translate(-50%, -50%)",
            width: 1,
            height: 8,
            background: MUTED,
            opacity: 0.6,
          }}
          aria-hidden
          title={`Entry ${entry}`}
        />
        {/* Current tick */}
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
            title={`Current ${current}`}
          />
        )}
      </div>

      {/* Endpoint labels */}
      <div
        className="mt-1 flex justify-between text-[9px]"
        style={{
          color: MUTED,
          fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: stopColor, opacity: 0.85 }}>
          STOP {fmtCompact(stop)}
        </span>
        <span style={{ opacity: 0.6 }}>ENTRY {fmtCompact(entry)}</span>
        <span style={{ color: targetColor, opacity: 0.85 }}>
          TGT {fmtCompact(target)}
        </span>
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  if (!isFinite(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function fmtCompact(n: number): string {
  if (!isFinite(n)) return "—";
  // Mirror fmtPrice: up to 3 decimals, strip trailing zeros
  return n.toFixed(3).replace(/\.?0+$/, "");
}
