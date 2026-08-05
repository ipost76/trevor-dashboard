import * as React from "react";
import {
  MathSection,
  FormulaEntry,
  MATH_SECTIONS,
  type FormulaEntryProps,
} from "@/components/math";
import { MATH_CONSTANTS, MIRRORED_FROM } from "@/lib/math-constants";

/**
 * Sections 1–2 — reading the market · scoring a setup.  [D1-MATH-SCORING]
 * Formula IDs F-IND-01…19, transcribed from the RM-MATH master spec
 * (`docs/reports/recon/2026-08-04_math-page/MASTER_2026-08-04_math-page.md`, VM).
 *
 * 🚨 NOTHING HERE IS AUTHORED. Every formula, symbol gloss, explanation and
 * number traces to the master or to the constants mirror. Where the master and
 * the mirror disagree the MIRROR WINS and the disagreement is named on screen —
 * a silent pick in either direction is how a teaching page starts lying.
 *
 * 🚨 THE LaTeX IS `String.raw`, AND THAT IS LOAD-BEARING. `\text{vol\_state}`
 * must reach KaTeX with its backslash escape intact or it renders as a
 * subscripted "state" instead of the column name. A raw template preserves the
 * escape by construction; a quoted string would need `\\_` and would silently
 * degrade the first time someone "tidied" it. B1 proved the escape matters with
 * a negative control. Do not convert these to quoted strings.
 *
 * 🚨 STANDING VALUES ARE READ FROM `math-constants.ts`, NEVER RETYPED. A
 * hand-copied literal is a second copy that drifts the day the VM changes; the
 * mirror is stamped, reseeded, and drift-checked. `mirrored()` fails VISIBLY
 * rather than returning a plausible blank.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mirror access — stamped `bcbce58`, reseeded by C1-MATH-RESEED 2026-08-05
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One mirrored constant, by key.
 *
 * 🚨 An absent key renders a VISIBLE marker, never "" and never a fallback
 * literal. A blank reads as a bug and a fallback reads as a measurement; the
 * marker reads as what it is.
 */
function mirrored(key: string): string {
  return MATH_CONSTANTS[key]?.value ?? "— not in the constants mirror";
}

/** A field out of one of the mirror's JSON-valued constants. */
function mirroredField(key: string, field: string): string {
  const raw = MATH_CONSTANTS[key]?.value;
  if (!raw) return "— not in the constants mirror";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed[field];
    return v === undefined ? `— no '${field}' in ${key}` : String(v);
  } catch {
    return `— ${key} did not parse`;
  }
}

const TALIB = "TALIB_PERIODS";
/** Provenance suffix for anything sourced from the mirror rather than a live row. */
const FROM_MIRROR = `code constant, mirrored at ${MIRRORED_FROM}`;

/**
 * The five group weights, read from the mirror and formatted for display.
 * 🚨 The LIVE authority is `auto_config.GROUP_WEIGHTS_V2_VALUES`; this constant
 * is the fail-closed fallback. See F-IND-17's caveat — the two are byte-identical
 * today, which is exactly why the distinction has to be stated rather than
 * assumed away.
 */
const GROUP_WEIGHT_ROWS: { group: string; share: string; maxPts: string }[] = [
  { group: "momentum", share: "27.0%", maxPts: "27.0" },
  { group: "trend", share: "27.0%", maxPts: "27.0" },
  { group: "volume", share: "26.0%", maxPts: "26.0" },
  { group: "volatility", share: "10.0%", maxPts: "10.0" },
  {
    group: "microstructure",
    share: "10.0%",
    maxPts: "10.0 (9.0 reachable — micro caps at 18, not 20)",
  },
];

const WEIGHTS_TABLE: FormulaEntryProps["values"] = [
  ...GROUP_WEIGHT_ROWS.map((r) => ({
    label: r.group,
    value: Number(mirroredField("PRODUCTION_WEIGHTS", r.group)).toFixed(2),
    note: `${r.share} of 5.0 · max contribution ${r.maxPts} pts`,
  })),
  {
    label: "sum",
    value: Number(mirrored("WEIGHT_SUM_TARGET")).toFixed(3),
    note: "100% · max composite 100.0 (99.0 reachable)",
  },
  {
    label: "sum enforced at import to",
    value: mirrored("WEIGHT_SUM_TOLERANCE"),
    note: "scalp_engine._validate_weight_sum raises ValueError outside this tolerance",
  },
  {
    label: "live weights source",
    value: "auto_config.GROUP_WEIGHTS_V2_VALUES",
    note: "live CSV 1.35,1.35,1.30,0.50,0.50 — the authority; the constant above is the fail-closed fallback",
  },
];

