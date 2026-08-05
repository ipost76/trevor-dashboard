// math-values.ts — the READ-ONLY query layer behind /api/math/values.  [B2-MATH-API]
//
// Serves the standing configuration values the /math page needs to make its 88
// formulas concrete, plus the badge inputs that say whether each piece of math is
// actually deciding anything today.
//
// ─── THE THREE RULES THIS FILE IS BUILT AROUND ───────────────────────────────
//
// 1. 🚨 READ-ONLY, ABSOLUTELY. SELECT only, against the litestream REPLICA — never
//    the live VM DB, never a network mount. The connection is opened with
//    `readOnly: true` so the driver itself refuses a write, on top of the fact
//    that no write statement is written anywhere in this file.
//
// 2. 🚨 A ZERO READS AS A MEASUREMENT; A BLANK READS AS A BUG. A value that cannot
//    be known returns `available: false` WITH A REASON — never 0, never "", never
//    a TypeScript literal quietly standing in for a real setting. Every config
//    value here is READ FROM THE ROW, including ones whose default we "know".
//
// 3. 🚨 EVERY AGGREGATE CARRIES ITS WINDOW AND ITS `n`. The paper book is ~46
//    closed trades — far too small to support a rate claim — so the page must be
//    able to print the sample size beside every number. A bare count invites the
//    page to imply evidence the data cannot support.
//
// ─── CLOCK HYGIENE (the trap that silently corrupts every duration) ──────────
//   • auto_trades.opened_at / closed_at ....... NAIVE EASTERN
//   • auto_trades.created_at .................. real UTC
//   • equity_snapshots.ts ..................... real UTC
//   • auto_config.updated_at .................. real UTC
// Never difference across the two families without the 4-hour offset. Every
// timestamp returned from here is labelled with the clock it is on.
// ⚠️ AUTO_CUTOVER_EPOCH is the sharp edge: its VALUE is naive ET while its own
// `updated_at` is UTC — one row, two clocks. That is correct, not a bug. Because
// the value and `closed_at` are BOTH naive ET, the post-cutover window compares
// them directly with NO offset applied; converting either one would be the bug.
//
// ─── WHY node:sqlite AND NOT THE HUB'S runPython() ───────────────────────────
// The Hub's established replica-read path is runPython() → a Python helper that
// opens `file:...?mode=ro`. There is no TypeScript SQLite driver in the project
// (no better-sqlite3, nothing in node_modules). This file instead uses Node 24's
// BUILT-IN `node:sqlite`, which adds no dependency and enforces read-only at the
// connection level. Ghost approved this explicitly after Phase 0 established the
// contradiction. It is loaded via createRequire rather than a static import for
// one concrete reason: @types/node is pinned at 20.19.35, which predates the
// `node:sqlite` type declarations, so a static `import ... from "node:sqlite"`
// FAILS `next build` with TS2307 even though webpack bundles it fine (measured
// both ways). createRequire keeps the types local and the build green without
// touching package.json.

import { createRequire } from "node:module";
import { statSync } from "node:fs";
import type { MathLiveValue } from "@/components/math/values";
import {
  MATH_CONSTANTS,
  UNMIRRORED_CONSTANTS,
  MIRRORED_AT,
  MIRRORED_FROM,
} from "./math-constants";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal local typings for node:sqlite. Local BY DESIGN: B1 owns the shared
// types module for the /math response, and a second shared module would collide
// with it.
// ─────────────────────────────────────────────────────────────────────────────
interface SqliteStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean },
  ) => SqliteDatabase;
}

const nodeRequire = createRequire(import.meta.url);

/** The read-only litestream replica. NEVER the live VM DB. */
export const REPLICA_PATH =
  process.env.TREVOR_DB_PATH || "/home/ghost/trevor-replica/trevor.db";

/**
 * Staleness threshold for the replica, in seconds. The tailsync timer lands a
 * fresh copy roughly every ~20 min, so 1 hour means roughly three consecutive
 * sync cycles have been missed — a genuine fault, not ordinary lag.
 */
const STALE_AFTER_SECONDS = 3600;

// ─────────────────────────────────────────────────────────────────────────────
// Response contract. Mirrors §"Response shape" from the [B2] prompt verbatim, so
// B1 and D1–D6 can build against it before B1's shared types module lands.
// ─────────────────────────────────────────────────────────────────────────────
export interface ReplicaMeta {
  path: string;
  lagSeconds: number | null;
  asOfUtc: string;
  stale: boolean;
}
export interface ConfigValue {
  value: string;
  updatedAt: string;
  available: boolean;
  reason?: string;
}
export interface ConstantValue {
  mirrored: string;
  live?: string;
  drift: boolean;
  source: string;
  mirroredFrom: string;
  mirroredAt: string;
}
export interface AggregateValue {
  value: number;
  window: string;
  n: number;
  note?: string;
}
export interface SleeveStatus {
  inert: boolean;
  level: null;
  levelSource: "unavailable";
  proofs: { name: string; value: string }[];
}
export interface GateStatus {
  name: string;
  limit: string;
  binds: boolean;
  note?: string;
}
export interface BreakerStatus {
  name: string;
  armed: boolean;
  limit?: string;
  /** Additive beyond the base contract — see the note at buildStatus(). */
  tripped?: boolean;
}
export interface MathStatus {
  paperGated: boolean;
  sleeveStatus: SleeveStatus;
  portfolioChain: { flag: string; value: string }[];
  gates: GateStatus[];
  armedBreakers: BreakerStatus[];
  /** Additive beyond the base contract — see the note at buildStatus(). */
  entriesAllowed?: boolean;
  /** Additive: when the stored breaker evaluation was written (UTC). */
  breakerStateAsOfUtc?: string;
}
export interface UnavailableEntry {
  id: string;
  label: string;
  reason: string;
}
/**
 * The endpoint payload.
 *
 * 🚨 THIS SERVES TWO CONTRACTS AT ONCE, DELIBERATELY. The [B2] prompt specified
 * the `replica`/`config`/`constants`/`aggregates`/`status`/`unavailable`/`errors`
 * shape, on the stated assumption that B1 was writing its shared types module
 * against the same contract. B1 landed mid-build (commit 1ea9841) having declared
 * a DIFFERENT and much flatter shape in src/components/math/values.ts:
 * `{ ok, generatedAt, values, error, warnings }`. Neither is a subset of the other.
 *
 * Serving only the prompt's shape would leave B1's page unable to read this
 * endpoint at all — B1 already points MATH_VALUES_ENDPOINT at this exact route.
 * Serving only B1's would discard the provenance, drift and window/`n` structure
 * that is the entire point of this slice. So the response carries BOTH: the
 * detailed shape below, plus B1's four fields projected from the same underlying
 * reads. No number is computed twice and no number differs between the views.
 *
 * 🚨 `error` is REQUIRED and always present — null on success, a string on
 * failure — because B1's consumers guard with `if (!data || data.error)`, which
 * goes FALSE GREEN on a partially-failed payload that simply omits the key.
 */
