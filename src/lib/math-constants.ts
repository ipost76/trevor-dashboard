// math-constants.ts — the CODE-CONSTANT MIRROR for the /math page.
// [B2-MATH-API, reseeded from real VM source by C1-MATH-RESEED 2026-08-05]
//
// WHAT THIS IS. The /math page explains 88 formulas, and many are made concrete
// by constants that live in PYTHON ON THE VM. This box — ghost@Ghost, WSL —
// cannot read the VM at request time, so these are MIRRORED values.
//
// ✅ PROVENANCE IS NOW A REAL COMMIT. [B2] could not honour the '56e4f90' stamp
// its prompt specified: the only copy reachable from this box was a 46-day-old
// scratch snapshot with a broken .git, so it stamped what it had actually read
// rather than fabricating a commit. That was the right call. C1 re-read every
// symbol below from the LIVE VM source over the read-only `ssh vm` pipe and
// replaced the stamp with the commit that was really at HEAD: bcbce58
// (2026-08-05T09:56:14-04:00).
//
// 🚨 THE STAMP IS NOT '56e4f90'. That was HEAD when the Wave-A recon ran; the VM
// has moved since. Where the RM-MATH master spec quotes a value, THE MIRROR WINS
// — D1-D6 must transcribe from here, not from the report.
//
// 🚨 THE SCRATCH SNAPSHOT WAS NOT MERELY OLD, IT WAS WRONG IN FIVE PLACES.
// S1_BREAKEVEN_ARM_R was mirrored as 0.25 and is 0.15 (the old mirror had copied
// the stale COMMENT, not the literal); STALE_TRADE_MINUTES and TIMEOUT_MINUTES
// were 120 and are 75; TICKER_TIMEOUTS and TICKER_STALE_MINUTES were all-120 and
// are all-75. Every one of those would have taught Ghost something false.
//
// 🚨 GENERATED FROM AN AST PARSE, NOT TYPED BY HAND. Values were extracted with
// ast.literal_eval over source pulled from the VM and sha256-verified against it.
// Derived entries (e.g. HL_FEE_ROUNDTRIP_TAKER = HL_FEE_TAKER * 2) are computed
// from the extracted literals, never keyed in.
//
// 🚨 READ THE LITERAL, NEVER THE COMMENT. Five comments in this codebase
// contradict the code beside them; each is recorded as `staleComment` on its own
// entry so the page can show the truth without the reader tripping on the prose.
//
// 🚨 THE MIRROR NEVER WINS. Where a constant also exists as an `auto_config` row,
// THE LIVE ROW IS AUTHORITATIVE and the mirror is demoted to (a) a fallback and
// (b) a drift detector. See `liveKey` and the comparison in math-values.ts.
//
// 🚨 `source` IS `module.symbol`, NEVER A LINE NUMBER. Several of these modules
// are known drifters; a line number would rot within days of being written.

export interface MirroredConstant {
  /** The mirrored literal, stringified. */
  value: string;
  /** `module.symbol` — never a line number. */
  source: string;
  /**
   * The `auto_config` key that SUPERSEDES this mirror when present. Set only
   * where the live row means the SAME THING as the Python symbol — a same-named
   * key with different semantics is not a drift pair and would raise a false
   * alarm (see RECALIBRATED_THRESHOLDS_V2_TABLE for exactly that trap).
   */
  liveKey?: string;
  /**
   * Set where a comment in the source CONTRADICTS the literal beside it. The
   * page renders this so a reader who later opens the Python is not misled by
   * prose the code outgrew. The literal always wins.
   */
  staleComment?: string;
  /**
   * True where the constant is real, readable, and DECIDES NOTHING on the live
   * path. A dead constant is mirrored so the page can name it as dead — it must
   * never be servable as an active gate.
   */
  dead?: boolean;
  /** Anything a reader needs in order not to misread the value. */
  note?: string;
}

/**
 * 🚨 ONE STAMP PER RESEED, not 80 independent stamps. Every entry below was read
 * in a single pass from this commit; a per-entry stamp would imply a per-entry
 * read that never happened.
 */
export const MIRRORED_FROM = "bcbce58";
export const MIRRORED_AT = "2026-08-05";
/** Author date of bcbce58, for the page's provenance line. */
export const MIRRORED_COMMIT_DATE = "2026-08-05T09:56:14-04:00";

