// math-constants.ts — the CODE-CONSTANT MIRROR for the /math page.  [B2-MATH-API]
//
// WHAT THIS IS. The /math page explains 88 formulas, and many of them are made
// concrete by constants that live in PYTHON ON THE VM (auto_trader/config.py,
// ticker_thresholds.py, auto_trader/exit_helpers.py, auto_trader/fees.py). This
// box — ghost@Ghost, WSL — cannot read the VM. So these are MIRRORED values, and
// every entry says so in its own provenance stamp rather than passing itself off
// as a live read.
//
// 🚨 PROVENANCE IS NOT THE COMMIT THE PROMPT ASKED FOR — READ THIS.
// The [B2] prompt specified `mirroredFrom: '56e4f90'`. That stamp could NOT be
// honoured honestly. The only copy of these modules reachable from this box is
// /home/ghost/a3_scratch/, a SNAPSHOT dated 2026-06-20 whose .git directory is
// broken (`git rev-parse` fails: "not a git repository"), so the commit it came
// from is unverifiable from here. Stamping '56e4f90' on values actually read out
// of an unverified 46-day-old scratch copy would be fabricated provenance — the
// precise failure the mirror-with-drift-detection design exists to prevent. The
// stamp below therefore names what was really read. Ghost can replace it with a
// real commit the moment someone re-mirrors these from the VM.
//
// 🚨 THE MIRROR NEVER WINS. Where a constant also exists as an `auto_config` row,
// the LIVE ROW IS AUTHORITATIVE and the mirror is demoted to (a) a fallback and
// (b) a drift detector. See `liveKey` below and the comparison in math-values.ts.
//
// 🚨 `source` IS `module.symbol`, NEVER A LINE NUMBER. Several of these modules
// are known drifters; a line number would rot within days of being written.
//
// ⚠️ AGE. These values are ~46 days old at time of writing. Only 5 of them have
// an `auto_config` counterpart, which means the other ~67 have NO drift detector
// and are trusted on the strength of the provenance stamp alone. That is a real
// limitation of reading a VM-only constant from a box that cannot see the VM, and
// the page should render the stamp prominently rather than hiding it.

export interface MirroredConstant {
  /** The mirrored literal, stringified. */
  value: string;
  /** `module.symbol` — never a line number. */
  source: string;
  /**
   * The `auto_config` key that SUPERSEDES this mirror when present. Set only
   * where the live row means the SAME THING as the Python symbol — a same-named
   * key with different semantics is not a drift pair and would raise a false
   * alarm (see RECALIBRATED_THRESHOLDS_V2 below for exactly that trap).
   */
  liveKey?: string;
}

/**
 * 🚨 Honest provenance. NOT a commit hash — see the header. Rendered on the page.
 */
export const MIRRORED_FROM = "a3_scratch snapshot 2026-06-20 (commit unverifiable)";
export const MIRRORED_AT = "2026-08-05";

