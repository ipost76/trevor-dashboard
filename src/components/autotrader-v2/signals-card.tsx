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
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { ReplicaAge } from "@/lib/replica-age";
// 🚨 The two-clock rule lives in one tested place — see src/lib/et-clock.ts.
// created_at_utc is REAL UTC and must be converted; the RECENT trade rows
// raw-slice their naive-ET columns instead. Using either helper on the wrong
// kind of column is the 4-hour bug, in one direction or the other.
import { fmtEtFromUtc, parseUtc } from "@/lib/et-clock";
import { Radio, AlertTriangle } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// W4b (2026-07-30) — RECENT SIGNALS, and the three-state empty message.
//
// 🚨 THE DEFECT THIS CLOSES is not "signals are missing". It is that three
// completely different situations rendered as the SAME empty screen:
//     (a) no signals were produced
//     (b) signals were produced and none converted
//     (c) the replica has not caught up
// During 18 hours of zero entries the truth was (b) — the system was producing
// ~26 signals normally and dying at the last gate — and Ghost had no way to
// know that from the Hub. A bare "nothing yet" is what made those 18 hours
// unreadable, so this card never renders one.
//
// 🚨 WHAT IT DOES NOT CLAIM. The Hub reads a replica; it cannot read journals.
// Every Stage-A kill (SIGNAL-GUARD, TREND-FLOOR, P3-SCREEN) happens before any
// DB row exists, and `entry_failed` names no specific gate. So a signal with no
// recorded reason shows "not converted" with the reason blank, and the funnel
// line states its own gap out loud. See query_signals.py's header for the
// measured limits.
// ─────────────────────────────────────────────────────────────────────────────

type SignalState =
  | "converting"
  | "signals_no_trades"
  | "no_signals"
  | "scanner_silent";

interface SignalRow {
  signal_id: number;
  ticker: string;
  direction: string | null;
  score: number | null;
  quality_tier: string | null;
  regime: string | null;
  /** 🚨 REAL UTC. Rendered via fmtEtFromUtc — never the raw-slice helper the
      RECENT trade rows use, which is correct only for naive-ET columns. */
  created_at_utc: string;
  converted: boolean;
  trade_id: number | null;
  trade_mode: string | null;
  trade_status: string | null;
  /** FINAL-LEG net only — see `realisedNet` below. */
  pnl_usd: number | null;
  /** B6-LEDGER: banked scale-out profit, null when the trade never scaled out. */
  partial_pnl_realized: number | null;
  /** B6-LEDGER: PAPER per the authority, never `trade_mode` (which lies for #101733). */
  is_paper: boolean;
  decision_action: string | null;
  decision_reason: string | null;
}

/**
 * Realised net for one trade — the SAME quantity the REALIZED card above sums.
 *
 * 🚨 B6-LEDGER (2026-08-09): the row rendered `pnl_usd` alone while the card
 * sums `pnl_usd + COALESCE(partial_pnl_realized, 0)`, so every scaled-out trade
 * showed a SMALLER number on its row than it contributed to the card on the same
 * screen. Measured on #101786 (SUI): row $0.0791 vs contribution $0.1744 — a
 * $0.0953 permanent disagreement. The card is the one that is right.
 *
 * Returns null only when the final leg itself was never captured — that stays a
 * "no P&L" render, never a 0.00 (RM-RED-2 M10).
 */
function realisedNet(s: SignalRow): number | null {
  if (s.pnl_usd == null) return null;
  return s.pnl_usd + (s.partial_pnl_realized ?? 0);
}

interface SignalsResponse {
  window_hours: number;
  replica_age_seconds: number | null;
  /** B2-RM-PROFIT: absolute replica watermark (real UTC epoch SECONDS) — the
   *  term the freshness stamp derives from, because a duration cannot age. */
  replica_mtime_epoch_s?: number | null;
  state: SignalState;
  replica_stale: boolean;
  scanner_silent_seconds: number | null;
  scanner: {
    cycles: number;
    ticker_scans: number;
    candidates: number;
    signals_posted: number;
    newest_scan_utc: string | null;
    scan_age_seconds: number | null;
  };
  funnel: {
    signals: number;
    with_decision: number;
    rejected: number;
    converted: number;
    unexplained: number;
  };
  reject_reasons: Array<{ reason: string | null; n: number }>;
  signals: SignalRow[];
  data_available: boolean;
  error?: string;
}