/** Titles come from the pinned registry — never hardcoded here. */
function sectionTitle(n: number): string {
  return MATH_SECTIONS.find((s) => s.number === n)?.title ?? `Section ${n}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — the TA primitives (F-IND-01 … F-IND-10)
// ─────────────────────────────────────────────────────────────────────────────

const PRIMITIVES: FormulaEntryProps[] = [
  {
    id: "F-IND-01",
    name: "RSI (14)",
    status: "live",
    source:
      "scalp_engine._check_momentum (5m closes); re-computed at the tail of scalp_engine.analyze_scalp_v2 to surface `rsi` on the result dict",
    tex: String.raw`\text{RSI}_n = 100 - \frac{100}{1 + \text{RS}}, \qquad \text{RS} = \frac{\overline{\text{gain}}_n}{\overline{\text{loss}}_n}, \qquad n = 14`,
    symbols: [
      { sym: String.raw`n`, means: "Lookback, 14 bars (5-minute bars)." },
      {
        sym: String.raw`\text{gain} / \text{loss}`,
        means: "The up-moves and down-moves between consecutive closes.",
      },
      {
        sym: String.raw`\text{RS}`,
        means: "Relative strength — average gain over average loss.",
      },
      {
        sym: String.raw`\text{RSI}`,
        means:
          "The result, bounded 0–100. Low = sold off hard, high = bought up hard.",
      },
    ],
    why: "RSI answers “how one-sided has recent trading been?” on a fixed 0–100 scale, which lets a $100k asset and a sub-cent one be compared on the same axis. TREVOR does not use it as a naive “oversold = buy” trigger — that fails constantly in trends. It requires RSI to be extreme AND turning (see F-IND-11). Without the scale-free bound you would need a different threshold per ticker and per price level.",
    values: [
      {
        label: "period",
        value: mirroredField(TALIB, "RSI"),
        note: `inline talib argument \`timeperiod=14\`, not configurable — ${FROM_MIRROR}`,
      },
      {
        label: "live per-ticker RSI",
        value: "no live value available",
        note: "runtime value persisted onto the signal result as `rsi` → `trade_insights`, and carried in `CandidateSignal.market_context.rsi_14`. Trade-derived, not standing config.",
      },
    ],
    caveat:
      "Differs from textbook. TA-Lib uses Wilder smoothing (a recursive EMA-like average), not a simple mean of the last 14 gains. The two diverge materially on the first ~14×3 bars after a cold start.",
  },
  {
    id: "F-IND-02",
    name: "Stochastic RSI",
    status: "live",
    source: "scalp_engine._check_momentum — same call as F-IND-01",
    tex: String.raw`\text{StochRSI}_k = \frac{\text{RSI} - \min(\text{RSI}_n)}{\max(\text{RSI}_n) - \min(\text{RSI}_n)}, \qquad n=14,\; k_{\text{period}}=3,\; d_{\text{period}}=3`,
    symbols: [
      {
        sym: String.raw`\%K`,
        means:
          "(`fastk`) Where today's RSI sits inside its own recent 14-bar range, 0–100.",
      },
      {
        sym: String.raw`\%D`,
        means: "(`fastd`) A 3-bar smoothing of %K; the slower line.",
      },
      {
        sym: String.raw`\%K \uparrow \%D`,
        means:
          "The crossing of %K up through %D is the event TREVOR scores.",
      },
    ],
    why: "Plain RSI can sit at 35 for days without telling you anything is about to change. StochRSI re-normalises RSI against ITS OWN recent range, so it fires on the turn rather than on the level. TREVOR scores only a genuine cross — %K below 30 and crossing above %D having been at-or-below it the prior bar — which filters out the case where both lines drift together and nothing has actually reversed.",
    values: [
      {
        label: "timeperiod",
        value: mirroredField(TALIB, "STOCHRSI_period"),
        note: FROM_MIRROR,
      },
      {
        label: "fastk_period",
        value: mirroredField(TALIB, "STOCHRSI_fastk"),
        note: FROM_MIRROR,
      },
      {
        label: "fastd_period",
        value: mirroredField(TALIB, "STOCHRSI_fastd"),
        note: FROM_MIRROR,
      },
      {
        label: "cross thresholds",
        value: "30 (LONG) / 70 (SHORT)",
        note: "constants in `_check_momentum`, not configurable",
      },
    ],
  },
  {
    id: "F-IND-03",
    name: "MACD Histogram",
    status: "live",
    source: "scalp_engine._check_momentum",
    tex: String.raw`\text{MACD} = \text{EMA}_{12} - \text{EMA}_{26}, \quad \text{Signal} = \text{EMA}_9(\text{MACD}), \quad \text{Hist} = \text{MACD} - \text{Signal}`,
    symbols: [
      {
        sym: String.raw`\text{EMA}_{12}, \text{EMA}_{26}`,
        means: "Fast and slow exponential moving averages of close.",
      },
      {
        sym: String.raw`\text{Signal}`,
        means: "A 9-period EMA of the MACD line itself.",
      },
      {
        sym: String.raw`\text{Hist}`,
        means:
          "The gap between them. Sign gives direction; change in size gives whether it is strengthening.",
      },
    ],
    why: "The histogram is a second derivative in disguise: it measures whether the GAP between fast and slow trend is widening. That turns positive slightly before price does, which is why TREVOR scores a zero-crossing (15 pts) higher than mere expansion (12 pts) — the crossing is the earlier, rarer event. Without it, momentum scoring would rely entirely on oscillators, which are noisy in trends.",
    values: [
      {
        label: "fastperiod",
        value: mirroredField(TALIB, "MACD_fast"),
        note: FROM_MIRROR,
      },
      {
        label: "slowperiod",
        value: mirroredField(TALIB, "MACD_slow"),
        note: FROM_MIRROR,
      },
      {
        label: "signalperiod",
        value: mirroredField(TALIB, "MACD_signal"),
        note: FROM_MIRROR,
      },
      {
        label: "awards",
        value: "15 (crossing) / 12 (expanding)",
        note: "constants in `_check_momentum`",
      },
    ],
  },
  {
    id: "F-IND-04",
    name: "EMA(9) / EMA(21) Spread",
    status: "live",
    source: "scalp_engine._check_trend, every scan via scalp_engine.analyze_scalp_v2",
    tex: String.raw`\text{spread}_{\%} = \frac{|\text{EMA}_9 - \text{EMA}_{21}|}{|\text{EMA}_{21}|} \times 100`,
    symbols: [
      {
        sym: String.raw`\text{EMA}_9 / \text{EMA}_{21}`,
        means:
          "Fast and slow EMAs on 15-minute closes when ≥21 bars are available, otherwise falling back to 5-minute closes.",
      },
      {
        sym: String.raw`\text{spread}_{\%}`,
        means:
          "Separation as a percentage of the slow EMA. Direction comes from the SIGN of EMA₉ − EMA₂₁; this magnitude only sets the score.",
      },
    ],
    why: "Two moving averages crossing tells you a trend flipped; how far apart they are tells you how convinced the market is. A 0.01% separation is noise, 0.5% is a real trend. Normalising by EMA₂₁ makes the measure comparable across BTC and kPEPE. Trend is the only group that has ever shown positive predictive correlation on TREVOR's live cohort, which is why it also has a dedicated floor gate (F-IND-34).",
    values: [
      {
        label: "fast period",
        value: mirroredField(TALIB, "EMA_fast"),
        note: FROM_MIRROR,
      },
      {
        label: "slow period",
        value: mirroredField(TALIB, "EMA_slow"),
        note: FROM_MIRROR,
      },
      {
        label: "timeframe rule",
        value: "15m if len ≥ 21, else 5m",
        note: "constant in code",
      },
    ],
  },
  {
    id: "F-IND-05",
    name: "Volume Z-Score",
    status: "live",
    source: "scalp_engine._check_volume",
    tex: String.raw`Z = \frac{V_t - \text{SMA}_{20}(V)}{\max\!\left(\sigma_{20}(V),\, 1\right)}`,
    symbols: [
      { sym: String.raw`V_t`, means: "Current bar's volume." },
      {
        sym: String.raw`\text{SMA}_{20}(V), \sigma_{20}(V)`,
        means: "20-bar mean and standard deviation of volume.",
      },
      {
        sym: String.raw`\max(\sigma, 1)`,
        means:
          "A divide-by-zero / degenerate-variance guard, not a statistical choice.",
      },
    ],
    why: "Raw volume is meaningless across assets and across time of day. A Z-score says “this bar's volume is 2.3 standard deviations above what this asset has been doing lately”, which is comparable everywhere. A price move on ordinary volume is usually noise; the same move on Z=2 volume means real participation. The clamp at σ ≥ 1 means a dead-flat-volume window degrades the score toward zero rather than exploding it.",
    values: [
      {
        label: "SMA timeperiod",
        value: mirroredField(TALIB, "VOL_SMA"),
        note: FROM_MIRROR,
      },
      {
        label: "STDDEV timeperiod",
        value: mirroredField(TALIB, "VOL_STDDEV"),
        note: FROM_MIRROR,
      },
      { label: "σ floor", value: "1.0", note: "constant" },
    ],
  },
  {
    id: "F-IND-06",
    name: "VWAP (cumulative)",
    status: "live",
    source: "scalp_engine._check_volume",
    tex: String.raw`\text{VWAP}_t = \frac{\sum_{i \le t} \text{TP}_i \cdot V_i}{\sum_{i \le t} V_i}, \qquad \text{TP}_i = \frac{H_i + L_i + C_i}{3}`,
    symbols: [
      {
        sym: String.raw`\text{TP}`,
        means: "Typical price of a bar (high + low + close, over 3).",
      },
      { sym: String.raw`V`, means: "Volume of that bar." },
      {
        sym: String.raw`\text{VWAP}`,
        means:
          "The volume-weighted average price over the ENTIRE array supplied, cumulative from the first bar.",
      },
    ],
    why: "VWAP is the average price everyone actually paid, weighted by how much traded there. It is the reference institutions benchmark against, so it acts as a magnet and as a fairness line: above VWAP, buyers are in control. TREVOR uses it as a binary confirmation (+4 pts) rather than a signal in itself.",
    values: [
      {
        label: "configurable parameters",
        value: "none",
        note: "award 4 pts — constant",
      },
    ],
    caveat:
      "Differs from textbook. This is a CUMULATIVE running VWAP over the whole candle array — `np.cumsum` from index 0 — and is NOT anchored to a session or a day. The denominator guard is `np.where(cum_vol > 0, cum_vol, 1)`. The longer the fetched window, the more inert this value becomes.",
  },
  {
    id: "F-IND-07",
    name: "Bollinger %B",
    status: "live",
    source:
      "scalp_engine._check_volatility — the same BBANDS call also drives regime detection (F-IND-20)",
    tex: String.raw`\%B = \frac{C - \text{Lower}}{\text{Upper} - \text{Lower}}, \qquad \text{Upper/Lower} = \text{SMA}_{20} \pm 2\sigma_{20}`,
    symbols: [
      { sym: String.raw`C`, means: "Current close." },
      {
        sym: String.raw`\text{Upper} / \text{Lower}`,
        means: "Bands at ±2 standard deviations around the 20-bar SMA.",
      },
      {
        sym: String.raw`\%B`,
        means:
          "Position inside the band. 0 = at the lower band, 1 = at the upper, 0.5 = at the middle.",
      },
    ],
    why: "%B converts “how stretched is price?” into a single bounded number that automatically adapts to the asset's current volatility — the bands widen when things get wild, so a %B of 0.1 means genuinely stretched RELATIVE TO CURRENT CONDITIONS, not relative to a fixed percentage. TREVOR scores LONGs for low %B and SHORTs for high %B, i.e. it is a mean-reversion input sitting alongside three trend-following ones.",
    values: [
      {
        label: "timeperiod",
        value: mirroredField(TALIB, "BB_period"),
        note: FROM_MIRROR,
      },
      {
        label: "nbdevup / nbdevdn",
        value: mirroredField(TALIB, "BB_nbdev"),
        note: FROM_MIRROR,
      },
      {
        label: "guard",
        value: "bb_range ≤ 0 → group returns 0 pts",
        note: "constant",
      },
    ],
  },
  {
    id: "F-IND-08",
    name: "ATR (14) and ATR%",
    status: "live",
    source:
      "scalp_engine._check_volatility (5m) · scalp_engine.detect_scalp_regime (5m, volatility state) · scalp_engine.analyze_scalp_v2 (stop distance and the `atr_pct` field)",
    tex: [
      String.raw`\text{TR}_t = \max\!\big(H_t - L_t,\; |H_t - C_{t-1}|,\; |L_t - C_{t-1}|\big), \qquad \text{ATR}_{14} = \text{Wilder}_{14}(\text{TR})`,
      String.raw`\text{ATR}_{\%} = \frac{\text{ATR}_{14}}{C_t} \times 100`,
      String.raw`\text{vol\_state} = \begin{cases} \text{EXTREME} & \text{ATR}_\% > 3.0 \\ \text{HIGH} & \text{ATR}_\% > 1.5 \\ \text{NORMAL} & \text{ATR}_\% > 0.5 \\ \text{LOW} & \text{otherwise} \end{cases}`,
    ],
    symbols: [
      {
        sym: String.raw`\text{TR}`,
        means:
          "True range — the bar's full travel including any gap from the previous close.",
      },
      {
        sym: String.raw`\text{ATR}_{14}`,
        means: "Wilder-smoothed average of TR over 14 bars.",
      },
      {
        sym: String.raw`\text{ATR}_{\%}`,
        means: "ATR as a percentage of price, comparable across assets.",
      },
    ],
    why: "ATR is the workhorse: the system's single measure of “how much does this thing move in a typical bar?” Everything downstream that needs a distance uses it — stop placement, the volatility-extreme check, the market-state tier, the regime's volatility label. A fixed percentage stop would be too tight on FARTCOIN and absurdly wide on BTC.",
    values: [
      {
        label: "timeperiod",
        value: mirroredField(TALIB, "ATR"),
        note: FROM_MIRROR,
      },
      {
        label: "band edges",
        value: "3.0 / 1.5 / 0.5",
        note: "in `detect_scalp_regime` — constants",
      },
      {
        label: "default atr_pct when ATR unavailable",
        value: "2.0",
        note: "constant",
      },
      {
        label: "exit-engine ATR period",
        value: mirrored("ATR_TRAIL_PERIOD"),
        note: `auto_trader.config.ATR_TRAIL_PERIOD — a DIFFERENT period from the 14 above; ${FROM_MIRROR}`,
      },
    ],
    caveat:
      "Cross-family unit note. This `atr_pct` is a PERCENT, and it is the value F-SIZE-03 divides by 100. Separately, the exit engine's trail and rung-1 override use ATR at a different period — `auto_trader.config.ATR_TRAIL_PERIOD` = 10 — despite being passed through a keyword argument literally named `atr_14`. Trust the constant, never the parameter name.",
  },
  {
    id: "F-IND-09",
    name: "ADX (14)",
    status: "live",
    source:
      "scalp_engine.detect_scalp_regime, on 15-minute bars, requires ≥28 bars",
    tex: String.raw`\text{ADX}_{14} = \text{Wilder}_{14}\!\left( \frac{|\text{DI}^+ - \text{DI}^-|}{\text{DI}^+ + \text{DI}^-} \times 100 \right)`,
    symbols: [
      {
        sym: String.raw`\text{DI}^+ / \text{DI}^-`,
        means:
          "Positive and negative directional indicators, measuring upward vs downward movement strength.",
      },
      {
        sym: String.raw`\text{ADX}`,
        means:
          "How STRONG the trend is, 0–100, regardless of direction.",
      },
    ],
    why: "ADX separates “is there a trend at all?” from “which way?”. That separation is what makes regime detection possible: anything above ADX 25 is TRENDING and gets a looser entry bar, because trend-following inputs are trustworthy when a trend exists and actively misleading when one does not.",
    values: [
      {
        label: "timeperiod",
        value: mirroredField(TALIB, "ADX"),
        note: FROM_MIRROR,
      },
      { label: "regime cut", value: "ADX > 25", note: "constant" },
      {
        label: "default adx on any failure",
        value: "20.0",
        note: "constant",
      },
    ],
  },
  {
    id: "F-IND-10",
    name: "ATR Percentile (rolling, per-ticker)",
    status: "live",
    source:
      "discord_bot._compute_atr_percentile, fed from `discord_bot._atr_percentile_history[ticker]`, a deque(maxlen=_ATR_HISTORY_SIZE)",
    tex: String.raw`P(\text{ATR}_\%) = \frac{\#\{v \in H : v \le \text{ATR}_\%\}}{|H|} \times 100, \qquad |H| \ge 50`,
    symbols: [
      {
        sym: String.raw`H`,
        means:
          "This ticker's rolling in-memory history of past ATR% readings.",
      },
      {
        sym: String.raw`P`,
        means:
          "The percentile rank of the current reading within that history, 0–100.",
      },
    ],
    why: "An ATR of 1.2% means nothing on its own — it is high for BTC and low for a memecoin. The percentile answers “is this asset unusually active FOR ITSELF, right now?”, which is exactly the input the quiet/normal/active threshold tier needs (F-IND-25).",
    values: [
      {
        label: "_ATR_MIN_SAMPLES",
        value: mirrored("_ATR_MIN_SAMPLES"),
        note: `discord_bot._ATR_MIN_SAMPLES — ${FROM_MIRROR}`,
      },
      {
        label: "cold-start return",
        value: "50.0",
        note: "hardcoded until 50 samples accumulate — constant in `discord_bot.py`",
      },
      {
        label: "live percentile per ticker",
        value: "no live value available",
        note: "`_atr_percentile_history` is an in-process deque, never persisted — no table, no sentinel. The page cannot show which threshold tier is in force; it shows the rule instead.",
      },
    ],
    caveat:
      "Two honest limits. ① The history is IN-PROCESS MEMORY ONLY — empty at every restart, and until 50 samples accumulate the function returns a hardcoded 50.0, landing every ticker in the `normal` tier. At a 3-minute cadence that is roughly 2.5 HOURS AFTER EACH RESTART during which the quiet and active tiers are unreachable. ② It is therefore NOT RETRIEVABLE by a Hub API — the tier currently in force cannot be read from the replica, and a zero here would read as a measurement rather than as an absence.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — the five groups and the composite (F-IND-11 … F-IND-19)
// ─────────────────────────────────────────────────────────────────────────────

const SCORING: FormulaEntryProps[] = [
  {
    id: "F-IND-11",
    name: "Group 1: Momentum (best-of-three)",
    status: "live",
    statusNote: "Weight 1.35. Every group returns (fired, points, reason) with points an integer in [0, 20].",
    source: "scalp_engine._check_momentum",
    tex: [
      String.raw`\text{fired} = (\text{points} \ge 6)`,
      String.raw`\text{pts}_{\text{mom}} = \Big\lfloor \max\big(s_{\text{RSI}},\, s_{\text{StochRSI}},\, s_{\text{MACD}}\big) \Big\rceil`,
      String.raw`s_{\text{RSI}} = \begin{cases}\text{clip}\big((45 - \text{RSI}) \cdot 0.67,\,0,\,20\big) & \text{LONG},\ \text{RSI}<45,\ \text{RSI}>\text{RSI}_{t-1}\\[4pt] \text{clip}\big((\text{RSI} - 55) \cdot 0.67,\,0,\,20\big) & \text{SHORT},\ \text{RSI}>55,\ \text{RSI}<\text{RSI}_{t-1}\\[4pt] 0 & \text{otherwise}\end{cases}`,
      String.raw`s_{\text{StochRSI}} = \begin{cases}\text{clip}\big((30 - \%K)\cdot 0.67,\,0,\,20\big) & \text{LONG},\ \%K<30,\ \%K>\%D,\ \%K_{t-1}\le\%D_{t-1}\\[4pt] \text{clip}\big((\%K - 70)\cdot 0.67,\,0,\,20\big) & \text{SHORT},\ \%K>70,\ \%K<\%D,\ \%K_{t-1}\ge\%D_{t-1}\\[4pt] 0 & \text{otherwise}\end{cases}`,
      String.raw`s_{\text{MACD}} = \begin{cases}15 & \text{sign flip into the trade direction}\\ 12 & \text{histogram expanding in the trade direction}\\ 0 & \text{otherwise}\end{cases}`,
    ],
    symbols: [
      {
        sym: String.raw`s_X`,
        means:
          "The candidate score from sub-indicator X. THEY DO NOT ADD — the best one wins.",
      },
      {
        sym: String.raw`0.67`,
        means:
          "The slope converting “distance past the trigger level” into points. 30 points of RSI distance maps to the full 20.",
      },
      { sym: String.raw`\lfloor \cdot \rceil`, means: "Round to nearest integer." },
    ],
    why: "Three momentum indicators on the same bars are heavily correlated, so summing them would triple-count one piece of information and let momentum dominate the composite. Taking the maximum says “whichever lens sees this most clearly sets the score” while keeping the group's contribution bounded at 20 like every other group. The gradient — score proportional to how far past the trigger — is what stops the system treating an RSI of 44.9 and an RSI of 20 as the same event.",
    values: [
      {
        label: "group-fired floor",
        value: mirrored("GROUP_FIRED_FLOOR"),
        note: `an inline literal applied identically at every group scorer — ${FROM_MIRROR}`,
      },
      {
        label: "RSI trigger levels",
        value: "45 (LONG) / 55 (SHORT)",
        note: "constants",
      },
      {
        label: "StochRSI trigger levels",
        value: "30 (LONG) / 70 (SHORT)",
        note: "constants",
      },
      { label: "slope", value: "0.67", note: "constant" },
      { label: "MACD awards", value: "15 / 12", note: "constants" },
      { label: "group cap", value: "20", note: "constant" },
      {
        label: "weight",
        value: Number(mirroredField("PRODUCTION_WEIGHTS", "momentum")).toFixed(2),
        note: "live authority is auto_config.GROUP_WEIGHTS_V2_VALUES, field 1",
      },
    ],
    caveat:
      "That single constant 6 is LOAD-BEARING THREE TIMES OVER: it decides `groups_confirmed` (feeding the `required_groups` gate, F-IND-18), and it is the same number the trend floor (F-IND-34) and the P3 screen (F-IND-35) use. Changing it moves three gates at once.",
  },
  {
    id: "F-IND-12",
    name: "Group 2: Trend Alignment",
    status: "live",
    statusNote: "Weight 1.35.",
    source: "scalp_engine._check_trend",
    tex: String.raw`\text{pts}_{\text{trend}} = \begin{cases}\Big\lfloor \text{clip}\big(\text{spread}_\% \times 40,\; 0,\; 20\big)\Big\rceil & \text{if direction agrees with } \text{sign}(\text{EMA}_9 - \text{EMA}_{21})\\[4pt] 0 & \text{otherwise}\end{cases}`,
    symbols: [
      { sym: String.raw`\text{spread}_\%`, means: "From F-IND-04." },
      {
        sym: String.raw`40`,
        means:
          "The gain mapping separation to points. A 0.5% separation SATURATES the group at 20.",
      },
      {
        sym: String.raw`\text{agreement}`,
        means: "EMA₉ > EMA₂₁ for LONG, EMA₉ < EMA₂₁ for SHORT.",
      },
    ],
    why: "This is the one group with demonstrated positive predictive value on TREVOR's own live trades, and the scaling reflects a real property of 15-minute crypto bars: EMA separations above half a percent are genuinely rare, so saturating there puts almost all live readings on the responsive part of the curve rather than pinned at the ceiling.",
    values: [
      { label: "gain", value: "40", note: "constant" },
      { label: "group cap", value: "20", note: "constant" },
      {
        label: "weight",
        value: Number(mirroredField("PRODUCTION_WEIGHTS", "trend")).toFixed(2),
        note: "live authority is auto_config.GROUP_WEIGHTS_V2_VALUES, field 2",
      },
    ],
  },
  {
    id: "F-IND-13",
    name: "Group 3: Volume Confirmation",
    status: "live",
    statusNote: "Weight 1.30.",
    source: "scalp_engine._check_volume",
    tex: String.raw`\text{pts}_{\text{vol}} = \min\!\Big(20,\; \underbrace{\big\lfloor\text{clip}(Z \cdot 6,\,0,\,12)\big\rceil}_{\text{volume}} + \underbrace{4 \cdot \mathbb{1}[\text{candle agrees}]}_{\text{candle}} + \underbrace{4 \cdot \mathbb{1}[\text{VWAP agrees}]}_{\text{VWAP}}\Big)`,
    symbols: [
      {
        sym: String.raw`Z`,
        means:
          "Volume Z-score from F-IND-05. Contributes at most 12 of the 20.",
      },
      {
        sym: String.raw`\text{candle agrees}`,
        means:
          "Green (close > previous close) for LONG, red for SHORT.",
      },
      {
        sym: String.raw`\text{VWAP agrees}`,
        means: "Close above VWAP for LONG, below for SHORT.",
      },
      {
        sym: String.raw`\mathbb{1}[\cdot]`,
        means: "1 if true, 0 if false.",
      },
    ],
    why: "Volume alone is directionless — a huge bar can be panic buying or panic selling. Pairing the Z-score with two cheap directional confirmations turns “something happened” into “something happened in our favour.” The 12/4/4 split deliberately keeps magnitude dominant over the two binaries, so a genuinely explosive bar still scores well even if one confirmation misses.",
    values: [
      { label: "Z gain", value: "6", note: "constant" },
      { label: "volume sub-cap", value: "12", note: "constant" },
      { label: "candle / VWAP awards", value: "4 / 4", note: "constants" },
      { label: "group cap", value: "20", note: "constant" },
      {
        label: "weight",
        value: Number(mirroredField("PRODUCTION_WEIGHTS", "volume")).toFixed(2),
        note: "live authority is auto_config.GROUP_WEIGHTS_V2_VALUES, field 3",
      },
    ],
    caveat:
      "Implementation note the page must not gloss: the candle-direction test uses `close[-2]` AS A PROXY FOR THE CURRENT BAR'S OPEN (`curr_open = _nan_safe(close[-2])`) — that is the previous bar's close, not the true open. On a gapping bar the two disagree and the candle points can be awarded to the wrong side.",
  },
  {
    id: "F-IND-14",
    name: "Group 4: Volatility Context",
    status: "live",
    statusNote: "Weight 0.50.",
    source: "scalp_engine._check_volatility",
    tex: [
      String.raw`b = \begin{cases}\text{clip}\big((0.4 - \%B)\cdot 40,\,0,\,16\big) & \text{LONG}\\ \text{clip}\big((\%B - 0.6)\cdot 40,\,0,\,16\big) & \text{SHORT}\end{cases}`,
      String.raw`\text{pts}_{\text{vlt}} = \Big\lfloor\text{clip}\big(b \cdot 0.4 \cdot \mathbb{1}[\text{extreme}] + (b + 4)\cdot\mathbb{1}[\neg\text{extreme}],\; 0,\; 20\big)\Big\rceil`,
      String.raw`\text{extreme} \iff \text{ATR}_{14,t} > \text{percentile}_{90}\big(\text{ATR}_{14}[-50{:}]\big)`,
    ],
    symbols: [
      {
        sym: String.raw`\%B`,
        means:
          "Bollinger position from F-IND-07. Note the DEAD ZONE: %B between 0.4 and 0.6 scores zero for both directions.",
      },
      {
        sym: String.raw`b`,
        means: "The base score, capped at 16 (leaving room for the +4 bonus).",
      },
      {
        sym: String.raw`\text{extreme}`,
        means:
          "Current ATR above the 90th percentile of the LAST 50 BARS' ATR. Requires ≥10 non-NaN values or the group returns 0.",
      },
      {
        sym: String.raw`0.4 \text{ vs } +4`,
        means:
          "On extreme volatility the base is MULTIPLIED by 0.4 (a 60% penalty); otherwise it gets +4.",
      },
    ],
    why: "This group answers “is price stretched, and is it safe to act on that?” — two questions that must be combined, not averaged. Stretched price in calm conditions is a mean-reversion opportunity; the identical reading during a volatility explosion is a falling knife. The multiplicative penalty rather than a hard block is deliberate: extreme volatility degrades the signal rather than vetoing it, leaving the veto to the regime layer. The low weight (0.50) reflects that this group has never shown predictive value on live trades.",
    values: [
      { label: "centres", value: "0.4 / 0.6", note: "constants" },
      { label: "gain", value: "40", note: "constant" },
      { label: "base cap", value: "16", note: "constant" },
      { label: "extreme multiplier", value: "0.4", note: "constant" },
      { label: "calm bonus", value: "4", note: "constant" },
      { label: "group cap", value: "20", note: "constant" },
      {
        label: "percentile / window / min samples",
        value: "90 / 50 bars / 10",
        note: "constants",
      },
      {
        label: "weight",
        value: Number(
          mirroredField("PRODUCTION_WEIGHTS", "volatility"),
        ).toFixed(2),
        note: "live authority is auto_config.GROUP_WEIGHTS_V2_VALUES, field 4",
      },
    ],
  },
  {
    id: "F-IND-15",
    name: "Group 5: Microstructure v2 (order flow)",
    status: "live",
    statusNote:
      "Weight 0.50. Gated by MICRO_SCALP_V2_ENABLED (live true) and requiring MICRO_DATA_LAYER_ENABLED (live true). analyze_scalp_v2 calls it first; it falls back to v1 (F-IND-16) only when the adapter returns None or data_quality == \"STUB\".",
    source: "scalp_engine._check_microstructure_v2",
    tex: [
      String.raw`\text{pts}_{\mu} = \min\big(20,\; s_{\text{CVD}} + s_{\text{OBI}} + s_{\text{AGGR}}\big)`,
      String.raw`s_{\text{CVD}} = \min\!\left(8, \left\lfloor \frac{|\text{CVD}_{15m}|}{1000} \right\rfloor\right) \text{ if } \text{sign}(\text{CVD}) \text{ agrees, else } 0`,
      String.raw`s_{\text{OBI}} = \min\big(6, \lfloor |\text{OBI}| \cdot 60 \rfloor\big) \text{ if } \text{OBI} > 0.05 \text{ (LONG) or } \text{OBI} < -0.05 \text{ (SHORT), else } 0`,
      String.raw`s_{\text{AGGR}} = \min\big(4, \lfloor (\text{AGGR} - 0.5) \cdot 20 \rfloor\big) \text{ (LONG, } \text{AGGR}>0.55); \quad \min\big(4, \lfloor (0.5 - \text{AGGR}) \cdot 20\rfloor\big) \text{ (SHORT, } \text{AGGR}<0.45)`,
    ],
    symbols: [
      {
        sym: String.raw`\text{CVD}_{15m}`,
        means:
          "Cumulative volume delta — buy volume minus sell volume over 15 minutes. Positive means aggressive buyers dominated.",
      },
      {
        sym: String.raw`\text{OBI}`,
        means:
          "Order book imbalance across the top 10 levels (falling back to top 5), roughly −1 to +1. Positive means more resting bids than asks.",
      },
      {
        sym: String.raw`\text{AGGR}`,
        means:
          "The fraction of trades that were aggressive buys over 15m; 0.5 is balanced.",
      },
    ],
    why: "The other four groups all read the same public candles; this one reads WHO WAS ACTUALLY PUSHING. CVD separates a rally on real buying from a rally on thin selling; OBI shows where the resting liquidity sits; the aggressor ratio shows who is crossing the spread to get filled. Together they are the closest TREVOR gets to seeing intent rather than outcome — which is why they are worth having even at a low weight.",
    values: [
      { label: "CVD divisor", value: "1000", note: "constant" },
      { label: "sub-caps", value: "8 / 6 / 4", note: "constants" },
      {
        label: "OBI gain / deadband",
        value: "60 / ±0.05",
        note: "constants",
      },
      {
        label: "AGGR gain / deadbands",
        value: "20 / 0.55 / 0.45",
        note: "constants",
      },
      { label: "group cap", value: "20", note: "constant — see the caveat" },
      {
        label: "weight",
        value: Number(
          mirroredField("PRODUCTION_WEIGHTS", "microstructure"),
        ).toFixed(2),
        note: "live authority is auto_config.GROUP_WEIGHTS_V2_VALUES, field 5",
      },
      {
        label: "live CVD / OBI / AGGR",
        value: "no live value available",
        note: "sourced from `microstructure_adapter.get_micro_snapshot` at scan time and never persisted; the adapter logs via stdlib logging and produces zero lines in `logs/trevor*.log` or journald. The formula and its caps are shown; the inputs are unavailable.",
      },
    ],
    caveat:
      "The theoretical cap is UNREACHABLE. `min(20, pts)` cannot bind: the three legs cap at 8 + 6 + 4 = 18. The cap is a documented leftover from when a fourth (funding) leg existed — that leg was REMOVED as dead-by-units. It is deliberately left in place: changing it would be a threshold change under the Threshold Moratorium.",
  },
  {
    id: "F-IND-16",
    name: "Group 5 fallback: Microstructure v1",
    status: "dormant",
    statusNote:
      "Reached ONLY when _check_microstructure_v2 returns None (adapter disabled/unavailable, or data_quality == \"STUB\"). The fallback emits a [MICRO-FALLBACK] WARNING on every occurrence; the record documents 0/10 tickers STUB and 0 fallback lines across 25 measured cycles and 60 scored bars. Both gating flags are live true. Wired and one adapter outage from running — not dead, but not executing.",
    source: "scalp_engine._check_microstructure",
    tex: String.raw`\text{pts}_{\mu,v1} = \min\Big(20,\; \min\big(12, \lfloor |f| \cdot 600 \rceil\big)\cdot\mathbb{1}[\text{sign}(f)\text{ favours direction}] \;+\; 8\cdot\mathbb{1}[\text{OI agrees}]\Big)`,
    symbols: [
      {
        sym: String.raw`f`,
        means:
          "Funding rate. Negative funding favours LONG (shorts are paying); positive favours SHORT.",
      },
      {
        sym: String.raw`+8`,
        means:
          "The OI term — UNREACHABLE BY CONSTRUCTION. analyze_scalp_v2 passes oi_delta=None explicitly, and the branch requires `oi_delta is not None and != 0`.",
      },
    ],
    why: "Funding is what one side pays the other to hold the position. Persistently negative funding means shorts are crowded and paying for the privilege — a squeeze risk favouring the long side. It is a positioning signal rather than a price signal, which is why it belongs in microstructure. Stated as why it WOULD work: this function is not executing.",
    values: [
      { label: "gain", value: "600", note: "constant" },
      { label: "sub-cap", value: "12", note: "constant" },
      { label: "OI award", value: "8", note: "constant — unreachable, see the caveat" },
      { label: "group cap", value: "20", note: "constant" },
    ],
    caveat:
      "TWO ⚫ DEAD LEGS INSIDE THIS ⚪ DORMANT FUNCTION, both deliberate, both recent. ① OI leg — P3-OI-DELTA-ARG (2026-08-04) found an ABSOLUTE open interest bound to the `oi_delta` parameter, handing LONG a permanent +8 and a free confirmed group on every signal. The caller now passes None; nothing computes a real delta, and no OI history exists on the entry path. ② Funding leg — P5-FUNDING-UNITS (2026-08-04) removed the v2 leg entirely: the producer supplies a per-hour FRACTION while the thresholds assume a PERCENT, so it scored zero on 100% of 5,000 measured hourly observations. The v1 leg above carries the same ·600 scaling and % formatting and is ALSO DEAD BY UNITS — left untouched because the function is unreachable and editing dead code invites belief in it. This entry is dormant-and-partly-dead, not live math.",
  },
  {
    id: "F-IND-17",
    name: "The Composite Score",
    status: "live",
    source: "scalp_engine.analyze_scalp_v2",
    tex: [
      String.raw`S_d = \text{clip}\!\left(\sum_{g \in G} \text{pts}_{g,d} \cdot w_g,\; 0,\; 100\right), \qquad G = \{\text{mom},\text{trend},\text{vol},\text{vlt},\mu\}`,
      String.raw`\sum_{g \in G} w_g = 5.0`,
      String.raw`d^\* = \arg\max_d S_d, \qquad S = S_{d^\*}`,
    ],
    symbols: [
      {
        sym: String.raw`\text{pts}_{g,d}`,
        means: "Group g's points for direction d, each in [0, 20].",
      },
      { sym: String.raw`w_g`, means: "That group's weight." },
      {
        sym: String.raw`S_d`,
        means:
          "The composite for one direction. BOTH DIRECTIONS ARE SCORED INDEPENDENTLY every scan; the higher wins.",
      },
    ],
    why: "Five independent lenses on the same bar, each bounded to the same 0–20 range, combined by weights encoding how much each has historically been worth. Bounding each group first is what stops any single indicator running away with the score. The sum-to-5.0 constraint is the important invariant: with each group capped at 20 it fixes the composite's maximum at exactly 100, which is the scale every downstream threshold, calibrator and per-ticker floor was tuned against. Re-weighting is therefore safe AS LONG AS THE SUM IS PRESERVED — the distribution of scores shifts, but the scale, and with it the meaning of the counter-trend penalty, does not.",
    values: WEIGHTS_TABLE,
    caveat:
      "Two corrections the page must get right. ① THE MAXIMUM IS 100, and the clamp sits exactly at it. The module's own header comment claims groups are in [0,100] and a max signal “hits exactly 500” — stale from an earlier scale and arithmetically impossible against group scorers that all cap at 20. The literal wins; do not reproduce the 500. Because microstructure's true reachable max is 18, the arithmetic ceiling is 99, not 100, and `signal_guard`'s own comments record the practical maximum as ~56. ② THE WEIGHTS ARE READ FROM `auto_config`, NOT THE PYTHON LITERAL. `_get_active_weights()` returns the parsed GROUP_WEIGHTS_V2_VALUES CSV when GROUP_WEIGHTS_V2 is true and the CSV sums to 5.0 — both hold on the live row, while the code DEFAULT for GROUP_WEIGHTS_V2 is 'false'. A live row and a code default are different facts, not a drift: the values are byte-identical today (1.35, 1.35, 1.30, 0.50, 0.50), so nothing behaves differently — but the Hub must read the auto_config key, or this page silently lies the first time Ghost tunes a weight.",
  },
  {
    id: "F-IND-18",
    name: "Firing Conditions",
    status: "live",
    source: "scalp_engine.analyze_scalp_v2",
    tex: String.raw`\text{fires} = \underbrace{\big(S \ge T_{\text{regime}}\big)}_{\text{score}} \;\wedge\; \underbrace{\bigwedge_{g \in M} \text{fired}_g}_{\text{must-include}} \;\wedge\; \underbrace{\big(N_{\text{confirmed}} \ge R\big)}_{\text{breadth}}`,
    symbols: [
      {
        sym: String.raw`T_{\text{regime}}, M, R`,
        means:
          "Engine threshold, must-include set, and required group count — all from F-IND-24.",
      },
      {
        sym: String.raw`N_{\text{confirmed}}`,
        means: "How many of the five groups had points ≥ 6.",
      },
    ],
    why: "Three different failure modes, three different guards. A high score from one enormous group is not confluence — hence the breadth requirement. A broad but weak reading is not conviction — hence the score. A trending-market signal with no trend confirmation is incoherent regardless of both — hence must-include. Requiring all three is what makes “confluence” mean something.",
    values: [
      {
        label: "independent constants",
        value: "none",
        note: "all three inputs are derived from F-IND-24",
      },
      {
        label: "group-fired floor feeding N_confirmed",
        value: mirrored("GROUP_FIRED_FLOOR"),
        note: `the same literal as F-IND-11 — ${FROM_MIRROR}`,
      },
    ],
  },
  {
    id: "F-IND-19",
    name: "Quality Tier and Confidence Label",
    status: "live",
    statusNote:
      "DISPLAY ONLY. Both are display/telemetry labels — neither gates firing. This entry labels a signal; it does not decide one.",
    source: "scalp_engine.analyze_scalp_v2",
    tex: String.raw`\text{tier} = \begin{cases} A & S \ge 75 \wedge N_{\text{confirmed}} \ge 4\\ B & S \ge 65 \;\vee\; N_{\text{confirmed}} \ge 4\\ C & \text{otherwise}\end{cases} \qquad \text{label} = \begin{cases}\text{HIGH} & S \ge 70\\ \text{MEDIUM} & S \ge 50\\ \text{LOW} & \text{otherwise}\end{cases}`,
    symbols: [
      { sym: String.raw`S`, means: "The composite score from F-IND-17." },
      {
        sym: String.raw`N_{\text{confirmed}}`,
        means: "How many of the five groups had points ≥ 6.",
      },
      {
        sym: String.raw`\text{tier} / \text{label}`,
        means:
          "Two summaries of the same number, for two audiences. Neither is consulted by any gate.",
      },
    ],
    why: "Two summaries of the same number for two audiences: the tier combines strength with breadth for analysis, the label is a plain-language readout. Neither feeds a firing decision, a threshold or a size — they are what a human reads, not what the engine acts on.",
    values: [
      { label: "tier cuts", value: "75 / 65 / 4", note: "constants" },
      { label: "label cuts", value: "70 / 50", note: "constants" },
    ],
    caveat:
      "Against an observed ceiling of ~56, TIER A IS EFFECTIVELY UNREACHABLE AND “HIGH” IS VERY RARE — the bands were set on an earlier score scale. A reader who sees mostly C/LOW is looking at a mis-scaled label, not at a weak market.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export function MathReadingScoring() {
  return (
    <>
      <MathSection
        number={1}
        title={sectionTitle(1)}
        intro={
          <p>
            The TA primitives. Every one is computed by <strong>TA-Lib</strong>{" "}
            on the arrays TA-Lib is handed; where TREVOR&rsquo;s usage differs
            from the textbook, it is called out. ATR is the workhorse everything
            downstream depends on.
          </p>
        }
      >
        {PRIMITIVES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>

      <MathSection
        number={2}
        title={sectionTitle(2)}
        intro={
          <p>
            The five groups and the composite they add up to. Each group is
            bounded to 0&ndash;20 and carries its own weight; the weights sum to
            5.0, which fixes the composite&rsquo;s maximum at exactly{" "}
            <strong>100</strong> &mdash; 99 arithmetically reachable, ~56
            observed. Never the 500 the module header still claims.
          </p>
        }
      >
        {SCORING.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>
    </>
  );
}
