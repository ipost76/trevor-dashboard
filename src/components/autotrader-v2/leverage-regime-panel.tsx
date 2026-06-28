"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  LiveValue,
} from "@/components/ui";
import {
  Gauge,
  Activity,
  Layers,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Waves,
  Minus,
  GitCompareArrows,
} from "lucide-react";
import { useLiveTerminal } from "@/lib/live-terminal";

// S2-P05 — Leverage + Regime panel (READ-ONLY display).
//
// Surfaces Stage-2 state that already lands in the bot but was never visible:
//   1. Per open LIVE trade — chosen dynamic leverage (S2-P01), the
//      maintenance-margin liquidation distance shown as a safety margin vs the
//      ≥k×stop guarantee, and the conf/regime/vol multiplier breakdown (S2-P02).
//   2. Current HMM regime per ticker (latest hmm_inference_log row).
//   3. Margin utilization (live HL marginSummary).
//   4. Regime-exit shadow comparison (exit_engine_shadow — would-be vs actual)
//      so promotion can be judged.
//
// This panel NEVER sends commands to the bot. It only GETs /api/auto/leverage-regime.
// Matches the repo's data-fetching convention (raw fetch + setInterval); the
// dashboard has no react-query/SWR dependency (see profit-risk-panel.tsx).

const ENDPOINT = "/api/auto/leverage-regime";
const POLL_MS = 15_000;

interface LevBreakdown {
  liq_safe_cap?: number;
  conf_mult?: number;
  regime_mult?: number;
  vol_mult?: number;
  weighted_target?: number;
  final?: number;
  confidence?: number;
  regime?: string;
  atr_pct?: number;
}

interface LevTrade {
  id: number;
  ticker: string;
  direction: string;
  leverage: number | null;
  leverage_at_entry: number | null;
  liq_distance_at_entry: number | null;
  entry_price: number | null;
  stop_price: number | null;
  notional_usd: number | null;
  regime_at_entry: string | null;
  opened_at: string | null;
  stop_fraction: number | null;
  required_liq_distance: number | null;
  liq_safe: boolean | null;
  breakdown: LevBreakdown | null;
}

interface RegimeRow {
  ticker: string;
  state: string | null;
  prob: number | null;
  all_probs: Record<string, number>;
  ts: number | null;
  age_seconds: number | null;
}

interface MarginState {
  available: boolean;
  account_value: number;
  margin_used: number;
  utilization_pct: number;
  total_ntl_pos: number;
  error?: string;
}

interface ShadowRow {
  id: number;
  trade_id: number | null;
  ticker: string;
  direction: string | null;
  regime: string | null;
  check_time: string | null;
  old_exit_action: string | null;
  new_exit_action: string | null;
  old_stop_price: number | null;
  new_stop_price: number | null;
  current_price: number | null;
  pnl_pct: number | null;
  divergent: boolean;
}

interface RegimeExitShadow {
  available: boolean;
  total: number;
  divergent: number;
  recent: ShadowRow[];
  error?: string;
}

interface LeverageRegimeResponse {
  data_available: boolean;
  ts: number;
  open_count: number;
  leverage_dynamic_enabled: boolean;
  leverage_weighting_enabled: boolean;
  autotrader_enabled: boolean;
  liq_buffer_k: number;
  open_trades: LevTrade[];
  regimes: RegimeRow[];
  margin: MarginState;
  regime_exit_shadow: RegimeExitShadow;
  error?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(Number(v) * 100).toFixed(decimals)}%`;
}

function fmtMult(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Number(v).toFixed(2)}×`;
}

function fmtAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Regime → visual (icon + accent class + bar class + short label).
// `bar` is a LITERAL bg class (never derived from `cls`) so Tailwind's static
// scanner emits the CSS — dynamically-built class strings are not detected.
type RegimeVisual = { icon: React.ReactNode; cls: string; bar: string; label: string };
function regimeVisual(state: string | null | undefined): RegimeVisual {
  const s = (state ?? "").toUpperCase();
  if (s === "TRENDING_BULL")
    return { icon: <TrendingUp size={14} aria-hidden />, cls: "text-accent-mint", bar: "bg-accent-mint", label: "TREND ↑" };
  if (s === "TRENDING_BEAR")
    return { icon: <TrendingDown size={14} aria-hidden />, cls: "text-accent-red", bar: "bg-accent-red", label: "TREND ↓" };
  if (s === "VOLATILE")
    return { icon: <Waves size={14} aria-hidden />, cls: "text-accent-gold", bar: "bg-accent-gold", label: "VOLATILE" };
  if (s === "RANGING")
    return { icon: <Minus size={14} aria-hidden />, cls: "text-accent-cyan-soft", bar: "bg-accent-cyan-soft", label: "RANGING" };
  return { icon: <Activity size={14} aria-hidden />, cls: "text-fg-muted", bar: "bg-fg-muted", label: s || "—" };
}

