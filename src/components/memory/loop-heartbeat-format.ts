// Shared plain-English formatting for the background-loop heartbeat surface ([B6]).
// Mirrors watcher-format.ts: the state -> screen mapping lives in PURE FUNCTIONS so each
// state can be rendered and checked directly rather than inferred from a live store.
//
// 🚨 SIX STATES, SIX RENDERINGS, AND EXACTLY ONE OF THEM IS GREEN. `[B1]` built a
// three-state contract in the database (a reason / NULL / unknown) and a surface that
// collapsed it back to two would throw that fix away. The states are BRANCHED, never
// ternaried — a ternary is how a third state silently becomes one of the other two.

export type LoopState =
  | "ok"
  | "degraded"
  | "stale"
  | "unpopulated"
  | "unknown"
  | "dormant";

export interface LoopRow {
  loop_name: string;
  cadence_seconds: number;
  stale_threshold_sec: number;
  age_sec: number | null;
  iteration_count: number | null;
  error_count: number | null;
  last_error: string | null;
  last_error_at: string | null;
  last_iteration_at: string | null;
  degraded_reason: string | null;
  detail: string;
  state: LoopState;
}

export interface LoopsResponse {
  status: "ok" | "unknown";
  source: string;
  degraded_column: boolean | null;
  loops: LoopRow[];
  rollup: {
    worst: LoopState;
    counts: Partial<Record<LoopState, number>>;
    active: number;
    total: number;
  };
  error: string | null;
  /**
   * 🚨 [B2] (2026-08-17) — THE WATERMARK. Epoch-ms at which this payload was BUILT, stamped
   * by the route from the SWR cache's own `ts`. An ABSOLUTE instant, never a duration:
   * that distinction is the entire fix, and it is `replica-age.tsx`'s `asOfEpochS` law
   * applied one layer down. A duration cannot age — `age_sec` below was measured when the
   * payload was built and stays frozen at that number no matter how long the payload is
   * afterwards held and re-served, which is how this surface reported `age_sec: 2107` on a
   * 3h14m-old payload whose true age was 2968s.
   *
   * `null` means the payload carries no build stamp (a failed read, or a pre-[B2] server) —
   * the consumer must then say so, never silently fall back to the frozen figure.
   * OPTIONAL so the two locally-constructed UNKNOWN shapes in loop-heartbeat-card.tsx and
   * any older cached payload still type-check; absent is handled identically to null.
   */
  built_at_epoch_ms?: number | null;
  /** Epoch-ms this response left the route. Diagnostic only — nothing branches on it. */
  served_at_epoch_ms?: number | null;
}

export interface StatePresentation {
  /** Short label on the row's pill. */
  label: string;
  /** One sentence a non-engineer can act on. */
  blurb: string;
  /** Tailwind classes for the pill — the four non-OK states are visually distinct. */
  tone: string;
  /** Dot colour for the compact line. */
  dot: string;
}

// 🚨 A TOTAL FUNCTION OVER THE UNION. Every state has its own entry; there is no default
// branch that could quietly absorb a state added later. If a seventh state appears, the
// compiler fails here rather than the screen falling back to something reassuring.
const PRESENTATION: Record<LoopState, StatePresentation> = {
  ok: {
    label: "Running",
    blurb: "Updating on schedule and reporting nothing wrong.",
    tone: "border-accent-mint/40 bg-accent-mint/10 text-accent-mint",
    dot: "bg-accent-mint",
  },
  degraded: {
    label: "Impaired",
    blurb: "Still running, but it is telling us something is wrong.",
    tone: "border-accent-gold/50 bg-accent-gold/10 text-accent-gold",
    dot: "bg-accent-gold",
  },
  stale: {
    label: "Stopped",
    blurb: "It has not updated for longer than its own limit allows.",
    tone: "border-accent-red/50 bg-accent-red/10 text-accent-red",
    dot: "bg-accent-red",
  },
  unpopulated: {
    // 🚨 The state that exists because [B1]'s restart is still pending. It is NOT green and
    // it is NOT "fine" — it means the health field is blank because nothing is filling it in.
    label: "Not reporting",
    blurb:
      "Its health field is blank because nothing is writing it — so we cannot tell " +
      "whether it is fine. Treat this as unknown, not as healthy.",
    tone: "border-accent-violet/50 bg-accent-violet/10 text-accent-violet",
    dot: "bg-accent-violet",
  },
  unknown: {
    label: "Unknown",
    blurb: "We could not read its state at all.",
    tone: "border-border-strong bg-bg-elevated text-fg-muted",
    dot: "bg-fg-faint",
  },
  dormant: {
    label: "Parked",
    blurb: "Switched off deliberately. Not running, and not a fault.",
    tone: "border-border-subtle bg-bg-primary text-fg-faint",
    dot: "bg-fg-faint",
  },
};