const WINDOW_HOURS = 24;

function fmtQuiet(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "an unknown time";
  if (seconds < 90) return "under a minute";
  const m = Math.round(seconds / 60);
  return m < 90 ? `${m} min` : `${Math.round(seconds / 3600)}h`;
}

/**
 * Rejection codes → plain English. The codes are the bot's own wire values,
 * written verbatim by `query_signals.fetch_reject_reasons`.
 *
 * 🚨 An UNMAPPED code renders as "Other", NEVER as the raw code — a screen is
 * not a log. Nothing is lost by that: the count still shows, and the raw string
 * carried no meaning to a reader who does not already know the codebase.
 *
 * `entry_failed` is deliberately vague here because it is deliberately vague at
 * the source — the helper's own docstring records that the specific gate behind
 * it is not stored anywhere. Naming a gate would invent precision the data does
 * not have, which is the defect this pass exists to remove.
 */
const REJECT_REASON_COPY: Record<string, string> = {
  regime_blocked: "Market conditions were wrong",
  entry_failed: "Couldn't place the trade",
  "time_gate:utc_hour": "Outside trading hours",
  correlation_limit: "Too similar to a trade already open",
  chop_brake_loss_streak: "Paused after a losing streak",
  insufficient_equity: "Not enough account balance",
  duplicate_open_trade: "Already in this trade",
};

function fmtRejectReason(reason: string | null, n: number): string {
  const copy = reason === null ? undefined : REJECT_REASON_COPY[reason];
  return `${copy ?? "Other"} (${n})`;
}

/**
 * The three-state message. 🚨 This is the whole point of the card — every
 * branch NAMES which state it is and what that means, so an empty screen is
 * never ambiguous. There is deliberately no generic fallback string.
 */
