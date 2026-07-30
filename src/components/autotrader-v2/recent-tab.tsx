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
import { cn } from "@/lib/utils";
import { ReplicaAge } from "@/lib/replica-age";
import { SignalsCard } from "./signals-card";
import { History, AlertTriangle, SlidersHorizontal } from "lucide-react";

interface ClosedTrade {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  pnl_pct: number | null;
  pnl_usd: number | null;
  hold_duration_minutes: number | null;
  // B1-COLLAPSE-FILTERS: opened_at is the SAME naive-EASTERN clock as closed_at
  // (created_at == opened_at + 4h proven live) — rendered via the raw fmtEastern
  // HH:MM slice, NEVER parseUTC/new Date/toLocale*. Optional-guarded to "--:--".
  opened_at?: string | null;
  closed_at: string;
  trade_mode: "live" | "paper";
  exit_reason?: string | null;
  // W4a: the Smart-Exit layer that fired. INTEGER with fractional layers ×10 —
  // layer 6.5 is stored 65, 6.2 is 62. See fmtExitLayer.
  exit_layer?: number | null;
}

interface ClosedTradesResponse {
  type: "closed";
  count: number;
  trades: ClosedTrade[];
  /** W4a: age of the replica this list came from. null => render no age claim. */
  replica_age_seconds?: number | null;
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

// B1-COLLAPSE-FILTERS: the held window "HH:MM → HH:MM" — BOTH times raw Eastern
// via fmtEastern (opened_at is the SAME naive-Eastern clock as closed_at; created_at
// == opened_at + 4h proven live). NEVER parseUTC / new Date / toLocale* on either.
// GUARD: if opened_at is null/malformed (fmtEastern -> "--:--"), degrade to the
// close time ALONE (no misleading "--:-- → HH:MM") — the same close-time-only value
// the row showed before. NULL opened_at count is 0 today; this is purely defensive.
function fmtWindow(opened: string | null | undefined, closed: string): string {
  const open = fmtEastern(opened);
  const close = fmtEastern(closed);
  return open === "--:--" ? close : `${open} → ${close}`;
}

// ─── W4a (2026-07-30): WHICH EXIT LAYER FIRED ───────────────────────────────
// `auto_trades.exit_layer` stores fractional layers ×10 — 6.5 is 65, 6.2 is 62
// — so a bare render would print "L65". Measured all-time on the WSL replica
// 2026-07-30: 0(129) 1(46) 4(36) 6(747) 7(20) 62(12) 65(99), plus one -1.
// Two-digit values divide; anything else prints as-is. Purely a display
// transform — never do arithmetic on this column.
function fmtExitLayer(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n >= 10) return `L${n / 10}`;
  return `L${n}`;
}