/** The state -> screen mapping. Total over LoopState; never falls back to a nicer state. */
export function loopStatePresentation(state: LoopState): StatePresentation {
  return PRESENTATION[state] ?? PRESENTATION.unknown;
}

/** Every state, in worst-first order — the order the card sorts rows into. */
export const LOOP_STATES: LoopState[] = [
  "stale",
  "degraded",
  "unpopulated",
  "unknown",
  "ok",
  "dormant",
];

/** A short relative age from a seconds count. Mirrors watcher-format.fmtSeconds. */
export function fmtLoopAge(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || !Number.isFinite(secs)) return "—";
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * 🚨 [B2] A payload the consumer has been HOLDING for this long or more gets its hold time
 * said out loud. Below it the clause is omitted, so a payload served inside its own TTL
 * renders BYTE-IDENTICALLY to the pre-[B2] string — the honesty is additive, and the normal
 * case is not made noisier to pay for the abnormal one.
 */
export const HELD_MATERIALITY_S = 60;

/** Mirrors replica-age.tsx's MAX_FUTURE_SKEW_S — a build stamp slightly ahead of the
 *  reader's clock is ordinary skew, not a finding; well ahead of it is unusable. */
export const MAX_FUTURE_SKEW_S = 90;

/**
 * 🚨 [B2] THE RE-DERIVED AGE. A TOTAL UNION WITH NO DEFAULT BRANCH — the
 * `resolveWedgeBadge` / `evaluateReplicaFreshness` / `loopStatePresentation` shape, so a
 * fourth outcome fails the compiler rather than falling through to something reassuring.
 *
 * `derived` — age re-computed at READ time: the VM-measured age at build PLUS how long the
 *   payload has been held since. Splitting it that way is deliberate: the base was computed
 *   inside the VM's own SQLite clock and is free of cross-box skew, so only the hold term
 *   crosses clocks, and that term is zero on a fresh payload.
 * `at_build` — there is no usable watermark, so the frozen build-time figure is ALL that
 *   exists. It is still shown, but explicitly labelled as a past measurement with a reason.
 *   Never silently rendered as if it were current.
 * `unknown` — the row has no age at all.
 */
export type LoopAge =
  | { kind: "derived"; ageSeconds: number; heldSeconds: number }
  | { kind: "at_build"; ageSeconds: number; reason: string }
  | { kind: "unknown"; reason: string };

export function resolveLoopAge(
  row: LoopRow,
  data: LoopsResponse | null,
  nowMs: number,
): LoopAge {
  const base = row.age_sec;
  if (base === null || base === undefined || !Number.isFinite(base)) {
    return { kind: "unknown", reason: "no last-run time was recorded" };
  }
  const atBuild = Math.max(0, Math.round(base));

  const built = data?.built_at_epoch_ms;
  if (typeof built !== "number" || !Number.isFinite(built) || built <= 0) {
    return {
      kind: "at_build",
      ageSeconds: atBuild,
      reason: "this payload carries no build stamp, so its age cannot be re-derived",
    };
  }

  const heldSeconds = (nowMs - built) / 1000;
  if (heldSeconds < -MAX_FUTURE_SKEW_S) {
    return {
      kind: "at_build",
      ageSeconds: atBuild,
      reason: "the build stamp is in the future — clock skew",
    };
  }
  const held = Math.max(0, heldSeconds);
  return {
    kind: "derived",
    ageSeconds: Math.max(0, Math.round(base + held)),
    heldSeconds: Math.round(held),
  };
}

