/**
 * TREVOR // MATH PAGE — THE CANONICAL SHARED CONTRACT
 * [B1, 2026-08-05 · contract unified by C1-MATH-RESEED, 2026-08-05]
 *
 * The single source of truth for the /math learning surface. Six later prompts
 * (D1–D6) fill in 88 formula entries across 17 sections, and B2's
 * `/api/math/values` supplies the live values. They all import their types from
 * HERE so the surface stays one shape instead of six.
 *
 * 🚨 THIS FILE IS THE CONTRACT; `src/lib/math-values.ts` IS ITS IMPLEMENTATION.
 * D1–D6 build against the types below. `math-values.ts` now IMPORTS them from
 * here rather than redeclaring them, so there is exactly one definition of the
 * response shape in the repo.
 *
 * 🚨 WHY THIS FILE CHANGED. B1 and B2 landed in parallel and declared two
 * different response shapes: B1's flat `{ok, generatedAt, values, error,
 * warnings}` and B2's detailed `{replica, config, constants, aggregates, status,
 * unavailable, errors, …}`. B2's is the SUPERSET and is now CANONICAL — it
 * carries the badge resolution, the unavailable register, and the per-aggregate
 * `window`/`n` that the page's honesty depends on. B1's four fields survive
 * verbatim inside it (B2 projects them from the same underlying reads, so no
 * number is computed twice and no number differs between the two views).
 * Nothing consumed the old narrow shape, so it was replaced rather than wrapped
 * in a compatibility layer nobody needed.
 *
 * Nothing in this file reads the DB, calls an API, or writes anything. /math is
 * a read-only learning surface — no gateway calls, no mutations, no controls.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Status vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a formula is ACTUALLY doing in the live system right now — not what it
 * was designed to do. An honest badge is the whole point of the page.
 *
 *   live    🟢 runs on every signal/position today
 *   paper   🟡 runs, but the fill is simulated
 *   dormant ⚪ built and wired, gated off
 *   shadow  🔵 computes, never acts
 *   dead    ⚫ unreachable, or arithmetically unable to act
 *   inert   🟠 live-looking, neutered by a live value
 *   split   ◐  two statuses at once — `statusNote` must explain
 */
export type FormulaStatus =
  | "live"
  | "paper"
  | "dormant"
  | "shadow"
  | "dead"
  | "inert"
  | "split";

/** One row of the symbol glossary under a formula. */
export interface FormulaSymbol {
  /** The symbol as it appears in the TeX, e.g. `\alpha` renders as α. */
  sym: string;
  /** Plain English. What this symbol IS, not how it is computed. */
  means: string;
}