function emptyStateCopy(d: SignalsResponse): { title: string; body: string } {
  if (!d.data_available) {
    return {
      title: "Couldn't load signals",
      body: "The signals API is unreachable — this is a Hub/data error, NOT a quiet market. Retrying every 30s.",
    };
  }
  switch (d.state) {
    case "scanner_silent":
      // 🚨 Named as an observation, not a diagnosis. From the replica alone a
      // silent window is indistinguishable from rows that have not synced yet.
      // `scanner_silent_seconds` already has replica lag subtracted out, so the
      // quiet-time quoted here is about the BOT, not about the Hub's copy.
      return {
        title: "No scan activity recorded",
        body: `No scan cycles landed in the last ${d.window_hours}h — quiet for ${fmtQuiet(d.scanner_silent_seconds)} beyond the replica's own lag. The scanner normally logs one every ~3 min, so this is either a stalled scanner or a replica that hasn't received those rows; the data age above tells you which.`,
      };
    case "no_signals":
      // (a) — and crucially it says the scanner IS working.
      return {
        title: "Scanner running · no signals produced",
        body: `${d.scanner.cycles.toLocaleString()} scan cycles and ${d.scanner.ticker_scans.toLocaleString()} ticker checks in the last ${d.window_hours}h, and nothing scored high enough to post. The bot is healthy — the market just isn't offering setups.`,
      };
    default:
      // "signals_no_trades" with an empty list is unreachable (the state is
      // derived FROM a non-empty list), but a payload can always surprise you.
      return {
        title: "No signals in this window",
        body: `Nothing posted in the last ${d.window_hours}h.`,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C2 (2026-07-31) — E12: LAST SCAN, with an age recomputed HERE.
//
// The bare wall-clock time this used to render made two very different states
// look identical: a replica running a few minutes behind, and a scanner that
// had stopped. A3 measured the scanner and it is healthy — the largest gap in
// 26 hours was 198 seconds across 520 cycles on a ~180s cadence, and the
// apparent 85-minute stall was replica lag (~9 min measured). The number was
// right; the presentation made lag indistinguishable from death.
//
// This is the RD-B7 pattern from profit-risk-panel.tsx's evalFreshness(), and
// it is deliberately the SAME pattern rather than a second freshness idiom: the
// age is derived from the ABSOLUTE timestamp against the browser's own clock at
// render time. That matters because this route is served through a
// stale-while-revalidate cache — a server-computed age freezes with the body it
// travelled in and keeps looking fresh, which is a stale number wearing a
// freshness label. Deriving it here means a frozen body shows a GROWING age and
// trips the bound on its own.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Age past which "last scan" is called out rather than stated flatly.
 *
 * Derived, not picked for looks: the scan cadence is ~180s and the read-only
 * replica publishes on a timer that budgets ~20 min, so normal operation can
 * legitimately show a ~20 min old scan. 45 min sits clear of both — it cannot
 * be reached by ordinary lag, and it matches the STALE_S already used by
 * ReplicaAge so the two freshness surfaces agree on what "behind" means.
 */
const SCAN_STALE_S = 45 * 60;

/** Recompute the scan age against the browser clock. Undatable → no claim. */
function scanFreshness(utc: string | null | undefined): {
  ageS: number | null;
  stale: boolean;
} {
  const d = parseUtc(utc);
  if (d === null) return { ageS: null, stale: false };
  const ageS = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  return { ageS, stale: ageS > SCAN_STALE_S };
}

/** "3 min ago" / "2h ago" — plain words, no notation. */
function fmtScanAge(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function SignalsCard() {
  const [data, setData] = React.useState<SignalsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // C2 — drives the LAST SCAN age forward on its own cadence. Without it the age
  // would only advance when a fetch happened to resolve, so a wedged feed (or a
  // cache serving the same body) would show an age frozen at the moment it was
  // first rendered — the exact failure this fix exists to close.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const fetchSignals = async () => {
      try {
        const res = await fetch(`/api/auto/signals?hours=${WINDOW_HOURS}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setError("Couldn't reach the signals feed. Retrying.");
          return;
        }
        const j = (await res.json()) as SignalsResponse;
        if (cancelled) return;
        setData(j);
        setError(j.error ?? null);
      } catch {
        // The network-down branch. It renders the SAME sentence as the bad-status
        // branch above on purpose: to a reader both mean "the feed isn't
        // answering", and the exception object never said anything they could use.
        if (!cancelled) setError("Couldn't reach the signals feed. Retrying.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchSignals();
    const id = setInterval(fetchSignals, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const f = data?.funnel;

  return (
    <Card padding="md">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <Radio size={14} aria-hidden />
              {/* Now accurate: this card genuinely renders signals. The closed-
                  trades card below is "Recent Trades" (renamed in W4a, when it
                  was still carrying this heading while showing trades). */}
              Recent Signals
              {f && (
                <span className="ml-1 font-mono text-micro text-fg-muted">
                  {f.converted}/{f.signals}
                </span>
              )}
            </span>
          </CardTitle>
          <span className="font-sans text-micro uppercase tracking-wider text-fg-faint">
            {WINDOW_HOURS}h
          </span>
        </div>
      </CardHeader>

      {/* Data age — the (c) discriminator, always visible. */}
      <ReplicaAge asOfEpochS={data?.replica_mtime_epoch_s} className="mb-2 block" />

      {/* 🚨 (c) as a BANNER, not a state. A stale view can still be showing real
          signals, so staleness sits OVER whatever else is true rather than
          replacing it. Without this, an old snapshot reads as current fact. */}
      {data?.replica_stale && (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-2 font-sans text-micro text-accent-gold">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            This view is materially behind the bot. Anything below may already
            be out of date — including an empty list.
          </span>
        </p>
      )}

      {/* The scanner's own liveness, stated separately from the signal count so
          "nothing found" can never be confused with "nothing looked". */}
      {data?.data_available && data.scanner.cycles > 0 && (
        <p className="mb-3 font-mono text-micro tabular-nums text-fg-faint">
          {data.scanner.cycles.toLocaleString()} scans ·{" "}
          {data.scanner.ticker_scans.toLocaleString()} ticker checks →{" "}
          {data.scanner.candidates.toLocaleString()} candidates →{" "}
          {data.scanner.signals_posted.toLocaleString()} posted
          {data.scanner.newest_scan_utc &&
            (() => {
              const { ageS, stale } = scanFreshness(data.scanner.newest_scan_utc);
              const age = fmtScanAge(ageS);
              return (
                <>
                  {" "}
                  · last scan {fmtEtFromUtc(data.scanner.newest_scan_utc)}
                  {age && (
                    <span
                      className={stale ? "text-accent-gold" : undefined}
                      title={
                        stale
                          ? "The scanner normally runs every few minutes. A gap this large is beyond anything the read-only replica's own delay can explain, so the scanner itself may have stopped."
                          : "How long ago the scanner last ran, counted from your device's clock so it keeps rising even if this page is showing a cached copy."
                      }
                    >
                      {" "}
                      ({age})
                    </span>
                  )}
                </>
              );
            })()}
        </p>
      )}

      {/* 🚨 THE HONESTY LINE. The count of signals the DB records no decision
          for, stated on the surface rather than quietly absorbed. Without it
          the card would imply it explains every signal it lists.

          🚨 B6-LEDGER (2026-08-09): THE DENOMINATOR IS PART OF THE HONESTY.
          These three counts PARTITION the window — they sum to `f.signals` and
          the rejected/unexplained sets are disjoint (proven against the WSL
          replica: 21 = 11 + 6 + 4, zero overlap). Printed without their total a
          reader assumes a universe about the size of the largest of them, which
          understates it by roughly half — and that hides the finding underneath
          the arithmetic, which is how large `unexplained` actually is.

          The total is INFORMATION, not a warning: it renders in the line's own
          muted colour. Gold stays reserved for the unexplained count and the
          divergence guard below (Hub aesthetic — amber/red mean a real problem). */}
      {f && f.signals > 0 && (
        <p className="mb-3 font-sans text-micro text-fg-muted">
          {f.signals} signals: {f.converted} converted · {f.rejected} rejected
          {f.unexplained > 0 && (
            <span className="text-accent-gold">
              {" "}
              · {f.unexplained} with no recorded reason
            </span>
          )}
          {data && data.reject_reasons.length > 0 && (
            <span className="text-fg-faint">
              {" — "}
              {data.reject_reasons
                .map((r) => fmtRejectReason(r.reason, r.n))
                .join(" · ")}
            </span>
          )}
        </p>
      )}

      {/* 🚨 B6-LEDGER: THE DIVERGENCE GUARD, AND IT IS SILENT WHEN THINGS AGREE.
          The three parts and the total are not one measurement: the counts come
          from a trade_insights/auto_trades/decision_log join, and they agreed by
          coincidence of that join with NOTHING watching for the day they stop.
          A signal that was ACCEPTed but never filled is already a state the three
          counts cannot express, so the partition is a live assumption, not a law.

          This does not FIX that — reconciling the two queries is a later roadmap
          — it makes the failure VISIBLE the moment it happens, on the surface
          rather than in a report nobody runs. Gold, because a display that
          disagrees with itself is a real problem. */}
      {f && f.signals > 0 && f.converted + f.rejected + f.unexplained !== f.signals && (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-2 font-sans text-micro text-accent-gold">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            These counts don&apos;t add up: {f.converted} + {f.rejected} +{" "}
            {f.unexplained} = {f.converted + f.rejected + f.unexplained}, but{" "}
            {f.signals} signals were posted. Some signals are in none of the three
            groups, or in more than one — read the breakdown as incomplete.
          </span>
        </p>
      )}

      {loading && <Skeleton className="h-24 w-full" />}

      {!loading && error != null && data?.signals.length ? (
        <p className="mb-3 flex items-center gap-1.5 font-sans text-micro text-accent-red">
          <AlertTriangle size={12} aria-hidden />
          Couldn&apos;t refresh — showing the last successful update.
        </p>
      ) : null}

      {!loading && data && data.signals.length === 0 && (
        <EmptyState
          title={emptyStateCopy(data).title}
          body={emptyStateCopy(data).body}
          className="min-h-[80px]"
        />
      )}

      {!loading && data && data.signals.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {data.signals.map((s) => (
            <li
              key={s.signal_id}
              className="flex items-start justify-between gap-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-body font-bold tabular-nums text-fg-primary">
                    {s.ticker}{" "}
                    <span
                      className={
                        s.direction === "LONG"
                          ? "text-accent-mint-strong"
                          : s.direction === "SHORT"
                            ? "text-accent-red"
                            : "text-fg-muted"
                      }
                    >
                      {s.direction ?? "—"}
                    </span>
                  </span>
                  {/* 🚨 The paper marker rides the SIGNAL's own trade row, so a
                      converted paper signal is labelled here too — the same
                      rule as the trade rows.

                      🚨 B6-LEDGER: branches on `is_paper` (the authority), not
                      on `trade_mode === "paper"`. Seven post-cutover paper rows
                      are stamped 'live' and rendered NO marker at all. */}
                  {s.is_paper && (
                    <Pill intent="warn" size="sm" className="shrink-0">
                      PAPER
                    </Pill>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-micro text-fg-muted tabular-nums">
                  <span className="shrink-0" title={`${s.created_at_utc} UTC`}>
                    {fmtEtFromUtc(s.created_at_utc)}
                  </span>
                  <span className="shrink-0 text-fg-faint">·</span>
                  <span className="shrink-0">
                    score {s.score != null ? s.score.toFixed(1) : "—"}
                  </span>
                  {s.quality_tier && (
                    <>
                      <span className="shrink-0 text-fg-faint">·</span>
                      <span className="shrink-0 text-fg-faint">
                        {s.quality_tier}
                      </span>
                    </>
                  )}
                  {s.regime && (
                    <>
                      <span className="shrink-0 text-fg-faint">·</span>
                      <span className="min-w-0 truncate text-fg-faint">
                        {s.regime}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Conversion column. Three renders, and the middle one is the
                  point: "not converted" with NO reason is a real, common state
                  (11 of 35 over 24h) and must look different from a rejection
                  the DB can actually explain. */}
              <div className="min-w-[7rem] shrink-0 text-right">
                {s.converted ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <Pill intent="live" size="sm" title={`Trade #${s.trade_id}`}>
                      TRADED
                    </Pill>
                    {/* B6-LEDGER: realised net = final leg + banked partials,
                        matching the REALIZED card. See `realisedNet`. */}
                    {realisedNet(s) != null && (
                      <MoneyText
                        value={realisedNet(s) as number}
                        unit="$"
                        size="sm"
                        showSign
                      />
                    )}
                  </div>
                ) : s.decision_reason ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                      not converted
                    </span>
                    {/* Verbatim bot reason. `entry_failed` names no gate and is
                        NOT prettified — inventing a friendlier label would
                        manufacture precision the DB does not have. */}
                    <span
                      className="max-w-[7rem] truncate font-mono text-micro text-accent-gold"
                      title={s.decision_reason}
                    >
                      {s.decision_reason}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-sans text-micro uppercase tracking-wider text-fg-muted">
                      not converted
                    </span>
                    {/* 🚨 NOT a guess. The DB records no entry decision for this
                        signal at all; saying why would be fabrication. */}
                    <span
                      className="font-mono text-micro text-fg-faint"
                      title="No entry decision was recorded for this signal. The reason is not in the database — Stage-A rejections are journal-only and the Hub cannot read journals."
                    >
                      no reason logged
                    </span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* The standing limit, on the surface. Prevents the card from reading as
          a complete funnel when it is the part of one the DB can support. */}
      <p className={cn("mt-3 font-sans text-micro text-fg-faint")}>
        Signals and entry decisions come from the database. Reasons a candidate
        died before becoming a signal are journal-only and cannot be shown here.
      </p>
    </Card>
  );
}