export const MATH_CONSTANTS: Record<string, MirroredConstant> = {
  PER_TICKER_THRESHOLDS_ENABLED: {
    value: "true",
    source: "ticker_thresholds.PER_TICKER_THRESHOLDS_ENABLED",
  },
  "TICKER_THRESHOLDS.BTC": {
    value: "{\"quiet\":34.0,\"normal\":37.0,\"active\":40.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.ETH": {
    value: "{\"quiet\":36.0,\"normal\":39.0,\"active\":42.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.SOL": {
    value: "{\"quiet\":38.0,\"normal\":41.0,\"active\":44.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.HYPE": {
    value: "{\"quiet\":39.0,\"normal\":42.0,\"active\":45.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.FARTCOIN": {
    value: "{\"quiet\":42.0,\"normal\":45.0,\"active\":48.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.XRP": {
    value: "{\"quiet\":38.0,\"normal\":41.0,\"active\":44.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.DOGE": {
    value: "{\"quiet\":42.0,\"normal\":45.0,\"active\":48.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.NEAR": {
    value: "{\"quiet\":39.0,\"normal\":42.0,\"active\":45.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.SUI": {
    value: "{\"quiet\":39.0,\"normal\":42.0,\"active\":45.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  "TICKER_THRESHOLDS.kPEPE": {
    value: "{\"quiet\":42.0,\"normal\":45.0,\"active\":48.0}",
    source: "ticker_thresholds.TICKER_THRESHOLDS",
  },
  DIRECTION_PENALTIES: {
    value: "{\"BTC\":3.0,\"ETH\":4.0,\"SOL\":5.0,\"HYPE\":6.0,\"FARTCOIN\":8.0,\"XRP\":5.0,\"DOGE\":8.0,\"NEAR\":6.0,\"SUI\":6.0,\"kPEPE\":8.0}",
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
    value: "[\"TRENDING\"]",
    source: "ticker_thresholds.ACTIVE_REGIMES",
    note:
      "Stored as a frozenset in Python; mirrored as an array.",
  },
  RECALIBRATED_THRESHOLDS_V2_TABLE: {
    value: "{\"BTC\":{\"quiet\":51.0,\"normal\":54.0,\"active\":57.0},\"ETH\":{\"quiet\":53.0,\"normal\":56.0,\"active\":59.0},\"SOL\":{\"quiet\":53.0,\"normal\":56.0,\"active\":59.0},\"HYPE\":{\"quiet\":39.0,\"normal\":42.0,\"active\":45.0},\"FARTCOIN\":{\"quiet\":42.0,\"normal\":45.0,\"active\":48.0}}",
    source: "ticker_thresholds.RECALIBRATED_THRESHOLDS_V2",
    note:
      "\ud83d\udea8 NO liveKey DELIBERATELY. auto_config has a key spelled exactly RECALIBRATED_THRESHOLDS_V2, but it is a BOOLEAN FLAG switching the table on, whereas this symbol is the TABLE ITSELF. Same name, different meaning \u2014 wiring them as a drift pair would report a permanent false drift.",
  },
  PRODUCTION_WEIGHTS: {
    value: "{\"momentum\":1.35,\"trend\":1.35,\"volume\":1.3,\"volatility\":0.5,\"microstructure\":0.5}",
    source: "scalp_engine.PRODUCTION_WEIGHTS",
    staleComment:
      "The module header says sum=5.0 is what makes a max-score signal 'hit exactly 500'. It does not: analyze_scalp_v2 clamps the composite to [0, 100] (`total = max(0, min(100, total))`), as the header's own next sentence concedes. The composite maximum is 100.",
    note:
      "Sums to exactly 5.0 \u2014 verified at reseed. scalp_engine._validate_weight_sum asserts this at import with tolerance 1e-6 and raises ValueError otherwise.",
  },
  WEIGHT_SUM_TARGET: {
    value: "5.0",
    source: "scalp_engine._validate_weight_sum",
    note:
      "The invariant the validator enforces at import time.",
  },
  WEIGHT_SUM_TOLERANCE: {
    value: "1e-06",
    source: "scalp_engine._validate_weight_sum",
    note:
      "abs(sum - 5.0) > 1e-6 raises ValueError.",
  },
  OPTIMIZED_WEIGHTS_V2: {
    value: "{\"momentum\":1.35,\"trend\":1.35,\"volume\":1.3,\"volatility\":0.5,\"microstructure\":0.5}",
    source: "scalp_engine.OPTIMIZED_WEIGHTS_V2",
    note:
      "Currently EQUAL to PRODUCTION_WEIGHTS \u2014 the V2 slot is infrastructure, not a different weighting. Gated by auto_config.GROUP_WEIGHTS_V2 (DEFAULTS 'false'); GROUP_WEIGHTS_V2_VALUES can override it as a CSV without a code edit.",
  },
  GROUP_NAMES: {
    value: "[\"momentum\",\"trend\",\"volume\",\"volatility\",\"microstructure\"]",
    source: "scalp_engine._GROUP_NAMES",
    note:
      "Iteration order is load-bearing: it pins the CSV format of auto_config.GROUP_WEIGHTS_V2_VALUES.",
  },
  TALIB_PERIODS: {
    value: "{\"RSI\":14,\"ATR\":14,\"ADX\":14,\"EMA_fast\":9,\"EMA_slow\":21,\"BB_period\":20,\"BB_nbdev\":2,\"MACD_fast\":12,\"MACD_slow\":26,\"MACD_signal\":9,\"VOL_SMA\":20,\"VOL_STDDEV\":20,\"STOCHRSI_period\":14,\"STOCHRSI_fastk\":3,\"STOCHRSI_fastd\":3}",
    source: "scalp_engine (talib call sites)",
    note:
      "\ud83d\udea8 These are INLINE ARGUMENTS at the talib call sites, not named module constants \u2014 there is no symbol to cite. Read directly from the talib.RSI/ATR/ADX/EMA/BBANDS/MACD/SMA/STDDEV/STOCHRSI calls in scalp_engine.",
  },
  ADAPTIVE_THRESHOLD_BY_REGIME: {
    value: "{\"TRENDING\":{\"threshold\":25,\"required_groups\":2,\"must_include\":[\"trend\"]},\"RANGING\":{\"threshold\":40,\"required_groups\":3,\"must_include\":[\"volume\"]},\"VOLATILE\":{\"threshold\":35,\"required_groups\":3,\"must_include\":[\"trend\"]},\"EXTREME_volatility_bonus\":10}",
    source: "scalp_engine.get_adaptive_threshold",
    note:
      "VOLATILE is the else-branch, so it is also the value for any unrecognised regime. +10 is added when volatility_state == 'EXTREME'.",
  },
  GROUP_FIRED_FLOOR: {
    value: "6",
    source: "scalp_engine (group scorers)",
    note:
      "A confluence group counts as fired at `pts >= 6`, applied identically at every group scorer. An inline literal, not a named constant.",
  },
  N_STATES: {
    value: "4",
    source: "hmm_regime.N_STATES",
  },
  STATE_LABELS: {
    value: "[\"TRENDING_BULL\",\"TRENDING_BEAR\",\"VOLATILE\",\"RANGING\"]",
    source: "hmm_regime.STATE_LABELS",
  },
  FEATURE_NAMES: {
    value: "[\"adx\",\"dm_ratio\",\"bb_width_pctile\",\"atr_pct\",\"vol_ratio\",\"rsi_dist\"]",
    source: "hmm_regime.FEATURE_NAMES",
  },
  N_FEATURES: {
    value: "6",
    source: "hmm_regime.N_FEATURES",
    note:
      "Defined as len(FEATURE_NAMES); mirrored as the resolved integer.",
  },
  MIN_HMM_PROB: {
    value: "0.5",
    source: "regime_source.MIN_HMM_PROB",
  },
  STALE_AFTER_SEC: {
    value: "900",
    source: "regime_source.STALE_AFTER_SEC",
    note:
      "Written as `15 * 60`; mirrored as the resolved seconds.",
  },
  FALLBACK_REGIME: {
    value: "NORMAL",
    source: "regime_source.FALLBACK_REGIME",
  },
  HMM_TO_RULES: {
    value: "{\"TRENDING_BULL\":\"TRENDING\",\"TRENDING_BEAR\":\"TRENDING\",\"VOLATILE\":\"VOLATILE\",\"RANGING\":\"RANGING\"}",
    source: "regime_source.HMM_TO_RULES",
    note:
      "Collapses the 4 HMM states onto the 3 rules-engine regimes \u2014 both TRENDING_BULL and TRENDING_BEAR map to TRENDING.",
  },
  REGIME_THRESHOLDS: {
    value: "{\"TRENDING\":42,\"VOLATILE\":50,\"RANGING\":60,\"EXTREME_VOLATILE\":80}",
    source: "signal_guard.REGIME_THRESHOLDS",
    dead: true,
    note:
      "\ud83d\udea8 DEAD ON THE LIVE PATH. discord_bot overwrites every key of signal_guard.REGIME_THRESHOLDS in place before calling should_post_signal and restores them in a `finally`, so these four numbers decide nothing. They are mirrored ONLY so the page can render them as a documented dead constant. They must NEVER be servable as 'the gate'.",
  },
  BASE_THRESHOLD: {
    value: "65",
    source: "signal_guard.BASE_THRESHOLD",
    dead: true,
    note:
      "\ud83d\udea8 DEAD ON THE LIVE PATH. discord_bot overwrites every key of signal_guard.REGIME_THRESHOLDS in place before calling should_post_signal and restores them in a `finally`, so these four numbers decide nothing. They are mirrored ONLY so the page can render them as a documented dead constant. They must NEVER be servable as 'the gate'.",
  },
  PRICE_PROXIMITY_THRESHOLD: {
    value: "0.005",
    source: "signal_guard.PRICE_PROXIMITY_THRESHOLD",
  },
  COOLDOWN_SECONDS: {
    value: "3600",
    source: "signal_guard.COOLDOWN_SECONDS",
    liveKey: "COOLDOWN_WINDOW_SECONDS",
    note:
      "FALLBACK ONLY \u2014 the live window comes from auto_config.COOLDOWN_WINDOW_SECONDS (DEFAULTS '900'). A bad or missing value fail-safes to this 3600.",
  },
  COOLDOWN_WINDOW_FLOOR: {
    value: "60",
    source: "signal_guard.COOLDOWN_WINDOW_FLOOR",
    note:
      "Hard floor on the config-driven cooldown window, in seconds.",
  },
  _ATR_MIN_SAMPLES: {
    value: "50",
    source: "discord_bot._ATR_MIN_SAMPLES",
  },
  PERSISTENCE_WINDOW_SECONDS: {
    value: "540",
    source: "discord_bot._run_scalp_scan",
    note:
      "Function-local inside _run_scalp_scan, not a module constant. ~9 minutes \u2248 3 scan cycles.",
  },
  TREND_FLOOR_FAIL_OPEN_POINTS: {
    value: "20",
    source: "discord_bot._run_scalp_scan",
    note:
      "\ud83d\udea8 FAIL-OPEN. When signal.raw['groups_fired']['trend']['points'] is missing, the trend score defaults to 20 \u2014 the TOP of the 0-20 group scale \u2014 so an absent payload can never block a signal. The floor it is compared against is auto_config.TREND_FLOOR_V2_VALUE (DEFAULTS '6'), gated by TREND_FLOOR_V2_ENABLED (DEFAULTS 'false').",
  },
  CALIBRATOR_DELTA_CAP_ON: {
    value: "2.0",
    source: "confidence_calibrator.cap_applied_delta",
    note:
      "|delta| clamp when the cap is enabled.",
  },
  CALIBRATOR_DELTA_CAP_OFF: {
    value: "20.0",
    source: "confidence_calibrator.cap_applied_delta",
    note:
      "Legacy |delta| clamp when the cap is disabled \u2014 byte-identical prior behaviour. The applied confidence is then clamped to [0, 100] either way.",
  },
  MARGIN_MODE: {
    value: "isolated",
    source: "auto_trader.config.MARGIN_MODE",
  },
  DEFAULT_LEVERAGE: {
    value: "5",
    source: "auto_trader.config.DEFAULT_LEVERAGE",
  },
  DISCOVERY_TICKER_LEVERAGE: {
    value: "5.0",
    source: "auto_trader.config.DISCOVERY_TICKER_LEVERAGE",
  },
  SIZE_MIN_USD: {
    value: "5.0",
    source: "auto_trader.config.SIZE_MIN_USD",
  },
  SIZE_MAX_USD: {
    value: "15.0",
    source: "auto_trader.config.SIZE_MAX_USD",
  },
  CONFIDENCE_FLOOR: {
    value: "35",
    source: "auto_trader.config.CONFIDENCE_FLOOR",
  },
  CONFIDENCE_CEILING: {
    value: "56",
    source: "auto_trader.config.CONFIDENCE_CEILING",
  },
  HARD_STOP_PCT: {
    value: "10.0",
    source: "auto_trader.config.HARD_STOP_PCT",
  },
  TRAIL_ACTIVATION_R: {
    value: "0.5",
    source: "auto_trader.config.TRAIL_ACTIVATION_R",
  },
  TRAIL_ATR_MULTIPLIER: {
    value: "2.0",
    source: "auto_trader.config.TRAIL_ATR_MULTIPLIER",
  },
  TRAIL_MIN_PCT: {
    value: "0.015",
    source: "auto_trader.config.TRAIL_MIN_PCT",
  },
  TRAIL_TIGHTEN_AT_2R: {
    value: "true",
    source: "auto_trader.config.TRAIL_TIGHTEN_AT_2R",
  },
  ATR_TRAIL_PERIOD: {
    value: "10",
    source: "auto_trader.config.ATR_TRAIL_PERIOD",
    staleComment:
      "\ud83d\udea8 THE PERIOD IS 10, AND A PARAMETER NAME SAYS 14. auto_trader/monitor.py passes this ATR through a keyword argument literally named `atr_14=` (`_calc_tgt(..., atr_14=current_atr)`). The argument name is a leftover from when the period was 14; the period actually in force is 10. Trust this constant, never the parameter name.",
  },
  BREAKEVEN_ACTIVATION_R: {
    value: "0.5",
    source: "auto_trader.config.BREAKEVEN_ACTIVATION_R",
  },
  BREAKEVEN_BUFFER_PCT: {
    value: "0.003",
    source: "auto_trader.config.BREAKEVEN_BUFFER_PCT",
  },
  S1_BREAKEVEN_ARM_R: {
    value: "0.15",
    source: "auto_trader.config.S1_BREAKEVEN_ARM_R",
    staleComment:
      "\ud83d\udea8 THE COMMENT ABOVE THIS LINE SAYS 0.25R AND THE LITERAL IS 0.15. The rationale block reads '0.25R aligns with S1-P01's first partial rung', which was true of an earlier value. The arming point in force is 0.15R. (The previous mirror carried the COMMENT's 0.25 \u2014 this reseed corrects it.)",
  },
  S1_RATCHET_LADDER: {
    value: "[[0.5,\"be\"],[0.75,0.25],[1.0,0.5]]",
    source: "auto_trader.config.S1_RATCHET_LADDER",
    note:
      "Rungs are [R_multiple, action]; 'be' moves the stop to breakeven, a float is the locked fraction of R.",
  },
  PARTIAL_EXIT_ENABLED: {
    value: "true",
    source: "auto_trader.config.PARTIAL_EXIT_ENABLED",
  },
  PARTIAL_EXIT_SCHEDULE: {
    value: "[[0.75,0.33],[1.5,0.5]]",
    source: "auto_trader.config.PARTIAL_EXIT_SCHEDULE",
  },
  S1_PARTIAL_SCHEDULE: {
    value: "[[0.25,0.4],[0.5,0.5833]]",
    source: "auto_trader.config.S1_PARTIAL_SCHEDULE",
    note:
      "Fractions are OF REMAINING, not of original: rung 1 banks 40% of original, rung 2 banks 35% of original (0.35/0.60 = 0.5833 of the 60% left), runner = 25% of original.",
  },
  PARTIAL_EXIT_MIN_USD: {
    value: "3.0",
    source: "auto_trader.config.PARTIAL_EXIT_MIN_USD",
  },
  FEE_RATE_BPS: {
    value: "9",
    source: "auto_trader.config.FEE_RATE_BPS",
  },
  HL_FEE_TAKER: {
    value: "0.00045",
    source: "auto_trader.config.HL_FEE_TAKER",
    note:
      "4.5 bps \u2014 userCrossRate (aggressive/market entry).",
  },
  HL_FEE_MAKER: {
    value: "0.00015",
    source: "auto_trader.config.HL_FEE_MAKER",
    note:
      "1.5 bps \u2014 userAddRate (passive/ALO exit).",
  },
  HL_FEE_ROUNDTRIP_TAKER: {
    value: "0.0009",
    source: "auto_trader.config.HL_FEE_ROUNDTRIP_TAKER",
    note:
      "Defined as HL_FEE_TAKER * 2.",
  },
  HL_FEE_ROUNDTRIP_MAKER: {
    value: "0.0003",
    source: "auto_trader.config.HL_FEE_ROUNDTRIP_MAKER",
    note:
      "Defined as HL_FEE_MAKER * 2.",
  },
  HL_FEE_ENTRY_TAKER_EXIT_MAKER: {
    value: "0.0006",
    source: "auto_trader.config.HL_FEE_ENTRY_TAKER_EXIT_MAKER",
    note:
      "Defined as HL_FEE_TAKER + HL_FEE_MAKER = 6 bps. The realistic scalp round-trip: taker in, maker (ALO) out.",
  },
  MIN_PROFIT_TARGET_FLOOR_MULT: {
    value: "3.0",
    source: "auto_trader.config.MIN_PROFIT_TARGET_FLOOR_MULT",
  },
  MIN_PROFIT_TARGET_FLOOR_PCT: {
    value: "0.0018",
    source: "auto_trader.config.MIN_PROFIT_TARGET_FLOOR_PCT",
    note:
      "Defined as HL_FEE_ENTRY_TAKER_EXIT_MAKER * MIN_PROFIT_TARGET_FLOOR_MULT = 18 bps.",
  },
  HL_MAKER_FEE_RATE: {
    value: "0.00015",
    source: "auto_trader.fees.HL_MAKER_FEE_RATE",
    note:
      "Second copy of the same fact as auto_trader.config.HL_FEE_MAKER, in a different module.",
  },
  HL_TAKER_FEE_RATE: {
    value: "0.00045",
    source: "auto_trader.fees.HL_TAKER_FEE_RATE",
    note:
      "Second copy of the same fact as auto_trader.config.HL_FEE_TAKER, in a different module.",
  },
  PARTIAL_EXIT_FEE_RATE_TAKER: {
    value: "0.00045",
    source: "auto_trader.fees.PARTIAL_EXIT_FEE_RATE_TAKER",
    note:
      "Aliased to HL_TAKER_FEE_RATE. Taker-only is deliberate: partial exits use reduce_only MARKET orders, never post-only.",
  },
  _MAKER_FILL_PATHS: {
    value: "[\"alo\",\"maker\"]",
    source: "auto_trader.fees._MAKER_FILL_PATHS",
    note:
      "frozenset in Python. Only a CONFIRMED post-only fill ('alo') or a confirmed maker partial ('maker') is billed at the maker rate.",
  },
  MAKER_FEE_BPS: {
    value: "1.5",
    source: "auto_trader.executor.MAKER_FEE_BPS",
    note:
      "Not currently consumed \u2014 aggressive flow is all taker.",
  },
  TAKER_FEE_BPS: {
    value: "4.5",
    source: "auto_trader.executor.TAKER_FEE_BPS",
  },
  ROUND_TRIP_BPS: {
    value: "9.0",
    source: "auto_trader.executor.ROUND_TRIP_BPS",
    note:
      "Defined as TAKER_FEE_BPS * 2.",
  },
  FALLBACK_SLIPPAGE_BPS: {
    value: "{\"BTC\":4.7,\"ETH\":6.0,\"SOL\":7.4,\"HYPE\":8.2,\"FARTCOIN\":12.6,\"NEAR\":14.0,\"SUI\":7.7,\"DOGE\":5.9,\"XRP\":5.2,\"KPEPE\":6.3}",
    source: "auto_trader.executor.FALLBACK_SLIPPAGE_BPS",
    note:
      "\ud83d\udea8 PAPER-FILL AND COST-REPORTING ONLY. The live path (live_executor) does NOT consume these. Per-ticker realized-slippage means.",
  },
  DEFAULT_SLIPPAGE_BPS: {
    value: "9.0",
    source: "auto_trader.executor.DEFAULT_SLIPPAGE_BPS",
    note:
      "Applied to tickers absent from FALLBACK_SLIPPAGE_BPS. Paper-fill only.",
  },
  TECH_EXIT_ENABLED: {
    value: "true",
    source: "auto_trader.config.TECH_EXIT_ENABLED",
  },
  RSI_EXIT_OVERBOUGHT: {
    value: "78",
    source: "auto_trader.config.RSI_EXIT_OVERBOUGHT",
  },
  RSI_EXIT_OVERSOLD: {
    value: "22",
    source: "auto_trader.config.RSI_EXIT_OVERSOLD",
  },
  MOMENTUM_FADE_LOOKBACK: {
    value: "5",
    source: "auto_trader.config.MOMENTUM_FADE_LOOKBACK",
  },
  MOMENTUM_FADE_THRESHOLD: {
    value: "3",
    source: "auto_trader.config.MOMENTUM_FADE_THRESHOLD",
  },
  EXIT_THRESHOLD: {
    value: "40",
    source: "auto_trader.config.EXIT_THRESHOLD",
  },
  TIMEOUT_MINUTES: {
    value: "75",
    source: "auto_trader.config.TIMEOUT_MINUTES",
    staleComment:
      "The comment beside this line says 'STALE_TRADE_MINUTES stays at 120'. It does not \u2014 STALE_TRADE_MINUTES is also 75. Both were cut 120 -> 75 by G3-STALE-75M (2026-06-29) and the comment was not updated.",
  },
  STALE_TRADE_MINUTES: {
    value: "75",
    source: "auto_trader.config.STALE_TRADE_MINUTES",
    note:
      "Cut 120 -> 75 by G3-STALE-75M (2026-06-29). The previous mirror still said 120.",
  },
  STALE_TRADE_EXIT_ENABLED: {
    value: "true",
    source: "auto_trader.config.STALE_TRADE_EXIT_ENABLED",
  },
  AUTO_CONFIG_CACHE_ENABLED: {
    value: "true",
    source: "auto_trader.config.AUTO_CONFIG_CACHE_ENABLED",
  },
  EQUITY_MA_PERIOD: {
    value: "20",
    source: "auto_trader.config.DEFAULTS",
    liveKey: "EQUITY_MA_PERIOD",
    note:
      "A real drift pair \u2014 same symbol, same meaning, live row wins.",
  },
  HL_MAX_LEVERAGE_MAP: {
    value: "{\"BTC\":{\"max_leverage\":40,\"sz_decimals\":5},\"ETH\":{\"max_leverage\":25,\"sz_decimals\":4},\"SOL\":{\"max_leverage\":20,\"sz_decimals\":2},\"HYPE\":{\"max_leverage\":10,\"sz_decimals\":2},\"FARTCOIN\":{\"max_leverage\":10,\"sz_decimals\":1},\"XRP\":{\"max_leverage\":20,\"sz_decimals\":0},\"DOGE\":{\"max_leverage\":10,\"sz_decimals\":0},\"NEAR\":{\"max_leverage\":10,\"sz_decimals\":1},\"SUI\":{\"max_leverage\":10,\"sz_decimals\":1},\"kPEPE\":{\"max_leverage\":10,\"sz_decimals\":0}}",
    source: "auto_trader.config.HL_MAX_LEVERAGE_MAP",
    note:
      "\ud83d\udea8 The VENUE CEILING, not the runtime risk leverage. Always >= the per-ticker runtime leverage. Carries szDecimals per asset as a second field.",
  },
  ATR_TRAIL_MULTIPLIERS: {
    value: "{\"TRENDING_BULL\":1.5,\"TRENDING_BEAR\":1.5,\"VOLATILE\":3.0,\"RANGING\":2.5,\"NORMAL\":2.0}",
    source: "auto_trader.exit_helpers.ATR_TRAIL_MULTIPLIERS",
  },
  TICKER_ATR_ADJUSTMENT: {
    value: "{\"BTC\":0.0,\"ETH\":0.0,\"SOL\":0.2,\"HYPE\":0.3,\"FARTCOIN\":0.5}",
    source: "auto_trader.exit_helpers.TICKER_ATR_ADJUSTMENT",
  },
  CHANDELIER_MULTIPLIER: {
    value: "3.0",
    source: "auto_trader.exit_helpers.CHANDELIER_MULTIPLIER",
  },
  TICKER_TRAIL_FLOORS_V3: {
    value: "{\"BTC\":0.003,\"ETH\":0.003,\"SOL\":0.003,\"HYPE\":0.005,\"FARTCOIN\":0.007}",
    source: "auto_trader.exit_helpers.TICKER_TRAIL_FLOORS_V3",
  },
  TICKER_TRAIL_FLOORS: {
    value: "{\"BTC\":0.015,\"ETH\":0.015,\"SOL\":0.015,\"HYPE\":0.02,\"FARTCOIN\":0.025}",
    source: "auto_trader.exit_helpers.TICKER_TRAIL_FLOORS",
  },
  TICKER_HARD_STOP_PCT: {
    value: "{\"BTC\":10.0,\"ETH\":10.0,\"SOL\":10.0,\"HYPE\":10.0,\"FARTCOIN\":10.0}",
    source: "auto_trader.exit_helpers.TICKER_HARD_STOP_PCT",
  },
  TICKER_PARTIAL_SCHEDULES: {
    value: "{\"BTC\":[[0.75,0.33],[1.5,0.5]],\"ETH\":[[0.75,0.33],[1.5,0.5]],\"SOL\":[[0.75,0.33],[1.5,0.5]],\"HYPE\":[[0.75,0.33],[1.5,0.5]],\"FARTCOIN\":[[0.75,0.33],[1.5,0.5]]}",
    source: "auto_trader.exit_helpers.TICKER_PARTIAL_SCHEDULES",
  },
  ATR_BAND_THRESHOLDS: {
    value: "{\"major\":[0.0015,0.004],\"mid\":[0.0025,0.006],\"memecoin\":[0.004,0.01],\"default\":[0.0025,0.006]}",
    source: "auto_trader.exit_helpers.ATR_BAND_THRESHOLDS",
  },
  ATR_BAND_MULTIPLIERS: {
    value: "{\"low\":1.0,\"normal\":1.5,\"high\":2.0}",
    source: "auto_trader.exit_helpers.ATR_BAND_MULTIPLIERS",
  },
  PROFIT_STEP_START_R: {
    value: "0.5",
    source: "auto_trader.exit_helpers.PROFIT_STEP_START_R",
  },
  PROFIT_STEP_FULL_R: {
    value: "2.0",
    source: "auto_trader.exit_helpers.PROFIT_STEP_FULL_R",
  },
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
  TICKER_TIMEOUTS: {
    value: "{\"BTC\":75,\"ETH\":75,\"SOL\":75,\"HYPE\":75,\"FARTCOIN\":75}",
    source: "auto_trader.exit_helpers.TICKER_TIMEOUTS",
    note:
      "All five are 75, tracking the 120 -> 75 cut. The previous mirror said 120.",
  },
  TICKER_STALE_MINUTES: {
    value: "{\"BTC\":75,\"ETH\":75,\"SOL\":75,\"HYPE\":75,\"FARTCOIN\":75}",
    source: "auto_trader.exit_helpers.TICKER_STALE_MINUTES",
    note:
      "All five are 75, tracking the 120 -> 75 cut. The previous mirror said 120.",
  },
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
  SLEEVES: {
    value: "[{\"name\":\"scalp\",\"enabled_at_level\":1,\"mode\":\"LIVE\",\"tickers\":[\"BTC\",\"ETH\",\"SOL\",\"HYPE\",\"ZEC\"],\"horizon\":{\"min_minutes\":1,\"max_minutes\":60},\"size_band\":{\"min_frac\":0.05,\"max_frac\":0.3},\"lmax_fraction\":0.5,\"ladder_floor\":1.0,\"stop_pct\":8.0,\"direction\":\"BOTH\",\"hedge_eligible\":true},{\"name\":\"short_hold\",\"enabled_at_level\":1,\"mode\":\"LIVE\",\"tickers\":[\"BTC\",\"ETH\",\"SOL\",\"HYPE\",\"ZEC\"],\"horizon\":{\"min_minutes\":60,\"max_minutes\":360},\"size_band\":{\"min_frac\":0.05,\"max_frac\":0.3},\"lmax_fraction\":0.4,\"ladder_floor\":1.0,\"stop_pct\":8.0,\"direction\":\"BOTH\",\"hedge_eligible\":true},{\"name\":\"intraday_24h\",\"enabled_at_level\":1,\"mode\":\"LIVE\",\"tickers\":[\"BTC\",\"ETH\",\"SOL\",\"HYPE\",\"ZEC\",\"PAXG\",\"XMR\"],\"horizon\":{\"min_minutes\":360,\"max_minutes\":1440},\"size_band\":{\"min_frac\":0.1,\"max_frac\":0.4},\"lmax_fraction\":0.3,\"ladder_floor\":1.0,\"stop_pct\":10.0,\"direction\":\"BOTH\",\"hedge_eligible\":true},{\"name\":\"multiday_week\",\"enabled_at_level\":1,\"mode\":\"SHADOW\",\"tickers\":[\"BTC\",\"ETH\",\"SOL\",\"HYPE\",\"ZEC\",\"PAXG\",\"XMR\"],\"horizon\":{\"min_minutes\":1440,\"max_minutes\":10080},\"size_band\":{\"min_frac\":0.1,\"max_frac\":0.5},\"lmax_fraction\":0.2,\"ladder_floor\":1.0,\"stop_pct\":12.0,\"direction\":\"BOTH\",\"hedge_eligible\":true}]",
    source: "auto_trader.sleeves.SLEEVES",
    staleComment:
      "\ud83d\udea8 THE DOCSTRINGS SAY THIS REGISTRY IS EMPTY. IT HOLDS FOUR SLEEVES. The module docstring states 'The SLEEVES registry is intentionally EMPTY here \u2014 R6/B1 populates it', and active_sleeves() adds 'Empty until B1 populates SLEEVES (returns () at any level for now)'. B1 populated it; neither docstring was updated. Read the tuple, not the prose.",
    note:
      "Four sleeves, all enabled_at_level=1. Three are mode=LIVE and multiday_week is mode=SHADOW. Every parameter is a NEUTRAL-NULL structural default, not a tuned strategy \u2014 the trainer sets the numbers post-cutover. Horizon->leverage and horizon->stop coupling is the enforced structure.",
  },
  CASCADE_LMAX: {
    value: "{\"BTC\":5.85,\"PAXG\":4.24,\"ETH\":3.71,\"HYPE\":3.61,\"XMR\":2.55,\"SOL\":2.33,\"ZEC\":2.16,\"NEAR\":2.09,\"XRP\":1.72,\"DOGE\":1.52,\"kPEPE\":1.44,\"SUI\":1.21,\"FARTCOIN\":1.16}",
    source: "auto_trader.sleeves.CASCADE_LMAX",
    note:
      "\ud83d\udea8 THIRTEEN tickers, not ten. PAXG, XMR and ZEC are NOT in the tradeable sacred-10 universe \u2014 they are portfolio diversifiers/liquidity names carried for the sleeve layer. First-order liquidation ceilings, masked-wick-corrected, worst daily open->low excursion. SUI (1.21) and FARTCOIN (1.16) are the two thin-history names and are deliberately the most conservative; thin history is a reason for caution, not to relax them. Any change is a separate gated decision.",
  },
  VENUE_MAX: {
    value: "{\"BTC\":40.0,\"PAXG\":10.0,\"ETH\":25.0,\"HYPE\":10.0,\"XMR\":5.0,\"SOL\":20.0,\"ZEC\":10.0,\"NEAR\":10.0,\"XRP\":20.0,\"DOGE\":10.0,\"kPEPE\":10.0,\"SUI\":10.0,\"FARTCOIN\":10.0}",
    source: "auto_trader.sleeves.venue_max",
    note:
      "Exchange leverage caps. Above cascade Lmax for every name, so CASCADE_LMAX is the binding bound and venue_max is the outer clamp guard.",
  },
  LEVERAGE_LADDER_FLOOR: {
    value: "1.0",
    source: "auto_trader.sleeves.LeverageLadder",
    note:
      "Dataclass field default \u2014 the minimum leverage a sleeve will use. All four registry sleeves take this default explicitly.",
  },
  SLEEVE_COUPLING_INVARIANT: {
    value: "across sleeves ordered by ascending horizon: lmax_fraction NON-INCREASING AND stop_pct NON-DECREASING",
    source: "auto_trader.sleeves.validate_sleeve_coupling",
    note:
      "Structural, not tuned. A longer hold spans more independent cascade windows, so it must ride lower leverage and a wider stop. Raises CouplingViolation on the first offending adjacent pair; an empty or singleton sequence trivially holds.",
  },
  EFFECTIVE_LEV_FORMULA: {
    value: "max(floor, min(lmax_fraction * CASCADE_LMAX[ticker], venue_max[ticker]))",
    source: "auto_trader.sleeves.effective_lev",
    note:
      "The survival invariant. The ladder can only cap DOWN \u2014 it can never raise leverage above the ticker's cascade Lmax.",
  },
  _CONSERVATIVE_LMAX_FRACTION: {
    value: "0.5",
    source: "auto_trader.live_executor._CONSERVATIVE_LMAX_FRACTION",
    note:
      "\ud83d\udea8 THE TAIL-CAP FRACTION ACTUALLY IN FORCE, and previously missing from this mirror entirely. The scalp-sleeve wall applied until RF-2 supplies a resolved sleeve fraction. Idempotent: a later portfolio wire re-applying the cap is a min(), so it is a no-op or a further tighten, never a double-clamp and never a bypass.",
  },
  LEVERAGE_MIN_DEFAULT: {
    value: "2",
    source: "auto_trader.dynamic_leverage.LEVERAGE_MIN_DEFAULT",
  },
  LEVERAGE_FALLBACK: {
    value: "5",
    source: "auto_trader.dynamic_leverage.LEVERAGE_FALLBACK",
    note:
      "Used when the stop is missing or zero. Deliberately conservative \u2014 never default high.",
  },
  RISK_DOLLARS_FALLBACK: {
    value: "0.7",
    source: "auto_trader.risk_sizing.RISK_DOLLARS_FALLBACK",
    note:
      "Fail-safe Risk$ when the live-equity read errors: 1% of a conservative $70 baseline. Deliberately small \u2014 a failed equity read must fail DOWN.",
  },
  FALLBACK_STOP_FRAC: {
    value: "0.02",
    source: "auto_trader.risk_sizing.FALLBACK_STOP_FRAC",
    note:
      "Stop-distance fraction when the signal carries no usable stop.",
  },
  HL_MIN_ORDER_USD: {
    value: "10.0",
    source: "auto_trader.risk_sizing.HL_MIN_ORDER_USD",
    note:
      "Hyperliquid minimum order notional. A risk-budget notional below this is REJECTED rather than rounded up \u2014 taking at minimum would overshoot the risk budget.",
  },
  DEPLOYMENT_CEILING_NULL: {
    value: "0.45",
    source: "auto_trader.portfolio.capital.DEPLOYMENT_CEILING_NULL",
    note:
      "The neutral-null deployment ceiling. Leans cautious deliberately: a 60-70% null would bake in aggression the trainer has not earned.",
  },
  NEUTRAL_NULL_IN_BAND_WEIGHT: {
    value: "0.5",
    source: "auto_trader.sleeve_sizing.NEUTRAL_NULL_IN_BAND_WEIGHT",
    note:
      "Band midpoint \u2014 equal-weight, no in-band tilt. The trainer moves it within [0.0, 1.0] (0.0 -> min_frac, 1.0 -> max_frac).",
  },
  DEFAULT_CLUSTERS: {
    value: "{\"MAJORS\":[\"BTC\",\"ETH\"],\"L1S\":[\"SOL\",\"NEAR\",\"SUI\"],\"MEMES\":[\"DOGE\",\"FARTCOIN\",\"KPEPE\"],\"XRP\":[\"XRP\"],\"HYPE\":[\"HYPE\"]}",
    source: "auto_trader.correlation_limits.DEFAULT_CLUSTERS",
    note:
      "Tickers are normalised (uppercased, '-PERP' stripped) before lookup, so kPEPE matches the stored KPEPE. A ticker in no cluster falls back to the UNKNOWN cluster.",
  },
  CORRELATION_UNMAPPED_CLUSTER: {
    value: "UNKNOWN",
    source: "auto_trader.correlation_limits",
    note:
      "The cluster assigned to any ticker not present in DEFAULT_CLUSTERS.",
  },
  _MOMENTUM_WEIGHTS: {
    value: "{\"rsi_trend\":0.25,\"price_vs_ema\":0.25,\"volume\":0.2,\"candle_structure\":0.15,\"profit_acceleration\":0.15}",
    source: "auto_trader.monitor._MOMENTUM_WEIGHTS",
    note:
      "Sums to exactly 1.0 \u2014 verified at reseed. Feeds calculate_momentum_score and Layer 6 of evaluate_exit_signals.",
  },
  MOMENTUM_FLOOR_BY_TICKER: {
    value: "{\"BTC\":50,\"ETH\":50,\"SOL\":52,\"HYPE\":50,\"FARTCOIN\":50}",
    source: "auto_trader.monitor.MOMENTUM_FLOOR_BY_TICKER",
    note:
      "Only SOL differs from the uniform 50. An unknown ticker falls back to the caller-supplied default, typically auto_config.MOMENTUM_EXIT_FLOOR.",
  },
  MOMENTUM_HOLD_EDGE: {
    value: "70",
    source: "auto_trader.monitor",
    note:
      "\ud83d\udea8 HARDCODED AND DELIBERATELY NOT CONFIGURABLE. composite > 70 -> HOLD. Only the EXIT/TIGHTEN boundary below it is configurable, via auto_config.MOMENTUM_EXIT_THRESHOLD_LIVE (DEFAULTS '55'). A momentum-calc exception also falls back to HOLD with score 70, so exit decisions never fail closed on an error.",
  },
};

/**
 * Constants the /math page's formulas reference but which have NO readable
 * value — not on the VM at this commit, and not in any auto_config row. They are
 * listed so the page can name them as missing instead of silently omitting a
 * term from a formula, which reads as though the term does not exist.
 *
 * 🚨 THIS LIST SHRANK BY THREE AT THE C1 RESEED. CASCADE_LMAX, the tail-cap
 * fraction (_CONSERVATIVE_LMAX_FRACTION) and the sleeve registry were here only
 * because the 2026-06-20 scratch snapshot predated or omitted them. All three
 * are now mirrored with real values. What remains is genuinely unretrievable.
 */
export const UNMIRRORED_CONSTANTS: { id: string; label: string; reason: string }[] = [
  {
    id: "CONFIDENCE_ESCALATION",
    label: "Confidence-escalation threshold",
    reason:
      "NOT A SYMBOL. Named in prose in auto_trader/config.py and discord_bot.py, and the mechanism exists (discord_bot allows a re-fire and updates the cache when confidence escalates), but no constant of this name is defined anywhere in the bot repo at bcbce58. There is no literal to mirror; the behaviour is inline in the re-fire path.",
  },
  {
    id: "sleeve_capital",
    label: "Per-sleeve capital allocation",
    reason:
      "The sleeve REGISTRY is now mirrored, but a per-sleeve capital ALLOCATION is a runtime figure the portfolio layer computes from live equity, and no auto_trades row carries a sleeve tag yet. There is no stored value to read.",
  },
];