/** One standing configuration value that makes a formula concrete. */
export interface FormulaValue {
  label: string;
  /** Display-ready. Pre-format it — the component does not round or unit-ise. */
  value: string;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The entry contract — every one of the 88 formulas renders through this
// ─────────────────────────────────────────────────────────────────────────────

export interface FormulaEntryProps {
  /** 'F-IND-01'. Rendered, and used verbatim as the anchor id. */
  id: string;
  /** 'RSI (14)'. */
  name: string;
  status: FormulaStatus;
  /**
   * 🚨 `paper` is an OVERLAY, not an alternative. Most sizing and fee entries
   * are `live` AND behind the paper gate — a bare 🟢 would tell Ghost real
   * money moved. Pass `status="live" overlay="paper"` and BOTH badges render.
   */
  overlay?: FormulaStatus;
  /** One line: what this is actually doing right now. Required for `split`. */
  statusNote?: string;
  /**
   * 'scalp_engine._check_momentum' — module.symbol.
   * 🚨 NEVER a line number. Line numbers rot on the next commit; symbols do not.
   */
  source: string;
  /** One or more display formulas, rendered in the order given. */
  tex: string | string[];
  symbols: FormulaSymbol[];
  /** 2–4 sentences, plain English. Why this works, not what it computes. */
  why: string;
  /** Standing config that makes the formula concrete. */
  values?: FormulaValue[];
  /**
   * 🚨 Rendered INLINE and PROMINENT, never as a footnote. Several entries
   * carry a warning that would teach Ghost something false if buried.
   */
  caveat?: string;
  /** Exit-family only: 'FIRED (n=62)' / 'NEVER FIRED'. */
  fired?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The section registry — pins titles, numbering and ownership for D1–D6
// ─────────────────────────────────────────────────────────────────────────────

export interface MathSectionSpec {
  /** 1-17. Drives both the rendered number and the anchor id. */
  number: number;
  title: string;
  /** Export name of the component that fills this section. */
  stub: string;
  /** Which prompt fills it: 'D1'…'D6'. */
  prompt: string;
  /** The formula-id range this section owns, e.g. 'F-IND-01…19'. */
  idRange: string;
}

/**
 * All 17 sections in render order. The page builds its table of contents from
 * this, so a D-prompt does not need to touch the page to be linkable — it only
 * has to render `<MathSection number={n}>` with the matching number.
 */
export const MATH_SECTIONS: readonly MathSectionSpec[] = [
  { number: 1,  title: "Reading the market",     stub: "MathReadingScoring",      prompt: "D1", idRange: "F-IND-01…19" },
  { number: 2,  title: "Scoring a setup",        stub: "MathReadingScoring",      prompt: "D1", idRange: "F-IND-01…19" },
  { number: 3,  title: "Regime",                 stub: "MathRegimeThresholds",    prompt: "D2", idRange: "F-IND-20…37" },
  { number: 4,  title: "Thresholds",             stub: "MathRegimeThresholds",    prompt: "D2", idRange: "F-IND-20…37" },
  { number: 5,  title: "Cooldown & dedup",       stub: "MathRegimeThresholds",    prompt: "D2", idRange: "F-IND-20…37" },
  { number: 6,  title: "Stage-A screens",        stub: "MathRegimeThresholds",    prompt: "D2", idRange: "F-IND-20…37" },
  { number: 7,  title: "Sizing",                 stub: "MathSizingGates",         prompt: "D3", idRange: "F-SIZE-01…15" },
  { number: 8,  title: "The tail cap",           stub: "MathSizingGates",         prompt: "D3", idRange: "F-SIZE-01…15" },
  { number: 9,  title: "The gates",              stub: "MathSizingGates",         prompt: "D3", idRange: "F-SIZE-01…15" },
  { number: 10, title: "The exit stack",         stub: "MathExitsSleeves",        prompt: "D4", idRange: "F-EXIT-00…15" },
  { number: 11, title: "Sleeves",                stub: "MathExitsSleeves",        prompt: "D4", idRange: "F-EXIT-00…15" },
  { number: 12, title: "Fees",                   stub: "MathFeesPnl",             prompt: "D5", idRange: "F-FEE-01…12" },
  { number: 13, title: "P&L",                    stub: "MathFeesPnl",             prompt: "D5", idRange: "F-FEE-01…12" },
  { number: 14, title: "Break-even",             stub: "MathFeesPnl",             prompt: "D5", idRange: "F-FEE-01…12" },
  { number: 15, title: "Funding & slippage",     stub: "MathFundingEquityPaper",  prompt: "D6", idRange: "F-FEE-13…21" },
  { number: 16, title: "Equity & return",        stub: "MathFundingEquityPaper",  prompt: "D6", idRange: "F-FEE-13…21" },
  { number: 17, title: "Paper mode",             stub: "MathFundingEquityPaper",  prompt: "D6", idRange: "F-FEE-13…21" },
] as const;

/** The anchor id for a section number. Zero-padded so #math-sec-02 sorts. */
export function mathSectionAnchor(n: number): string {
  return `math-sec-${String(n).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// B2's live-values API — the shape, declared here so both halves agree
// ─────────────────────────────────────────────────────────────────────────────

/** The route B2 builds. Pinned here so a D-prompt never guesses the path. */
export const MATH_VALUES_ENDPOINT = "/api/math/values";

/** Where a live value actually came from. Shown so Ghost can audit a number. */
export type MathValueSource =
  | "auto_config"
  | "env"
  | "db"
  | "code"
  | "derived"
  | "unknown";

/** One resolved live value — the standing config behind a formula. */
export interface MathLiveValue {
  /** Stable lookup key, e.g. 'RISK_PCT'. */
  key: string;
  label: string;
  /** Display-ready string. The renderer never re-formats. */
  value: string;
  /** The untouched underlying value, for callers that must compute. */
  raw?: string | number | boolean | null;
  unit?: string;
  source: MathValueSource;
  /** Provenance detail, e.g. 'auto_config:RISK_PCT'. */
  origin?: string;
  note?: string;
  /** True when the read fell back to a default rather than a live row. */
  stale?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The detailed response sections. These are what make the page honest: where a
// number came from, how old it is, and what its denominator was.
// ─────────────────────────────────────────────────────────────────────────────

/** Which replica was read, and how stale it was when it was read. */
export interface ReplicaMeta {
  path: string;
  /** Seconds since tailsync last landed a copy. `null` if unmeasurable. */
  lagSeconds: number | null;
  asOfUtc: string;
  stale: boolean;
}

/** One `auto_config` row. */
export interface ConfigValue {
  value: string;
  /** UTC — `auto_config.updated_at` is real UTC, unlike `auto_trades.opened_at`. */
  updatedAt: string;
  /**
   * 🚨 An absent key reports `available: false` WITH a reason. It never falls
   * back to a literal: a default dressed as a live read is how a config page
   * starts lying.
   */
  available: boolean;
  reason?: string;
}

/**
 * One mirrored Python constant, with the live row's verdict where one exists.
 *
 * 🚨 Drift is SURFACED, NEVER RESOLVED. When `mirrored` and `live` disagree,
 * both are carried and `drift` is true; the layer does not pick a winner,
 * because a silent resolution in either direction is how a mirror starts lying.
 */
export interface ConstantValue {
  mirrored: string;
  live?: string;
  drift: boolean;
  /** `module.symbol` — never a line number. */
  source: string;
  /** The VM commit the mirror was read from. One stamp per reseed. */
  mirroredFrom: string;
  mirroredAt: string;
  /**
   * Set where a comment in the Python source CONTRADICTS the literal beside it.
   * Render it: a reader who later opens the module must not be misled by prose
   * the code outgrew. The literal always wins.
   */
  staleComment?: string;
  /**
   * True where the constant is real and readable but DECIDES NOTHING on the live
   * path.
   * 🚨 A `dead` constant must NEVER be rendered as an active gate. It is served
   * so the page can name it as dead, which is a different statement.
   */
  dead?: boolean;
}

/**
 * One derived aggregate.
 *
 * 🚨 `window` AND `n` ARE MANDATORY. The paper book is small enough that a bare
 * count invites the page to imply evidence the data cannot support, so the
 * sample size travels WITH the number rather than beside it.
 */
export interface AggregateValue {
  value: number;
  window: string;
  n: number;
  note?: string;
}

/**
 * Whether the per-sleeve maths is deciding anything.
 *
 * 🚨 `level` and `levelSource` are deliberately pinned to `null` /
 * `"unavailable"`. `rebuild_tracker.db` is not litestream-replicated and is not
 * reachable from this box, so MAX(level) genuinely cannot be read here — and
 * baking a 0 would become a lie the moment Ghost mints level 1. Inertness is
 * PROVEN from `proofs` instead, each a live replica read, so the badge
 * self-corrects if any of them changes.
 */
export interface SleeveStatus {
  inert: boolean;
  level: null;
  levelSource: "unavailable";
  proofs: { name: string; value: string }[];
}

export interface GateStatus {
  name: string;
  limit: string;
  /**
   * 🚨 0 is the UNLIMITED sentinel on the count gates — it does NOT mean
   * "blocked". `binds` encodes that, so the badge cannot invert the meaning.
   */
  binds: boolean;
  note?: string;
}

export interface BreakerStatus {
  name: string;
  /** In force: breakers enabled AND present in the stored evaluation. */
  armed: boolean;
  limit?: string;
  /** Whether it has actually FIRED. Optional — absent is not "false". */
  tripped?: boolean;
}

export interface MathStatus {
  paperGated: boolean;
  sleeveStatus: SleeveStatus;
  portfolioChain: { flag: string; value: string }[];
  gates: GateStatus[];
  armedBreakers: BreakerStatus[];
  entriesAllowed?: boolean;
  /** When the stored breaker evaluation was written (UTC). */
  breakerStateAsOfUtc?: string;
}

/**
 * A value the page must NOT render as a number.
 *
 * 🚨 Each carries a SPECIFIC reason, so the page says why it is missing rather
 * than showing a blank (which reads as a bug) or a zero (which reads as a
 * measurement).
 */
export interface UnavailableEntry {
  id: string;
  label: string;
  reason: string;
}

/**
 * The `/api/math/values` response — THE CANONICAL SHAPE. D1–D6 build against
 * this; `src/lib/math-values.ts` implements it.
 *
 * 🚨 `error` is REQUIRED and must always be present — `null` on success, a
 * string on failure. It is not optional on purpose: a consumer guarding with
 * `if (!data || data.error)` goes FALSE GREEN when a partially-failed payload
 * simply omits the key. Populate it or the guard is decorative.
 */
export interface MathValuesResponse {
  ok: boolean;
  replica: ReplicaMeta;
  /** Live `auto_config` rows, keyed by config key. */
  config: Record<string, ConfigValue>;
  /** The VM-constant mirror, drift-checked against `config` where paired. */
  constants: Record<string, ConstantValue>;
  /** Derived counts, each carrying its own window and `n`. */
  aggregates: Record<string, AggregateValue>;
  status: MathStatus;
  unavailable: UnavailableEntry[];
  /** Non-fatal problems. Same content as `warnings`. */
  errors: string[];
  /** ISO-8601. When the values were read. */
  generatedAt: string;
  /** Flat, display-ready projection of everything above, keyed by value key. */
  values: Record<string, MathLiveValue>;
  /** null on success. NEVER omitted. */
  error: string | null;
  /** Non-fatal problems — same content as `errors`. */
  warnings?: string[];
}
