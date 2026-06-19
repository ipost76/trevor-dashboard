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
  LiveValue,
} from "@/components/ui";
import { useLiveTerminal } from "@/lib/live-terminal";
import { TrendingUp } from "lucide-react";

// RM-PNL P01 (2026-05-29): Auto Capital = REALIZED-only headline.
// The large number is booked (closed-trade) P&L for the selected ET-calendar
// window — an open position contributes $0 until it's closed. Unrealized is
// shown in a flat GREYED line (never green/red) so it can never be mistaken
// for the real number. Equity is the live HL account value, explicitly
// labeled as floating with open positions.

// WA-P2: "custom" is an arbitrary calendar date range fed through the same
// realized-P&L + start-of-window-equity path as the presets.
type WindowKey = "today" | "yesterday" | "week" | "month" | "all" | "custom";

interface RealizedWindows {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  all: number;
  custom?: number;
}

// WA-P1 (2026-06-12): each window's % is computed against the account equity at
// that window's START. A window whose start-of-window base is missing/≤floor is
// `null` → rendered "—", never a garbage number.
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
  open_exposure_usd: number;
  unrealized_usd: number;
  open_count: number;
  // EQT-A3: real-HL equity sourcing flags (set by /api/auto/state).
  equity_available?: boolean;
  equity_stale?: boolean;
  equity_source?: "real-hl" | "stale" | "unavailable";
  // legacy back-compat (still read for the equity figure if equity_usd absent)
  equity?: number;
  trades_total?: number;
  data_available: boolean;
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
const LABEL_TO_KEY: Record<string, WindowKey> = Object.fromEntries(
  WINDOWS.map((w) => [w.label, w.key]),
) as Record<string, WindowKey>;

const ZERO: RealizedWindows = { today: 0, yesterday: 0, week: 0, month: 0, all: 0 };

export function CapitalHero() {
  const [data, setData] = React.useState<AutoState | null>(null);
  const [loading, setLoading] = React.useState(true);
  // Default window = Today.
  const [windowLabel, setWindowLabel] = React.useState<string>("Today");

  // B6 (RM-LIVE): flash-on-refresh flag, default OFF (NEXT_PUBLIC_LIVE_TERMINAL).
  // OFF → render the existing JSX verbatim (byte-identical to B0). ON → route the
  // equity figure through <LiveValue> so it flashes mint/red when the existing
  // ~15s /api/auto/state refresh changes it. NO new data, NO WS, NO faster poll.
  const live = useLiveTerminal();

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
  const equity = data?.equity_usd ?? data?.equity ?? 0;
  const unrealized = data?.unrealized_usd ?? 0;
  const openExposure = data?.open_exposure_usd ?? 0;
  const openCount = data?.open_count ?? 0;
  const totalCount = data?.trades_total ?? 0;

  // WA-P2: `custom` is absent on a preset payload (and momentarily while a custom
  // fetch is in flight) — guard so a hero number is never undefined. A missing
  // custom % falls through to the existing "—" render (headlinePct == null).
  const headlinePnl = realized[win] ?? 0;
  const headlinePct = realizedPct[win] ?? null;
  const headlineCount = realizedCount[win] ?? 0;

  // Flat greyed text for unrealized — deliberately NOT green/red, so it never
  // reads as part of the booked number. Plain muted mono with an explicit sign.
  const unrealStr = `${unrealized > 0 ? "+" : unrealized < 0 ? "−" : ""}$${Math.abs(
    unrealized,
  ).toFixed(2)}`;

  // EQT-A3 (2026-06-07): the account-value line MIRRORS real HL — show HL's
  // accountValue AS-IS (no de-float). It's sourced server-side from the
  // Observatory heartbeat (`account_value_usd`, Wave A1), so the prior EQT-D1
  // `equity - unrealized` de-float is gone (Ghost: "everything mirrors real HL").
  // When the real-HL value is briefly unreachable the API serves the last-known
  // figure flagged `equity_stale`; when it has never been observed
  // (`equity_available:false`, e.g. A1 not yet live) we render "—" rather than a
  // virtual/DB number. The unrealized split stays on the sub-line below.
  const equityAvailable = data?.equity_available ?? false;
  const equityStale = data?.equity_stale ?? false;
  const liveEquity = equity;

  return (
    <Card padding="lg" className="card-elevated space-y-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-sans text-micro uppercase tracking-wider text-fg-muted">
          <TrendingUp size={12} aria-hidden />
          Auto Capital
        </span>
        <Pill
          tone="cyan"
          size="sm"
          className="bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
        >
          REALIZED
        </Pill>
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
              {/* WA-P1: % of the account's equity at THIS window's start (a true
                  return over the window). Snapshot-based, so it shows even when
                  live equity is momentarily unreachable; a window with no usable
                  start-of-window base renders "—", never a garbage number. */}
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
                  title="no start-of-window equity snapshot for this window"
                >
                  —
                </span>
              )}
            </div>
            <span className="font-sans text-micro text-fg-faint">
              {headlineCount} closed {headlineCount === 1 ? "trade" : "trades"} · open
              positions count $0 until closed
            </span>
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

          {/* ── Greyed secondary block: honest cash + floating glance (2 lines) ── */}
          <div className="space-y-1.5 border-t border-border-subtle pt-3">
            <div className="flex flex-wrap items-baseline gap-2">
              {/* B6: equity flashes mint/red when the existing 15s refresh changes
                  it (ON); the value/formatter are unchanged — same liveEquity,
                  same `$x.xx`, `—` when unavailable. OFF renders the prior span
                  verbatim. Resting <LiveValue> is text-fg-primary, matching. */}
              {live ? (
                <LiveValue
                  value={equityAvailable ? liveEquity : null}
                  format={(n) => `$${n.toFixed(2)}`}
                  className="text-h3 font-bold"
                />
              ) : (
                <span className="font-mono text-h3 font-bold tabular-nums text-fg-primary">
                  {equityAvailable ? `$${liveEquity.toFixed(2)}` : "—"}
                </span>
              )}
              <span className="font-sans text-micro text-fg-muted">live account</span>
              {equityStale && (
                <span className="font-sans text-micro text-accent-gold">· stale</span>
              )}
            </div>
            <div className="font-mono text-caption tabular-nums text-fg-muted">
              {unrealStr} floating · {openCount} open · ${openExposure.toFixed(2)} deployed
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
              } · ${totalCount.toLocaleString()} total`}
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
