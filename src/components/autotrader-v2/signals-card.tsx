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
import { fmtEtFromUtc } from "@/lib/et-clock";
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
  pnl_usd: number | null;
  decision_action: string | null;
  decision_reason: string | null;
}

interface SignalsResponse {
  window_hours: number;
  replica_age_seconds: number | null;
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

export function SignalsCard() {
  const [data, setData] = React.useState<SignalsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const fetchSignals = async () => {
      try {
        const res = await fetch(`/api/auto/signals?hours=${WINDOW_HOURS}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const j = (await res.json()) as SignalsResponse;
        if (cancelled) return;
        setData(j);
        setError(j.error ?? null);
      } catch (e) {
        if (!cancelled) setError(String(e));
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
      <ReplicaAge ageSeconds={data?.replica_age_seconds} className="mb-2 block" />

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
          {data.scanner.newest_scan_utc && (
            <> · last scan {fmtEtFromUtc(data.scanner.newest_scan_utc)}</>
          )}
        </p>
      )}

      {/* 🚨 THE HONESTY LINE. The count of signals the DB records no decision
          for, stated on the surface rather than quietly absorbed. Without it
          the card would imply it explains every signal it lists. */}
      {f && f.signals > 0 && (
        <p className="mb-3 font-sans text-micro text-fg-muted">
          {f.converted} converted · {f.rejected} rejected
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
                .map((r) => `${r.reason ?? "unspecified"} ${r.n}`)
                .join(" · ")}
            </span>
          )}
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
                      rule as the trade rows. Only a real 'live' value renders
                      no marker; anything else is not asserted as live. */}
                  {s.converted && s.trade_mode === "paper" && (
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
                    {s.pnl_usd != null && (
                      <MoneyText value={s.pnl_usd} unit="$" size="sm" showSign />
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
