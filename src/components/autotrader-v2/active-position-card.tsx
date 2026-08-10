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
  // KPI-RECON: nullable — a heartbeat-only ("thin") live position has no replica
  // detail yet, so stop/target/confidence/opened_at arrive null until it syncs.
  stop_price: number | null;
  target_price: number | null;
  leverage: number;
  confidence: number | null;
  notional_usd: number;
  opened_at: string | null;
  peak_pnl_pct?: number | null;
  exit_signals_log?: string | null;
  // W4a: null on a THIN card — heartbeat-only, the replica row carrying the
  // mode has not arrived. Genuinely unknown, and rendered as such.
  trade_mode?: "live" | "paper" | null;
  /**
   * B6-LEDGER: PAPER per the authority, never `trade_mode`. `undefined` = a thin
   * heartbeat card whose replica row hasn't arrived — genuinely unknown.
   */
  is_paper?: boolean;
  // KPI-RECON: true ⇒ live-from-heartbeat but not yet in the replica (thin card).
  thin?: boolean;
}

interface OpenTradesResponse {
  type: "open";
  count: number;
  positions: OpenPosition[];
  // KPI-RECON: open-set tier. true ⇒ live heartbeat membership (badge LIVE);
  // false ⇒ heartbeat down, replica fallback (badge REPLICA). The list length
  // equals the header's open-count because both read the same heartbeat set.
  live?: boolean;
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

// opened_at is naive EASTERN wall-clock ("YYYY-MM-DD HH:MM:SS", no offset) —
// written by Python datetime.now() on the America/New_York VM; created_at is its
// real-UTC twin (proven exactly +4h). To measure the hold WITHOUT the +240-minute
// bug, compare on ONE consistent ET clock: render "now" as ET wall-clock and
// subtract opened_at, parsing BOTH the same append-Z way so the offset cancels →
// true elapsed minutes, DST-robust, no hardcoded ±4/±5. NEVER
// `Date.now() − parseUTC(opened_at)` (a real-UTC now against an ET-string-read-
// as-UTC) — that mismatch is the +240-minute bug this replaces.
function etWallClockNow(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hh = g("hour") === "24" ? "00" : g("hour"); // hour12:false can emit "24"
  return `${g("year")}-${g("month")}-${g("day")}T${hh}:${g("minute")}:${g("second")}`;
}

function holdMin(opened_at: string): number {
  if (typeof opened_at !== "string" || opened_at.length < 16) return 0;
  const openedMs = Date.parse(opened_at.replace(" ", "T") + "Z");
  const nowMs = Date.parse(etWallClockNow() + "Z");
  if (!Number.isFinite(openedMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - openedMs) / 60_000));
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

// exit_signals_log[].ts is naive EASTERN wall-clock ("YYYY-MM-DD HH:MM:SS") —
// written by monitor.py log_exit_event via datetime.now() on the ET VM, the SAME
// clock as opened_at (proven == opened_at, 4h off the UTC created_at). The value
// is ALREADY Eastern, so render the raw HH:MM slice (24h) — NEVER parseUTC /
// new Date / toLocaleTimeString on it (parse-as-UTC-then-relocalize was the
// 4-hour-early bug, the class killed in recent-tab.tsx). "" on bad/empty input.
function fmtEventTime(ts: string | undefined): string {
  if (typeof ts !== "string" || ts.length < 16) return "";
  const hhmm = ts.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm} ET` : "";
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
          {/* 🚨 W4a: the mode marker on the open position — the card Ghost will
              be staring at when the first entry lands. Three renders, and the
              absent case is NOT silent: an unlabelled position card reads as
              real money, so a card whose mode we could not resolve says so
              explicitly rather than showing nothing. `live` is the only value
              that renders the confident LIVE pill. */}
          {/* 🚨 B6-LEDGER: branches on `is_paper` (the authority) instead of
              `trade_mode`, which is stamped 'live' on seven post-cutover paper
              rows. The THREE states are unchanged and the unknown one still
              fails toward "unconfirmed": `is_paper === undefined` means no
              replica row yet, and an unlabelled card reads as real money. */}
          <Pill
            intent={p.is_paper === false ? "live" : "warn"}
            size="sm"
            title={
              p.is_paper === false
                ? "Real order placed on the exchange"
                : p.is_paper === true
                  ? "Simulated position — no order was sent to the exchange"
                  : "Mode not yet known for this position — its detail has not replicated. Treat as unconfirmed."
            }
          >
            {p.is_paper === false
              ? "LIVE"
              : p.is_paper === true
                ? "PAPER"
                : "MODE?"}
          </Pill>
          {/* KPI-RECON: live-but-not-yet-replicated — its detail is still syncing. */}
          {p.thin && (
            <Pill intent="warn" size="sm">
              syncing
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
        {/* KPI-RECON: a thin (heartbeat-only) live position has no opened_at
            until it replicates — omit hold-time rather than render "0m". */}
        {p.opened_at && (
          <span className="flex items-center gap-1 tabular-nums">
            <Clock size={12} aria-hidden />
            {fmtHold(holdMin(p.opened_at))}
          </span>
        )}
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
          {/* KPI-RECON: thin live card — stop/tgt not yet replicated. */}
          {p.thin ? (
            <span className="text-fg-faint"> · stop/tgt syncing…</span>
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
  // KPI-RECON: the open-set freshness tier from /api/auto/trades. true ⇒ live
  // heartbeat (badge LIVE), false ⇒ replica fallback (badge REPLICA), null ⇒
  // not yet known / error fallback (no badge). Never show a live card under a
  // stale label — this badge always reflects the source the rows actually came from.
  const [liveTier, setLiveTier] = React.useState<boolean | null>(null);
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
          // KPI-RECON: track the tier so the header badge matches the source.
          setLiveTier(typeof j.live === "boolean" ? j.live : null);
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
            {/* KPI-RECON: open-set tier badge — the count + cards come from the
                live heartbeat (same source as the header's open-count), so this
                cluster is the LIVE tier. Falls back to a REPLICA badge only if
                the heartbeat was unavailable. Never a live card under a stale label. */}
            {liveTier === true && (
              <Pill intent="live" size="sm">
                LIVE
              </Pill>
            )}
            {liveTier === false && (
              <Pill intent="warn" size="sm">
                REPLICA
              </Pill>
            )}
          </span>
        </CardTitle>
      </CardHeader>

      {loading && <Skeleton className="h-20 w-full" />}

      {!loading && positions && positions.length === 0 && (
        <EmptyState
          title="No open positions"
          body="No open positions right now."
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
