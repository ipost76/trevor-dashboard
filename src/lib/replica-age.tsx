// ─────────────────────────────────────────────────────────────────────────────
// W4a (2026-07-30) — THE DATA'S AGE, MADE LEGIBLE.
// B2-RM-PROFIT (2026-08-14) — ...AND MADE CAPABLE OF SAYING "STALE".
//
// The Hub reads a READ-ONLY tailsync replica at
// /home/ghost/trevor-replica/trevor.db (WSL), republished on a timer and ~20 min
// behind the VM's live trevor.db by design. During a multi-week run Ghost will
// open this after an alert, and the failure mode is a stale view mistaken for a
// live one: an empty screen that means "the replica has not caught up" reads
// identically to one that means "nothing happened".
//
// 🚨 WHY THIS FILE WAS REWRITTEN. The previous version took a DURATION
// (`ageSeconds`) and rendered `as of ${now - ageSeconds}`. That is decoration,
// not an instrument, and it is decoration in the most dangerous possible
// direction: a duration cannot age. Whatever layer holds a payload — the
// route's stale-while-revalidate cache, a browser tab suspended overnight —
// keeps re-serving a lag that stopped being true, and the stamp derived from it
// SLIDES FORWARD WITH THE WALL CLOCK while the "N min behind" figure sits
// perfectly still. It is structurally incapable of ever reporting staleness,
// which is exactly why a nine-hour-old page looked ten minutes old.
//
// MEASURED ON THIS BOX (2026-08-14), the reproduction that motivated the fix:
// /api/auto/state returned a payload built 2026-08-13 09:04:45 at 08:12:30 the
// next day — 23h07m old — still carrying `replica_age_seconds: 933`. Every
// figure on the card was internally consistent, which is what made it
// believable. The stamp would have read "as of 07:57 · 16 min behind".
//
// 🚨 THE FIX IS THE INPUT, NOT THE FORMATTING. This component now takes an
// ABSOLUTE watermark — `replica_mtime_epoch_s`, the replica file's mtime as
// real UTC epoch seconds, emitted by query_auto_state / query_auto_trades /
// query_signals. That is a step function: it jumps when tailsync publishes and
// sits still between publishes, so `now - watermark` grows for exactly as long
// as the data is actually held, at whatever layer holds it. No amount of
// caching, tab-suspending or re-rendering can make it lie.
//
// 🚨 CLOCK NOTE (CLAUDE.md Law 7 / the two-clock rule). The watermark is an
// INTEGER EPOCH, deliberately not the `replica_mtime_utc` string beside it in
// the same payload: that string is real UTC but carries no offset, so
// `new Date("2026-08-14 12:06:42")` in a browser parses it as LOCAL time and
// silently invents a 4-hour error. An epoch has no timezone to get wrong. It is
// formatted for display in America/New_York at the very end, once.
// ─────────────────────────────────────────────────────────────────────────────
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Age past which the view is not shown as a reading at all.
 *
 * 30 minutes (B2-RM-PROFIT ruling, 2026-08-14). The tailsync publish cadence is
 * ~21 min, so 30 min sits just outside normal operation: a healthy replica
 * never trips it, and the 23h07m incident above would have tripped it by ~46×.
 * The old constant was 45 min AND it only changed the text COLOUR — the number
 * still rendered, and a number on screen gets read as a number.
 */
export const REPLICA_STALE_S = 30 * 60;

/**
 * A watermark more than this far in the FUTURE is not treated as "very fresh" —
 * it is treated as undecidable. Cross-box clock skew is the ordinary cause and
 * a small negative age is harmless, but a watermark genuinely ahead of us means
 * one of the two clocks is wrong and we cannot say how old the data is.
 */
const MAX_FUTURE_SKEW_S = 120;

/**
 * The three states this instrument can be in. A total union: `unknown` is a
 * first-class outcome carrying its own reason, never a silent fallthrough and
 * never collapsed into `fresh`.
 *
 * 🚨 There is deliberately no fourth state and no default branch. Absence is
 * `unknown`. On this project an absent value coerced into a healthy-looking
 * default has now been found six times across three subsystems; this file is
 * not going to be the seventh.
 */
export type ReplicaFreshness =
  | { kind: "fresh"; ageSeconds: number; asOfEpochS: number }
  | { kind: "stale"; ageSeconds: number; asOfEpochS: number }
  | { kind: "unknown"; reason: string };

/**
 * PURE state function — no React, no `Date.now()` of its own, no I/O. `nowMs` is
 * injected so every state can be DRIVEN in a harness rather than argued about.
 * The component below is a thin renderer over this.
 */