// Margin utilization → tone (green low / gold mid / red high).
function utilTone(pct: number): { bar: string; text: string } {
  if (pct >= 80) return { bar: "bg-accent-red", text: "text-accent-red" };
  if (pct >= 50) return { bar: "bg-accent-gold", text: "text-accent-gold" };
  return { bar: "bg-accent-mint", text: "text-accent-mint" };
}

// ── component ───────────────────────────────────────────────────────────────

// B4 — compact replica-age formatter for the freshness badge.
function fmtReplicaAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function LeverageRegimePanel() {
  const [data, setData] = React.useState<LeverageRegimeResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  // B4: replica file age for the freshness badge — the per-open-trade leverage
  // here is read from the lagging replica; the live count lives in the heartbeat.
  const [replicaAge, setReplicaAge] = React.useState<number | null>(null);
  // B7: flag OFF (default) renders the existing JSX verbatim (byte-identical);
  // ON wraps each stat value in <LiveValue> so it flashes mint/red on its own
  // refresh. tabular-nums (baked into <LiveValue>) keeps the text-h1 margin
  // headline from shifting when a digit-width changes.
  const live = useLiveTerminal();

  React.useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) {
          setData((await res.json()) as LeverageRegimeResponse);
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

  const trades = data?.open_trades ?? [];
  const regimes = data?.regimes ?? [];
  const margin = data?.margin;
  const shadow = data?.regime_exit_shadow;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Leverage ──────────────────────────────────────────────────── */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex flex-wrap items-center gap-2 uppercase tracking-wider">
              <Gauge size={14} aria-hidden />
              Leverage ·{" "}
              {live ? (
                <LiveValue value={data?.open_count ?? 0} format={(n) => String(n)} />
              ) : (
                data?.open_count ?? 0
              )}
              {data && (
                <Pill
                  intent={data.leverage_dynamic_enabled ? "active" : "warn"}
                  size="sm"
                >
                  DYNAMIC {data.leverage_dynamic_enabled ? "ON" : "OFF"}
                </Pill>
              )}
              {data?.leverage_weighting_enabled && (
                <Pill intent="active" size="sm">
                  WEIGHTED
                </Pill>
              )}
            </span>
          </CardTitle>
          {replicaAge !== null && (
            <span
              className="shrink-0 font-sans text-micro text-accent-gold"
              title="Per-open-trade leverage is read from the lagging litestream replica — the live count lives in the heartbeat (Health → Data Freshness)."
            >
              REPLICA ~{fmtReplicaAge(replicaAge)}
            </span>
          )}
        </CardHeader>

        {loading && !data && <Skeleton className="h-20 w-full" />}

        {!loading && trades.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
            <Gauge size={24} className="opacity-20" aria-hidden />
            <span className="text-caption text-fg-muted">No open positions</span>
            <span className="text-micro text-fg-faint">
              Stage-2 sizing populates on the next live entry
              {data && !data.autotrader_enabled ? " (AutoTrader paused)" : ""}.
            </span>
          </div>
        )}

        {trades.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {trades.map((t) => {
              const lev = t.leverage_at_entry ?? t.leverage;
              const safe = t.liq_safe;
              return (
                <li key={t.id} className="flex flex-col gap-1.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-h3 font-bold tabular-nums">
                      {t.ticker}{" "}
                      <span
                        className={
                          t.direction === "LONG"
                            ? "text-accent-mint"
                            : "text-accent-red"
                        }
                      >
                        {t.direction}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {live ? (
                        <LiveValue
                          value={lev}
                          format={(n) => `${Number(n).toFixed(0)}×`}
                          className="text-h3 font-bold"
                        />
                      ) : (
                        <span className="text-h3 font-bold tabular-nums text-accent-cyan-soft">
                          {lev != null ? `${Number(lev).toFixed(0)}×` : "—"}
                        </span>
                      )}
                      {safe === true && (
                        <Pill intent="active" size="sm">
                          <ShieldCheck size={10} aria-hidden />
                          SAFE
                        </Pill>
                      )}
                      {safe === false && (
                        <Pill intent="error" size="sm">
                          <ShieldAlert size={10} aria-hidden />
                          CHECK
                        </Pill>
                      )}
                    </span>
                  </div>

                  {/* Liquidation safety margin — the "is my aggressive leverage
                      actually safe" line. liq distance vs the ≥k×stop guarantee. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
                    <span className="text-fg-muted">
                      liq distance{" "}
                      {live ? (
                        <LiveValue
                          value={t.liq_distance_at_entry}
                          format={(n) => fmtPct(n)}
                          className="font-semibold"
                        />
                      ) : (
                        <span
                          className={`tabular-nums font-semibold ${
                            safe === false ? "text-accent-red" : "text-accent-mint"
                          }`}
                        >
                          {fmtPct(t.liq_distance_at_entry)}
                        </span>
                      )}
                    </span>
                    <span className="text-fg-muted">
                      required{" "}
                      <span className="tabular-nums text-fg-default">
                        {live ? (
                          <LiveValue
                            value={t.required_liq_distance}
                            format={(n) => fmtPct(n)}
                          />
                        ) : (
                          fmtPct(t.required_liq_distance)
                        )}
                      </span>{" "}
                      <span className="text-fg-muted">
                        ({data?.liq_buffer_k ?? 2.5}× stop{" "}
                        {live ? (
                          <LiveValue
                            value={t.stop_fraction}
                            format={(n) => fmtPct(n)}
                          />
                        ) : (
                          fmtPct(t.stop_fraction)
                        )}
                        )
                      </span>
                    </span>
                  </div>

                  {/* S2-P02 multiplier breakdown — conf × regime × vol → cap. */}
                  {t.breakdown ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-subtle bg-bg-elevated/40 px-2.5 py-1.5 text-micro tabular-nums text-fg-muted">
                      <span>
                        conf{" "}
                        {live ? (
                          <LiveValue
                            value={t.breakdown.conf_mult ?? null}
                            format={(n) => fmtMult(n)}
                          />
                        ) : (
                          <span className="text-accent-cyan-soft">
                            {fmtMult(t.breakdown.conf_mult)}
                          </span>
                        )}
                      </span>
                      <span>
                        regime{" "}
                        {live ? (
                          <LiveValue
                            value={t.breakdown.regime_mult ?? null}
                            format={(n) => fmtMult(n)}
                          />
                        ) : (
                          <span className="text-accent-cyan-soft">
                            {fmtMult(t.breakdown.regime_mult)}
                          </span>
                        )}
                      </span>
                      <span>
                        vol{" "}
                        {live ? (
                          <LiveValue
                            value={t.breakdown.vol_mult ?? null}
                            format={(n) => fmtMult(n)}
                          />
                        ) : (
                          <span className="text-accent-cyan-soft">
                            {fmtMult(t.breakdown.vol_mult)}
                          </span>
                        )}
                      </span>
                      <span className="text-fg-muted">→</span>
                      <span>
                        cap{" "}
                        {live ? (
                          <LiveValue
                            value={t.breakdown.liq_safe_cap ?? null}
                            format={(n) => `${Number(n).toFixed(0)}×`}
                          />
                        ) : (
                          <span className="text-fg-default">
                            {t.breakdown.liq_safe_cap != null
                              ? `${Number(t.breakdown.liq_safe_cap).toFixed(0)}×`
                              : "—"}
                          </span>
                        )}
                      </span>
                      {t.breakdown.regime && (
                        <span className="text-fg-muted">· {t.breakdown.regime}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-micro text-fg-faint">
                      multiplier breakdown unavailable (legacy / fixed-leverage entry)
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Current Regime (HMM) ──────────────────────────────────────── */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <Activity size={14} aria-hidden />
              Current Regime · HMM
            </span>
          </CardTitle>
        </CardHeader>

        {loading && !data && <Skeleton className="h-24 w-full" />}

        {!loading && regimes.length === 0 && (
          <div className="py-6 text-center text-caption text-fg-muted">
            No HMM inference rows yet.
          </div>
        )}

        {regimes.length > 0 && (
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            {regimes.map((r) => {
              const v = regimeVisual(r.state);
              const pct = r.prob != null ? Math.round(r.prob * 100) : null;
              return (
                <li
                  key={r.ticker}
                  className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-elevated/40 p-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-caption font-bold tabular-nums">
                      {r.ticker}
                    </span>
                    <span className={v.cls}>{v.icon}</span>
                  </div>
                  <span className={`text-micro font-semibold uppercase tracking-wider ${v.cls}`}>
                    {v.label}
                  </span>
                  {/* Confidence bar for the predicted state. */}
                  <div className="h-1 w-full overflow-hidden rounded-full bg-bg-base">
                    <div
                      className={`h-full rounded-full ${v.bar}`}
                      style={{ width: `${pct ?? 0}%` }}
                      aria-hidden
                    />
                  </div>
                  <div className="flex items-center justify-between text-micro text-fg-muted">
                    <span className="tabular-nums">
                      {live ? (
                        <LiveValue value={pct} format={(n) => `${n}%`} />
                      ) : pct != null ? (
                        `${pct}%`
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="tabular-nums" title={r.ts ? String(r.ts) : undefined}>
                      {fmtAge(r.age_seconds)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Margin Utilization ────────────────────────────────────────── */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <Layers size={14} aria-hidden />
              Margin Utilization
            </span>
          </CardTitle>
        </CardHeader>

        {loading && !data && <Skeleton className="h-16 w-full" />}

        {margin && (
          <div className="flex flex-col gap-3">
            {margin.available ? (
              <>
                {(() => {
                  const pct = Number(margin.utilization_pct) || 0;
                  const tone = utilTone(pct);
                  return (
                    <>
                      <div className="flex items-end justify-between gap-3">
                        {live ? (
                          <LiveValue
                            value={pct}
                            format={(n) => `${n.toFixed(1)}%`}
                            className="text-h1 font-bold"
                          />
                        ) : (
                          <span className={`text-h1 font-bold tabular-nums ${tone.text}`}>
                            {pct.toFixed(1)}%
                          </span>
                        )}
                        <span className="text-caption tabular-nums text-fg-muted">
                          ${margin.margin_used.toFixed(2)} used / $
                          {margin.account_value.toFixed(2)} acct
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-base">
                        <div
                          className={`h-full rounded-full ${tone.bar}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                          aria-hidden
                        />
                      </div>
                      <div className="flex items-center justify-between text-micro text-fg-muted">
                        <span>open notional</span>
                        <span className="tabular-nums">
                          {live ? (
                            <LiveValue
                              value={margin.total_ntl_pos}
                              format={(n) => `$${n.toFixed(2)}`}
                            />
                          ) : (
                            `$${margin.total_ntl_pos.toFixed(2)}`
                          )}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </>
            ) : (
              <div className="text-micro text-accent-gold">
                margin read degraded
                {margin.error ? `: ${margin.error}` : " — HL unreachable"}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Regime-Exit Shadow (would-be vs actual) ───────────────────── */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex flex-wrap items-center gap-2 uppercase tracking-wider">
              <GitCompareArrows size={14} aria-hidden />
              Regime-Exit Shadow
              {shadow && (
                <>
                  <Pill tone="neutral" size="sm">
                    {shadow.total} EVAL
                  </Pill>
                  {shadow.divergent > 0 && (
                    <Pill intent="warn" size="sm">
                      {shadow.divergent} DIVERGENT
                    </Pill>
                  )}
                </>
              )}
            </span>
          </CardTitle>
        </CardHeader>

        {loading && !data && <Skeleton className="h-20 w-full" />}

        {shadow && !shadow.available && (
          <div className="text-micro text-accent-gold">
            shadow read degraded{shadow.error ? `: ${shadow.error}` : ""}
          </div>
        )}

        {shadow && shadow.available && shadow.recent.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 py-6 text-center">
            <GitCompareArrows size={24} className="opacity-20" aria-hidden />
            <span className="text-caption text-fg-muted">No exit-shadow rows yet</span>
            <span className="text-micro text-fg-faint">
              Would-be vs actual exit decisions appear here as the regime-aware
              exit engine evaluates open trades.
            </span>
          </div>
        )}

        {shadow && shadow.recent.length > 0 && (
          <>
            <p className="mb-2 text-micro text-fg-muted">
              Production exit (actual) vs the regime-aware candidate (would-be) —
              for judging promotion.
            </p>
            <ul className="divide-y divide-border-subtle">
              {shadow.recent.map((s) => {
                const v = regimeVisual(s.regime);
                // One compact glance line per row (G4): ticker · dir · regime ·
                // actual→would-be · pnl% · state. Boilerplate words cut; the
                // old→new action divergence (gold when divergent) is the point.
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-x-1.5 gap-y-1 py-1.5 text-micro tabular-nums text-fg-muted"
                  >
                    <span className="text-caption font-bold tabular-nums">
                      {s.ticker}{" "}
                      <span
                        className={
                          s.direction === "LONG"
                            ? "text-accent-mint"
                            : "text-accent-red"
                        }
                      >
                        {s.direction}
                      </span>
                    </span>
                    <span className="text-fg-faint">·</span>
                    <span className={`flex items-center gap-1 font-normal ${v.cls}`}>
                      {v.icon}
                      {s.regime ?? "—"}
                    </span>
                    <span className="text-fg-faint">·</span>
                    <span className={s.divergent ? "text-accent-gold" : undefined}>
                      {s.old_exit_action ?? "—"}→{s.new_exit_action ?? "—"}
                    </span>
                    {s.pnl_pct != null && (
                      <>
                        <span className="text-fg-faint">·</span>
                        <span
                          className={
                            s.pnl_pct >= 0 ? "text-accent-mint" : "text-accent-red"
                          }
                        >
                          {s.pnl_pct >= 0 ? "+" : ""}
                          {Number(s.pnl_pct).toFixed(2)}%
                        </span>
                      </>
                    )}
                    {s.divergent ? (
                      <Pill intent="warn" size="sm">
                        DIVERGENT
                      </Pill>
                    ) : (
                      <Pill tone="neutral" size="sm">
                        EVAL
                      </Pill>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
