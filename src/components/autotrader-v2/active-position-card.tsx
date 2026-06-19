"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
  MoneyText,
  LiveValue,
} from "@/components/ui";
import { Activity, Clock, Target } from "lucide-react";
import { useLiveTerminal } from "@/lib/live-terminal";
import { useLiveMark } from "@/lib/hl-ws-store";

interface OpenPosition {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  stop_price: number;
  target_price: number;
  leverage: number;
  confidence: number;
  notional_usd: number;
  opened_at: string;
  peak_pnl_pct?: number | null;
  exit_signals_log?: string | null;
  trade_mode?: "live" | "paper";
}

interface OpenTradesResponse {
  type: "open";
  count: number;
  positions: OpenPosition[];
}

interface PriceMap {
  [ticker: string]: number;
}

interface PricesResponse {
  prices: Record<string, { price: number; source: string; stale: boolean }>;
}

// The shape produced by the `enriched` useMemo and consumed by <PositionRow>.
type EnrichedPosition = OpenPosition & {
  current_price?: number;
  pnl_pct: number | null;
  peak_display: number | null;
};

const WATCH_TICKERS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "NEAR", "SUI", "kPEPE"];

function parseUTC(ts: string): Date {
  if (!ts) return new Date(NaN);
  let s = ts.includes("T") ? ts : ts.replace(" ", "T");
  if (!/Z$|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  return new Date(s);
}

function holdMin(opened_at: string): number {
  const ts = parseUTC(opened_at);
  if (!Number.isFinite(ts.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - ts.getTime()) / 60_000));
}

function fmtHold(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

// computeRoe — the SINGLE source of truth for the position ROE% math. The
// OFF-path `enriched` useMemo and the live <PositionRow> BOTH route through this
// (no duplicated formula). ROE% = directional price move / entry × 100 ×
// leverage — the existing formula, unchanged; only the mark fed in differs.
function computeRoe(
  direction: "LONG" | "SHORT",
  entry: number,
  mark: number,
  leverage: number,
): number {
  const directional = direction === "LONG" ? mark - entry : entry - mark;
  return (directional / entry) * 100 * (leverage || 1);
}

// Mirror MoneyText's unit="%" + showSign rendering (sign + abs.toFixed(2) + "%",
// U+2212 minus) so the live ROE% LiveValue matches the OFF-path number exactly.
function fmtRoe(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

const ET_TZ = "America/New_York";

interface ExitEvent {
  ts?: string;
  event?: string;
  entry?: number;
  stop?: number;
  regime?: string;
}

// W-A-P2: parse the raw exit_signals_log JSON string → the most-recent event
// for a clean glance line. Never render the raw blob. Returns null on any
// failure (null/empty/malformed/non-array) so the caller omits the line.
function latestExitEvent(raw: string | null | undefined): ExitEvent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const last = parsed[parsed.length - 1];
      return last && typeof last === "object" ? (last as ExitEvent) : null;
    }
    return parsed && typeof parsed === "object" ? (parsed as ExitEvent) : null;
  } catch {
    return null;
  }
}

