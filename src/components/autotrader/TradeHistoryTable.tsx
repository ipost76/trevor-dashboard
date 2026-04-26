"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, ChevronRight, ChevronDown } from "lucide-react";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import type { AutoTraderSummary } from "@/hooks/useAutoTraderStream";

// Filterable, paginated, expandable history of closed auto trades.
// - Filter pills: All / Winners / Losers × 7D / 30D / All Time
// - Collapsed row shows essentials; click to expand for full detail grid.
// - "Load More" appends next page (does not replace).

const GREEN = "#00ff88";
const RED = "#ff4757";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";
const ROW_BG = "#0e1015";
const DETAIL_BG = "#0a0a0f";

type Trade = {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  leverage: number;
  notional_usd: number;
  original_notional_usd: number | null;
  confidence: number;
  adjusted_confidence: number | null;
  pnl_usd: number;
  pnl_pct: number;
  fees_usd: number | null;
  exit_reason: string | null;
  hold_duration_minutes: number | null;
  peak_pnl_pct: number | null;
  peak_price: number | null;
  trough_price: number | null;
  partial_exits_taken: number | null;
  partial_pnl_realized: number | null;
  breakeven_stop_active: boolean;
  regime_at_entry: string | null;
  market_state: string | null;
  opened_at: string;
  closed_at: string;
  trade_mode: "live" | "paper";
};

