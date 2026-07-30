// ─────────────────────────────────────────────────────────────────────────────
// W4a (2026-07-30) — THE DATA'S AGE, MADE LEGIBLE.
//
// The Hub reads a READ-ONLY litestream/tailsync replica at
// /home/ghost/trevor-replica/trevor.db (WSL), published on a timer and ~20 min
// behind the VM's live trevor.db by design. During a multi-week run Ghost will
// open this after an alert, and the failure mode is a stale view mistaken for a
// live one: an empty screen that means "the replica has not caught up" reads
// identically to one that means "nothing happened".
//
// A static REPLICA badge does not close that — it says the source is a replica,
// never how old it is. This renders the AGE: "as of 17:33 · 19 min behind".
//
// 🚨 CLOCK NOTE (CLAUDE.md Law 7 / the two-clock rule). The "as of" instant is
// derived from `ageSeconds` and the browser's own now(), then formatted in
// America/New_York. It deliberately does NOT parse the payload's
// `replica_mtime_utc` string: that value is real UTC while auto_trades
// opened_at/closed_at are naive EASTERN, and mixing the two clocks is the
// recurring 4-hour bug in this codebase. Deriving from a duration touches
// neither clock and is DST-correct for free.
// ─────────────────────────────────────────────────────────────────────────────
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Replica age past which the view is called out as materially behind. The
 * publish cadence is ~15 min with a restore that can take ~8-14 min, so real
 * freshness is ~20-30 min; 45 min is comfortably outside normal operation and
 * matches the LIVE_ACCOUNT_VALUE_STALE_S threshold already used server-side.
 */
const STALE_S = 45 * 60;

/** Eastern HH:MM for an instant `ageSeconds` in the past. */
function etClockAgo(ageSeconds: number): string {
  const at = new Date(Date.now() - ageSeconds * 1000);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).format(at);
}

function fmtBehind(ageSeconds: number): string {
  if (ageSeconds < 90) return "just now";
  const mins = Math.round(ageSeconds / 60);
  if (mins < 90) return `${mins} min behind`;
  const hrs = Math.round(ageSeconds / 3600);
  return `${hrs}h behind`;
}

/**
 * `as of HH:MM · N min behind` — the age of the replica the surrounding numbers
 * were read from.
 *
 * 🚨 A null/undefined/negative age renders NOTHING. The Hub must never invent a
 * freshness claim it cannot support: no line at all is honest, a fabricated
 * "as of now" is not.
 */
export function ReplicaAge({
  ageSeconds,
  className,
}: {
  ageSeconds: number | null | undefined;
  className?: string;
}) {
  if (typeof ageSeconds !== "number" || !Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return null;
  }
  const stale = ageSeconds > STALE_S;
  return (
    <span
      className={cn(
        "font-mono text-micro tabular-nums",
        stale ? "text-accent-gold" : "text-fg-faint",
        className,
      )}
      title={
        stale
          ? "This view is materially behind the bot. The replica publishes on a timer (~20 min); a gap this large may mean the sync itself has stalled."
          : "Age of the read-only replica these numbers came from. The Hub never reads the live VM database."
      }
    >
      as of {etClockAgo(ageSeconds)} · {fmtBehind(ageSeconds)}
    </span>
  );
}
