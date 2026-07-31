"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  MoneyText,
  LiveValue,
} from "@/components/ui";
import {
  TrendingUp,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Anchor,
  Scissors,
  Lock,
  HelpCircle,
} from "lucide-react";
import { useLiveTerminal } from "@/lib/live-terminal";

// S1-P06 — Profit-Taking + Risk panel (READ-ONLY display).
//
// Surfaces Stage-1 state that already lands in the bot but was never visible:
//   1. Per open LIVE trade — breakeven armed?, ratchet floor (R), partials
//      taken + realized partial P&L, intended risk ($/%).
//   2. Consolidated circuit-breaker state — entries allowed?, which breakers
//      are active, each breaker's reading vs its limit.
//
// This panel NEVER sends commands to the bot. It only GETs /api/auto/profit-risk.
// Matches the repo's data-fetching convention (raw fetch + setInterval); the
// dashboard has no react-query/SWR dependency.

const ENDPOINT = "/api/auto/profit-risk";
const POLL_MS = 15_000;

type BreakerStatus = "OK" | "YELLOW" | "RED" | string;

interface OpenTrade {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  leverage: number | null;
  notional_usd: number | null;
  original_notional_usd: number | null;
  opened_at: string | null;
  peak_pnl_pct: number | null;
  breakeven_armed: boolean;
  ratchet_locked_r: number;
  partials_taken: number;
  partial_pnl_realized: number;
  risk_dollars: number | null;
  risk_pct: number | null;
  // B2: true ⇒ live-from-heartbeat, not yet replicated (thin "syncing" card).
  thin?: boolean;
}

interface BreakerGauge {
  key: string;
  label: string;
  status: BreakerStatus;
  // Nullable BY DESIGN. The writer omits a breaker's reading/limit on its
  // flat-day path; the reader emits null rather than inventing a 0, so a
  // safety gauge can never show a number nobody measured. See fmtGauge.
  value: number | null;
  limit: number | null;
  unit: string;
}

interface ActiveBreaker {
  key: string;
  label: string;
  status: string;
  detail: string;
}

interface BreakerState {
  overall_status: "OK" | "YELLOW" | "RED" | "OFF" | "UNKNOWN";
  override_active: boolean;
  entries_allowed: boolean;
  // RD-B7 (2026-07-25): freshness of the breaker's EVALUATION — see fmtEvalAge /
  // the "not asked" banner below.
  last_eval_at?: string | null;
  last_eval_age_s?: number | null;
  last_eval_stale?: boolean;
  last_eval_stale_after_s?: number;
  active: ActiveBreaker[];
  all: BreakerGauge[];
  error?: string;
}

interface ProfitRiskResponse {
  data_available: boolean;
  ts: number;
  open_count: number;
  // B2: Σ notional_usd over the merged (deduped + closed-id-evicted) open set.
  open_notional?: number;
  open_trades: OpenTrade[];
  breakers: BreakerState;
  // B2: true ⇒ live heartbeat membership; false ⇒ replica fallback.
  live?: boolean;
  error?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────

// Map a breaker status to a Pill tone + a text color class.
function statusTone(s: BreakerStatus): "green" | "amber" | "red" | "neutral" {
  if (s === "RED") return "red";
  if (s === "YELLOW") return "amber";
  if (s === "OK") return "green";
  return "neutral";
}
function statusText(s: BreakerStatus): string {
  if (s === "RED") return "text-accent-red";
  if (s === "YELLOW") return "text-accent-amber";
  if (s === "OK") return "text-accent-green";
  return "text-fg-muted";
}

// Render one gauge number. null/non-finite → em-dash, NEVER 0 — a fabricated
// zero on a safety gauge is indistinguishable from a real reading of zero.
// Trailing zeros are trimmed only past a decimal point, so an integral cap reads
// "-25" while a fractional one SURVIVES: the old `.toFixed(0)` rounded a real
// 0.4% cap to "0%", producing the same false zero by rounding rather than by
// default. Keep the number, lose the notation.
// The unit rides WITH the number, so an unknown renders a bare "—" rather than
// a stray "—%" that reads like a broken template.
function fmtGaugeNum(
  n: number | null | undefined,
  places: number,
  suffix = "",
): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const text = Number(n).toFixed(places);
  return (text.includes(".") ? text.replace(/\.?0+$/, "") : text) + suffix;
}

