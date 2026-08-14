"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, Pill, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Snowflake } from "lucide-react";

// Wedge-Rate tile [B2] — READ-ONLY at-a-glance loop-freeze regression signal.
//
// The tile Ghost watches each gated FREEZE fix against: today's loop-freeze
// count (big number), the 7-day trend (mini bars), the worst stall today, the
// last boot, plus a green/amber/red state. Reads /api/hub/wedge-metrics (60s
// poll) which serves the VM's logs/wedge_metrics.json ([B1] contract) via the
// read-only `ssh vm` pipe. Consumes the [B1] shape EXACTLY — no log parsing here.
//
// Resilient by construction: never crashes, never blanks. States —
//   status "ok"       → render metrics; border color = alert_state (green/amber/red)
//   status "no_data"  → clean "No data yet" (B1 not deployed / file absent)
//   status "error"    → clean "Metrics unavailable" (VM unreachable / mid-write)
//   stale_minutes > N → "updated Xm ago" flagged stale (numbers may be old)

const ENDPOINT = "/api/hub/wedge-metrics";
const POLL_MS = 60_000;
// Conservative freshness bound: the [B1] job regenerates on a minutes cadence, so
// data older than this means the generator hasn't refreshed in a while — flag it.
const STALE_MINUTES = 30;

interface WedgeDay {
  date?: string;
  wedge_count?: number;
  max_age_s?: number;
  sigabrt_count?: number;
}
interface WedgeBoot {
  at?: string;
  duration_s?: number;
}
interface WedgeThresholds {
  daily_count?: number;
  age_s?: number;
  boot_s?: number;
}
interface WedgeMetrics {
  status?: string; // "ok" | "no_data" | "error"
  generated_at?: string;
  today?: WedgeDay;
  series_7d?: WedgeDay[];
  last_boot?: WedgeBoot;
  alert_state?: string; // "green" | "amber" | "red"
  thresholds?: WedgeThresholds;
  stale_minutes?: number | null;
  error?: string;
}

// SVG token colors (CSS vars resolve inside `fill`).
const C_MINT = "var(--color-accent-mint)";
const C_RED = "var(--color-accent-red)";
const C_MUTED = "var(--color-fg-muted)";

const ALERT_META: Record<
  string,
  { border: string; pill: React.ReactNode }
