"use client";
import * as React from "react";
import {
  Card,
  MetricTile,
  Pill,
  Skeleton,
  MoneyText,
  FilterChips,
  BottomSheet,
  HapticButton,
} from "@/components/ui";
import { ReplicaAge } from "@/lib/replica-age";
import {
  normalizePaperWindowState,
  isPaperMode,
  isModeConfirmed,
  type PaperWindowState,
} from "@/lib/trading-mode";
import { TrendingUp } from "lucide-react";

// RM-PNL P01 (2026-05-29): Auto Capital = REALIZED-only headline.
// The large number is booked (closed-trade) P&L for the selected ET-calendar
// window — an open position contributes $0 until it's closed. Unrealized is
// shown in a flat GREYED line (never green/red) so it can never be mistaken
// for the real number. Equity is the live HL account value, explicitly
// labeled as floating with open positions.

// WA-P2: "custom" is an arbitrary calendar date range fed through the same
// realized-P&L path as the presets (PCT-DENOM-FIX B1: % base = account value at
// the window's start, floored at the cutover epoch).
type WindowKey = "today" | "yesterday" | "week" | "month" | "all" | "custom";

interface RealizedWindows {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  all: number;
  custom?: number;
}

// PCT-DENOM-FIX B1 (2026-07-03): each window's % divides its realized $ by the
// account value at that window's START, floored at the cutover epoch; ALL
// divides by the account value at the cutover epoch. A window with no usable
// base (empty snapshots / read error) is `null` → rendered "—".
interface NullableWindows {
  today: number | null;
  yesterday: number | null;
  week: number | null;
  month: number | null;
  all: number | null;
  custom?: number | null;
}

interface AutoState {
  equity_usd: number;
  realized: RealizedWindows;
  realized_pct: NullableWindows;
  realized_count: RealizedWindows;
  realized_unknown_count: number;
  open_margin_usd: number;
  unrealized_usd: number;
  open_count: number;
  // RM-EQUITY-RESTORE B1: true live account value (the bot writes it to
  // auto_config.LIVE_ACCOUNT_VALUE_USD every ~5-min cycle). Real $ or null; the
  // server-side `stale` flag (threshold 2700s ≈ 45min, sized for the ~20-min
  // tailsync replica + ~5-min writer cadence) gates the render → "—" when stale.
  live_account_value_usd?: number | null;
  live_account_value_age_s?: number | null;
  live_account_value_stale?: boolean;
  // EQT-A3: real-HL equity sourcing flags (set by /api/auto/state).
  equity_available?: boolean;
  equity_stale?: boolean;
  equity_source?: "real-hl" | "stale" | "unavailable";
  // legacy back-compat (still read for the equity figure if equity_usd absent)
  equity?: number;
  trades_total?: number;
  // W4a: how many of trades_total are trade_mode='paper', and the EFFECTIVE
  // mode. Drive the PAPER label from these — never from `live_enabled`.
  trades_paper_count?: number;
  paper_window_state?: PaperWindowState;
  // W4a: age of the replica these figures were read from.
  replica_age_seconds?: number | null;
  data_available: boolean;
}

// RM-HUB-POLISH B1: the subset of /api/auto/trades?type=open fields the
// client-side floating recompute needs (both synced and thin heartbeat cards
// carry these). Marks come from /api/prices.
interface OpenPos {
  ticker: string;
  direction: string;
  entry_price: number;
  leverage: number;
  notional_usd: number;
}

const WINDOWS: ReadonlyArray<{ key: WindowKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yest" },
  { key: "week", label: "1W" },
  { key: "month", label: "1M" },
  { key: "all", label: "All" },
  // WA-P2: opens the date-range picker rather than selecting a precomputed window.
  { key: "custom", label: "Custom" },
];
const LABELS = WINDOWS.map((w) => w.label);
const CUSTOM_LABEL = "Custom";

// WA-P2: ET-calendar "today" as YYYY-MM-DD — the picker's max (no future dates).
// en-CA renders ISO YYYY-MM-DD; America/New_York matches the server's ET buckets.
function etTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(),
  );
}