export interface MathValuesResponse {
  ok: boolean;
  replica: ReplicaMeta;
  config: Record<string, ConfigValue>;
  constants: Record<string, ConstantValue>;
  aggregates: Record<string, AggregateValue>;
  status: MathStatus;
  unavailable: UnavailableEntry[];
  errors: string[];
  // ── B1's contract (src/components/math/values.ts) ─────────────────────────
  /** ISO-8601, when the values were read. */
  generatedAt: string;
  /** Flat, display-ready projection of everything above, keyed by value key. */
  values: Record<string, MathLiveValue>;
  /** null on success, a string on failure. NEVER omitted. */
  error: string | null;
  /** Non-fatal problems — same content as `errors`. */
  warnings?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The config keys the page's formulas need, grouped by the family they explain.
// 🚨 Every one of these is READ FROM THE REPLICA. A key absent from the table
// returns available:false with a reason — it never falls back to a literal.
// ─────────────────────────────────────────────────────────────────────────────
const REQUESTED_CONFIG_KEYS: string[] = [
  // Paper / live posture
  "PAPER_WINDOW_ENABLED", "PAPER_BLOCK_SURFACING", "AUTO_LIVE_ENABLED",
  "AUTO_CUTOVER_EPOCH", "LIVE_EDIT_ENABLED", "PROBATION_LIVE_ENABLED",
  "PROBATION_SIZE_FACTOR", "EMERGENCY_KILLSWITCH",
  // Capital and sizing
  "LIVE_ACCOUNT_VALUE_USD", "LIVE_CAPITAL_USD", "LIVE_PER_TRADE_USD",
  "LIVE_STARTING_EQUITY_USD", "LIVE_HARD_CAPITAL_CAP_USD",
  "RISK_PCT_PER_TRADE", "RISK_PCT_MIN", "RISK_PCT_MAX",
  "RISK_BUDGET_SIZING_ENABLED", "SIZING_V2_HIGH_CEILING_MAX_USD",
  "ETH_SIZE_REDUCTION_FACTOR", "RANGE_SIZE_MULT",
  // Leverage
  "LEVERAGE_DEFAULT", "LIVE_LEVERAGE_DEFAULT", "LEVERAGE_MIN",
  "LEVERAGE_DYNAMIC_ENABLED", "LEVERAGE_STRICT_ENFORCE",
  "LEVERAGE_CONF_FLOOR", "LEVERAGE_CONF_CEIL",
  "LEVERAGE_CONF_MULT_MIN", "LEVERAGE_CONF_MULT_MAX",
  "LEVERAGE_VOL_MULT_MIN", "LEVERAGE_VOL_MULT_MAX",
  "LEVERAGE_VOL_TARGET_ENABLED", "LEVERAGE_TARGET_VOL",
  "LEVERAGE_LIQ_BUFFER_K", "LEVERAGE_WEIGHTING_ENABLED",
  "LEVERAGE_REGIME_MULT_TRENDING", "LEVERAGE_REGIME_MULT_RANGING",
  "LEVERAGE_REGIME_MULT_VOLATILE", "LEVERAGE_REGIME_MULT_DEFAULT",
  "LEVERAGE_V2_PROMOTED", "LEVERAGE_V2_STRATEGY", "POST_OUTAGE_LEVERAGE_CAP",
  // Concurrency and frequency gates
  "MAX_CONCURRENT_POSITIONS", "MAX_CONCURRENT_PER_CLUSTER",
  "MAX_DAILY_TRADES", "MAX_DAILY_ROUND_TRIPS", "MAX_CONSECUTIVE_LOSSES",
  "MAX_CLUSTER_RISK_PCT", "MAX_TRADES_PER_TICKER_PER_DAY_V2",
  "MAX_TRADES_PER_TICKER_PER_DAY_V2_ENABLED",
  // Risk breakers
  "DAILY_LOSS_LIMIT_PCT", "RISK_BREAKERS_ENABLED", "RISK_BREAKERS_STATE_JSON",
  "RISK_BREAKERS_LAST_EVAL",
  // Confidence and entry thresholds
  "AGGRESSIVE_THRESHOLD", "MIN_JUDGMENT_CONFIDENCE", "RANGE_CONFIDENCE",
  "SIGNAL_V5_NO_CONFGATE", "RECALIBRATED_THRESHOLDS_V2",
  "WEAK_TICKER_THRESHOLD_SHADOW_ENABLED", "MAJOR_TICKER_THRESHOLD_SHADOW_ENABLED",
  // Regime
  "REGIME_GATE_V2_MODE", "REGIME_GATE_V2", "REGIME_GATE_LIVE",
  "REGIME_GATE_V2_ALLOW_CELLS", "REGIME_EXITS_ENABLED",
  "REGIME_DEBOUNCE_CONFIRM_CYCLES", "REGIME_DEBOUNCE_MIN_PROB",
  "REGIME_HOLD_ADJUST_ENABLED", "HMM_REGIME_SOURCE", "HMM_FEATURE_FIX_ENABLED",
  "HMM_STALENESS_ALERT_THRESHOLD_SEC",
  "REGIME_EXIT_TRAIL_FACTOR_TRENDING", "REGIME_EXIT_TRAIL_FACTOR_RANGING",
  "REGIME_EXIT_TRAIL_FACTOR_VOLATILE", "REGIME_EXIT_TRAIL_FACTOR_NORMAL",
  "REGIME_EXIT_TP_FACTOR_TRENDING", "REGIME_EXIT_TP_FACTOR_RANGING",
  "REGIME_EXIT_TP_FACTOR_VOLATILE", "REGIME_EXIT_TP_FACTOR_NORMAL",
  // Counter-trend / counter-regime
  "COUNTER_REGIME_CHECK_ENABLED", "COUNTER_REGIME_MIN_HMM_PROB",
  "COUNTER_REGIME_HIGH_LEV_ONLY", "COUNTER_REGIME_HIGH_LEV_THRESHOLD",
  "COUNTER_TREND_PENALTY_SHADOW_ENABLED",
  // Time gates
  "TIME_GATE_BLOCKED_UTC_HOURS_JSON", "TIME_GATE_BLOCKED_DAYS_JSON",
  "TIME_GATE_BLOCKED_SESSIONS_JSON", "TIME_GATE_BLOCKED_DAY_HOUR_JSON",
  "TIME_GATE_PROMOTED", "TIME_GATE_SHADOW_ENABLED",
  // Other entry gates
  "PATTERN_GATE_ENABLED", "PERSISTENCE_GATE_V2", "PERSISTENCE_GATE_RELAXED",
  "DIRECTION_GATE_PROMOTED", "POST_OUTAGE_REENTRY_GATE_ENABLED",
  "POST_OUTAGE_GAP_THRESHOLD_SEC",
  // Stops and trail
  "ATR_STOP_MULT", "ATR_TRAIL_ENABLED", "ATR_TP_RUNG1_ENABLED",
  "RANGE_STOP_PAD_ATR", "RANGE_MIN_WIDTH_ATR",
  "TRAIL_V2", "TRAIL_V3_PROMOTED", "S1_RATCHET_ENABLED",
  "LAYER6_NATIVE_LEAN_ENABLED", "LAYER6_NATIVE_LEAN_FLOOR",
  // Partial exits
  "PARTIAL_V2", "LIVE_PARTIALS_ENABLED", "PARTIAL_LADDER_S1_ENABLED",
  "PARTIAL_MIN_ORDER_USD", "PARTIAL_DUST_GUARD_USD",
  "PARTIAL_FEE_GUARD_V2_ENABLED", "PARTIAL_MAKER_ENABLED",
  "PARTIAL_MAKER_TIMEOUT_SEC", "PARTIAL_MAKER_ADVERSE_PCT",
  "PARTIAL_ROUNDING_ENABLED", "PARTIAL_MIN_NOTIONAL_ENABLED",
  "PARTIAL_GATE_LEVERAGE_AWARE", "PARTIAL_TP_RESIZE_ENABLED",
  // Exit thresholds
  "MOMENTUM_EXIT_THRESHOLD_LIVE", "MOMENTUM_EXIT_THRESHOLD_V2",
  "MOMENTUM_EXIT_THRESHOLD_DISPLAY",
  // Fees
  "FEE_AWARE_EXIT", "FEE_MODEL_V2_ENABLED", "FEES_TRUE_CAPTURE_ENABLED",
  "S1_BREAKEVEN_FEE_AWARE", "LIVE_SLIPPAGE_PCT", "LIVE_EXIT_SLIPPAGE_PCT",
  "SLIPPAGE_AUDIT_THRESHOLD_BPS",
  // Sleeves
  "SLEEVE_TAGGING_ENABLED", "SLEEVE_SHADOW_ENABLED",
  "PER_SLEEVE_EXIT_PROFILES", "PER_SLEEVE_STOP_ENABLED",
  // Portfolio / judgment chain
  "PORTFOLIO_INTEGRATION_ENABLED", "PORTFOLIO_CAPITAL_ENABLED",
  "PORTFOLIO_COORDINATION_ENABLED", "PORTFOLIO_ROUTING_LEVEL",
  "PORTFOLIO_DEPLOYMENT_CEILING", "CB_PORTFOLIO_ENABLED",
  "AI_SWARM_JUDGMENT_ENABLED", "BOTBRAIN_JUDGMENT_ENABLED",
  // Stale / timeout
  "STALE_V2", "TIMEOUT_V2", "ALO_ENTRY_TIMEOUT_SEC", "SCAN_TICKER_TIMEOUT_SEC",
  "EQUITY_MA_PERIOD", "EQUITY_DRIFT_THRESHOLD_USD",
];

/** The flags that together gate the R5/R6 judgment + sizing chain. */
const PORTFOLIO_CHAIN_KEYS = [
  "PORTFOLIO_INTEGRATION_ENABLED",
  "PORTFOLIO_CAPITAL_ENABLED",
  "PORTFOLIO_COORDINATION_ENABLED",
  "PORTFOLIO_ROUTING_LEVEL",
  "PORTFOLIO_DEPLOYMENT_CEILING",
  "CB_PORTFOLIO_ENABLED",
  "AI_SWARM_JUDGMENT_ENABLED",
  "BOTBRAIN_JUDGMENT_ENABLED",
  "MIN_JUDGMENT_CONFIDENCE",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function utcNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function asString(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compare a mirrored literal against a live `auto_config` value.
 * Numeric when BOTH sides parse as numbers — otherwise "20" vs "20.0" would be
 * reported as drift when nothing has changed. Falls back to a trimmed string
 * comparison for everything else.
 */
function valuesDiffer(mirrored: string, live: string): boolean {
  const a = Number(mirrored);
  const b = Number(live);
  if (Number.isFinite(a) && Number.isFinite(b) && mirrored.trim() !== "" && live.trim() !== "") {
    return a !== b;
  }
  return mirrored.trim() !== live.trim();
}

function openReplica(): SqliteDatabase {
  const { DatabaseSync } = nodeRequire("node:sqlite") as SqliteModule;
  // 🚨 readOnly at the CONNECTION level — the driver refuses a write even if a
  // future edit to this file were to attempt one.
  return new DatabaseSync(REPLICA_PATH, { readOnly: true });
}

/**
 * Replica lag, measured from the FILE's mtime — i.e. when tailsync last landed a
 * copy.
 *
 * 🚨 WHY NOT `MAX(equity_snapshots.ts)`, WHICH THE PROMPT ORIGINALLY SPECIFIED:
 * that column advances on an HOURLY snapshot cadence, so a perfectly fresh
 * replica reads as ~an hour stale (measured: file 18 min old while the newest
 * snapshot was 72 min old). Using it as the lag would mislabel a healthy replica
 * as stale on most requests. Ghost approved this change; the snapshot age is
 * still returned, as its own separately-labelled aggregate, so the page can show
 * both without conflating them.
 */
function measureLagSeconds(): number | null {
  try {
    const st = statSync(REPLICA_PATH);
    return Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section readers. Each one is independently guarded so a single failure
// degrades one section rather than emptying the whole response.
// ─────────────────────────────────────────────────────────────────────────────

function readConfig(
  db: SqliteDatabase,
  errors: string[],
): Record<string, ConfigValue> {
  const out: Record<string, ConfigValue> = {};
  let stmt: SqliteStatement;
  try {
    stmt = db.prepare("SELECT value, updated_at FROM auto_config WHERE key = ?");
  } catch (err) {
    errors.push(`config: could not prepare auto_config read — ${String(err)}`);
    return out;
  }
  for (const key of REQUESTED_CONFIG_KEYS) {
    try {
      const row = stmt.get(key);
      if (!row) {
        // 🚨 NOT a default. An absent key is reported as absent.
        out[key] = {
          value: "",
          updatedAt: "",
          available: false,
          reason: "No such key in auto_config on the replica.",
        };
        continue;
      }
      out[key] = {
        value: asString(row.value),
        updatedAt: asString(row.updated_at), // UTC
        available: true,
      };
    } catch (err) {
      out[key] = {
        value: "",
        updatedAt: "",
        available: false,
        reason: `Read failed: ${String(err)}`,
      };
      errors.push(`config[${key}]: ${String(err)}`);
    }
  }
  return out;
}

/**
 * The constants mirror, with the live row winning wherever one exists.
 *
 * 🚨 Drift is SURFACED, NEVER RESOLVED. When the mirror and the live row
 * disagree the response carries both and sets drift:true; this layer does not
 * pick a winner for display, because a silent resolution in either direction is
 * how a mirror starts lying.
 */
function buildConstants(
  config: Record<string, ConfigValue>,
): Record<string, ConstantValue> {
  const out: Record<string, ConstantValue> = {};
  for (const [name, c] of Object.entries(MATH_CONSTANTS)) {
    const entry: ConstantValue = {
      mirrored: c.value,
      drift: false,
      source: c.source,
      mirroredFrom: MIRRORED_FROM,
      mirroredAt: MIRRORED_AT,
    };
    if (c.liveKey) {
      const live = config[c.liveKey];
      if (live?.available) {
        entry.live = live.value;
        entry.drift = valuesDiffer(c.value, live.value);
      }
      // A liveKey that is absent leaves `live` undefined and drift false — an
      // absent row is not evidence of drift, and must not be reported as such.
    }
    out[name] = entry;
  }
  return out;
}

function readAggregates(
  db: SqliteDatabase,
  config: Record<string, ConfigValue>,
  errors: string[],
): Record<string, AggregateValue> {
  const out: Record<string, AggregateValue> = {};
  const add = (k: string, v: AggregateValue) => {
    out[k] = v;
  };

  // 🚨 COUNT(DISTINCT id) throughout. `auto_trades` has NO `trade_id` column —
  // the PK is `id` (verified against the replica: 82 columns, pk = id) — so a
  // COUNT(DISTINCT trade_id) would not merely be wrong, it would throw.
  let totalClosed = 0;
  try {
    const row = db
      .prepare("SELECT COUNT(DISTINCT id) AS n FROM auto_trades WHERE status = 'closed'")
      .get();
    totalClosed = asNumber(row?.n);
    add("closed_trades_total", {
      value: totalClosed,
      window: "all time · auto_trades.closed_at (naive ET)",
      n: totalClosed,
      note: "Every row in auto_trades on this replica has status='closed'; there is no open-trade complement here.",
    });
  } catch (err) {
    errors.push(`aggregate closed_trades_total: ${String(err)}`);
  }

  try {
    const row = db
      .prepare(
        "SELECT COUNT(DISTINCT id) AS n FROM auto_trades WHERE status = 'closed' AND paper_window = 1",
      )
      .get();
    add("closed_trades_paper_window", {
      value: asNumber(row?.n),
      window: "paper window · auto_trades.paper_window = 1",
      n: totalClosed,
      note: "n is the full closed book, so the page can show this as a share of it. FAR too small to support any rate claim on its own.",
    });
  } catch (err) {
    errors.push(`aggregate closed_trades_paper_window: ${String(err)}`);
  }

  // Post-cutover window. AUTO_CUTOVER_EPOCH's VALUE is naive ET and closed_at is
  // naive ET, so they compare DIRECTLY — applying the 4h offset to either side
  // here would be the bug, not the fix.
  const cutover = config.AUTO_CUTOVER_EPOCH;
  if (cutover?.available && cutover.value) {
    try {
      const row = db
        .prepare(
          "SELECT COUNT(DISTINCT id) AS n FROM auto_trades WHERE status = 'closed' AND closed_at >= ?",
        )
        .get(cutover.value);
      add("closed_trades_post_cutover", {
        value: asNumber(row?.n),
        window: `closed_at >= ${cutover.value} (naive ET, from AUTO_CUTOVER_EPOCH)`,
        n: totalClosed,
        note: "Both sides of this comparison are naive ET; no UTC offset is applied, deliberately.",
      });
    } catch (err) {
      errors.push(`aggregate closed_trades_post_cutover: ${String(err)}`);
    }
  } else {
    errors.push(
      "aggregate closed_trades_post_cutover: skipped — AUTO_CUTOVER_EPOCH unavailable, so the window cannot be defined.",
    );
  }

  // Sleeve proof #2 — the count of rows actually carrying a sleeve tag.
  try {
    const row = db
      .prepare("SELECT COUNT(DISTINCT id) AS n FROM auto_trades WHERE sleeve IS NOT NULL")
      .get();
    add("sleeve_tagged_rows", {
      value: asNumber(row?.n),
      window: "all time · auto_trades.sleeve IS NOT NULL",
      n: totalClosed,
      note: "Proof #2 of three that per-sleeve maths is inert: no row carries a sleeve tag.",
    });
  } catch (err) {
    errors.push(`aggregate sleeve_tagged_rows: ${String(err)}`);
  }

  // Exit-reason distribution. Each reason carries the SAME denominator so the
  // page can render a share without inventing one.
  try {
    const rows = db
      .prepare(
        "SELECT COALESCE(exit_reason, '(null)') AS reason, COUNT(DISTINCT id) AS n " +
          "FROM auto_trades WHERE status = 'closed' GROUP BY reason ORDER BY n DESC",
      )
      .all();
    for (const r of rows) {
      add(`exit_reason.${asString(r.reason)}`, {
        value: asNumber(r.n),
        window: "all time · closed trades, grouped by auto_trades.exit_reason",
        n: totalClosed,
        note: "n is the denominator: the full closed book, not this reason's own count.",
      });
    }
  } catch (err) {
    errors.push(`aggregate exit_reason distribution: ${String(err)}`);
  }

  // The equity-snapshot age, kept SEPARATE from replica lag on purpose (see
  // measureLagSeconds).
  try {
    const row = db.prepare("SELECT MAX(ts) AS m, COUNT(*) AS n FROM equity_snapshots").get();
    const newest = asString(row?.m);
    if (newest) {
      const ageSec = Math.max(
        0,
        Math.round((Date.now() - Date.parse(newest.replace(" ", "T") + "Z")) / 1000),
      );
      add("equity_snapshot_age_seconds", {
        value: ageSec,
        window: `newest equity_snapshots.ts = ${newest} UTC`,
        n: asNumber(row?.n),
        note: "NOT the replica lag. equity_snapshots advances on an hourly cadence, so this is routinely far larger than replica.lagSeconds and means something different.",
      });
    }
  } catch (err) {
    errors.push(`aggregate equity_snapshot_age_seconds: ${String(err)}`);
  }

  // Backs the "no live break-even bar" entry in the unavailable register with an
  // actual measurement rather than an assertion.
  if (cutover?.available && cutover.value) {
    try {
      const row = db
        .prepare(
          "SELECT COUNT(DISTINCT id) AS n FROM auto_trades " +
            "WHERE fees_usd_true IS NOT NULL AND closed_at >= ?",
        )
        .get(cutover.value);
      add("fees_true_rows_post_cutover", {
        value: asNumber(row?.n),
        window: `fees_usd_true IS NOT NULL AND closed_at >= ${cutover.value} (naive ET)`,
        n: totalClosed,
        note: "If this is 0, no post-cutover true-fee data exists and NO current break-even bar can be computed. The 8.2 bps figure is a historical cohort, not a live number.",
      });
    } catch (err) {
      // fees_usd_true may not exist on every schema revision — degrade, do not crash.
      errors.push(`aggregate fees_true_rows_post_cutover: ${String(err)}`);
    }
  }

  return out;
}

function buildStatus(
  config: Record<string, ConfigValue>,
  aggregates: Record<string, AggregateValue>,
  errors: string[],
): MathStatus {
  const val = (k: string): string => (config[k]?.available ? config[k].value : "");
  const isTrue = (k: string): boolean => val(k).trim().toLowerCase() === "true";

  // ── Sleeve status (pre-decision ②) ────────────────────────────────────────
  // 🚨 NO BAKED LEVEL. rebuild_tracker.db is not litestream-replicated and is not
  // reachable from this box (verified in Phase 0), so MAX(level) cannot be read.
  // Hardcoding 0 would become a lie the moment Ghost mints level 1. Instead the
  // inertness is PROVEN from three things the replica genuinely holds, so the
  // badge self-corrects if any of them changes.
  const taggedRows = aggregates.sleeve_tagged_rows?.value ?? null;
  const tagging = config.SLEEVE_TAGGING_ENABLED;
  const sleeveProofs = [
    {
      name: "SLEEVE_TAGGING_ENABLED (auto_config)",
      value: tagging?.available ? tagging.value : "unavailable",
    },
    {
      name: "auto_trades rows with a non-NULL sleeve",
      value:
        taggedRows === null
          ? "unavailable"
          : `${taggedRows} of ${aggregates.closed_trades_total?.value ?? "?"}`,
    },
    {
      name: "PER_SLEEVE_EXIT_PROFILES / PER_SLEEVE_STOP_ENABLED",
      value: `${config.PER_SLEEVE_EXIT_PROFILES?.available ? config.PER_SLEEVE_EXIT_PROFILES.value : "unavailable"} / ${
        config.PER_SLEEVE_STOP_ENABLED?.available ? config.PER_SLEEVE_STOP_ENABLED.value : "unavailable"
      } — on, and deciding nothing while nothing is tagged`,
    },
  ];
  const sleeveStatus: SleeveStatus = {
    inert: !isTrue("SLEEVE_TAGGING_ENABLED") && taggedRows === 0,
    level: null,
    levelSource: "unavailable",
    proofs: sleeveProofs,
  };

  // ── Portfolio / judgment chain ────────────────────────────────────────────
  // 🚨 Returns EVERY relevant flag rather than asserting a single gate: the R5/R6
  // chain needs more than one flip, so naming one flag would misrepresent what it
  // takes to turn this on.
  const portfolioChain = PORTFOLIO_CHAIN_KEYS.map((flag) => ({
    flag,
    value: config[flag]?.available ? config[flag].value : "unavailable",
  }));

  // ── Numeric gates ─────────────────────────────────────────────────────────
  const gates: GateStatus[] = [];
  const pushGate = (name: string, note?: string, zeroMeansUnlimited = false) => {
    const c = config[name];
    if (!c?.available) {
      gates.push({
        name,
        limit: "unavailable",
        binds: false,
        note: c?.reason ?? "Key not read.",
      });
      return;
    }
    const n = Number(c.value);
    const isZero = Number.isFinite(n) && n === 0;
    gates.push({
      name,
      limit: c.value,
      // 🚨 0 is the UNLIMITED sentinel on the count gates — it does NOT mean
      // "blocked". Treating it as a binding limit of zero would invert the
      // meaning of the badge.
      binds: zeroMeansUnlimited ? !isZero : Number.isFinite(n) && n !== 0,
      note:
        zeroMeansUnlimited && isZero
          ? "0 means UNLIMITED, not blocked — this gate is not binding."
          : note,
    });
  };
  pushGate("MAX_CONCURRENT_POSITIONS", "A finite concurrency ceiling — this one binds.");
  pushGate("MAX_CONCURRENT_PER_CLUSTER", "Per-cluster concurrency ceiling.");
  pushGate("MAX_DAILY_TRADES", undefined, true);
  pushGate("MAX_DAILY_ROUND_TRIPS", undefined, true);
  pushGate("MAX_CONSECUTIVE_LOSSES", "Feeds the consecutive-losses breaker.");
  pushGate("MAX_CLUSTER_RISK_PCT", "Cluster risk ceiling, percent.");
  pushGate("DAILY_LOSS_LIMIT_PCT", "Feeds the daily-loss breaker; negative by convention.");
  pushGate("RISK_PCT_PER_TRADE", "Per-trade risk budget, percent of account.");

  // ── Breakers: READ the stored row, never evaluate ─────────────────────────
  // 🚨 evaluate_breakers() WRITES auto_config (RISK_BREAKERS_STATE_JSON +
  // RISK_BREAKERS_LAST_EVAL) and a simulated halt POSTS A REAL DISCORD ALERT.
  // This endpoint therefore only ever reads the stored row.
  //
  // `armed` means "in force" (breakers enabled AND this breaker present in the
  // stored evaluation). `tripped` is additive beyond the base contract, as is
  // `entriesAllowed` below: whether a breaker has actually FIRED is too
  // load-bearing to omit from a money-adjacent surface, and both are optional
  // so B1's shared types stay compatible.
  const armedBreakers: BreakerStatus[] = [];
  let entriesAllowed: boolean | undefined;
  const breakersEnabled = isTrue("RISK_BREAKERS_ENABLED");
  const stateRow = config.RISK_BREAKERS_STATE_JSON;
  if (stateRow?.available && stateRow.value) {
    try {
      const parsed = JSON.parse(stateRow.value) as {
        entries_allowed?: boolean;
        active_breakers?: string[];
        detail?: Record<string, { active?: boolean; limit?: unknown; limit_pct?: unknown }>;
      };
      entriesAllowed = parsed.entries_allowed;
      const detail = parsed.detail ?? {};
      for (const [name, d] of Object.entries(detail)) {
        const lim = d.limit_pct ?? d.limit;
        armedBreakers.push({
          name,
          armed: breakersEnabled,
          limit: lim === undefined || lim === null ? undefined : String(lim),
          tripped: d.active === true,
        });
      }
      for (const name of parsed.active_breakers ?? []) {
        if (!armedBreakers.some((b) => b.name === name)) {
          armedBreakers.push({ name, armed: breakersEnabled, tripped: true });
        }
      }
    } catch (err) {
      errors.push(`status.armedBreakers: RISK_BREAKERS_STATE_JSON did not parse — ${String(err)}`);
    }
  } else {
    errors.push(
      "status.armedBreakers: RISK_BREAKERS_STATE_JSON unavailable — breaker state cannot be shown (it was NOT evaluated as a substitute).",
    );
  }

  return {
    paperGated: isTrue("PAPER_WINDOW_ENABLED"),
    sleeveStatus,
    portfolioChain,
    gates,
    armedBreakers,
    entriesAllowed,
    breakerStateAsOfUtc: config.RISK_BREAKERS_LAST_EVAL?.available
      ? config.RISK_BREAKERS_LAST_EVAL.value
      : undefined,
  };
}

/**
 * The 31 values the page must NOT render as a number. Each gets a specific,
 * honest sentence so the page says WHY it is missing instead of showing a blank
 * (which reads as a bug) or a zero (which reads as a measurement).
 */
function buildUnavailable(aggregates: Record<string, AggregateValue>): UnavailableEntry[] {
  const feesRows = aggregates.fees_true_rows_post_cutover?.value;
  const entries: UnavailableEntry[] = [
    {
      id: "atr_percentile_live",
      label: "Live ATR percentile, per ticker",
      reason:
        "Held in the scanner's in-process memory and never persisted — no table on the replica carries it.",
    },
    {
      id: "cvd_live",
      label: "Live CVD (cumulative volume delta)",
      reason: "Computed in-process from the order-feed and not written to any table.",
    },
    {
      id: "obi_live",
      label: "Live order-book imbalance",
      reason: "Computed in-process from the L2 book and not persisted.",
    },
    {
      id: "aggressor_live",
      label: "Live aggressor side / ratio",
      reason: "Derived from the trade feed in-process; not persisted.",
    },
    {
      id: "native_tp_target_price",
      label: "Native take-profit target price",
      reason:
        "Held on the exchange as a resting order; the bot does not record the target price in the database.",
    },
    {
      id: "free_margin",
      label: "Free margin",
      reason:
        "An exchange-side account figure read live from Hyperliquid at decision time; no column stores it.",
    },
    {
      id: "sleeve_capital",
      label: "Per-sleeve capital allocation",
      reason:
        "Requires the sleeve registry, which is not reachable from this box, and no trade carries a sleeve tag yet.",
    },
    {
      id: "sz_decimals",
      label: "Per-asset szDecimals",
      reason:
        "An exchange metadata field fetched from Hyperliquid at runtime; not mirrored into the database.",
    },
    {
      id: "hl_fee_tier",
      label: "Hyperliquid fee tier",
      reason:
        "Asserted in code prose only — it is stored nowhere, so the tier actually in force cannot be confirmed from data.",
    },
    {
      id: "maker_taker_mix",
      label: "Historical maker/taker mix",
      reason:
        "Fill-level maker/taker classification is not retained; only aggregate fees survive, which cannot be decomposed back into a mix.",
    },
    {
      id: "break_even_bar_live",
      label: "Live break-even bar (bps)",
      reason:
        feesRows === 0
          ? "fees_usd_true has ZERO post-cutover rows, so no current break-even bar exists. The 8.2 bps figure is a historical cohort (n=557, 2026-07-01→07-18) and must never be rendered as current."
          : "No current break-even bar is published; the 8.2 bps figure is a historical cohort (n=557, 2026-07-01→07-18) and must never be rendered as current.",
    },
    {
      id: "global_level",
      label: "Global LEVEL (MAX(level))",
      reason:
        "Lives in rebuild_tracker.db, which is NOT litestream-replicated and is unreachable from this box. Sleeve inertness is proven from three live replica reads instead of a baked level number.",
    },
    ...UNMIRRORED_CONSTANTS,
  ];

  // The 18 log-only sentinels. Individually named so the page can attach the
  // right sentence to the right formula rather than showing one generic excuse.
  const logOnly: [string, string][] = [
    ["gate_reject_reason_detail", "Per-candidate gate rejection detail"],
    ["scan_cycle_timing", "Scan-cycle timing breakdown"],
    ["signal_score_components", "Signal score component breakdown"],
    ["regime_transition_event", "Regime transition events"],
    ["hmm_probability_stream", "HMM state-probability stream"],
    ["order_submit_ack", "Order submit/ack round-trip"],
    ["slippage_per_fill", "Per-fill slippage"],
    ["ws_reconnect_event", "Websocket reconnect events"],
    ["rate_limit_backoff", "Rate-limit backoff events"],
    ["exit_layer_evaluation_order", "Exit-layer evaluation order per tick"],
    ["trail_recompute_trace", "Trail recomputation trace"],
    ["partial_skip_reason", "Partial-exit skip reason"],
    ["breaker_evaluation_trace", "Breaker evaluation trace"],
    ["leverage_clamp_event", "Leverage clamp events"],
    ["capital_refresh_event", "Capital refresh events"],
    ["startup_flag_snapshot", "Startup flag snapshot"],
    ["shadow_divergence_note", "Shadow divergence notes"],
    ["watchdog_actuation", "Watchdog actuation events"],
  ];
  for (const [id, label] of logOnly) {
    entries.push({
      id,
      label,
      reason:
        "Emitted to the bot log only — never written to a table, so the replica cannot supply it.",
    });
  }

  return entries;
}

/** SCREAMING_SNAKE / dotted key → a readable label, for B1's `label` field. */
function humanize(key: string): string {
  const s = key.replace(/[._]/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Project everything above into B1's flat `Record<string, MathLiveValue>`.
 *
 * 🚨 THE UNAVAILABLE CASES ARE THE POINT. B1's MathLiveValue has no
 * `available` flag, so a value that cannot be known is rendered as the explicit
 * string "no live value available" with the reason in `note` — never "0" (which
 * reads as a measurement) and never "" (which reads as a bug).
 *
 * ⚠️ `stale` in B1's contract means "fell back to a default rather than a live
 * row". This layer NEVER falls back to a default, so `stale` is set only where
 * the value is a mirror or is unavailable — i.e. wherever it is not a live read.
 */
function buildB1Values(
  config: Record<string, ConfigValue>,
  constants: Record<string, ConstantValue>,
  aggregates: Record<string, AggregateValue>,
  unavailable: UnavailableEntry[],
): Record<string, MathLiveValue> {
  const out: Record<string, MathLiveValue> = {};

  for (const [key, c] of Object.entries(config)) {
    out[key] = c.available
      ? {
          key,
          label: humanize(key),
          value: c.value,
          raw: c.value,
          source: "auto_config",
          origin: `auto_config:${key}`,
          note: `Live row, updated ${c.updatedAt} UTC.`,
        }
      : {
          key,
          label: humanize(key),
          value: "no live value available",
          raw: null,
          source: "unknown",
          origin: `auto_config:${key}`,
          note: c.reason,
          stale: true,
        };
  }

  for (const [name, k] of Object.entries(constants)) {
    const key = `const.${name}`;
    const drifted = k.drift && k.live !== undefined;
    out[key] = {
      key,
      label: humanize(name),
      // The LIVE row wins for display wherever one exists; the mirror is the
      // fallback. Drift is surfaced in the note, never silently resolved.
      value: k.live ?? k.mirrored,
      raw: k.live ?? k.mirrored,
      source: k.live !== undefined ? "auto_config" : "code",
      origin: k.source,
      note: drifted
        ? `⚠️ DRIFT: mirror says ${k.mirrored}, live row says ${k.live}. Mirrored from ${k.mirroredFrom} on ${k.mirroredAt}.`
        : k.live !== undefined
          ? `Live row wins; mirror agrees (${k.mirrored}). Mirrored from ${k.mirroredFrom} on ${k.mirroredAt}.`
          : `Mirrored constant — NOT a live read. From ${k.mirroredFrom} on ${k.mirroredAt}.`,
      stale: k.live === undefined,
    };
  }

  for (const [name, a] of Object.entries(aggregates)) {
    const key = `agg.${name}`;
    out[key] = {
      key,
      label: humanize(name),
      value: String(a.value),
      raw: a.value,
      source: "derived",
      origin: a.window,
      // 🚨 n travels WITH the number so the page cannot print a rate without
      // its sample size.
      note: `n=${a.n} · window: ${a.window}${a.note ? ` · ${a.note}` : ""}`,
    };
  }

  for (const u of unavailable) {
    const key = `unavailable.${u.id}`;
    out[key] = {
      key,
      label: u.label,
      value: "no live value available",
      raw: null,
      source: "unknown",
      note: u.reason,
      stale: true,
    };
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full /math values payload.
 *
 * 🚨 FAILS SOFT, LOUDLY. A missing, locked or unreadable replica returns a
 * structured `ok:false` response the page can render as "live values
 * unavailable" — it never returns zeros dressed as measurements, and it never
 * throws into the route.
 */
export function buildMathValues(): MathValuesResponse {
  const errors: string[] = [];
  const lagSeconds = measureLagSeconds();
  const replica: ReplicaMeta = {
    path: REPLICA_PATH,
    lagSeconds,
    asOfUtc: utcNow(),
    stale: lagSeconds === null ? true : lagSeconds > STALE_AFTER_SECONDS,
  };

  let db: SqliteDatabase | null = null;
  try {
    db = openReplica();
  } catch (err) {
    errors.push(
      `replica: cannot open ${REPLICA_PATH} read-only — ${String(err)}. No live values are available; nothing below is a measurement.`,
    );
    const deadConstants = buildConstants({});
    const deadUnavailable = buildUnavailable({});
    return {
      ok: false,
      replica: { ...replica, stale: true },
      config: {},
      constants: deadConstants,
      aggregates: {},
      status: {
        paperGated: false,
        sleeveStatus: {
          inert: false,
          level: null,
          levelSource: "unavailable",
          proofs: [
            {
              name: "replica",
              value: "unreadable — sleeve inertness cannot be proven either way",
            },
          ],
        },
        portfolioChain: PORTFOLIO_CHAIN_KEYS.map((flag) => ({ flag, value: "unavailable" })),
        gates: [],
        armedBreakers: [],
      },
      unavailable: deadUnavailable,
      errors,
      generatedAt: new Date().toISOString(),
      values: buildB1Values({}, deadConstants, {}, deadUnavailable),
      error: errors.join(" | ") || "replica unreadable",
      warnings: errors,
    };
  }

  try {
    const config = readConfig(db, errors);
    const aggregates = readAggregates(db, config, errors);
    const constants = buildConstants(config);
    const status = buildStatus(config, aggregates, errors);
    const unavailable = buildUnavailable(aggregates);
    return {
      ok: errors.length === 0,
      replica,
      config,
      constants,
      aggregates,
      status,
      unavailable,
      errors,
      generatedAt: new Date().toISOString(),
      values: buildB1Values(config, constants, aggregates, unavailable),
      // null ONLY on a clean read. A partially-failed payload carries a string
      // here so B1's `if (!data || data.error)` guard cannot go false green.
      error: errors.length === 0 ? null : errors.join(" | "),
      warnings: errors,
    };
  } finally {
    try {
      db.close();
    } catch {
      /* closing a read-only handle cannot lose data */
    }
  }
}