export const MATH_CONSTANTS: Record<string, MirroredConstant> = {
  // ── ticker_thresholds.py — the per-ticker confidence table ─────────────────
  PER_TICKER_THRESHOLDS_ENABLED: {
    value: "true",
    source: "ticker_thresholds.PER_TICKER_THRESHOLDS_ENABLED",
  },
  "TICKER_THRESHOLDS.BTC": {
    value: '{"quiet":34.0,"normal":37.0,"active":40.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.ETH": {
    value: '{"quiet":36.0,"normal":39.0,"active":42.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.SOL": {
    value: '{"quiet":38.0,"normal":41.0,"active":44.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.HYPE": {
    value: '{"quiet":39.0,"normal":42.0,"active":45.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.FARTCOIN": {
    value: '{"quiet":42.0,"normal":45.0,"active":48.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.XRP": {
    value: '{"quiet":38.0,"normal":41.0,"active":44.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.DOGE": {
    value: '{"quiet":42.0,"normal":45.0,"active":48.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.NEAR": {
    value: '{"quiet":39.0,"normal":42.0,"active":45.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.SUI": {
    value: '{"quiet":39.0,"normal":42.0,"active":45.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.kPEPE": {
    value: '{"quiet":42.0,"normal":45.0,"active":48.0}',
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  DIRECTION_PENALTIES: {
    value:
      '{"BTC":3.0,"ETH":4.0,"SOL":5.0,"HYPE":6.0,"FARTCOIN":8.0,"XRP":5.0,"DOGE":8.0,"NEAR":6.0,"SUI":6.0,"kPEPE":8.0}',
    source: "ticker_thresholds.DIRECTION_PENALTIES",
  },
  ATR_QUIET_THRESHOLD: {
    value: "30",
    source: "ticker_thresholds.ATR_QUIET_THRESHOLD",
  },
  ATR_ACTIVE_THRESHOLD: {
    value: "70",
    source: "ticker_thresholds.ATR_ACTIVE_THRESHOLD",
  },
  ACTIVE_REGIMES: {
    value: '["TRENDING"]',
    source: "ticker_thresholds.ACTIVE_REGIMES",
  },
  // 🚨 NO `liveKey` HERE, DELIBERATELY. `auto_config` has a key spelled exactly
  // RECALIBRATED_THRESHOLDS_V2, but it is a BOOLEAN FLAG ('false') switching the
  // table on, whereas this symbol is the TABLE ITSELF. Same name, different
  // meaning — wiring them as a drift pair would report a permanent false drift.
  RECALIBRATED_THRESHOLDS_V2_TABLE: {
    value:
      '{"BTC":{"quiet":51.0,"normal":54.0,"active":57.0},"ETH":{"quiet":53.0,"normal":56.0,"active":59.0},"SOL":{"quiet":53.0,"normal":56.0,"active":59.0},"HYPE":{"quiet":39.0,"normal":42.0,"active":45.0},"FARTCOIN":{"quiet":42.0,"normal":45.0,"active":48.0}}',
    source: "ticker_thresholds.RECALIBRATED_THRESHOLDS_V2",
  },

  // ── auto_trader/config.py — sizing, leverage, confidence ───────────────────
  MARGIN_MODE: { value: "isolated", source: "auto_trader.config.MARGIN_MODE" },
  DEFAULT_LEVERAGE: { value: "5", source: "auto_trader.config.DEFAULT_LEVERAGE" },
  DISCOVERY_TICKER_LEVERAGE: {
    value: "5.0",
    source: "auto_trader.config.DISCOVERY_TICKER_LEVERAGE",
  },
  SIZE_MIN_USD: { value: "5.0", source: "auto_trader.config.SIZE_MIN_USD" },
  SIZE_MAX_USD: { value: "15.0", source: "auto_trader.config.SIZE_MAX_USD" },
  CONFIDENCE_FLOOR: { value: "35", source: "auto_trader.config.CONFIDENCE_FLOOR" },
  CONFIDENCE_CEILING: { value: "56", source: "auto_trader.config.CONFIDENCE_CEILING" },

  // ── auto_trader/config.py — stops, trail, breakeven ────────────────────────
  HARD_STOP_PCT: { value: "10.0", source: "auto_trader.config.HARD_STOP_PCT" },
  TRAIL_ACTIVATION_R: { value: "0.5", source: "auto_trader.config.TRAIL_ACTIVATION_R" },
  TRAIL_ATR_MULTIPLIER: { value: "2.0", source: "auto_trader.config.TRAIL_ATR_MULTIPLIER" },
  TRAIL_MIN_PCT: { value: "0.015", source: "auto_trader.config.TRAIL_MIN_PCT" },
  TRAIL_TIGHTEN_AT_2R: { value: "true", source: "auto_trader.config.TRAIL_TIGHTEN_AT_2R" },
  ATR_TRAIL_PERIOD: { value: "10", source: "auto_trader.config.ATR_TRAIL_PERIOD" },
  BREAKEVEN_ACTIVATION_R: {
    value: "0.5",
    source: "auto_trader.config.BREAKEVEN_ACTIVATION_R",
  },
  BREAKEVEN_BUFFER_PCT: { value: "0.003", source: "auto_trader.config.BREAKEVEN_BUFFER_PCT" },
  S1_BREAKEVEN_ARM_R: { value: "0.25", source: "auto_trader.config.S1_BREAKEVEN_ARM_R" },

  // ── auto_trader/config.py — the ratchet ladder + partial schedules ─────────
  S1_RATCHET_LADDER: {
    value: '[[0.5,"be"],[0.75,0.25],[1.0,0.5]]',
    source: "auto_trader.config.S1_RATCHET_LADDER",
  },
  PARTIAL_EXIT_ENABLED: { value: "true", source: "auto_trader.config.PARTIAL_EXIT_ENABLED" },
  PARTIAL_EXIT_SCHEDULE: {
    value: "[[0.75,0.33],[1.5,0.5]]",
    source: "auto_trader.config.PARTIAL_EXIT_SCHEDULE",
  },
  S1_PARTIAL_SCHEDULE: {
    value: "[[0.25,0.4],[0.5,0.5833]]",
    source: "auto_trader.config.S1_PARTIAL_SCHEDULE",
  },
  PARTIAL_EXIT_MIN_USD: { value: "3.00", source: "auto_trader.config.PARTIAL_EXIT_MIN_USD" },

  // ── fees — config.py and fees.py hold the SAME rates in two places ─────────
  FEE_RATE_BPS: { value: "9", source: "auto_trader.config.FEE_RATE_BPS" },
  HL_FEE_TAKER: { value: "0.00045", source: "auto_trader.config.HL_FEE_TAKER" },
  HL_FEE_MAKER: { value: "0.00015", source: "auto_trader.config.HL_FEE_MAKER" },
  HL_FEE_ROUNDTRIP_TAKER: {
    value: "0.0009",
    source: "auto_trader.config.HL_FEE_ROUNDTRIP_TAKER",
  },
  HL_FEE_ROUNDTRIP_MAKER: {
    value: "0.0003",
    source: "auto_trader.config.HL_FEE_ROUNDTRIP_MAKER",
  },
  HL_FEE_ENTRY_TAKER_EXIT_MAKER: {
    value: "0.0006",
    source: "auto_trader.config.HL_FEE_ENTRY_TAKER_EXIT_MAKER",
  },
  MIN_PROFIT_TARGET_FLOOR_MULT: {
    value: "3.0",
    source: "auto_trader.config.MIN_PROFIT_TARGET_FLOOR_MULT",
  },
  MIN_PROFIT_TARGET_FLOOR_PCT: {
    value: "0.0018",
    source: "auto_trader.config.MIN_PROFIT_TARGET_FLOOR_PCT",
  },
  HL_MAKER_FEE_RATE: { value: "0.00015", source: "auto_trader.fees.HL_MAKER_FEE_RATE" },
  HL_TAKER_FEE_RATE: { value: "0.00045", source: "auto_trader.fees.HL_TAKER_FEE_RATE" },
  PARTIAL_EXIT_FEE_RATE_TAKER: {
    value: "0.00045",
    source: "auto_trader.fees.PARTIAL_EXIT_FEE_RATE_TAKER",
  },

  // ── auto_trader/config.py — technical exit layer (TA-Lib periods etc.) ─────
  TECH_EXIT_ENABLED: { value: "true", source: "auto_trader.config.TECH_EXIT_ENABLED" },
  RSI_EXIT_OVERBOUGHT: { value: "78", source: "auto_trader.config.RSI_EXIT_OVERBOUGHT" },
  RSI_EXIT_OVERSOLD: { value: "22", source: "auto_trader.config.RSI_EXIT_OVERSOLD" },
  MOMENTUM_FADE_LOOKBACK: {
    value: "5",
    source: "auto_trader.config.MOMENTUM_FADE_LOOKBACK",
  },
  MOMENTUM_FADE_THRESHOLD: {
    value: "3",
    source: "auto_trader.config.MOMENTUM_FADE_THRESHOLD",
  },
  EXIT_THRESHOLD: { value: "40", source: "auto_trader.config.EXIT_THRESHOLD" },

  // ── auto_trader/config.py — stale / timeout backstops ──────────────────────
  TIMEOUT_MINUTES: { value: "120", source: "auto_trader.config.TIMEOUT_MINUTES" },
  STALE_TRADE_MINUTES: { value: "120", source: "auto_trader.config.STALE_TRADE_MINUTES" },
  STALE_TRADE_EXIT_ENABLED: {
    value: "true",
    source: "auto_trader.config.STALE_TRADE_EXIT_ENABLED",
  },
  AUTO_CONFIG_CACHE_ENABLED: {
    value: "true",
    source: "auto_trader.config.AUTO_CONFIG_CACHE_ENABLED",
  },
  // ✅ A REAL DRIFT PAIR — same symbol, same meaning, live row wins.
  EQUITY_MA_PERIOD: {
    value: "20",
    source: "auto_trader.config.DEFAULTS",
    liveKey: "EQUITY_MA_PERIOD",
  },

  // ── auto_trader/exit_helpers.py — ATR trail machinery ──────────────────────
  ATR_TRAIL_MULTIPLIERS: {
    value:
      '{"TRENDING_BULL":1.5,"TRENDING_BEAR":1.5,"VOLATILE":3.0,"RANGING":2.5,"NORMAL":2.0}',
    source: "auto_trader.exit_helpers.ATR_TRAIL_MULTIPLIERS",
  },
  TICKER_ATR_ADJUSTMENT: {
    value: '{"BTC":0.0,"ETH":0.0,"SOL":0.2,"HYPE":0.3,"FARTCOIN":0.5}',
    source: "auto_trader.exit_helpers.TICKER_ATR_ADJUSTMENT",
  },
  CHANDELIER_MULTIPLIER: {
    value: "3.0",
    source: "auto_trader.exit_helpers.CHANDELIER_MULTIPLIER",
  },
  TICKER_TRAIL_FLOORS_V3: {
    value: '{"BTC":0.003,"ETH":0.003,"SOL":0.003,"HYPE":0.005,"FARTCOIN":0.007}',
    source: "auto_trader.exit_helpers.TICKER_TRAIL_FLOORS_V3",
  },
  TICKER_TIMEOUTS: {
    value: '{"BTC":120,"ETH":120,"SOL":120,"HYPE":120,"FARTCOIN":120}',
    source: "auto_trader.exit_helpers.TICKER_TIMEOUTS",
  },
  TICKER_STALE_MINUTES: {
    value: '{"BTC":120,"ETH":120,"SOL":120,"HYPE":120,"FARTCOIN":120}',
    source: "auto_trader.exit_helpers.TICKER_STALE_MINUTES",
  },

  // ── auto_trader/exit_helpers.py — ATR tier boundaries ──────────────────────
  ATR_BAND_THRESHOLDS: {
    value:
      '{"major":[0.0015,0.004],"mid":[0.0025,0.006],"memecoin":[0.004,0.01],"default":[0.0025,0.006]}',
    source: "auto_trader.exit_helpers.ATR_BAND_THRESHOLDS",
  },
  ATR_BAND_MULTIPLIERS: {
    value: '{"low":1.0,"normal":1.5,"high":2.0}',
    source: "auto_trader.exit_helpers.ATR_BAND_MULTIPLIERS",
  },
  PROFIT_STEP_START_R: {
    value: "0.5",
    source: "auto_trader.exit_helpers.PROFIT_STEP_START_R",
  },
  PROFIT_STEP_FULL_R: { value: "2.0", source: "auto_trader.exit_helpers.PROFIT_STEP_FULL_R" },
  PROFIT_STEP_FLOOR_MULT: {
    value: "1.0",
    source: "auto_trader.exit_helpers.PROFIT_STEP_FLOOR_MULT",
  },
  VOL_ADAPTIVE_MULT_MIN: {
    value: "1.0",
    source: "auto_trader.exit_helpers.VOL_ADAPTIVE_MULT_MIN",
  },
  VOL_ADAPTIVE_MULT_MAX: {
    value: "2.0",
    source: "auto_trader.exit_helpers.VOL_ADAPTIVE_MULT_MAX",
  },

  // ── exit_helpers regime factors — ✅ FOUR REAL DRIFT PAIRS ─────────────────
  // The Python dict and the four scalar auto_config rows are two copies of one
  // fact. They agree today; the drift check is what stops the mirror lying the
  // first time Ghost tunes one of the rows.
  "REGIME_EXIT_TRAIL_FACTORS.TRENDING": {
    value: "1.2",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TRAIL_FACTORS",
    liveKey: "REGIME_EXIT_TRAIL_FACTOR_TRENDING",
  },
  "REGIME_EXIT_TRAIL_FACTORS.RANGING": {
    value: "0.8",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TRAIL_FACTORS",
    liveKey: "REGIME_EXIT_TRAIL_FACTOR_RANGING",
  },
  "REGIME_EXIT_TRAIL_FACTORS.VOLATILE": {
    value: "1.2",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TRAIL_FACTORS",
    liveKey: "REGIME_EXIT_TRAIL_FACTOR_VOLATILE",
  },
  "REGIME_EXIT_TRAIL_FACTORS.NORMAL": {
    value: "1.0",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TRAIL_FACTORS",
    liveKey: "REGIME_EXIT_TRAIL_FACTOR_NORMAL",
  },
  "REGIME_EXIT_TP_FACTORS.TRENDING": {
    value: "1.25",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TP_FACTORS",
  },
  "REGIME_EXIT_TP_FACTORS.RANGING": {
    value: "0.85",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TP_FACTORS",
  },
  "REGIME_EXIT_TP_FACTORS.VOLATILE": {
    value: "0.85",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TP_FACTORS",
  },
  "REGIME_EXIT_TP_FACTORS.NORMAL": {
    value: "1.0",
    source: "auto_trader.exit_helpers.REGIME_EXIT_TP_FACTORS",
  },
};

/**
 * Constants the /math page's formulas reference but which this box has NO source
 * for — not in the replica, and not in the local snapshot either. They are listed
 * so the page can name them as missing instead of silently omitting a term from a
 * formula, which reads as though the term does not exist.
 *
 * 🚨 CASCADE_LMAX and the tail-cap fraction are here because a grep of the whole
 * local snapshot returns NOTHING for either symbol — they postdate 2026-06-20 or
 * live in a module the snapshot does not carry. Inventing a plausible number for
 * them is exactly the failure this register exists to prevent.
 */
export const UNMIRRORED_CONSTANTS: { id: string; label: string; reason: string }[] = [
  {
    id: "CASCADE_LMAX",
    label: "Cascade L-max",
    reason:
      "Not present anywhere in the local 2026-06-20 snapshot and not an auto_config key — VM-only, and no verifiable value is reachable from this box.",
  },
  {
    id: "TAIL_CAP_FRACTION",
    label: "Tail-cap fraction",
    reason:
      "No matching symbol in the local snapshot (grepped for TAIL_CAP / TAIL_FRAC) and no auto_config row — VM-only.",
  },
  {
    id: "SLEEVE_REGISTRY_FIELDS",
    label: "Sleeve registry fields",
    reason:
      "auto_trader/sleeves.py does not exist in the local snapshot, so the registry's field set cannot be mirrored. Sleeve status is instead proven from three live replica reads (see status.sleeveStatus).",
  },
];