> = {
  green: {
    border: "border-l-accent-mint",
    pill: (
      <Pill intent="live" size="sm">
        STABLE
      </Pill>
    ),
  },
  amber: {
    border: "border-l-accent-gold",
    pill: (
      <Pill intent="warn" size="sm">
        ELEVATED
      </Pill>
    ),
  },
  red: {
    border: "border-l-accent-red",
    pill: (
      <Pill intent="error" size="sm">
        REGRESSED
      </Pill>
    ),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// B3-RM-PROFIT (2026-08-14) — THE BADGE STOPS DEFAULTING ABSENCE TO HEALTH.
//
// 🚨 WHAT WAS WRONG. Two defaults on consecutive lines, each resolving a thing
// we do not know into the one thing that means "fine":
//     const alert = (data.alert_state ?? "green").toLowerCase();
//     const meta  = ALERT_META[alert] ?? ALERT_META.green;
// The first turned an ABSENT state into STABLE. The second turned an
// UNRECOGNISED state — a producer typo, a rename, a state the generator learns
// to emit tomorrow — into STABLE as well. And `stale` was read ONLY by the
// footer, so the badge could not go non-green for an old reading either. That
// is how a green STABLE badge came to sit on a nine-hour-old measurement.
//
// 🚨 THE DEFAULTS MATTERED MORE THAN THE STALENESS. Staleness is one failure
// mode; a default that resolves absence to health is a permanent blindfold.
//
// ⚠️ THE PROBE ITSELF IS HEALTHY AND IS NOT TOUCHED. Measured on the VM at build
// time: logs/wedge_metrics.json generated_at 2026-08-14T09:45:01-04:00,
// alert_state "green", on its 10-minute cadence. "0 wedges / 0 s worst stall" is
// a real healthy reading, not a dead probe. Only the badge changed.
//
// 🚨 NO STATE WORD WAS RENAMED. wedge_monitor._alert_state (VM) emits exactly
// "green" | "amber" | "red"; ALERT_META's keys and its rendered words STABLE /
// ELEVATED / REGRESSED are byte-identical to what they were. The three refusal
// words below are NEW outcomes that previously had no rendering at all.
//
// The corroborating precedent sat one box away the whole time: the VM's own
// consumer, monitor_center/monitors/28_wedge_rate.py, does
// `_STATE_TO_STATUS.get(state, "ERROR")` — an unrecognised state is an ERROR
// there, never an OK. The Hub was the only reader defaulting it to green.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the badge should say. A TOTAL union: every outcome is named, there is no
 * default branch, and none of the four resolves to a healthy value it was not
 * told. Absence is `absent`; an unknown word is `unrecognised`; an old reading
 * is `stale`. Mirrors `replica-age.tsx`'s `ReplicaFreshness` and
 * `loop-heartbeat-format.ts`'s state map — the same discipline, third surface.
 */
export type WedgeBadge =
  | { kind: "state"; state: string }
  | { kind: "stale" }
  | { kind: "age_unknown" }
  | { kind: "absent" }
  | { kind: "unrecognised"; raw: string };

/**
 * PURE — no React, no clock, no I/O, so every outcome can be DRIVEN in a
 * harness rather than argued about.
 *
 * Precedence is deliberate: a payload we cannot read a state out of outranks a
 * state we can read but should not trust, because `absent` and `unrecognised`
 * are statements about the payload's INTEGRITY while `stale` is a statement
 * about its AGE. That ordering never hides staleness — the footnote carries its
 * own `⚠ stale` disclosure in every branch, which is why it was kept.
 */
export function resolveWedgeBadge(
  alertState: unknown,
  staleMinutes: number | null | undefined,
  staleAfterMinutes: number = STALE_MINUTES,
): WedgeBadge {
  if (typeof alertState !== "string" || alertState.trim() === "") {
    return { kind: "absent" };
  }
  const key = alertState.trim().toLowerCase();
  // Own-property lookup. A bare `ALERT_META[k]` returns Object.prototype for
  // "__proto__" and the Object function for "constructor" — neither is
  // undefined, so a `?? fallback` would never fire and a non-string could reach
  // React. Same rule as plain-labels.ts's ownLabel().
  if (!Object.prototype.hasOwnProperty.call(ALERT_META, key)) {
    return { kind: "unrecognised", raw: alertState };
  }
  // 🚨 FOUND BY EXECUTION, NOT BY READING — the render proof's case K. The route's
  // staleMinutes() returns null when `generated_at` is absent or unparseable, so
  // the age is UNDECIDABLE. The first draft of this resolver let that fall
  // through to the recognised state and printed a green STABLE, which is the
  // same defect this file exists to remove, one branch further in. An age we
  // cannot compute is not an age inside the bound. The tile's own formatter
  // already renders it ("updated —"); only the badge was ignoring it.
  if (typeof staleMinutes !== "number" || !Number.isFinite(staleMinutes)) {
    return { kind: "age_unknown" };
  }
  if (staleMinutes > staleAfterMinutes) {
    return { kind: "stale" };
  }
  return { kind: "state", state: key };
}

/**
 * The three refusals. Each is visually distinct from the others and NONE is
 * mint. `border-l-accent-gold` is this file's own existing "cannot confirm"
 * idiom (the `status !== "ok"` UNAVAILABLE branch uses it) and a neutral pill is
 * how the tile already declines to assert (NO DATA).
 *
 * 🚨 The words name WHAT IS MISSING and never guess a severity. Calling an old
 * reading ELEVATED would claim the PROBE is elevated when it is the READING
 * that is old — a different, and wrong, finding.
 */
const REFUSAL_META: Record<
  "stale" | "age_unknown" | "absent" | "unrecognised",
  { border: string; word: string; title: string }
> = {
  age_unknown: {
    border: "border-l-accent-gold",
    // Deliberately the SAME words replica-age.tsx uses for the same condition.
    // One phrase for "we cannot tell how old this is", across both surfaces.
    word: "AGE UNKNOWN",
    title:
      "The payload carried no usable timestamp, so the Hub cannot tell how old " +
      "these figures are and is not claiming a state for them. Treat the numbers " +
      "below as unverified until this line reports an age.",
  },
  stale: {
    border: "border-l-accent-gold",
    word: "NO READING",
    title:
      "The last freeze figures are older than the freshness bound, so no state " +
      "is claimed for them. The numbers below are the last ones measured, not a " +
      "current reading — see the age on the bottom line.",
  },
  absent: {
    border: "border-l-accent-gold",
    word: "NO STATE",
    title:
      "The payload carried no alert state at all. That is not the same as a " +
      "healthy one, so nothing is claimed. The figures below may still be real; " +
      "the verdict on them is missing.",
  },
  unrecognised: {
    border: "border-l-accent-gold",
    word: "UNKNOWN STATE",
    title:
      "The generator reported a state this page has no meaning for. It is shown " +
      "verbatim on the bottom line so it can be searched for. It is not treated " +
      "as healthy — the VM's own reader treats an unknown state as an error.",
  },
};

function fmtSecs(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return "—";
  if (s < 90) return `${Math.round(s)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function fmtStale(m: number | null | undefined): string {
  if (m == null) return "updated —";
  if (m < 1) return "updated just now";
  if (m < 90) return `updated ${m}m ago`;
  return `updated ${Math.round(m / 60)}h ago`;
}

// Mini 7-day trend: one bar per series point, height ∝ wedge_count. A day at/over
// the daily_count threshold is a freeze day → red; under → mint. Empty → nothing.
function TrendBars({ series, threshold }: { series: WedgeDay[]; threshold: number | undefined }) {
  if (!series.length) {
    return <p className="text-micro text-fg-faint">no 7-day history yet</p>;
  }
  const counts = series.map((d) => Math.max(0, d.wedge_count ?? 0));
  const max = Math.max(...counts, 1);
  const W = 140;
  const H = 34;
  const gap = 3;
  const n = series.length;
  const bw = Math.max(2, (W - gap * (n - 1)) / n);
  const over = (c: number) => threshold != null && c >= threshold && c > 0;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-9 w-full"
      role="img"
      aria-label="Loop-freeze count, last 7 days"
    >
      {series.map((d, i) => {
        const c = counts[i];
        const bh = c === 0 ? 1.5 : Math.max(2, (c / max) * (H - 2));
        const x = i * (bw + gap);
        return (
          <rect
            key={d.date ?? i}
            x={x}
            y={H - bh}
            width={bw}
            height={bh}
            fill={c === 0 ? C_MUTED : over(c) ? C_RED : C_MINT}
            opacity={c === 0 ? 0.4 : 0.8}
          >
            <title>{`${d.date ?? "?"}: ${c} freeze${c === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function WedgeRateTile() {
  const [data, setData] = React.useState<WedgeMetrics | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) setData((await res.json()) as WedgeMetrics);
      } catch {
        /* keep prior data on a transient error — never blank */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const Header = ({ right }: { right?: React.ReactNode }) => (
    <CardHeader>
      <CardTitle>
        <span className="flex items-center gap-2 uppercase tracking-wider">
          <Snowflake size={14} aria-hidden />
          Loop freezes
        </span>
      </CardTitle>
      {right}
    </CardHeader>
  );

  // Loading (first paint, no data yet).
  if (loading && !data) {
    return (
      <Card padding="md" className="border-l-4 border-l-border-subtle">
        <Header />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  const status = data?.status;

  // No data yet — B1 not deployed / file absent. Clean, honest, inviting.
  if (status === "no_data" || !data) {
    return (
      <Card padding="md" className="border-l-4 border-l-border-subtle">
        <Header
          right={
            <Pill tone="neutral" size="sm">
              NO DATA
            </Pill>
          }
        />
        <p className="text-caption leading-relaxed text-fg-muted">
          No freeze data yet. This fills in once the bot starts reporting it.
        </p>
      </Card>
    );
  }

  // Error — VM unreachable / mid-write malformed. Never blank; surface honestly.
  if (status !== "ok") {
    return (
      <Card padding="md" className="border-l-4 border-l-accent-gold">
        <Header
          right={
            <Pill tone="neutral" size="sm">
              UNAVAILABLE
            </Pill>
          }
        />
        <p className="text-caption leading-relaxed text-fg-muted">
          Couldn&apos;t read the loop-freeze figures right now. Showing nothing
          rather than a stale number; retries automatically.
        </p>
      </Card>
    );
  }

  // OK — render the metrics.
  const today = data.today ?? {};
  const series = data.series_7d ?? [];
  const boot = data.last_boot ?? {};
  const thresholds = data.thresholds ?? {};
  // 🚨 No default anywhere on this path. Every outcome is named by the resolver
  // above, and the three that are not a recognised state render distinctly.
  const badge = resolveWedgeBadge(data.alert_state, data.stale_minutes);
  const shown =
    badge.kind === "state"
      ? ALERT_META[badge.state]
      : {
          border: REFUSAL_META[badge.kind].border,
          pill: (
            <Pill tone="neutral" size="sm" title={REFUSAL_META[badge.kind].title}>
              {REFUSAL_META[badge.kind].word}
            </Pill>
          ),
        };
  const stale = data.stale_minutes != null && data.stale_minutes > STALE_MINUTES;
  const wedgeCount = today.wedge_count ?? 0;

  return (
    <Card padding="md" className={cn("border-l-4", shown.border)}>
      <Header right={shown.pill} />

      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="WEDGES TODAY"
          value={wedgeCount}
          sub={
            thresholds.daily_count != null
              ? `threshold ${thresholds.daily_count}`
              : "loop freezes"
          }
        />
        <div className="flex flex-col justify-center">
          <span className="mb-1 text-micro uppercase tracking-wider text-fg-muted">
            7-day trend
          </span>
          <TrendBars series={series} threshold={thresholds.daily_count} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <MetricTile label="WORST STALL" value={fmtSecs(today.max_age_s)} sub="today" size="sm" />
        <MetricTile label="LAST BOOT" value={fmtSecs(boot.duration_s)} sub="startup" size="sm" />
        <MetricTile
          label="SIGABRT"
          value={today.sigabrt_count ?? 0}
          sub="today"
          size="sm"
        />
      </div>

      <p
        className={cn(
          "mt-3 text-micro",
          stale ? "text-accent-gold" : "text-fg-faint",
        )}
      >
        {stale ? "⚠ stale · " : ""}
        {fmtStale(data.stale_minutes)}
        {/* The unrecognised word, verbatim and greppable. It is the one piece of
            diagnostic nobody can look up, so it is named rather than glossed. */}
        {badge.kind === "unrecognised"
          ? ` · reported state "${badge.raw}" is not recognised here`
          : ""}
      </p>
    </Card>
  );
}