function fmtGauge(g: BreakerGauge): string {
  if (g.unit === "%") {
    return `${fmtGaugeNum(g.value, 1, "%")} / ${fmtGaugeNum(g.limit, 2, "%")} cap`;
  }
  return `${fmtGaugeNum(g.value, 0)} / ${fmtGaugeNum(g.limit, 0)}`;
}

function fmtRiskPct(p: number | null): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  return `${Number(p).toFixed(2)}%`;
}

// B4 — compact replica-age formatter for the freshness badge.
function fmtReplicaAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

// RD-B7 — DEFAULT_EVAL_STALE_S mirrors query_profit_risk.BREAKER_EVAL_STALE_S; it
// is only the fallback for a payload predating the field (the server publishes the
// real bound as last_eval_stale_after_s).
const DEFAULT_EVAL_STALE_S = 14400;

// RD-B7 — breaker-evaluation freshness, recomputed HERE rather than trusted from
// the server's snapshot. /api/auto/profit-risk is served through a
// stale-while-revalidate cache, so on the first hit after an idle period the whole
// body can be arbitrarily old (a 16h48m-old body was observed served as current).
// A server-computed age freezes with it and keeps looking fresh — a stale number
// wearing a freshness label, which is worse than no age at all. Deriving the age
// from the ABSOLUTE `last_eval_at` against the browser clock means a frozen body
// shows a growing age and trips the bound on its own.
//
// Falls back to the server's `last_eval_age_s` / `last_eval_stale` only when
// `last_eval_at` is absent. Undatable → stale (fail-safe), never a silent OK.
function evalFreshness(b: BreakerState): { ageS: number | null; stale: boolean } {
  const boundS = b.last_eval_stale_after_s ?? DEFAULT_EVAL_STALE_S;
  if (b.last_eval_at) {
    const parsed = Date.parse(b.last_eval_at);
    if (Number.isFinite(parsed)) {
      const ageS = Math.max(0, Math.round((Date.now() - parsed) / 1000));
      return { ageS, stale: ageS > boundS };
    }
  }
  if (typeof b.last_eval_age_s === "number" && Number.isFinite(b.last_eval_age_s)) {
    return { ageS: b.last_eval_age_s, stale: b.last_eval_age_s > boundS };
  }
  return { ageS: null, stale: b.last_eval_stale ?? true };
}

