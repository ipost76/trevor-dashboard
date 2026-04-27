"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

// Per-ticker performance breakdown — 5 cards (BTC/ETH/SOL/HYPE/FARTCOIN).
// 2-col mobile, 5-col desktop. Each card shows:
//   - ticker + tiny equity sparkline
//   - total P&L (large) + W/L record
//   - color-coded win-rate bar (red <40 / amber 40-55 / green >55)
//   - avg win, avg loss, best
// Mode filter pills: All / Live / Paper.

const GREEN = "#00ff88";
const RED = "#ff4757";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#0e1015";
const PANEL_BG = "#12131a";

const SACRED_ORDER = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN"];

type ModeKind = "all" | "live" | "paper";

type EquityPoint = { x: number; y: number };

type PerTickerStats = {
  ticker: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  equity_points: EquityPoint[];
};

type Response = {
  tickers: PerTickerStats[];
  mode: string;
  error?: string;
};

type Props = {
  defaultMode?: ModeKind;
};

function fmtSignedUsd(v: number): string {
  if (Math.abs(v) < 0.005) return "$0.00";
  return `${v > 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
}

function wrColor(wr: number): string {
  if (wr >= 55) return GREEN;
  if (wr >= 40) return AMBER;
  return RED;
}

const MODE_OPTS: { value: ModeKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "paper", label: "Paper" },
];

export function PerTickerCards({ defaultMode = "paper" }: Props) {
  const [mode, setMode] = useState<ModeKind>(defaultMode);
  const [data, setData] = useState<PerTickerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function load() {
      try {
        const res = await fetch(`/api/auto-trader/per-ticker?mode=${mode}`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as Response;
        if (!cancelled) {
          // Order according to SACRED_ORDER for stable layout
          const ordered = SACRED_ORDER.map(
            (t) =>
              body.tickers.find((row) => row.ticker === t) ?? {
                ticker: t,
                trades: 0,
                wins: 0,
                losses: 0,
                win_rate: 0,
                total_pnl: 0,
                avg_win: 0,
                avg_loss: 0,
                best_trade: 0,
                worst_trade: 0,
                equity_points: [],
              }
          );
          setData(ordered);
          setErr(body.error ?? null);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mode]);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <span
          className="text-[11px] uppercase tracking-[0.12em]"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: MUTED,
          }}
        >
          Per-Ticker Performance
          {err && (
            <span className="text-[10px] ml-2" style={{ color: RED }}>
              · {err}
            </span>
          )}
        </span>

        <div
          className="flex items-center gap-0.5 rounded-full border p-0.5"
          style={{ borderColor: BORDER, background: "#0a0a0f" }}
        >
          {MODE_OPTS.map((o) => {
            const active = o.value === mode;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setMode(o.value)}
                className="rounded-full px-2.5 py-0.5 text-[10px] sm:text-[11px] uppercase tracking-[0.06em] transition"
                style={{
                  fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                  background: active ? GREEN : "transparent",
                  color: active ? "#0a0a0f" : MUTED,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
        {data.length === 0 && loading
          ? SACRED_ORDER.map((t) => <SkeletonCard key={t} ticker={t} />)
          : data.map((t) => <Card key={t.ticker} t={t} />)}
      </div>
    </section>
  );
}

function Card({ t }: { t: PerTickerStats }) {
  const empty = t.trades === 0;
  const pnlColor =
    Math.abs(t.total_pnl) < 0.005 ? MUTED : t.total_pnl > 0 ? GREEN : RED;
  const wrC = wrColor(t.win_rate);
  const wrPct = Math.max(0, Math.min(100, t.win_rate));

  return (
    <div
      className="rounded-lg p-2.5 sm:p-3 flex flex-col gap-2"
      style={{
        background: empty ? "#0a0a0f" : SURFACE,
        border: `1px solid ${BORDER}`,
        opacity: empty ? 0.55 : 1,
        minHeight: 200,
      }}
    >
      {/* Ticker header + sparkline */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[12px] sm:text-[13px] font-bold"
          style={{
            color: TEXT,
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            letterSpacing: "0.04em",
          }}
        >
          {t.ticker}
        </span>
        {!empty && t.equity_points.length >= 2 && (
          <div
            style={{ width: 50, height: 18 }}
            aria-hidden
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={t.equity_points}
                margin={{ top: 2, right: 1, left: 1, bottom: 2 }}
              >
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke={pnlColor}
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {empty ? (
        <div
          className="flex-1 flex items-center justify-center text-[10px]"
          style={{ color: MUTED }}
        >
          no trades yet
        </div>
      ) : (
        <>
          {/* Total P&L (big) + W/L record */}
          <div>
            <div
              className="text-[16px] sm:text-[18px] font-bold leading-none"
              style={{
                color: pnlColor,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtSignedUsd(t.total_pnl)}
            </div>
            <div
              className="text-[10px] sm:text-[11px] mt-0.5"
              style={{
                color: MUTED,
                fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <b style={{ color: GREEN }}>{t.wins}W</b>
              <span className="opacity-50"> / </span>
              <b style={{ color: RED }}>{t.losses}L</b>
              <span className="opacity-70"> · {t.trades} total</span>
            </div>
          </div>

          {/* Win rate bar */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span
                className="text-[10px] uppercase tracking-[0.1em]"
                style={{ color: MUTED }}
              >
                WR
              </span>
              <b
                className="text-[12px]"
                style={{
                  color: wrC,
                  fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.win_rate.toFixed(0)}%
              </b>
            </div>
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ background: "#1e2030" }}
              aria-label={`Win rate ${t.win_rate.toFixed(0)}%`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${wrPct}%`,
                  background: wrC,
                  opacity: 0.85,
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>

          {/* Detail stats */}
          <div
            className="text-[10px] sm:text-[11px] space-y-0.5"
            style={{
              color: MUTED,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div>
              <span className="opacity-70">avg win</span>{" "}
              <b style={{ color: GREEN }}>{fmtSignedUsd(t.avg_win)}</b>
            </div>
            <div>
              <span className="opacity-70">avg loss</span>{" "}
              <b style={{ color: RED }}>{fmtSignedUsd(t.avg_loss)}</b>
            </div>
            <div>
              <span className="opacity-70">best</span>{" "}
              <b style={{ color: GREEN }}>{fmtSignedUsd(t.best_trade)}</b>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SkeletonCard({ ticker }: { ticker: string }) {
  return (
    <div
      className="rounded-lg p-2.5 sm:p-3"
      style={{
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
        minHeight: 200,
        opacity: 0.5,
      }}
    >
      <div
        className="text-[12px] font-bold"
        style={{
          color: TEXT,
          fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
        }}
      >
        {ticker}
      </div>
      <div className="mt-3 text-[10px]" style={{ color: MUTED }}>
        loading…
      </div>
    </div>
  );
}