// Short ET time-of-day (e.g. "4:59 PM ET"), matching dca-section.tsx's ET_TZ
// convention. Reuses parseUTC (naive stamps are UTC). "" on bad/empty input.
function fmtEventTime(ts: string | undefined): string {
  if (!ts) return "";
  const d = parseUTC(ts);
  if (!Number.isFinite(d.getTime())) return "";
  return (
    d.toLocaleTimeString("en-US", {
      timeZone: ET_TZ,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET"
  );
}

// RM-LIVE B4: one open position. Extracted so useLiveMark can be called once
// per ticker UNCONDITIONALLY (React hook rules) — calling it inside the parent's
// enriched.map would vary the hook count per render. Flag OFF: useLiveMark opens
// no socket and the row renders the existing values in the existing JSX
// (byte-identical to the pre-B4 <li>). Flag ON: price + ROE% tick from the WS
// mark and flash via <LiveValue>; the refcounted singleton store means N rows
// (and every card) share ONE WS connection total.
function PositionRow({ p, live }: { p: EnrichedPosition; live: boolean }) {
  const liveMark = useLiveMark(p.ticker, live);

  // Fresher WS mark when the flag is on and a frame has landed for this ticker;
  // null otherwise → the row falls back to the existing /api/prices value the
  // card already uses (p.current_price).
  const wsPrice = live ? liveMark.price : null;
  const mark = wsPrice ?? p.current_price;

  // Effective ROE via the SAME computeRoe helper, fed the fresher mark on the
  // live path; identical to the OFF-path enriched value when wsPrice is null.
  const effRoe =
    wsPrice != null
      ? computeRoe(p.direction, p.entry_price, wsPrice, p.leverage)
      : p.pnl_pct;

  // PKF-01 preserved on the live path: peak never renders below the live ROE.
  // Kept non-flashing (outside the price/ROE% flash scope).
  const storedPeak =
    typeof p.peak_pnl_pct === "number" ? p.peak_pnl_pct : null;
  const effPeak =
    wsPrice != null
      ? storedPeak === null
        ? null
        : typeof effRoe === "number"
          ? Math.max(storedPeak, effRoe)
          : storedPeak
      : p.peak_display;

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {p.trade_mode && (
            <Pill
              intent={p.trade_mode === "live" ? "live" : "warn"}
              size="sm"
            >
              {p.trade_mode}
            </Pill>
          )}
          <span className="text-h3 font-bold tabular-nums">
            {p.ticker}{" "}
            <span
              className={
                p.direction === "LONG"
                  ? "text-accent-green"
                  : "text-accent-red"
              }
            >
              {p.direction}
            </span>
          </span>
        </div>
        {live ? (
          <LiveValue
            value={effRoe ?? null}
            format={fmtRoe}
            className="text-h2 font-bold"
          />
        ) : typeof effRoe === "number" ? (
          <MoneyText value={effRoe} unit="%" size="lg" showSign />
        ) : (
          <span className="text-h3 text-fg-faint">—</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-caption text-fg-muted">
        <span className="flex items-center gap-1 tabular-nums">
          <Target size={12} aria-hidden />
          entry ${fmtPrice(p.entry_price)}
        </span>
        {mark !== undefined && mark !== null && (
          <span className="tabular-nums">
            now ${live ? (
              <LiveValue value={mark} format={fmtPrice} />
            ) : (
              fmtPrice(mark)
            )}
          </span>
        )}
        <span className="tabular-nums">
          {p.leverage}x · ${p.notional_usd?.toFixed(2)}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <Clock size={12} aria-hidden />
          {fmtHold(holdMin(p.opened_at))}
        </span>
        {typeof effPeak === "number" && effPeak !== 0 && (
          <span className="flex items-center gap-1">
            peak
            <MoneyText
              value={effPeak}
              unit="%"
              size="sm"
              decimals={2}
              showSign
            />
          </span>
        )}
      </div>

      {/* W-A-P2: trade-levels glance + most-recent event·time.
          Replaces the raw exit_signals_log JSON blob — never rendered. */}
      <div className="flex flex-col gap-0.5 text-caption text-fg-muted">
        <span className="tabular-nums">
          entry ${fmtPrice(p.entry_price)}
          {p.stop_price ? <> · stop ${fmtPrice(p.stop_price)}</> : null}
          {p.target_price ? (
            <> · tgt ${fmtPrice(p.target_price)}</>
          ) : null}
        </span>
        {(() => {
          const ev = latestExitEvent(p.exit_signals_log);
          const when = fmtEventTime(ev?.ts);
          if (!ev?.event && !when) return null;
          return (
            <span className="tabular-nums">
              {ev?.event ?? "event"}
              {when ? ` · ${when}` : ""}
            </span>
          );
        })()}
      </div>
    </li>
  );
}

export function ActivePositionCard() {
  const [positions, setPositions] = React.useState<OpenPosition[] | null>(null);
  const [prices, setPrices] = React.useState<PriceMap>({});
  const [loading, setLoading] = React.useState(true);
  // RM-LIVE B4: live-terminal flag (default OFF). Called unconditionally; only
  // the displayed value branches on it. Each <PositionRow> calls useLiveMark.
  const liveTerminal = useLiveTerminal();

  React.useEffect(() => {
    let cancelled = false;

    // Open positions come from a Python subprocess (slow) — keep at 15s.
    const fetchTrades = async () => {
      try {
        const snapRes = await fetch("/api/auto/trades?type=open&limit=10", {
          cache: "no-store",
        });
        if (snapRes.ok && !cancelled) {
          const j = (await snapRes.json()) as OpenTradesResponse;
          setPositions(j.positions ?? []);
        }
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // LP-01 (2026-05-31): live price half polls at 2s so unrealized P&L
    // (recomputed below from entry + live price) ticks live. /api/prices serves
    // the WS-fed store → zero HL REST per poll; single persistent WS. The
    // expensive open-positions fetch stays at 15s.
    const fetchPrices = async () => {
      try {
        const priceRes = await fetch(
          `/api/prices?tickers=${WATCH_TICKERS.join(",")}`,
          { cache: "no-store" },
        );
        if (priceRes.ok && !cancelled) {
          const j = (await priceRes.json()) as PricesResponse;
          const pm: PriceMap = {};
          for (const [t, v] of Object.entries(j.prices ?? {})) {
            if (typeof v?.price === "number") pm[t] = v.price;
          }
          setPrices(pm);
        }
      } catch {
        /* keep last good state */
      }
    };

    fetchTrades();
    fetchPrices();
    const tradesId = setInterval(fetchTrades, 15_000);
    // PERF-06 (2026-06-03): jitter the 2s price poll (±0–400ms, re-randomized each
    // tick) so it doesn't fire in lockstep with PriceStrip's identical 2s
    // /api/prices poll — flattens the coordinated burst. ~2.2s avg cadence.
    let pricesTimer: ReturnType<typeof setTimeout>;
    const schedulePrices = () => {
      pricesTimer = setTimeout(async () => {
        await fetchPrices();
        if (!cancelled) schedulePrices();
      }, 2_000 + Math.random() * 400);
    };
    schedulePrices();
    return () => {
      cancelled = true;
      clearInterval(tradesId);
      clearTimeout(pricesTimer);
    };
  }, []);

  const enriched = React.useMemo<EnrichedPosition[]>(() => {
    if (!positions) return [];
    return positions.map((p) => {
      const live = prices[p.ticker];
      let pnl_pct: number | null = null;
      if (live && p.entry_price) {
        // OFF-path ROE via the shared helper — byte-identical output to the
        // prior inline expression (same mark, same formula).
        pnl_pct = computeRoe(p.direction, p.entry_price, live, p.leverage);
      }
      // PKF-01: peak must never render BELOW the live unrealized % — the stored
      // peak_pnl_pct ratchet can stall (e.g. while a live trade is stuck in the
      // PARTIAL_EXIT branch and never reaches the HOLD persist path), so guard
      // the DISPLAY at max(stored peak, live%). Belt-and-suspenders until the
      // bot-side ratchet stall (PKF-02) is fixed with the partial-storm bug.
      const storedPeak =
        typeof p.peak_pnl_pct === "number" ? p.peak_pnl_pct : null;
      const peak_display =
        storedPeak === null
          ? null
          : typeof pnl_pct === "number"
            ? Math.max(storedPeak, pnl_pct)
            : storedPeak;
      return { ...p, current_price: live, pnl_pct, peak_display };
    });
  }, [positions, prices]);

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <Activity size={14} aria-hidden />
            Active · {positions?.length ?? 0}
          </span>
        </CardTitle>
      </CardHeader>

      {loading && <Skeleton className="h-20 w-full" />}

      {!loading && positions && positions.length === 0 && (
        <EmptyState
          title="No open positions"
          body="Awaiting next signal that clears the per-ticker threshold."
          className="min-h-[100px]"
        />
      )}

      {!loading && enriched.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {enriched.map((p) => (
            <PositionRow key={p.id} p={p} live={liveTerminal} />
          ))}
        </ul>
      )}
    </Card>
  );
}
