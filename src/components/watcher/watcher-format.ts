// Shared plain-English formatting for the WATCHER page (R12-B2).
// Extends the proven Hub grammar — relative "updated Xs ago" ages (these stores
// are WSL-LOCAL, so the age is real, never a replica proxy).

/** A short relative age from a timestamp string (accepts a trailing Z). */
export function fmtAge(ts: string | null | undefined): string {
  if (!ts) return "—";
  const t = Date.parse(ts.replace(" ", "T"));
  if (Number.isNaN(t)) return "—";
  return fmtSeconds(Math.max(0, Math.round((Date.now() - t) / 1000)));
}

/** A short relative age from a seconds count (e.g. the reader's updated_seconds). */
export function fmtSeconds(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || !Number.isFinite(secs)) return "—";
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** "updated Xs ago" freshness line (WSL-local — never "replica"). */
export function fmtUpdated(updatedSeconds: number | null | undefined): string {
  const age = fmtSeconds(updatedSeconds);
  return age === "—" ? "no updates yet" : `updated ${age} ago`;
}

/** The calendar date a timestamp records, in UTC — "22 Jul 2026". */
export function fmtWatcherDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  const t = Date.parse(ts.replace(" ", "T"));
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A panel's OWN freshness, recomputed client-side from its absolute timestamp
 * (the RD-B7 idiom) so a cached body yields a GROWING age, never a frozen one.
 *
 * 🚨 A null timestamp means that pool has NEVER been written. It says so, and it
 * must never fall back to another pool's age — one pool re-badging another's
 * freshness is the original defect this surface exists to stop.
 */
export function fmtPanelUpdated(updatedAt: string | null | undefined): string {
  const age = fmtAge(updatedAt);
  return age === "—" ? "never updated" : `updated ${age} ago`;
}

export interface ArmingLine {
  label: string;
  body: string;
  tone: string;
}

/**
 * Turns the watcher's arming state into the line a reader sees, so the panels
 * below are understood as a live reading or a snapshot.
 *
 * 🚨 `everRan` is TRI-state and is BRANCHED, never ternaried: true = a cycle ran,
 * false = none ever has, null = the store could not be read (or the endpoint
 * returned nothing). A ternary would silently fold null into one of the other
 * two and report a state nobody measured — the exact defect this surface exists
 * to stop. All three renders must stay textually and visually distinct.
 *
 * 🚨 Every sentence traces to a field the API returned. It does NOT say the
 * watcher is unscheduled, and it does NOT suggest starting it: the daemon's
 * state is a systemd fact this endpoint never reports, and the dormancy is
 * deliberate. "Nothing has run it since" is derived from the returned timestamp
 * being the newest one there is — not from any claim about a scheduler.
 */
export function armingLine(
  everRan: boolean | null,
  lastAt: string | null,
): ArmingLine {
  if (everRan === true && lastAt) {
    return {
      label: "Last run",
      body:
        `The watcher last completed a check on ${fmtWatcherDate(lastAt)}, ` +
        `${fmtAge(lastAt)} ago. Nothing has run it since, so everything on this ` +
        `page is a snapshot from that moment — not a live reading.`,
      tone: "border-border-subtle bg-bg-elevated/40",
    };
  }
  if (everRan === true) {
    // A cycle ran but carried no timestamp. Do NOT invent one.
    return {
      label: "Last run",
      body:
        "The watcher has completed a check, but no time was recorded for it. " +
        "Everything on this page is a snapshot, not a live reading.",
      tone: "border-border-subtle bg-bg-elevated/40",
    };
  }
  if (everRan === false) {
    return {
      label: "Never run",
      body:
        "The watcher has never completed a check. The panels below are empty " +
        "for that reason, not because nothing was found.",
      tone: "border-border-subtle bg-bg-base",
    };
  }
  return {
    label: "Run state unknown",
    body:
      "Whether the watcher has ever run is unknown — its records could not be " +
      "read. Nothing on this page can be treated as either current or complete.",
    tone: "border-accent-gold/40 bg-accent-gold/5",
  };
}