// 🚨 Layers 3 (breakeven) and 4.5 (ratchet) have NEVER fired — zero rows in the
// entire table as of 2026-07-30. Their first appearance is a first-ever event
// in this system and Ghost should not have to notice it from a P&L number
// alone. Stored as 3 and 45 respectively.
const FIRST_EVER_LAYERS: ReadonlyArray<number> = [3, 45];
function isFirstEverLayer(n: number | null | undefined): boolean {
  return typeof n === "number" && FIRST_EVER_LAYERS.includes(n);
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
  const [draftStart, setDraftStart] = React.useState<string>("");
  const [draftEnd, setDraftEnd] = React.useState<string>("");

  // B1-COLLAPSE-FILTERS: the 4 filter groups now live inside ONE FILTERS
  // BottomSheet (filtersOpen). CUSTOM's date inputs render INLINE inside that
  // same sheet when the CUSTOM chip is active (customExpanded) — NEVER a second
  // nested sheet (bottom-sheet.tsx has no z-stacking/scroll-lock nesting guard,
  // and one Escape would close both). All filter state stays here in RecentTab —
  // the sheet renders the SAME controlled <FilterChips> wired to the SAME setters,
  // so B2's tradesUrl-as-effect-dep stale-closure fix is fully preserved.
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [customExpanded, setCustomExpanded] = React.useState(false);
  // W4a: age of the replica the current list was read from.
  const [replicaAge, setReplicaAge] = React.useState<number | null>(null);

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
        // W4a: capture the replica's age alongside the rows. undefined (an older
        // payload) => null => <ReplicaAge> renders nothing, never a false claim.
        setReplicaAge(j.replica_age_seconds ?? null);
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

  // B2/B1-COLLAPSE-FILTERS: tapping "Custom" reveals the INLINE date inputs
  // (pre-filled with the applied range or today) inside the FILTERS sheet — no
  // second sheet. Presets select directly AND collapse the inline custom inputs.
  const handleRangeChange = (label: string) => {
    const r = label as RangeKey;
    if (r === "CUSTOM") {
      setDraftStart(customStart ?? etToday);
      setDraftEnd(customEnd ?? etToday);
      setCustomExpanded(true);
      return;
    }
    setCustomExpanded(false);
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
    // range is now CUSTOM, so the inline inputs stay visible via `showCustomInputs`
    // (they remain editable for a re-Apply). No sheet to close.
  };

  // B1-COLLAPSE-FILTERS: the CUSTOM date inputs show whenever CUSTOM is the active
  // range OR the user just tapped the CUSTOM chip (pre-apply).
  const showCustomInputs = range === "CUSTOM" || customExpanded;

  // B1-COLLAPSE-FILTERS: at-a-glance active-filter state for the FILTERS button —
  // count of NON-DEFAULT filters (defaults: ALL / ALL / ALL / TODAY) + a compact
  // summary. He never wonders what's filtered without opening the sheet.
  const activeFilters: string[] = [];
  if (tickerFilter !== "ALL") activeFilters.push(tickerFilter);
  if (directionFilter !== "ALL") activeFilters.push(directionFilter);
  if (outcomeFilter !== "ALL") activeFilters.push(outcomeFilter);
  if (range !== "TODAY") activeFilters.push(range);
  const activeCount = activeFilters.length;
  const activeSummary = activeFilters.join(" · ");

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* W4b: signals FIRST. A signal precedes its trade, and during a quiet
          stretch this is the card that answers "is anything happening at all?"
          — the question an empty trades list cannot distinguish from a broken
          Hub. It carries its own data-age line and its own three-state empty
          message; see signals-card.tsx. */}
      <SignalsCard />

      <Card padding="md">
        <CardHeader>
          {/* B1-COLLAPSE-FILTERS: the header is the single control+status bar —
              title + {filtered}/{total} on the left, the FILTERS button (opening
              the sheet) on the right. The 4 chip rows moved into the sheet. The
              button is min-w-0 so its summary truncates; the title holds its width. */}
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              <span className="flex items-center gap-2 uppercase tracking-wider">
                <History size={14} aria-hidden />
                {/* 🚨 W4a: was "Recent Signals". This card has only ever rendered
                    closed TRADES — the count beside it is filteredTrades/trades.
                    Reading "RECENT SIGNALS 0/0" as "zero signals fired" is exactly
                    the wrong conclusion: 28 signals posted in the preceding 18h.
                    (The real signal surface is W4b.) */}
                Recent Trades
                {trades && (
                  <span className="ml-1 font-mono text-micro text-fg-muted">
                    {filteredTrades.length}/{trades.length}
                  </span>
                )}
              </span>
            </CardTitle>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-label={
                activeCount > 0
                  ? `Open filters — ${activeCount} active: ${activeSummary}`
                  : "Open filters"
              }
              className={cn(
                "tap-target flex min-w-0 items-center gap-1.5 rounded-pill border px-3 py-1 font-sans text-micro uppercase tracking-wider transition-colors duration-fast",
                activeCount > 0
                  ? "border-accent-cyan-soft bg-accent-cyan-soft/10 text-accent-cyan-soft-strong shadow-glow-subtle-cyan"
                  : "border-border-subtle text-fg-muted hover:border-accent-cyan-soft/40 hover:text-fg-primary",
              )}
            >
              <SlidersHorizontal size={12} className="shrink-0" aria-hidden />
              <span className="shrink-0">Filters</span>
              {activeCount > 0 && (
                <span className="shrink-0 rounded-pill bg-accent-cyan-soft/20 px-1.5 tabular-nums text-accent-cyan-soft-strong">
                  {activeCount}
                </span>
              )}
              {activeCount > 0 && (
                <span className="min-w-0 truncate normal-case tracking-normal text-fg-muted">
                  {activeSummary}
                </span>
              )}
            </button>
          </div>
        </CardHeader>

        {/* 🚨 W4a: the data's AGE, above the list and visible whether or not the
            list is empty. This is the line that stops an empty window reading as
            "nothing happened" when the truth is "the replica has not caught up".
            Always rendered here, never only in the empty state. */}
        <ReplicaAge ageSeconds={replicaAge} className="mb-3 block" />

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
                : // W4a: name BOTH readings so an empty screen is unambiguous.
                  // The age line above resolves which one it is.
                  "Nothing closed in the selected window. The data's age is shown above — if it looks current, the bot genuinely hasn't closed a trade."
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
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-body font-bold tabular-nums text-fg-primary">
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
                        </span>
                        {/* 🚨 W4a: the PAPER marker. This pill was REMOVED in
                            B1 (2026-07-15) as "constant, since the SQL hard-filters
                            trade_mode='live'". That premise died when the paper
                            window opened: the list is now mode-blind and mixes
                            both, so the label is load-bearing again. It renders
                            ONLY for paper, so a live-only list stays visually
                            quiet and the marker keeps its meaning. */}
                        {t.trade_mode === "paper" && (
                          <Pill
                            intent="warn"
                            size="sm"
                            className="shrink-0"
                            title="Simulated trade — no order was sent to the exchange"
                          >
                            PAPER
                          </Pill>
                        )}
                      </div>
                      {/* HH:MM → HH:MM (raw Eastern held window) · exit_reason —
                          single line, long reason ellipses (never wraps). min-w-0 is
                          load-bearing for truncate to work inside the flex child.
                          Duration dropped: the window conveys it (Ghost's call). */}
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-micro text-fg-muted tabular-nums">
                        <span
                          className="shrink-0"
                          title={
                            t.opened_at
                              ? `${t.opened_at} → ${t.closed_at}`
                              : t.closed_at
                          }
                        >
                          {fmtWindow(t.opened_at, t.closed_at)}
                        </span>
                        {t.exit_reason && (
                          <>
                            <span className="shrink-0 text-fg-faint">·</span>
                            <span className="min-w-0 truncate">{t.exit_reason}</span>
                          </>
                        )}
                        {/* W4a: WHICH exit layer fired. The P&L alone cannot tell
                            a breakeven exit from a stop; the layer can. */}
                        {fmtExitLayer(t.exit_layer) && (
                          <>
                            <span className="shrink-0 text-fg-faint">·</span>
                            <span
                              className={cn(
                                "shrink-0",
                                isFirstEverLayer(t.exit_layer)
                                  ? "font-bold text-accent-cyan-soft-strong"
                                  : "text-fg-faint",
                              )}
                              title={
                                isFirstEverLayer(t.exit_layer)
                                  ? "FIRST EVER — this exit layer had never fired before"
                                  : "Smart Exit layer that closed this trade"
                              }
                            >
                              {fmtExitLayer(t.exit_layer)}
                              {isFirstEverLayer(t.exit_layer) && " ★ 1st ever"}
                            </span>
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

      {/* B1-COLLAPSE-FILTERS: ONE sheet hosts all 4 filter groups (reusing the
          SAME controlled <FilterChips> + setters — B2's server-range refetch and
          the composed client-side useMemo are untouched). CUSTOM's date inputs
          render INLINE below the range chips (never a nested sheet). No date
          library; both inputs capped at ET-today. */}
      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Ticker
            </span>
            <FilterChips
              options={tickerOptions}
              selected={tickerFilter}
              onChange={setTickerFilter}
              ariaLabel="Filter by ticker"
            />
          </div>
          <div className="space-y-2">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Direction
            </span>
            <FilterChips
              options={DIRECTION_OPTIONS}
              selected={directionFilter}
              onChange={setDirectionFilter}
              ariaLabel="Filter by direction"
            />
          </div>
          <div className="space-y-2">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Outcome
            </span>
            <FilterChips
              options={OUTCOME_OPTIONS}
              selected={outcomeFilter}
              onChange={setOutcomeFilter}
              ariaLabel="Filter by outcome"
            />
          </div>
          <div className="space-y-2">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Date range
            </span>
            {/* server-side ET date range (drives a refetch, not a client filter;
                composes with the three above). */}
            <FilterChips
              options={RANGE_OPTIONS}
              selected={range}
              onChange={handleRangeChange}
              ariaLabel="Filter by date range"
            />
            {showCustomInputs && (
              <div className="space-y-3 pt-2">
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
                    onClick={() => setCustomExpanded(false)}
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
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