/**
 * The freshness phrase for one loop.
 *
 * 🚨 A NUMBER WITH NO FRESHNESS INDICATOR IS THE FAILURE `[B1]` FIXED ONE LAYER DOWN — a
 * frozen `iteration_count` read as a live one for a full day. Every count on this surface
 * is therefore rendered WITH its age, never alone.
 *
 * 🚨 [B2] AND THE AGE ITSELF IS NOW RE-DERIVED AT READ TIME. `row.age_sec` was measured when
 * the payload was built and froze there — a staleness meter that could not detect its own
 * staleness. It is now the BASE of a live computation, never the answer.
 */
export function fmtLoopFreshness(
  row: LoopRow,
  data: LoopsResponse | null = null,
  nowMs: number = Date.now(),
): string {
  const resolved = resolveLoopAge(row, data, nowMs);
  if (resolved.kind === "unknown") return "last run unknown";

  const limit = fmtLoopAge(row.stale_threshold_sec);
  const age = fmtLoopAge(resolved.ageSeconds);

  if (resolved.kind === "at_build") {
    // Mirrors replica-age.tsx: an absent watermark renders AGE UNKNOWN with its reason —
    // never nothing, and never a fresh-looking stamp.
    return `AGE UNKNOWN · last ran ${age} ago when this was read — ${resolved.reason}`;
  }

  const held =
    resolved.heldSeconds >= HELD_MATERIALITY_S
      ? ` · this reading is ${fmtLoopAge(resolved.heldSeconds)} old`
      : "";
  if (row.state === "stale") return `last ran ${age} ago — past its ${limit} limit${held}`;
  return `last ran ${age} ago (limit ${limit})${held}`;
}

/**
 * The roll-up headline.
 *
 * 🚨 `unknown` OUTRANKS `ok` — a partial read must never be summarised as a clean bill of
 * health. That is the same rule `external_liveness_check._worst` applies, kept identical
 * on purpose so the alert and the display cannot disagree in public.
 */
export function loopsHeadline(data: LoopsResponse | null): {
  label: string;
  body: string;
  tone: string;
} {
  if (data === null) {
    return {
      label: "Reading…",
      body: "Asking the live database how the background loops are doing.",
      tone: "border-border-subtle bg-bg-elevated/40",
    };
  }
  if (data.status !== "ok") {
    return {
      label: "Can't tell",
      body:
        `The live database could not be read, so nothing below is a current reading. ` +
        `${data.error ?? "No reason was given."}`,
      tone: "border-accent-gold/40 bg-accent-gold/5",
    };
  }
  const c = data.rollup.counts;
  // 🚨 CAUGHT BY THE B6 RENDER HARNESS, NOT BY REASONING. With every loop parked, `bad`
  // is 0 and the branch below rendered a GREEN "All 0 running normally" — a clean bill of
  // health for a system where nothing is running. Zero things running is not zero things
  // wrong. `active` excludes dormant rows, so this is the guard that has to come first.
  if (data.rollup.active === 0) {
    return {
      label: "Nothing running",
      body:
        `No background loop is currently active — all ${data.rollup.total} are parked. ` +
        `That is a state to check, not a clean bill of health.`,
      tone: "border-accent-gold/40 bg-accent-gold/5",
    };
  }
  const bad =
    (c.stale ?? 0) + (c.degraded ?? 0) + (c.unpopulated ?? 0) + (c.unknown ?? 0);
  if (bad === 0) {
    return {
      label: `All ${data.rollup.active} running normally`,
      body: "Every background loop that should be running is updating on schedule.",
      tone: "border-accent-mint/40 bg-accent-mint/5",
    };
  }
  const parts: string[] = [];
  if (c.stale) parts.push(`${c.stale} stopped`);
  if (c.degraded) parts.push(`${c.degraded} impaired`);
  if (c.unpopulated) parts.push(`${c.unpopulated} not reporting`);
  if (c.unknown) parts.push(`${c.unknown} unreadable`);
  return {
    label: `${bad} of ${data.rollup.active} need a look`,
    body: `${parts.join(" · ")}. The rest are updating on schedule.`,
    tone:
      (c.stale ?? 0) > 0
        ? "border-accent-red/40 bg-accent-red/5"
        : "border-accent-gold/40 bg-accent-gold/5",
  };
}