// RD-B7 — "3m ago" / "7h ago" / "—" for the evaluation age.
function fmtEvalAge(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

// RD-B7 — the bound, in words, for the explanatory line.
function fmtBound(seconds: number): string {
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

// ── component ───────────────────────────────────────────────────────────────

export function ProfitRiskPanel() {
  const [data, setData] = React.useState<ProfitRiskResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  // B4: replica file age for the freshness badge — the open trades here are read
  // from the lagging litestream replica; the live count lives in the heartbeat.
  const [replicaAge, setReplicaAge] = React.useState<number | null>(null);
  // B7: flag OFF (default) renders the existing JSX verbatim (byte-identical);
  // ON wraps each value in <LiveValue> so it flashes mint/red on its own refresh.
  const live = useLiveTerminal();

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) {
          setData((await res.json()) as ProfitRiskResponse);
        }
      } catch {
        /* keep last good state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchState();
    const id = setInterval(() => void fetchState(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // B4 — freshness badge: surface how far the replica lags live (mirrors
  // capital-hero's "· stale" precedent). Reuses /api/hub/drift-state.
  React.useEffect(() => {
    let cancelled = false;
    const fetchAge = async () => {
      try {
        const res = await fetch("/api/hub/drift-state", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const d = (await res.json()) as { replica_age_seconds?: number | null };
          if (typeof d?.replica_age_seconds === "number") setReplicaAge(d.replica_age_seconds);
        }
      } catch {
        /* badge stays hidden on failure */
      }
    };
    void fetchAge();
    const id = setInterval(() => void fetchAge(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // RD-B7 — tick so the evaluation age keeps growing even while fetches are
  // FAILING. A successful poll re-renders on its own (setData), which is what
  // defeats a frozen SWR body; this covers the other case — endpoint down, last
  // good state retained — where an age that stopped advancing would itself be a
  // small frozen-number lie.
  const [, setAgeTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setAgeTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const breakers = data?.breakers;
  const trades = data?.open_trades ?? [];

  // RD-B7 — recomputed every render off the ABSOLUTE last_eval_at (see
  // evalFreshness). `data` is intentionally in the dependency chain via render,
  // not memoized on it, so a frozen body still yields a growing age.
  const evalBoundS = breakers?.last_eval_stale_after_s ?? DEFAULT_EVAL_STALE_S;
  const { ageS: evalAgeS, stale: evalStale } = breakers
    ? evalFreshness(breakers)
    : { ageS: null, stale: true };

  // RD-B7 — `overall_status` is computed server-side and therefore FREEZES with a
  // cached body: a body cached while fresh keeps serving "OK" no matter how old the
  // evaluation it describes has since become. So the all-clear is re-derived here
  // against the locally-recomputed staleness, exactly as the server does it. Only
  // OK degrades — RED (a latched halt) and OFF (an explicit override) are facts
  // that staleness does not erase.
  const overallStatus =
    breakers && evalStale && breakers.overall_status === "OK"
      ? "UNKNOWN"
      : breakers?.overall_status;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Profit-Taking ─────────────────────────────────────────────── */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <TrendingUp size={14} aria-hidden />
              Profit-Taking ·{" "}
              {live ? (
                <LiveValue value={data?.open_count ?? 0} format={(n) => String(n)} />
              ) : (
                data?.open_count ?? 0
              )}
              {/* B2: OPEN-NOTIONAL subtotal — Σ over the merged heartbeat open-set. */}
              {(data?.open_notional ?? 0) > 0 && (
                <span className="font-normal normal-case tracking-normal text-fg-muted">
                  · ${(data?.open_notional ?? 0).toFixed(2)}
                </span>
              )}
            </span>
          </CardTitle>
          {replicaAge !== null && (
            <span
              className="shrink-0 font-sans text-micro text-accent-gold"
              title="Open positions are read from the lagging litestream replica — the live count lives in the heartbeat (Health → Data Freshness)."
            >
              REPLICA ~{fmtReplicaAge(replicaAge)}
            </span>
          )}
        </CardHeader>

        {loading && !data && <Skeleton className="h-20 w-full" />}

        {!loading && trades.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
            <TrendingUp size={24} className="opacity-20" aria-hidden />
            <span className="text-caption text-fg-muted">No open positions</span>
            <span className="text-micro text-fg-faint">
              Breakeven, ratchet and partial-exit progress appear here while a
              position is open.
            </span>
          </div>
        )}

        {trades.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {trades.map((t) => {
              // B2: a thin (heartbeat-only, not-yet-replicated) live position — its
              // Stage-1 exit/risk detail is still syncing. Render identity + live
              // leverage/notional + a "syncing" pill, NOT a misleading BE-OFF row.
              if (t.thin) {
                return (
                  <li key={t.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill intent="warn" size="sm">
                          syncing
                        </Pill>
                        <span className="text-h3 font-bold tabular-nums">
                          {t.ticker}{" "}
                          <span
                            className={
                              t.direction === "LONG"
                                ? "text-accent-green"
                                : "text-accent-red"
                            }
                          >
                            {t.direction}
                          </span>
                        </span>
                      </div>
                      <span className="text-caption tabular-nums text-fg-muted">
                        {t.leverage != null ? `${Number(t.leverage).toFixed(0)}x` : ""}
                        {t.notional_usd != null
                          ? ` · $${Number(t.notional_usd).toFixed(2)}`
                          : ""}
                      </span>
                    </div>
                    <span className="text-micro text-fg-faint">
                      breakeven / ratchet / partials syncing… (live from heartbeat,
                      not yet replicated)
                    </span>
                  </li>
                );
              }
              const scaledOut =
                t.original_notional_usd != null &&
                t.notional_usd != null &&
                t.original_notional_usd > 0 &&
                t.notional_usd < t.original_notional_usd;
              return (
                <li key={t.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-h3 font-bold tabular-nums">
                      {t.ticker}{" "}
                      <span
                        className={
                          t.direction === "LONG"
                            ? "text-accent-green"
                            : "text-accent-red"
                        }
                      >
                        {t.direction}
                      </span>
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill
                        tone={t.breakeven_armed ? "green" : "neutral"}
                        size="sm"
                      >
                        <Lock size={10} aria-hidden />
                        {t.breakeven_armed
                          ? "Break-even stop set"
                          : "No break-even stop"}
                      </Pill>
                      {t.ratchet_locked_r > 0 && (
                        <Pill tone="cyan" size="sm">
                          <Anchor size={10} aria-hidden />
                          Profit locked in:{" "}
                          {live ? (
                            <LiveValue
                              value={t.ratchet_locked_r}
                              format={(n) => n.toFixed(2)}
                            />
                          ) : (
                            t.ratchet_locked_r.toFixed(2)
                          )}
                          × the risk
                        </Pill>
                      )}
                      {t.partials_taken > 0 && (
                        <Pill tone="violet" size="sm">
                          <Scissors size={10} aria-hidden />
                          Sold{" "}
                          {live ? (
                            <LiveValue
                              value={t.partials_taken}
                              format={(n) => String(n)}
                            />
                          ) : (
                            t.partials_taken
                          )}{" "}
                          slice{t.partials_taken > 1 ? "s" : ""} already
                        </Pill>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-muted">
                    <span className="flex items-center gap-1">
                      realized
                      {t.partial_pnl_realized !== 0 ? (
                        <MoneyText
                          value={t.partial_pnl_realized}
                          unit="$"
                          size="sm"
                          decimals={2}
                          showSign
                        />
                      ) : (
                        <span className="tabular-nums text-fg-muted">$0.00</span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      risk{" "}
                      <span className="text-fg-default">
                        {live ? (
                          <LiveValue
                            value={t.risk_dollars}
                            format={(n) => `$${Number(n).toFixed(2)}`}
                          />
                        ) : t.risk_dollars != null ? (
                          `$${Number(t.risk_dollars).toFixed(2)}`
                        ) : (
                          "—"
                        )}
                      </span>{" "}
                      (
                      {live ? (
                        <LiveValue value={t.risk_pct} format={(n) => fmtRiskPct(n)} />
                      ) : (
                        fmtRiskPct(t.risk_pct)
                      )}
                      )
                    </span>
                    {scaledOut && (
                      <span className="tabular-nums text-accent-cyan-soft">
                        scaled ${Number(t.notional_usd).toFixed(0)}/$
                        {Number(t.original_notional_usd).toFixed(0)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Risk & Circuit Breakers ───────────────────────────────────── */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <ShieldCheck size={14} aria-hidden />
              Circuit Breakers
            </span>
          </CardTitle>
        </CardHeader>

        {loading && !data && <Skeleton className="h-24 w-full" />}

        {breakers && (
          <div className="flex flex-col gap-3">
            {/* RD-B7 — Entries gate banner. A HALT (entries_allowed=false) is a
                latched fact and still renders red even when the evaluation is
                stale. The ALL-CLEAR is the one that degrades: an "Entries
                Allowed" green banner sourced from an undatable evaluation was
                half of the green lie. When stale it becomes a NEUTRAL "not
                asked" banner — never green (that was the lie), never red (a
                fault we cannot prove; the same defect with the opposite colour,
                and a card that screams a fault on no-data gets ignored). */}
            {!breakers.entries_allowed ? (
              <div className="flex items-center gap-2 rounded-md border border-accent-red/40 bg-accent-red/15 px-3 py-2 shadow-glow-subtle-red">
                <ShieldX size={16} className="text-accent-red" aria-hidden />
                <span className="text-caption font-bold uppercase tracking-wider text-accent-red">
                  ⛔ Entries Halted
                </span>
              </div>
            ) : evalStale ? (
              <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-subtle px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <HelpCircle size={16} className="text-fg-muted" aria-hidden />
                  <span className="text-caption font-semibold uppercase tracking-wider text-fg-muted">
                    Entries — Unknown
                  </span>
                  <Pill tone="neutral" size="sm">
                    NOT EVALUATED
                  </Pill>
                  {breakers.override_active && (
                    <Pill tone="amber" size="sm">
                      OVERRIDE ACTIVE
                    </Pill>
                  )}
                </div>
                <span className="text-micro leading-snug text-fg-muted">
                  The safety check hasn&rsquo;t run yet — it only runs when a trade is
                  about to be placed, and none has been in{" "}
                  {fmtEvalAge(evalAgeS).replace(" ago", "")} (longer than the{" "}
                  {fmtBound(evalBoundS)} we wait before saying so). This means
                  &ldquo;no recent answer&rdquo;, not a fault. Last time it ran, the
                  answer was{" "}
                  <span className="text-fg-default">
                    {breakers.entries_allowed
                      ? "new trades allowed"
                      : "new trades blocked"}
                  </span>
                  , {fmtEvalAge(evalAgeS)}.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1 rounded-md border border-accent-green/30 bg-accent-green/10 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheck size={16} className="text-accent-green" aria-hidden />
                  <span className="text-caption font-semibold uppercase tracking-wider text-accent-green">
                    Entries Allowed
                  </span>
                  {breakers.override_active && (
                    <Pill tone="amber" size="sm">
                      OVERRIDE ACTIVE
                    </Pill>
                  )}
                </div>
                <span className="text-micro text-fg-muted">
                  Safety check ran {fmtEvalAge(evalAgeS)}.
                </span>
              </div>
            )}

            {/* Overall status + any active (non-OK) breakers as a quick row. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-micro uppercase tracking-wider text-fg-muted">
                overall
              </span>
              <Pill tone={statusTone(overallStatus ?? "UNKNOWN")} size="sm">
                {overallStatus ?? "UNKNOWN"}
              </Pill>
              {/* RD-B7 — the evaluation's age rides alongside the status pill, so
                  the reading is never presented undated. */}
              <span
                className="text-micro tabular-nums text-fg-muted"
                title={
                  breakers.last_eval_at
                    ? `Breaker last evaluated ${breakers.last_eval_at} (UTC); stale after ${fmtBound(evalBoundS)}`
                    : "Breaker evaluation time unavailable"
                }
              >
                evaluated {fmtEvalAge(evalAgeS)}
              </span>
              {breakers.active.map((a) => (
                <Pill key={a.key} tone={statusTone(a.status)} size="sm">
                  <ShieldAlert size={10} aria-hidden />
                  {a.label}
                </Pill>
              ))}
            </div>

            {/* Per-breaker gauges: reading vs limit, color-coded by status.
                RD-B7 — when the evaluation is stale these readings are just as
                undated as the headline, so they go NEUTRAL rather than keep
                showing a confident green dot. Greyed, not reddened: the reading
                is unverified, not bad. A tripped gauge keeps its red. */}
            <ul className="flex flex-col divide-y divide-border-subtle">
              {breakers.all.map((g) => {
                const muted = evalStale && g.status !== "RED";
                return (
                  <li
                    key={g.key}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span className="text-caption text-fg-muted">{g.label}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`text-caption tabular-nums ${
                          muted ? "text-fg-muted" : statusText(g.status)
                        }`}
                      >
                        {fmtGauge(g)}
                      </span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          g.status === "RED"
                            ? "bg-accent-red"
                            : muted
                              ? "bg-fg-muted/40"
                              : g.status === "YELLOW"
                                ? "bg-accent-amber"
                                : "bg-accent-green"
                        }`}
                        aria-hidden
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
            {evalStale && breakers.all.length > 0 && (
              <span className="text-micro text-fg-muted">
                Readings shown are the last recorded values, {fmtEvalAge(evalAgeS)} —
                not a current measurement.
              </span>
            )}

            {breakers.error && (
              <div className="text-micro text-accent-amber">
                breaker read degraded: {breakers.error}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