export function evaluateReplicaFreshness(
  asOfEpochS: number | null | undefined,
  nowMs: number,
): ReplicaFreshness {
  if (typeof asOfEpochS !== "number" || !Number.isFinite(asOfEpochS)) {
    // The payload carried no watermark: an old cached payload from before this
    // key existed, a failed read, a truncated response. We do not know how old
    // this is, so we say that.
    return { kind: "unknown", reason: "no timestamp in the data" };
  }
  if (asOfEpochS <= 0) {
    // Epoch 0 is 1970. Rendering it as "56 years behind" would be a measurement
    // nobody took; rendering it as fresh would be a lie. It is a null wearing a
    // number's clothes.
    return { kind: "unknown", reason: "timestamp not a real instant" };
  }
  const ageSeconds = Math.round(nowMs / 1000 - asOfEpochS);
  if (ageSeconds < -MAX_FUTURE_SKEW_S) {
    return { kind: "unknown", reason: "timestamp is in the future — clock skew" };
  }
  // Small negatives are ordinary skew between the file's clock and ours; floor
  // at 0 rather than rendering "-3 s behind".
  const age = Math.max(0, ageSeconds);
  return age > REPLICA_STALE_S
    ? { kind: "stale", ageSeconds: age, asOfEpochS }
    : { kind: "fresh", ageSeconds: age, asOfEpochS };
}

/** Eastern HH:MM for an absolute instant. Formatted once, at the very end. */
function etClock(epochS: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).format(new Date(epochS * 1000));
}

/** Compact lag for a FRESH reading — only ever used under the threshold. */
export function fmtBehind(ageSeconds: number): string {
  if (ageSeconds < 90) return "just now";
  return `${Math.round(ageSeconds / 60)} min behind`;
}

/**
 * Magnitude of a STALE gap, as a DURATION — "1h 12m", "23h 7m", "3d 4h".
 *
 * 🚨 A duration, never a clock time. The thing that fooled a reader was an
 * as-of instant that looked like a current reading; "23h 7m old" cannot be
 * misread that way, and withholding the magnitude entirely would leave Ghost
 * unable to tell 31 minutes from three days on a surface whose whole job is
 * telling him how much to trust what is underneath it.
 */
export function fmtStaleFor(ageSeconds: number): string {
  const m = Math.floor(ageSeconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * The freshness of the replica the surrounding numbers were read from.
 *
 *   fresh    → `as of 08:49 · 10 min behind`
 *   stale    → `STALE · no fresh reading — data 23h 7m old`   (NO clock time)
 *   unknown  → `AGE UNKNOWN · no timestamp in the data`
 *
 * 🚨 Above the threshold this renders NO reading. Not a number in a warning
 * colour — no number. The prior version's amber "as of HH:MM" was still an
 * as-of instant, and an as-of instant is precisely what gets read as current.
 *
 * 🚨 It NEVER renders nothing. The prior version returned `null` on an absent
 * age, on the reasoning that no line is more honest than a fabricated one. That
 * was half right: it is more honest, and it is also invisible — a card with no
 * freshness line looks exactly like a card whose freshness nobody thought to
 * question. Absence now says so out loud.
 */
export function ReplicaAge({
  asOfEpochS,
  className,
  nowMs,
}: {
  /** `replica_mtime_epoch_s` from the payload — real UTC epoch SECONDS. */
  asOfEpochS: number | null | undefined;
  className?: string;
  /** Test seam only. Production leaves this unset and reads the wall clock. */
  nowMs?: number;
}) {
  const f = evaluateReplicaFreshness(asOfEpochS, nowMs ?? Date.now());

  if (f.kind === "unknown") {
    return (
      <span
        className={cn(
          "font-mono text-micro tabular-nums text-accent-gold",
          className,
        )}
        title={
          "The Hub cannot tell how old these numbers are, so it is not claiming " +
          "they are current. Treat everything on this card as unverified until " +
          "this line reports an age."
        }
      >
        AGE UNKNOWN · {f.reason}
      </span>
    );
  }

  if (f.kind === "stale") {
    return (
      <span
        className={cn(
          "font-mono text-micro font-bold tabular-nums text-accent-red",
          className,
        )}
        title={
          `These numbers were read from a replica published ${fmtStaleFor(f.ageSeconds)} ago, ` +
          `past the ${Math.round(REPLICA_STALE_S / 60)}-minute threshold. No reading is shown ` +
          "because a number on screen gets read as a number. The replica publishes on a " +
          "timer (~21 min); a gap this large means the sync has stalled, or this page is " +
          "being served from a cache."
        }
      >
        STALE · no fresh reading — data {fmtStaleFor(f.ageSeconds)} old
      </span>
    );
  }

  return (
    <span
      className={cn("font-mono text-micro tabular-nums text-fg-faint", className)}
      title="Age of the read-only replica these numbers came from, measured from the replica's own publish timestamp. The Hub never reads the live VM database."
    >
      as of {etClock(f.asOfEpochS)} · {fmtBehind(f.ageSeconds)}
    </span>
  );
}
