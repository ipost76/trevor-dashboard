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
