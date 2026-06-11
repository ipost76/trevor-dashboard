// HUB-C2 — pure, client-side aggregation helpers for the Shadow page.
//
// No persisted state, no DB, no browser storage. These operate purely on the
// arrays the existing payloads already carry (and on the read-only registry
// aggregates surfaced server-side). The guiding rule: every value rendered is a
// rolled-up statistic over many entries — never one trade per line.

export interface OutcomeAgg {
  mean: number | null;
  min: number | null;
  max: number | null;
  count: number;
  /** null when NO entry carries a realized outcome (Group C). Never fabricated. */
  winRate: number | null;
}

/**
 * Pure aggregation over a shadow's entry array. `getPnl` extracts the realized
 * per-trade outcome (return null/NaN for an entry with no linked outcome).
 *
 * - `count` is the total entry count.
 * - `mean` / `min` / `max` are over LINKED entries only (those with an outcome).
 * - `winRate` (%) = share of linked entries with outcome > 0, or `null` when no
 *   entry has a realized outcome — the honesty line: a count-only shadow gets
 *   `null`, never a manufactured win-rate.
 */
export function aggregateShadow<T>(
  entries: readonly T[],
  getPnl: (e: T) => number | null | undefined,
): OutcomeAgg {
  const linked: number[] = [];
  for (const e of entries) {
    const v = getPnl(e);
    if (v !== null && v !== undefined && Number.isFinite(v)) linked.push(v);
  }
  const count = entries.length;
  if (linked.length === 0) {
    return { mean: null, min: null, max: null, count, winRate: null };
  }
  const sum = linked.reduce((a, b) => a + b, 0);
  const wins = linked.filter((v) => v > 0).length;
  return {
    mean: sum / linked.length,
    min: Math.min(...linked),
    max: Math.max(...linked),
    count: linked.length,
    winRate: (wins / linked.length) * 100,
  };
}

export interface ByLevelRow {
  partial_level_r: number;
  would_fire_7d: number;
  near_miss_7d: number;
  blocked_dust_7d: number;
  blocked_fee_7d: number;
}

export interface RBand {
  label: string; // e.g. "0.25–0.50R"
  loR: number;
  levels: number; // distinct partial_level_r rows folded into this band
  wouldFire: number;
  near: number;
  dust: number;
  fee: number;
}

/**
 * Collapse the near-continuous per-trade `partial_level_r` rows (≈1 row per
 * trade — ~1.8k rows on the live replica) into a HANDFUL of coarse R-bands.
 * Each band is itself an aggregate (folded-row count + would-fire / near / dust
 * / fee sums) — never a per-entry row. This replaces the old per-level dump.
 */
export function bandRTriggers(rows: readonly ByLevelRow[], bandSize = 0.25): RBand[] {
  const bands = new Map<number, RBand>();
  for (const r of rows) {
    const lo = Math.floor(r.partial_level_r / bandSize) * bandSize;
    const key = Math.round(lo * 100) / 100;
    let b = bands.get(key);
    if (!b) {
      b = {
        label: `${key.toFixed(2)}–${(key + bandSize).toFixed(2)}R`,
        loR: key,
        levels: 0,
        wouldFire: 0,
        near: 0,
        dust: 0,
        fee: 0,
      };
      bands.set(key, b);
    }
    b.levels += 1;
    b.wouldFire += r.would_fire_7d;
    b.near += r.near_miss_7d;
    b.dust += r.blocked_dust_7d;
    b.fee += r.blocked_fee_7d;
  }
  return [...bands.values()].sort((a, b) => a.loR - b.loR);
}

// ── formatters ──────────────────────────────────────────────────────────────

/** Signed small-dollar realized P&L, e.g. -$0.19 / $0.94. — for null/NaN. */
export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function fmtCount(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString();
}