type HistoryResponse = {
  trades: Trade[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  filter: string;
  period: string;
  mode: string;
  has_more: boolean;
};

type FilterKind = "all" | "winners" | "losers";
type PeriodKind = "all" | "7d" | "30d";
type ModeKind = "all" | "live" | "paper";

const PAGE_SIZE = 20;

const EXIT_PILL_COLOR: Record<string, string> = {
  timeout_240min: "#ffaa00",
  stop_hit: "#ff3366",
  trailing_stop: "#00aaff",
  tech_signals: "#00f0ff",
  partial_profit: "#00ff88",
};

function exitPillColor(reason: string | null | undefined, pnl: number): string {
  if (!reason) return MUTED;
  return EXIT_PILL_COLOR[reason] || (pnl >= 0 ? GREEN : RED);
}

function fmtHold(mins: number | null): string {
  if (mins == null || !isFinite(mins) || mins < 0) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

function fmtAgo(iso: string): string {
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!isFinite(t)) return "—";
  const d = new Date(t);
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.getDate();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

export function TradeHistoryTable({
  summary,
}: {
  summary: AutoTraderSummary | null;
}) {
  const isLiveMode = summary?.mode === "live";
  const [filter, setFilter] = useState<FilterKind>("all");
  const [period, setPeriod] = useState<PeriodKind>("all");
  // Default to current bot mode (live → live, paper → paper)
  const [mode, setMode] = useState<ModeKind>(isLiveMode ? "live" : "paper");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Re-derive default mode when summary mode flips (e.g. flipping to live in config)
  useEffect(() => {
    setMode(isLiveMode ? "live" : "paper");
  }, [isLiveMode]);

  const fetchPage = useCallback(
    async (
      p: number,
      append: boolean,
      f: FilterKind,
      per: PeriodKind,
      m: ModeKind
    ) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(p),
          limit: String(PAGE_SIZE),
          filter: f,
          period: per,
          mode: m,
        });
        const res = await fetch(`/api/auto-trader/history?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HistoryResponse;
        setTotal(data.total);
        setHasMore(!!data.has_more);
        setPage(data.page);
        setTrades((prev) => (append ? [...prev, ...data.trades] : data.trades));
        setErr(null);
      } catch (e) {
        setErr(String(e));
        if (!append) setTrades([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    setExpanded(new Set());
    fetchPage(1, false, filter, period, mode);
  }, [filter, period, mode, fetchPage]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section>
      {/* Heading + filters */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <ClipboardList size={14} style={{ color: MUTED }} />
          <span
            className="text-[11px] uppercase tracking-[0.12em]"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: MUTED,
            }}
          >
            Trade History
          </span>
          <span className="text-[10px]" style={{ color: MUTED, opacity: 0.7 }}>
            {loading
              ? "loading…"
              : `${trades.length} of ${total} shown`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <PillGroup<ModeKind>
            value={mode}
            onChange={setMode}
            options={[
              { value: "live", label: "Live" },
              { value: "paper", label: "Paper" },
              { value: "all", label: "All" },
            ]}
          />
          <span
            className="text-[10px]"
            style={{ color: MUTED, opacity: 0.4 }}
          >
            |
          </span>
          <PillGroup<FilterKind>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "winners", label: "Wins" },
              { value: "losers", label: "Losses" },
            ]}
          />
          <span
            className="text-[10px]"
            style={{ color: MUTED, opacity: 0.4 }}
          >
            |
          </span>
          <PillGroup<PeriodKind>
            value={period}
            onChange={setPeriod}
            options={[
              { value: "7d", label: "7D" },
              { value: "30d", label: "30D" },
              { value: "all", label: "All" },
            ]}
          />
        </div>
      </div>

      {/* Body */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{ background: SURFACE, borderColor: BORDER }}
      >
        {loading && trades.length === 0 ? (
          <HistorySkeleton />
        ) : trades.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-1 py-8 text-[11px]"
            style={{ color: MUTED }}
          >
            {err ? (
              <>
                <span style={{ color: RED }}>failed to load</span>
                <span className="text-[10px] opacity-70">{err}</span>
              </>
            ) : total === 0 && filter === "all" && period === "all" && mode === "all" ? (
              <>
                <span>no closed trades yet</span>
                <span className="text-[10px] opacity-70">
                  waiting for the first one
                </span>
              </>
            ) : total === 0 && mode === "live" ? (
              <>
                <span>🟢 no live trades yet</span>
                <span className="text-[10px] opacity-70">
                  flip to Paper or All to see history
                </span>
              </>
            ) : (
              <>
                <span>no trades match this filter</span>
                <span className="text-[10px] opacity-70">
                  try widening the period or switching to All
                </span>
              </>
            )}
          </div>
        ) : (
          <ul>
            {trades.map((t) => (
              <TradeRow
                key={t.id}
                t={t}
                expanded={expanded.has(t.id)}
                onToggle={() => toggle(t.id)}
              />
            ))}
          </ul>
        )}

        {hasMore && (
          <div
            className="flex items-center justify-center border-t px-4 py-2"
            style={{ borderColor: BORDER }}
          >
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => fetchPage(page + 1, true, filter, period, mode)}
              className="rounded border px-3 py-1 text-[11px] uppercase tracking-[0.08em] transition"
              style={{
                background: "transparent",
                borderColor: GREEN,
                color: GREEN,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                opacity: loadingMore ? 0.6 : 1,
                cursor: loadingMore ? "wait" : "pointer",
              }}
            >
              {loadingMore ? "loading…" : "Load More"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Single collapsed+expanded row ── */
function TradeRow({
  t,
  expanded,
  onToggle,
}: {
  t: Trade;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isProfit = (t.pnl_usd ?? 0) >= 0;
  const pnlColor = isProfit ? GREEN : RED;
  const pillColor = exitPillColor(t.exit_reason, t.pnl_usd);
  const grossPnl = Number(t.pnl_usd ?? 0);
  const fees = Number(t.fees_usd ?? 0);
  const netPnl = grossPnl - fees;
  const confAdj = t.adjusted_confidence ?? t.confidence;

  return (
    <li
      className="border-b last:border-b-0"
      style={{ borderColor: BORDER }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2 text-left transition"
        style={{
          background: expanded ? ROW_BG : "transparent",
          cursor: "pointer",
        }}
      >
        <span style={{ color: MUTED, flexShrink: 0 }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        <span
          className="text-[12px] sm:text-[13px] font-semibold"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: TEXT,
            minWidth: 72,
          }}
        >
          {t.ticker}
        </span>
        <DirectionBadge dir={t.direction} />
        <ModeBadge isLive={t.trade_mode === "live"} />

        <span
          className="text-[12px] sm:text-[13px] font-semibold"
          style={{
            color: pnlColor,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
            minWidth: 92,
          }}
        >
          {isProfit ? "+" : ""}${grossPnl.toFixed(2)}
          <span className="opacity-70 text-[10px] ml-1">
            ({fmtPctSigned(t.pnl_pct)}%)
          </span>
        </span>

        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: `${pillColor}22`,
            color: pillColor,
            border: `1px solid ${pillColor}55`,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          }}
        >
          {t.exit_reason || "unknown"}
        </span>

        <span className="flex-1 min-w-0" />

        <span
          className="text-[10px] sm:text-[11px]"
          style={{
            color: MUTED,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtHold(t.hold_duration_minutes)}
        </span>
        <span
          className="hidden sm:inline text-[10px]"
          style={{
            color: MUTED,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            opacity: 0.7,
          }}
        >
          {fmtAgo(t.closed_at)}
        </span>
      </button>

      {expanded && (
        <div
          className="border-t px-3 sm:px-4 py-3 text-[11px] sm:text-[12px]"
          style={{
            borderColor: BORDER,
            background: DETAIL_BG,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
            color: TEXT,
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
            <Detail label="Entry → Exit">
              {fmtDollarPrice(t.entry_price)} → {fmtDollarPrice(t.exit_price)}
            </Detail>
            <Detail label="Leverage">
              {Number(t.leverage).toFixed(t.leverage % 1 === 0 ? 0 : 1)}x
            </Detail>
            <Detail label="Size">${Number(t.notional_usd).toFixed(2)}</Detail>
            <Detail label="Confidence">
              {Math.round(Number(t.confidence) || 0)}
              {confAdj != null && confAdj !== t.confidence && (
                <span className="opacity-60">
                  {" "}
                  (adj {Math.round(Number(confAdj) || 0)})
                </span>
              )}
            </Detail>
            <Detail label="Regime">{t.regime_at_entry || "—"}</Detail>
            <Detail label="Market">{t.market_state || "—"}</Detail>
            <Detail label="Peak P&amp;L">
              <span
                style={{
                  color: (t.peak_pnl_pct ?? 0) > 0 ? GREEN : MUTED,
                }}
              >
                {t.peak_pnl_pct != null
                  ? `${fmtPctSigned(t.peak_pnl_pct)}%`
                  : "—"}
              </span>
            </Detail>
            <Detail label="Breakeven Stop">
              <span
                style={{ color: t.breakeven_stop_active ? GREEN : MUTED }}
              >
                {t.breakeven_stop_active ? "Active" : "Inactive"}
              </span>
            </Detail>
            <Detail label="Partials">
              {(t.partial_exits_taken ?? 0)}/2
              {(t.partial_pnl_realized ?? 0) !== 0 && (
                <span className="opacity-60">
                  {" "}
                  ({(t.partial_pnl_realized ?? 0) >= 0 ? "+" : ""}$
                  {(t.partial_pnl_realized ?? 0).toFixed(2)})
                </span>
              )}
            </Detail>
            <Detail label="Fees">
              ${fees.toFixed(3)}
            </Detail>
            <Detail label="Net P&amp;L">
              <span style={{ color: netPnl >= 0 ? GREEN : RED }}>
                {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(3)}
              </span>
            </Detail>
            <Detail label="Hold">{fmtHold(t.hold_duration_minutes)}</Detail>
            <Detail label="Opened">{fmtAgo(t.opened_at)}</Detail>
            <Detail label="Closed">{fmtAgo(t.closed_at)}</Detail>
          </div>
        </div>
      )}
    </li>
  );
}

function Detail({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] shrink-0" style={{ color: MUTED, opacity: 0.8 }}>
        {label}:
      </span>
      <span className="truncate">{children}</span>
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

/* ── Filter pill group ── */
function PillGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border p-0.5"
      style={{ borderColor: BORDER, background: "#0a0a0f" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="rounded-full px-2 sm:px-2.5 py-0.5 text-[10px] sm:text-[11px] uppercase tracking-[0.06em] transition"
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
  );
}

/* ── Skeleton rows ── */
function HistorySkeleton() {
  return (
    <ul>
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
          style={{ borderColor: BORDER }}
        >
          <div
            className="at-hist-skel h-3 w-3 rounded"
            style={{ background: "rgba(0,255,136,0.08)" }}
          />
          <div
            className="at-hist-skel h-3 w-16 rounded"
            style={{ background: "rgba(0,255,136,0.08)" }}
          />
          <div
            className="at-hist-skel h-3 w-12 rounded"
            style={{ background: "rgba(0,255,136,0.04)" }}
          />
          <div
            className="at-hist-skel h-3 w-20 rounded"
            style={{ background: "rgba(0,255,136,0.08)" }}
          />
          <div className="flex-1" />
          <div
            className="at-hist-skel h-3 w-12 rounded"
            style={{ background: "rgba(0,255,136,0.04)" }}
          />
        </li>
      ))}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes at-hist-skel-kf{0%,100%{opacity:.45}50%{opacity:.85}}.at-hist-skel{animation:at-hist-skel-kf 1.4s ease-in-out infinite}",
        }}
      />
    </ul>
  );
}
