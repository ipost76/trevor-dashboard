// ─────────────────────────────────────────────────────────────────────────────
// W4b (2026-07-30) — THE TWO-CLOCK RULE, in one testable place.
//
// 🚨 trevor.db stores timestamps on TWO DIFFERENT CLOCKS, and mixing them is the
// recurring 4-hour bug in this codebase (CLAUDE.md measurement law 7):
//
//   REAL UTC   trade_insights.created_at · decision_log.ts
//              scan_cadence_timing_shadow.ts · equity_snapshots.ts
//              auto_config.updated_at · auto_trades.created_at
//
//   NAIVE ET   auto_trades.opened_at · auto_trades.closed_at
//              exit_signals_log[].ts
//              (written by datetime.now() on the America/New_York VM — already
//              Eastern, with no offset and no 'Z')
//
// PROVEN on one event, WSL replica 2026-07-30: trade #101743 opened_at
// '2026-07-29 17:18:27' (ET); its signal trade_insights.id=7495 created_at
// '2026-07-29 21:17:52' (UTC, 35s before the fill); its decision_log ACCEPT ts
// '2026-07-29 21:18:27' (UTC = exactly opened_at + 4h).
//
// 🚨 THE TWO MISTAKES, and they are mirror images:
//   · Passing a NAIVE-ET value here converts it a second time and shows a time
//     4 hours early. That is the original bug (15:21 EDT rendering as 11:21).
//   · Raw-slicing a UTC value (the correct treatment for an ET column) shows a
//     time 4 hours LATE. That is the same bug inverted, and it is the one a new
//     UTC-sourced surface walks into.
//
// So: raw-slice ET columns, call fmtEtFromUtc on UTC columns, and never the
// other way round.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a REAL-UTC timestamp as Eastern `HH:MM` (24h).
 *
 * 🚨 ONLY for genuinely-UTC columns. Passing `auto_trades.opened_at` (naive ET)
 * would double-convert and print 4 hours early.
 *
 * The trailing `Z` is appended explicitly rather than left to the browser: a
 * bare `new Date("2026-07-29 21:17:52")` is parsed as LOCAL time by every
 * engine, which on an ET machine silently produces the right-looking answer in
 * development and the wrong one for any viewer in another timezone. Being
 * explicit makes it correct everywhere and, more importantly, makes it correct
 * for the same reason everywhere.
 *
 * Returns "--:--" for null/short/unparseable input — never NaN, never a blank
 * that reads as a missing value.
 */
export function fmtEtFromUtc(utc: string | null | undefined): string {
  const d = parseUtc(utc);
  if (d === null) return "--:--";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).format(d);
}

/**
 * Parse a REAL-UTC DB timestamp to a Date, or null if unusable.
 *
 * Accepts both shapes the bot writes: SQLite's `YYYY-MM-DD HH:MM:SS` and
 * Python's isoformat `YYYY-MM-DDTHH:MM:SS.ffffff+00:00`. An already-offset
 * string is left alone — appending `Z` to a value that already carries `+00:00`
 * would produce an invalid date.
 */
export function parseUtc(utc: string | null | undefined): Date | null {
  if (typeof utc !== "string" || utc.length < 16) return null;
  const iso = utc.includes("T") ? utc : utc.replace(" ", "T");
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
