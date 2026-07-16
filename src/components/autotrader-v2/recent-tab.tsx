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
  FilterChips,
  BottomSheet,
  HapticButton,
} from "@/components/ui";
import { History, AlertTriangle } from "lucide-react";

interface ClosedTrade {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  pnl_pct: number | null;
  pnl_usd: number | null;
  hold_duration_minutes: number | null;
  closed_at: string;
  trade_mode: "live" | "paper";
  exit_reason?: string | null;
}

interface ClosedTradesResponse {
  type: "closed";
  count: number;
  trades: ClosedTrade[];
  // B2: present on ANY failure path (the route's runPython-throw catch, the
  // Python script's own error payloads, and the route's parse-failure fallback),
  // so the client can tell "fetch broke" from "no trades this day".
  error?: string;
}

const SACRED_TICKERS: ReadonlyArray<string> = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN", "XRP", "DOGE", "NEAR", "SUI", "kPEPE"];
const DIRECTION_OPTIONS: ReadonlyArray<string> = ["ALL", "LONG", "SHORT"];
const OUTCOME_OPTIONS: ReadonlyArray<string> = ["ALL", "PROFITABLE", "LOSING"];

// B2 (2026-07-15): the RECENT tab requests up to this many closed rows. Raised
// 200 → 2000 so a full ET date range (1W ~203, MAX ~482 post-cutover) returns
// without silent truncation — the route ceiling was raised to match, and the
// AUTO_CUTOVER_EPOCH floor naturally bounds the post-cutover set well under this.
// The capped notice stays HONEST against this ceiling (it fires only if a range
// genuinely returns ≥ 2000 rows — a future-pagination signal, not silent loss).
const RECENT_LIMIT = 2000;

// B2: server-side ET date-range chips. TODAY is the default on mount. The chip
// drives a server REFETCH (not a client filter); the three chips above still
// filter the fetched range client-side on top, so all four compose.
const RANGE_OPTIONS = ["TODAY", "YESTERDAY", "1W", "MAX", "CUSTOM"] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number];

// B2: today's EASTERN calendar date as YYYY-MM-DD — the ET helper reused verbatim
// from capital-hero.tsx. en-CA renders ISO YYYY-MM-DD; America/New_York matches
// the server's ET buckets AND the stored ET closed_at, regardless of the phone's
// own timezone (a phone in any tz still asks for the correct Eastern day).
function etTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(),
  );
}