// WA-P2: short display of an applied range, e.g. "Jun 6 – Jun 12". Parse as local
// midnight (append T00:00:00) so the date never rolls back a day via UTC parsing.
function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// RM-HUB-POLISH B1: signed-USD glance formatter (U+2212 minus), matching the
// prior RM-PNL secondary-line convention. `$0.00` for exactly zero.
function fmtUsd(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
}
const LABEL_TO_KEY: Record<string, WindowKey> = Object.fromEntries(
  WINDOWS.map((w) => [w.label, w.key]),
) as Record<string, WindowKey>;

const ZERO: RealizedWindows = { today: 0, yesterday: 0, week: 0, month: 0, all: 0 };

export function CapitalHero() {
  const [data, setData] = React.useState<AutoState | null>(null);
  const [loading, setLoading] = React.useState(true);
  // Default window = Today.
  const [windowLabel, setWindowLabel] = React.useState<string>("Today");

  // RM-HUB-POLISH B1 (2026-07-11): aggregate FLOATING P&L, computed client-side
  // from live open positions + marks — independent of the retired Observatory
  // heartbeat (whose death made the old `data.unrealized_usd` read $0.00 for any
  // real floating amount). Three honest states: a real number (open positions
  // priced), 0 (genuinely nothing open), or null → "—" (open positions exist but
  // the trades/prices fetch is unavailable). NEVER a hardcoded 0 / fake balance.
  const [floating, setFloating] = React.useState<number | null>(null);

  // WA-P2: custom date-range state. `customStart/customEnd` are the APPLIED range
  // (drive the API fetch); `draftStart/draftEnd` are the in-sheet picker values
  // (no API call until Apply). The picker's max is ET-today (no future dates).
  const etToday = React.useMemo(() => etTodayStr(), []);
  const [customStart, setCustomStart] = React.useState<string | null>(null);
  const [customEnd, setCustomEnd] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [draftStart, setDraftStart] = React.useState<string>("");
  const [draftEnd, setDraftEnd] = React.useState<string>("");

  const isCustomActive =
    windowLabel === CUSTOM_LABEL && customStart !== null && customEnd !== null;

  // Only a valid applied range appends the params — otherwise the plain preset
  // fetch (all windows precomputed) is used. The URL is the effect's sole dep, so
  // preset↔preset switches reuse the last payload (no refetch); switching to a
  // custom range or changing it triggers exactly one refetch.
  const stateUrl = isCustomActive
    ? `/api/auto/state?start=${customStart}&end=${customEnd}`
    : "/api/auto/state";

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch(stateUrl, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as AutoState;
        if (!cancelled) setData(j);
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchState();
    const id = setInterval(fetchState, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stateUrl]);

  // RM-HUB-POLISH B1: recompute aggregate FLOATING $ from live data, heartbeat-
  // independent. Reads the SAME routes the ACTIVE card uses: /api/auto/trades
  // ?type=open (positions carry entry/leverage/notional/direction) + /api/prices
  // (marks). Dollar form of computeRoe (active-position-card.tsx:94-102):
  //   floating$ = Σ (directional/entry) × leverage × notional_usd
  // notional_usd is MARGIN, so the ×leverage factor is REQUIRED (verified against
  // the replica: pnl_pct == computeRoe exactly; notional == margin, not size).
  // Any un-priceable position, an errored trades payload, or a failed fetch →
  // null ("—"); zero open positions → 0 ($0.00, genuinely nothing floating).
  React.useEffect(() => {
    let cancelled = false;
    const computeFloating = async () => {
      try {
        const tRes = await fetch("/api/auto/trades?type=open&limit=50", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!tRes.ok) return void setFloating(null);
        const tj = (await tRes.json()) as {
          positions?: OpenPos[];
          error?: string;
        };
        if (cancelled) return;
        // An errored trades response returns {positions:[], error} at HTTP 200 —
        // treat as unavailable ("—"), NOT as a genuine zero-open $0.00.
        if (tj.error) return void setFloating(null);
        const positions = tj.positions ?? [];
        if (positions.length === 0) return void setFloating(0);

        const tickers = [
          ...new Set(positions.map((p) => p.ticker).filter(Boolean)),
        ];
        const pRes = await fetch(`/api/prices?tickers=${tickers.join(",")}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!pRes.ok) return void setFloating(null);
        const pj = (await pRes.json()) as {
          prices?: Record<string, { price?: number }>;
        };
        if (cancelled) return;
        const marks: Record<string, number> = {};
        for (const [t, v] of Object.entries(pj.prices ?? {})) {
          const px = v?.price;
          if (typeof px === "number" && Number.isFinite(px) && px > 0) {
            marks[t] = px;
          }
        }

        let sum = 0;
        for (const p of positions) {
          const mark = marks[p.ticker];
          // Any position we can't price (missing/zero mark, or missing
          // entry/notional) → the aggregate is incomplete → honest "—", never a
          // partial sum and never a fabricated 0.
          if (
            typeof mark !== "number" ||
            !p.entry_price ||
            typeof p.notional_usd !== "number"
          ) {
            return void setFloating(null);
          }
          const lev = p.leverage || 1;
          const directional =
            p.direction === "LONG" ? mark - p.entry_price : p.entry_price - mark;
          sum += (directional / p.entry_price) * lev * p.notional_usd;
        }
        if (!cancelled) setFloating(sum);
      } catch {
        // Fetch/parse failure → honest "—" (never a stale or fabricated number).
        if (!cancelled) setFloating(null);
      }
    };
    computeFloating();
    const id = setInterval(computeFloating, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // WA-P2 validation: both dates set, end ≥ start, neither in the future. String
  // compare on YYYY-MM-DD is chronologically correct. Apply stays disabled until
  // this holds; single-day (start === end) is allowed.
  const draftValid =
    draftStart !== "" &&
    draftEnd !== "" &&
    draftStart <= draftEnd &&
    draftStart <= etToday &&
    draftEnd <= etToday;

  // WA-P2: tapping "Custom" opens the picker (pre-filled with the applied range or
  // today) rather than selecting a precomputed window. Presets select directly.
  const handleWindowChange = (label: string) => {
    if (label === CUSTOM_LABEL) {
      setDraftStart(customStart ?? etToday);
      setDraftEnd(customEnd ?? etToday);
      setPickerOpen(true);
      return;
    }
    setWindowLabel(label);
  };

  const applyCustom = () => {
    if (!draftValid) return;
    setCustomStart(draftStart);
    setCustomEnd(draftEnd);
    setWindowLabel(CUSTOM_LABEL);
    setPickerOpen(false);
  };

  const win = LABEL_TO_KEY[windowLabel] ?? "today";
  const realized = data?.realized ?? ZERO;
  const realizedPct = data?.realized_pct ?? ZERO;
  const realizedCount = data?.realized_count ?? ZERO;
  // RF3T2-B5: posted margin, NOT leveraged exposure. The visible label below
  // ("deployed") is the honest word for margin and is deliberately UNCHANGED.
  const openMargin = data?.open_margin_usd ?? 0;
  const openCount = data?.open_count ?? 0;
  const totalCount = data?.trades_total ?? 0;
  // 🚨 W4a: this headline blends paper and live P&L (correct — mode-blind
  // windows are what make a paper run visible at all), so it MUST carry a label
  // or a paper figure reads as real cash. Same fail direction as the badge:
  // an absent field is a failed read and lands in a paper-coloured state, never
  // a silent "this is real money".
  const paperCount = data?.trades_paper_count ?? 0;
  const pwState = normalizePaperWindowState(data?.paper_window_state);
  const paperMode = isPaperMode(pwState);
  const modeConfirmed = isModeConfirmed(pwState);

  // WA-P2: `custom` is absent on a preset payload (and momentarily while a custom
  // fetch is in flight) — guard so a hero number is never undefined. A missing
  // custom % falls through to the existing "—" render (headlinePct == null).
  const headlinePnl = realized[win] ?? 0;
  const headlinePct = realizedPct[win] ?? null;
  const headlineCount = realizedCount[win] ?? 0;

  // RM-HUB-POLISH B1: total session P&L = window realized + live floating. Null
  // (→ "—") whenever floating is unavailable — a total can't be honestly summed
  // from an unknown floating.
  const total = floating === null ? null : headlinePnl + floating;

  // RM-EQUITY-RESTORE B1: the TRUE live account value (total $ on Hyperliquid).
  // Real $ only when present AND fresh — the server-side stale flag (threshold
  // 2700s ≈ 45min, accounts for the ~20-min tailsync replica + ~5-min writer
  // cadence) is authoritative. Otherwise null → "—". Never a fabricated or frozen
  // number (default-stale on a missing field via the `?? true`).
  const liveAccountValue =
    data?.live_account_value_usd != null &&
    !(data?.live_account_value_stale ?? true)
      ? data.live_account_value_usd
      : null;

  return (
    <Card padding="lg" className="card-elevated space-y-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-sans text-micro uppercase tracking-wider text-fg-muted">
          <TrendingUp size={12} aria-hidden />
          Auto Capital
        </span>
        <div className="flex items-center gap-2">
          {/* W4a: the PAPER marker sits ON the money card, beside REALIZED, so
              the headline $ can never be read as real cash during the run. */}
          {!loading && data && paperMode && (
            <Pill intent="warn" size="sm">
              {modeConfirmed ? "PAPER" : "PAPER?"}
            </Pill>
          )}
          <Pill
            tone="cyan"
            size="sm"
            className="bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
          >
            REALIZED
          </Pill>
        </div>
      </div>

      {loading && <Skeleton className="h-40 w-full" />}
      {!loading && data && (
        <>
          {/* ── Realized headline (primary) — booked, closed trades only ── */}
          <div className="space-y-2">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              Realized P&L · booked
            </span>
            <div className="flex flex-wrap items-baseline gap-3">
              <MoneyText
                value={headlinePnl}
                unit="$"
                size="hero"
                decimals={2}
                showSign
              />
              {/* PCT-DENOM-FIX3: % of the account value at the window's start;
                  windows predating the cutover (1W/1M/ALL) floor to the POST-cutover
                  starting capital (~$69.74, the first funded post-cutover equity —
                  NOT the $21.63 mid-migration seed); today/yesterday use their own
                  start-of-day equity. A window with no usable base (empty snapshots /
                  read error) renders "—", never a garbage number. */}
              {headlinePct != null ? (
                <MoneyText
                  value={headlinePct}
                  unit="%"
                  size="md"
                  decimals={2}
                  showSign
                />
              ) : (
                <span
                  className="font-mono text-body tabular-nums text-fg-muted"
                  title="window-start account value unavailable (post-cutover starting capital / start-of-day equity)"
                >
                  —
                </span>
              )}
            </div>
            <span className="font-sans text-micro text-fg-faint">
              {headlineCount} closed {headlineCount === 1 ? "trade" : "trades"} · open
              positions count $0 until closed
            </span>
            {/* W4a: says plainly that the figure above is not money. Shown only
                while paper trades are actually in the window — once the window
                closes and live trades age past it, this disappears by itself.

                🚨 B6-LEDGER (2026-08-09): LABEL ONLY. `paperCount` is bounded by
                the cutover EPOCH, not by the window this card is scoped to, so
                "Includes N paper trades" sitting under a 1W/1M/today headline
                read as "N in the period shown" and was not. The bound is
                DELIBERATE — it exists so this label can never disagree with the
                `total` beside it (both epoch-floored, query_auto_state) — and
                Ghost's cutover law says it does not move. What was missing was
                saying so. The predicate behind the count changed in the same
                commit (see query_auto_state.py); the BOUND did not. */}
            {paperMode && paperCount > 0 && (
              <span className="block font-sans text-micro text-accent-gold">
                Includes {paperCount} paper{" "}
                {paperCount === 1 ? "trade" : "trades"} since the cutover —
                simulated, not money.
              </span>
            )}
            {/* W4a: the data's age. An empty window must never be mistaken for a
                stale one — see src/lib/replica-age.tsx. */}
            <ReplicaAge
              ageSeconds={data.replica_age_seconds}
              className="block pt-0.5"
            />
            {/* WA-P2: the applied custom span, so the headline's scope is legible. */}
            {isCustomActive && customStart && customEnd && (
              <span className="block font-sans text-micro text-accent-cyan-soft-strong">
                {fmtDay(customStart)} – {fmtDay(customEnd)}
              </span>
            )}
          </div>

          {/* ── Window selector (segmented; default Today; "Custom" opens picker) ── */}
          <FilterChips
            options={LABELS}
            selected={windowLabel}
            onChange={handleWindowChange}
            ariaLabel="Realized P&L time window"
          />

          {/* ── Account value (RM-EQUITY-RESTORE B1) — the TRUE live balance: the ──
              total $ on Hyperliquid, sourced from auto_config.LIVE_ACCOUNT_VALUE_USD
              (the bot writes it every ~5-min cycle; the Hub reads it from the
              replica — NO HL call). Real $ or "—" when stale (>45min) / missing —
              never a fabricated number, never a frozen value presented as live.
              Separate from the realized/floating/total P&L trio below. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
              {/* E14b: "live" denoted PROVENANCE (a true exchange balance, not a
                  derived figure) but READ as latency. The number is real and
                  correct; it reaches us via the replica and can be up to ~45 min
                  old, which is exactly what the staleness gate below bounds. The
                  label now says where it came from, not how fresh it is. */}
              Account value{" "}
              <span className="text-fg-faint">
                · balance on the exchange, updated periodically
              </span>
            </span>
            {liveAccountValue === null ? (
              <span
                className="font-mono text-h3 font-bold tabular-nums text-fg-muted"
                title="live account value unavailable — writer/sync stale (>45min) or unset"
              >
                —
              </span>
            ) : (
              <span className="font-mono text-h3 font-bold tabular-nums text-fg-primary">
                ${liveAccountValue.toFixed(2)}
              </span>
            )}
          </div>

          {/* ── Real-P&L trio (RM-HUB-POLISH B1): realized (window-tied) + live ──
              floating + total. Replaces the retired-heartbeat equity "—" line —
              the Hub has no HL creds so an account value can't be known; real P&L
              can (floating computed client-side, see effect above). Floating/Total
              render "—" when floating is unavailable — never a fabricated $0.00. */}
          <div className="space-y-1.5 border-t border-border-subtle pt-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-0.5">
                <span className="block font-sans text-micro uppercase tracking-wider text-fg-muted">
                  Realized
                </span>
                <span className="font-mono text-body font-bold tabular-nums text-fg-primary">
                  {fmtUsd(headlinePnl)}
                </span>
              </div>
              <div className="space-y-0.5">
                <span className="block font-sans text-micro uppercase tracking-wider text-fg-muted">
                  Floating
                </span>
                <span className="font-mono text-body font-bold tabular-nums text-fg-primary">
                  {floating === null ? "—" : fmtUsd(floating)}
                </span>
              </div>
              <div className="space-y-0.5">
                <span className="block font-sans text-micro uppercase tracking-wider text-fg-muted">
                  Total
                </span>
                <span className="font-mono text-body font-bold tabular-nums text-fg-primary">
                  {total === null ? "—" : fmtUsd(total)}
                </span>
              </div>
            </div>
            <div className="font-mono text-caption tabular-nums text-fg-muted">
              {openCount} open · ${openMargin.toFixed(2)} deployed
            </div>
          </div>

          {/* ── Counts (Trades / Open) ── */}
          <div className="grid grid-cols-2 gap-3">
            <MetricTile
              label="Trades"
              value={String(headlineCount)}
              sub={`${
                isCustomActive && customStart && customEnd
                  ? `${fmtDay(customStart)}–${fmtDay(customEnd)}`
                  : windowLabel.toLowerCase()
              } · ${totalCount.toLocaleString()} total since cutover${
                paperCount > 0 ? ` (${paperCount} paper)` : ""
              }`}
            />
            <MetricTile label="Open" value={String(openCount)} sub="positions" />
          </div>
        </>
      )}

      {/* ── WA-P2: custom date-range picker (native inputs, phone-friendly) ── */}
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
    </Card>
  );
}