// B2: add N calendar days to a YYYY-MM-DD string, DRIFT-FREE. The string is a
// pure calendar date: parse to a UTC instant, shift in UTC (which has NO DST),
// reformat as YYYY-MM-DD. A naive `new Date(str)` + setDate() would drift via the
// browser's local tz — this never touches local time, so it can't roll a day.
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// B2: map a range chip → INCLUSIVE ET (start, end) calendar dates, matching the
// capital-hero → query_auto_state contract (start/end are inclusive; the server
// applies the exclusive +1-day upper bound). MAX → null (no range; the SQL
// cutover floor bounds it at the post-cutover set). CUSTOM uses the APPLIED
// picker dates (null until Apply → treated as MAX-style no-range).
function rangeParams(
  range: RangeKey,
  today: string,
  customStart: string | null,
  customEnd: string | null,
): { start: string; end: string } | null {
  switch (range) {
    case "TODAY":
      return { start: today, end: today };
    case "YESTERDAY": {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case "1W":
      return { start: addDays(today, -6), end: today };
    case "MAX":
      return null;
    case "CUSTOM":
      return customStart && customEnd
        ? { start: customStart, end: customEnd }
        : null;
  }
}

// B2: day-separator label for a raw ET date prefix ("2026-07-14" → "TUE JUL 14").
// tz-INDEPENDENT: build a UTC instant from the calendar parts and format in UTC,
// so the browser's own timezone can never roll the label to an adjacent day.
function fmtDayHeader(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
    .format(dt)
    .replace(",", "")
    .toUpperCase();
}

function fmtHold(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

// closed_at is stored as EASTERN-LOCAL naive wall-clock ("YYYY-MM-DD HH:MM:SS",
// no offset/Z) — written by Python datetime.now() on the America/New_York VM.
// Render the raw HH:MM slice (24h): the value is ALREADY Eastern, so do NOT
// parse it as UTC + re-localize — that was the 4-hour bug (15:21 EDT → 11:21).
// The raw slice is browser-timezone-independent (a phone in any tz shows the
// true ET close). A1 proof: created_at (SQLite CURRENT_TIMESTAMP = real UTC)
// == opened_at/closed_at + exactly 4h on every row. Guarded: null/short/
// malformed → "--:--" (never NaN, never an empty gap).
function fmtEastern(ts: string | null | undefined): string {
  if (typeof ts !== "string" || ts.length < 16) return "--:--";
  const hhmm = ts.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : "--:--";
}

export function RecentTab() {
  const [trades, setTrades] = React.useState<ClosedTrade[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  // B2: distinct error state (null on the most recent successful fetch) so a
  // broken fetch never masquerades as an empty day.
  const [error, setError] = React.useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = React.useState<string>("ALL");
  const [directionFilter, setDirectionFilter] = React.useState<string>("ALL");
  const [outcomeFilter, setOutcomeFilter] = React.useState<string>("ALL");

  // B2: range chip (default TODAY) + custom-range picker state. `customStart/End`
  // are the APPLIED range (drive the fetch); `draftStart/End` are the in-sheet
  // picker values (no fetch until Apply). The picker caps both at ET-today.
  const [range, setRange] = React.useState<RangeKey>("TODAY");
  const etToday = React.useMemo(() => etTodayStr(), []);
  const [customStart, setCustomStart] = React.useState<string | null>(null);
  const [customEnd, setCustomEnd] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [draftStart, setDraftStart] = React.useState<string>("");
  const [draftEnd, setDraftEnd] = React.useState<string>("");

  // B2: derive the fetch URL from the CURRENT range. This URL is the effect's SOLE
  // dependency (mirroring capital-hero's stateUrl), so a range change re-runs the
  // effect — tearing down the old 30s interval and subscribing a fresh one bound
  // to the current range. A [] deps effect would capture the initial (TODAY) URL
  // and keep polling TODAY after the user picks 1W — the classic stale-closure
  // bug. MAX / an un-applied CUSTOM → no range params (cutover-floored default).
  const params = rangeParams(range, etToday, customStart, customEnd);
  const tradesUrl = params
    ? `/api/auto/trades?type=closed&limit=${RECENT_LIMIT}&start=${params.start}&end=${params.end}`
    : `/api/auto/trades?type=closed&limit=${RECENT_LIMIT}`;

  React.useEffect(() => {
    let cancelled = false;
    const fetchTrades = async () => {
      try {
        const res = await fetch(tradesUrl, { cache: "no-store" });
        if (cancelled) return;
        // B2: surface a broken fetch (was a bare `return` that left the empty
        // state showing). !res.ok → HTTP-level failure.
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const j = (await res.json()) as ClosedTradesResponse;
        if (cancelled) return;
        // B2: the route now returns { ...error } (HTTP 200) on every failure path,
        // so a payload-level error is distinguishable from a genuine empty day.
        if (j.error) {
          setError(j.error);
          return;
        }
        setTrades(j.trades ?? []);
        setError(null); // most recent fetch succeeded — clear any prior error
      } catch (e) {
        // B2: network / parse failure → honest error, NEVER a silent "no trades".
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTrades();
    const id = setInterval(fetchTrades, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tradesUrl]);

  const tickerOptions = React.useMemo<string[]>(() => {
    const discovered = new Set<string>(SACRED_TICKERS);
    (trades ?? []).forEach((t) => discovered.add(t.ticker));
    return ["ALL", ...Array.from(discovered).sort()];
  }, [trades]);

  const filteredTrades = React.useMemo(() => {
    if (!trades) return [];
    return trades.filter((t) => {
      if (tickerFilter !== "ALL" && t.ticker !== tickerFilter) return false;
      if (directionFilter !== "ALL" && t.direction !== directionFilter) return false;
      if (outcomeFilter === "PROFITABLE" && !(t.pnl_pct != null && t.pnl_pct > 0)) return false;
      if (outcomeFilter === "LOSING" && !(t.pnl_pct != null && t.pnl_pct <= 0)) return false;
      return true;
    });
  }, [trades, tickerFilter, directionFilter, outcomeFilter]);

  // B2: group the (already closed_at-DESC) filtered set by its raw ET date prefix
  // — closed_at.slice(0,10) IS the Eastern calendar day (no parse, no conversion).
  // Same-day rows are contiguous (the SQL orders by closed_at DESC), so a single
  // linear pass groups them. Separators render ONLY when the set spans >1 distinct
  // ET day (`multiDay`), so TODAY / YESTERDAY / single-day CUSTOM show none.
  const dayGroups = React.useMemo(() => {
    const groups: { day: string; trades: ClosedTrade[] }[] = [];
    for (const t of filteredTrades) {
      const day = typeof t.closed_at === "string" ? t.closed_at.slice(0, 10) : "";
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.trades.push(t);
      else groups.push({ day, trades: [t] });
    }
    return groups;
  }, [filteredTrades]);
  const multiDay = dayGroups.length > 1;

  // B6-RECENT-GAPS / B2: server returns at most RECENT_LIMIT closed rows. When the
  // returned set hits that ceiling, real older closed trades are hidden — surface
  // it. Honest against the raised 2000 ceiling: with the post-cutover floor
  // bounding the set at ~482, this no longer fires for any current window, but
  // stays truthful if a range ever genuinely reaches the ceiling.
  const capped = (trades?.length ?? 0) >= RECENT_LIMIT;

  // B2: tapping "Custom" opens the picker (pre-filled with the applied range or
  // today) instead of selecting a precomputed window. Presets select directly.
  const handleRangeChange = (label: string) => {
    const r = label as RangeKey;
    if (r === "CUSTOM") {
      setDraftStart(customStart ?? etToday);
      setDraftEnd(customEnd ?? etToday);
      setPickerOpen(true);
      return;
    }
    setRange(r);
  };

  // B2: both dates set, end ≥ start, neither in the future. String compare on
  // YYYY-MM-DD is chronologically correct. Apply stays disabled until this holds;
  // single-day (start === end) is allowed.
  const draftValid =
    draftStart !== "" &&
    draftEnd !== "" &&
    draftStart <= draftEnd &&
    draftStart <= etToday &&
    draftEnd <= etToday;

  const applyCustom = () => {
    if (!draftValid) return;
    setCustomStart(draftStart);
    setCustomEnd(draftEnd);
    setRange("CUSTOM");
    setPickerOpen(false);
  };

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <div className="space-y-3">
        <FilterChips
          options={tickerOptions}
          selected={tickerFilter}
          onChange={setTickerFilter}
          ariaLabel="Filter by ticker"
        />
        <FilterChips
          options={DIRECTION_OPTIONS}
          selected={directionFilter}
          onChange={setDirectionFilter}
          ariaLabel="Filter by direction"
        />
        <FilterChips
          options={OUTCOME_OPTIONS}
          selected={outcomeFilter}
          onChange={setOutcomeFilter}
          ariaLabel="Filter by outcome"
        />
        {/* B2: 4th row — server-side ET date range (drives a refetch, not a
            client filter; composes with the three above). */}
        <FilterChips
          options={RANGE_OPTIONS}
          selected={range}
          onChange={handleRangeChange}
          ariaLabel="Filter by date range"
        />
      </div>

      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <History size={14} aria-hidden />
              Recent Signals
              {trades && (
                <span className="ml-1 font-mono text-micro text-fg-muted">
                  {filteredTrades.length}/{trades.length}
                </span>
              )}
            </span>
          </CardTitle>
        </CardHeader>

        {/* B2: transient refresh failure while last-good data is still shown. */}
        {error != null && trades !== null && (
          <p className="mb-3 flex items-center gap-1.5 font-sans text-micro text-accent-red">
            <AlertTriangle size={12} aria-hidden />
            Couldn&apos;t refresh — showing the last successful update.
          </p>
        )}

        {trades && capped && (
          <p className="mb-3 font-sans text-micro text-accent-gold">
            List capped — showing {trades.length} most recent (older closed trades hidden).
          </p>
        )}

        {loading && <Skeleton className="h-32 w-full" />}

        {/* B2: FULL error state — visually distinct from an empty day. First-load
            failure only (no data ever loaded → trades still null). Ghost can tell
            at a glance that the Hub is broken vs. that the bot hasn't traded. */}
        {!loading && error != null && trades === null && (
          <div className="flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-md border border-accent-red/40 bg-accent-red/5 p-6 text-center">
            <AlertTriangle size={20} className="text-accent-red" aria-hidden />
            <span className="font-sans text-caption font-semibold text-accent-red">
              Couldn&apos;t load trades
            </span>
            <span className="font-sans text-micro text-fg-muted">
              The trades API is unreachable — a Hub/data error, not an empty day.
              Retrying every 30s.
            </span>
          </div>
        )}

        {/* Calm empty — genuinely no trades (or filtered to none). Never shown when
            trades is null (that's the full error above). A pre-cutover CUSTOM
            range correctly lands here (0 rows is the right answer, not an error). */}
        {!loading && trades !== null && filteredTrades.length === 0 && (
          <EmptyState
            title={
              trades.length > 0
                ? "No matches"
                : range === "TODAY"
                  ? "No closed trades today yet"
                  : "No closed trades in this window"
            }
            body={
              trades.length > 0
                ? "Try widening the ticker / direction / outcome filters."
                : "Nothing closed in the selected window."
            }
            className="min-h-[80px]"
          />
        )}

        {!loading && filteredTrades.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {dayGroups.map((g) => (
              <React.Fragment key={g.day}>
                {/* B2: day separator (── TUE JUL 14 ── + count). Multi-day ranges
                    only; single-day windows render none (redundant). A plain <li>
                    that rides the divide-y rhythm — no new primitive. */}
                {multiDay && (
                  <li className="flex items-center gap-2 py-2 font-sans text-micro uppercase tracking-wider text-fg-muted">
                    <span className="h-px flex-1 bg-border-subtle" aria-hidden />
                    <span>{fmtDayHeader(g.day)}</span>
                    <span className="tabular-nums text-fg-faint">{g.trades.length}</span>
                    <span className="h-px flex-1 bg-border-subtle" aria-hidden />
                  </li>
                )}
                {g.trades.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    {/* left column — line 1 identity (bold), line 2 meta (one line, never wraps) */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-bold tabular-nums text-fg-primary">
                        {t.ticker}{" "}
                        <span
                          className={
                            t.direction === "LONG"
                              ? "text-accent-mint-strong"
                              : "text-accent-red"
                          }
                        >
                          {t.direction}
                        </span>
                      </div>
                      {/* HH:MM (raw Eastern) · duration · exit_reason — single line,
                          long reason ellipses (never wraps). min-w-0 is load-bearing
                          for truncate to work inside the flex child. */}
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-micro text-fg-muted tabular-nums">
                        <span className="shrink-0" title={t.closed_at}>
                          {fmtEastern(t.closed_at)}
                        </span>
                        <span className="shrink-0 text-fg-faint">·</span>
                        <span className="shrink-0">{fmtHold(t.hold_duration_minutes)}</span>
                        {t.exit_reason && (
                          <>
                            <span className="shrink-0 text-fg-faint">·</span>
                            <span className="min-w-0 truncate">{t.exit_reason}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* fixed-width right P&L column so every row's % aligns on a common
                        x. -100.00% (8 glyphs) is the sizing worst case; min-w is a floor
                        not a cap → a rare >100% value extends left instead of clipping.
                        The no-P&L pill lives in the SAME column so alignment holds. */}
                    <div className="min-w-[5rem] shrink-0 text-right">
                      {t.pnl_pct != null ? (
                        <MoneyText value={t.pnl_pct} unit="%" size="md" showSign />
                      ) : (
                        // B6-RECENT-GAPS / RM-RED-2 M10: closed trade w/ no captured
                        // native P&L → "no P&L" neutral pill (never a misleading 0.00%).
                        <Pill tone="neutral" size="sm" title="Closed — native P&L not captured">
                          no P&L
                        </Pill>
                      )}
                    </div>
                  </li>
                ))}
              </React.Fragment>
            ))}
          </ul>
        )}
      </Card>

      {/* B2: CUSTOM date-range picker (native inputs, phone-friendly) — mirrors
          capital-hero. No date library; both inputs capped at ET-today. */}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Custom range"
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Start
            </span>
            <input
              type="date"
              value={draftStart}
              max={etToday}
              onChange={(e) => setDraftStart(e.target.value)}
              className="w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 font-mono text-body tabular-nums text-fg-primary focus:border-accent-cyan-soft focus:outline-none"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              End
            </span>
            <input
              type="date"
              value={draftEnd}
              min={draftStart || undefined}
              max={etToday}
              onChange={(e) => setDraftEnd(e.target.value)}
              className="w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 font-mono text-body tabular-nums text-fg-primary focus:border-accent-cyan-soft focus:outline-none"
            />
          </label>
          {draftStart !== "" && draftEnd !== "" && draftStart > draftEnd && (
            <p className="font-sans text-micro text-accent-red">
              End date must be on or after the start date.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <HapticButton
              variant="secondary"
              fullWidth
              onClick={() => setPickerOpen(false)}
            >
              Cancel
            </HapticButton>
            <HapticButton
              variant="primary"
              fullWidth
              disabled={!draftValid}
              onClick={applyCustom}
              className="disabled:pointer-events-none disabled:opacity-40"
            >
              Apply
            </HapticButton>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
