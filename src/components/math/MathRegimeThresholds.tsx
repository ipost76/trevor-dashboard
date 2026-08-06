import * as React from "react";
import {
  MathSection,
  FormulaEntry,
  MATH_SECTIONS,
  type FormulaValue,
} from "@/components/math";
import {
  MATH_CONSTANTS,
  MIRRORED_FROM,
  UNMIRRORED_CONSTANTS,
} from "@/lib/math-constants";

/**
 * Sections 3–6 — regime · thresholds · cooldown/dedup · Stage-A screens.
 * Formula IDs F-IND-20…37, all 18 of them.  [D2-MATH-REGIME, 2026-08-05]
 *
 * TRANSCRIBED, NOT AUTHORED. Every formula, symbol gloss, why-it-works and
 * number below comes from the RM-MATH master spec
 * (`docs/reports/recon/2026-08-04_math-page/MASTER_2026-08-04_math-page.md`, VM)
 * or from the code-constant mirror in `src/lib/math-constants.ts`. Where the two
 * disagree THE MIRROR WINS and the disagreement is stated inline rather than
 * quietly resolved.
 *
 * 🚨 FOUR ENTRIES HERE ARE THE REASON THIS SECTION EXISTS. They look like
 * ordinary green formulas and are not:
 *
 *   F-IND-29  ⚫ DEAD    — `signal_guard.REGIME_THRESHOLDS`. `discord_bot`
 *                          overwrites every key in place before calling
 *                          `should_post_signal` and restores them in a
 *                          `finally`. Four of the most quotable numbers in the
 *                          posting gate, and they decide nothing. This entry
 *                          must NEVER render as "the gate".
 *   F-IND-22  ◐ SPLIT   — the live HMM runs on a feature vector its own code
 *                          calls broken, while the correct one is computed
 *                          every scan and discarded. Both halves render.
 *   F-IND-33  ◐ SPLIT   — the CandidateSignal structure is live; its consumer
 *                          is dormant. Both halves render.
 *   F-IND-36  🟠 INERT   — the persistence gate runs and is structurally unable
 *                          to block.
 *
 * A page that showed these four as ordinary 🟢 LIVE entries would teach Ghost
 * the opposite of the truth. If you edit this file, keep the badges honest.
 *
 * 🚨 ZERO FETCH. /math renders with no API call by construction (B1 contract),
 * so live `auto_config` rows are carried as the master's dated measurement and
 * anything genuinely unreadable renders "no live value available" WITH ITS
 * REASON — never a blank, never a zero.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Value helpers — every standing value declares where it came from
// ─────────────────────────────────────────────────────────────────────────────

/** Live `auto_config` rows are not constants; they were measured, and dated. */
const MASTER_MEASURED =
  "auto_config (live) — measured in the RM-MATH master, 2026-08-04";

/** A constant the master records but the code mirror does not carry. */
const MASTER_ONLY =
  "constant recorded in the RM-MATH master; no matching symbol in the code mirror";

/**
 * One standing value read from the code-constant mirror. The mirror is the
 * authority (stamped `bcbce58`), so its own `note` / `staleComment` / `dead`
 * flag travel WITH the number rather than being dropped on transcription.
 */
function mirrored(key: string, label: string, extra?: string): FormulaValue {
  const c = MATH_CONSTANTS[key];
  if (!c) {
    return {
      label,
      value: "no live value available",
      note: `\`${key}\` is not present in the code-constant mirror at ${MIRRORED_FROM}.`,
    };
  }
  const bits: string[] = [`${c.source} · mirror @${MIRRORED_FROM}`];
  if (c.dead) bits.push("⚫ DEAD on the live path — decides nothing");
  if (extra) bits.push(extra);
  if (c.note) bits.push(c.note);
  if (c.staleComment) bits.push(c.staleComment);
  return { label, value: c.value, note: bits.join(" — ") };
}

/**
 * A JSON table constant rendered as a spaced, wrappable glance line.
 *
 * 🚨 NEVER THE RAW JSON LITERAL. `FormulaEntry` applies `break-all` to `source`
 * but NOT to a standing value, and these mirrored literals contain no spaces — so
 * a 190-character `{"RSI":14,…}` cannot wrap, and with `overflow-x: hidden` on the
 * page it is silently CLIPPED at 375px rather than scrolled. A truncated value
 * that looks complete is exactly the defect this page exists to prevent.
 *
 * Every number and key is preserved verbatim; only the separators change. The
 * style is the master's own — `TRENDING 42 · VOLATILE 50 · …`.
 */
function mirroredTable(key: string, label: string, extra?: string): FormulaValue {
  const row = mirrored(key, label, extra);
  const c = MATH_CONSTANTS[key];
  if (!c) return row;
  const line = glanceLine(c.value);
  return line ? { ...row, value: line } : row;
}

/**
 * JSON table → a spaced line. Arrays join on `·`; an object's numeric entries
 * read `key value`, its string entries `key → value` (a mapping, not a reading).
 * Anything that is not a table is returned untouched, so a non-JSON constant can
 * never be mangled by passing through here.
 */
function glanceLine(raw: string): string {
  const parsed = parseJson<unknown>(raw);
  if (Array.isArray(parsed)) return parsed.map(String).join(" · ");
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as Record<string, unknown>)
      .map(([k, v]) =>
        typeof v === "string" ? `${k} → ${v}` : `${k} ${String(v)}`,
      )
      .join(" · ");
  }
  return raw;
}

/** A live `auto_config` reading, carried with the date it was measured. */
function liveConfig(label: string, value: string, extra?: string): FormulaValue {
  return {
    label,
    value,
    note: extra ? `${MASTER_MEASURED}; ${extra}` : MASTER_MEASURED,
  };
}

/** A constant the master records and the mirror does not. */
function masterConst(
  label: string,
  value: string,
  extra?: string,
): FormulaValue {
  return {
    label,
    value,
    note: extra ? `${MASTER_ONLY}; ${extra}` : MASTER_ONLY,
  };
}

/**
 * 🚨 Never a zero, never a blank. A value the page cannot read renders as an
 * explicit absence carrying the reason it is absent.
 */
function noLiveValue(label: string, reason: string): FormulaValue {
  return { label, value: "no live value available", note: reason };
}

/** A constant the mirror explicitly records as unretrievable, with its reason. */
function unmirrored(id: string, label: string): FormulaValue {
  const u = UNMIRRORED_CONSTANTS.find((x) => x.id === id);
  return noLiveValue(
    label,
    u
      ? u.reason
      : `\`${id}\` is not present in the code-constant mirror at ${MIRRORED_FROM}.`,
  );
}

/** The page is zero-fetch; a live DB read is structurally unavailable here. */
function noDbRead(label: string, where: string): FormulaValue {
  return noLiveValue(
    label,
    `${where} — /math is zero-fetch by construction and does not read the replica.`,
  );
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Titles are pinned by `MATH_SECTIONS`; this file never hardcodes one. */
function sectionTitle(n: number): string {
  const spec = MATH_SECTIONS.find((s) => s.number === n);
  return spec ? spec.title : `(section ${n} title unavailable)`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The two per-ticker tables, derived FROM the mirror rather than retyped
// ─────────────────────────────────────────────────────────────────────────────

interface Tiers {
  quiet: number;
  normal: number;
  active: number;
}

/** Master order, kept so the page reads in the same order as the spec. */
const TICKER_ORDER = [
  "BTC",
  "ETH",
  "SOL",
  "HYPE",
  "FARTCOIN",
  "XRP",
  "DOGE",
  "NEAR",
  "SUI",
  "kPEPE",
] as const;

const DIRECTION_PENALTIES = parseJson<Record<string, number>>(
  MATH_CONSTANTS.DIRECTION_PENALTIES?.value,
);

const RECALIBRATED_V2 = parseJson<Record<string, Tiers>>(
  MATH_CONSTANTS.RECALIBRATED_THRESHOLDS_V2_TABLE?.value,
);

function tierRow(label: string, t: Tiers, penalty?: number): FormulaValue {
  return {
    label,
    value: `${t.quiet.toFixed(1)} / ${t.normal.toFixed(1)} / ${t.active.toFixed(1)}`,
    note:
      penalty === undefined
        ? "quiet / normal / active"
        : `quiet / normal / active · counter-trend penalty +${penalty.toFixed(1)}`,
  };
}

/** The live production table — `ticker_thresholds.TICKER_THRESHOLDS`. */
function productionThresholdRows(): FormulaValue[] {
  return TICKER_ORDER.map((ticker) => {
    const key = `TICKER_THRESHOLDS.${ticker}`;
    const tiers = parseJson<Tiers>(MATH_CONSTANTS[key]?.value);
    if (!tiers) {
      return noLiveValue(
        ticker,
        `\`${key}\` is not present in the code-constant mirror at ${MIRRORED_FROM}.`,
      );
    }
    return tierRow(ticker, tiers, DIRECTION_PENALTIES?.[ticker]);
  });
}

/** The dormant V2 table — `ticker_thresholds.RECALIBRATED_THRESHOLDS_V2`. */
function recalibratedV2Rows(): FormulaValue[] {
  const defined = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN"];
  if (!RECALIBRATED_V2) {
    return [
      noLiveValue(
        "V2 table",
        `\`RECALIBRATED_THRESHOLDS_V2_TABLE\` could not be read from the code-constant mirror at ${MIRRORED_FROM}.`,
      ),
    ];
  }
  return defined.map((ticker) => {
    const tiers = RECALIBRATED_V2[ticker];
    if (!tiers) {
      return noLiveValue(
        ticker,
        `not defined in \`RECALIBRATED_THRESHOLDS_V2\` at ${MIRRORED_FROM}.`,
      );
    }
    return tierRow(ticker, tiers);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Regime
// ─────────────────────────────────────────────────────────────────────────────

function SectionRegime() {
  return (
    <MathSection
      number={3}
      title={sectionTitle(3)}
      intro={
        <p>
          Two orthogonal questions asked in order: is there a trend, and if not,
          is the market compressed or just choppy. A learned HMM answers the
          same question probabilistically instead of on hard edges, and its four
          states are then collapsed onto the three regimes the rest of the
          system was built against.
        </p>
      }
    >
      <FormulaEntry
        id="F-IND-20"
        name="Rules-Based Regime"
        status="live"
        source="scalp_engine.detect_scalp_regime — on 15-minute bars"
        tex={[
          String.raw`\text{regime}_{\text{rules}} = \begin{cases} \text{TRENDING} & \text{ADX}_{14} > 25 \\ \text{RANGING} & \text{ADX}_{14} \le 25 \;\wedge\; P_{\text{BB}} < 20 \\ \text{VOLATILE} & \text{otherwise (also the initial default)}\end{cases}`,
          String.raw`P_{\text{BB}} = \frac{\text{searchsorted}\big(\text{sort}(W),\, W_t\big)}{|W|}\times 100, \qquad W = \frac{\text{Upper} - \text{Lower}}{\text{Middle}}`,
          String.raw`\text{trend\_dir} = \begin{cases}\text{UP} & C_t > \text{EMA}_{21}\\ \text{DOWN} & C_t < \text{EMA}_{21}\\ \text{FLAT} & \text{forced when regime} = \text{RANGING}\end{cases}`,
        ]}
        symbols={[
          {
            sym: String.raw`W`,
            means:
              "Bollinger band width normalised by the middle band; P_BB is its percentile within the available history (needs >10 clean values).",
          },
          {
            sym: String.raw`\text{trend\_dir}`,
            means:
              "derived from close vs EMA21 for all non-RANGING regimes; RANGING is explicitly forced FLAT.",
          },
        ]}
        why="Two orthogonal questions asked in order: is there a trend (ADX), and if not, is the market compressed or just choppy (band width)? A tight band with no trend is a genuine range — mean reversion is trustworthy. A wide band with no trend is chop, the worst environment, so it gets the VOLATILE label and the strictest treatment. RANGING is forced FLAT because a 'trend direction' inside a tight range is noise, and letting it through would trigger spurious counter-trend penalties."
        values={[
          masterConst("ADX trend cut", "> 25"),
          masterConst("Band-width percentile cut", "< 20"),
          mirroredTable(
            "TALIB_PERIODS",
            "TA-Lib periods (BB 20 / ±2σ · EMA 21 · ADX 14)",
          ),
          masterConst(
            "Minimum bars",
            "28 for ADX · >10 clean values for the percentile",
          ),
          masterConst(
            "Defaults on failure",
            "regime = VOLATILE · adx = 20.0 · bb_pct = 50.0 · trend_dir = FLAT",
            "all constants",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-21"
        name="HMM Posterior and State Assignment"
        status="live"
        statusNote="Executed out-of-process via subprocess_inference.run_inference, called from discord_bot per scan. Model models/hmm_regime_v2.pkl — preferred over v1, whose degenerate startprob collapsed the state space. Proof of liveness: hmm_inference_log carried 500 rows in 24 h across all 10 tickers, newest 1.8 minutes old, with all four states present (TRENDING_BULL 207 · VOLATILE 129 · TRENDING_BEAR 84 · RANGING 80). No collapse."
        source="hmm_regime.HMMRegimeDetector.predict"
        tex={[
          String.raw`\hat{s}_t = \arg\max_{k} \; P(s_t = k \mid x_{1:t}), \qquad k \in \{0,1,2,3\}`,
          String.raw`\text{persistence} = A_{\hat{s}\hat{s}}, \qquad \text{transition risk} = \begin{cases}\text{LOW} & \max_{j\ne\hat{s}} A_{\hat{s}j} < 0.10\\ \text{MEDIUM} & < 0.25\\ \text{HIGH} & \text{otherwise}\end{cases}`,
        ]}
        symbols={[
          {
            sym: String.raw`P(s_t = k \mid x)`,
            means:
              "the posterior probability of each hidden state given the observed features (predict_proba).",
          },
          {
            sym: String.raw`A`,
            means:
              "the learned transition matrix; A_ss is the chance of staying put next bar.",
          },
        ]}
        why="Rule-based regime detection has hard edges — ADX 24.9 and 25.1 are different worlds, which makes the label flicker exactly when it matters. An HMM instead learns what regimes actually look like in the data and returns a probability distribution, so it can express uncertainty. Because it is a Markov model it also knows how sticky each regime is, yielding persistence and transition risk for free — information no threshold rule can produce."
        values={[
          mirrored("N_STATES", "N_STATES"),
          mirroredTable("STATE_LABELS", "STATE_LABELS"),
          masterConst(
            "Model configuration",
            'covariance_type = "full" · n_iter = 100 · tol = 1e-4 · random_state = 42 · startprob frozen uniform at 1/4',
            "Gaussian HMM, full covariance, 4 states, fitted by Baum-Welch; the frozen startprob prevents the v1 collapse",
          ),
          masterConst("Training minimum", "500 bars"),
          masterConst("Transition-risk cuts", "0.10 / 0.25"),
          noDbRead(
            "Live state + probability per ticker",
            "hmm_inference_log.predicted_state, .state_prob and .ts (epoch seconds), latest row per ticker",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-22"
        name="The Live HMM Feature Vector"
        status="shadow"
        overlay="live"
        statusNote="SPLIT — 🔵 SHADOW is the CORRECT vector: computed by scalp_engine.detect_scalp_regime via compute_hmm_feature_vector and exposed on regime_detail['hmm_features'], every scan, and not used. 🟢 LIVE is the BROKEN vector: assembled inline in discord_bot.scalp_scan_loop as _broken_features and fed to the model. The gate is _use_fixed = cfg_bool('HMM_FEATURE_FIX_ENABLED') and _fixed_features is not None; HMM_FEATURE_FIX_ENABLED is live false, so _live_features = _broken_features."
        source="discord_bot.scalp_scan_loop (_broken_features) · scalp_engine.detect_scalp_regime → compute_hmm_feature_vector"
        tex={[
          String.raw`x = \big[\,\text{adx},\; \text{dm\_ratio},\; \text{bb\_width\_pctile},\; \text{atr}_\%,\; \text{vol\_ratio},\; \text{rsi\_dist}\,\big] \in \mathbb{R}^6`,
          String.raw`\text{dm\_ratio} = \begin{cases}+0.3 & \text{trend\_dir} = \text{UP}\\ -0.3 & \text{trend\_dir} = \text{DOWN}\\ 0.0 & \text{FLAT}\end{cases} \qquad \text{vol\_ratio} = \text{clip}\!\left(1 + \frac{\text{pts}_{\text{vol}}}{12},\; 0.5,\; 3.0\right) \qquad \text{rsi\_dist} = 0.0`,
        ]}
        symbols={[
          {
            sym: String.raw`\text{dm\_ratio}`,
            means:
              "should be (DI⁺ − DI⁻)/(DI⁺ + DI⁻), a continuous directional bias. Live it is a three-valued ternary.",
          },
          {
            sym: String.raw`\text{vol\_ratio}`,
            means:
              "should be volume over its 20-bar SMA. Live it is derived from the volume group's points, a different quantity entirely.",
          },
          {
            sym: String.raw`\text{rsi\_dist}`,
            means: "should be |RSI − 50|. Live it is hardcoded 0.0.",
          },
          {
            sym: String.raw`\text{atr}_\%`,
            means:
              "trained on 15m; live value supplied from the 5m computation.",
          },
        ]}
        why="An HMM assigns states by asking which learned Gaussian a feature vector most resembles. If the vector is drawn from a different distribution than training, the answer is arbitrary in a way that still looks confident — you get a state label and a probability, and neither is meaningful. The code documents this itself: the ±0.3 ternary is ~4–6× out-of-distribution against trained state means of [-0.028, +0.08], and one of six dimensions is a constant. This is the single largest honesty item in the indicator half of the system."
        caveat="Deliberately shadow-first, not an accident. The fix ships OFF by design so the exit-side ripple can be reviewed before flipping; scripts/loop_edge_sweep.py measures would-vs-is and the live flip is recorded as a human decision. Read this as 'the correct vector is computed every scan and is currently not used' — which is true, and is the interesting fact — not as a bug nobody noticed."
        values={[
          liveConfig(
            "HMM_FEATURE_FIX_ENABLED",
            "false",
            "updated_at 2026-07-10 22:44:20 — while false, the broken vector is the live one",
          ),
          mirroredTable("FEATURE_NAMES", "FEATURE_NAMES (the declared contract)"),
          mirrored("N_FEATURES", "N_FEATURES"),
          masterConst(
            "dm_ratio ternary",
            "±0.3",
            "constant in discord_bot.py",
          ),
          masterConst(
            "vol_ratio divisor and clamp",
            "÷ 12, clipped to [0.5, 3.0]",
            "constants in discord_bot.py",
          ),
          masterConst("rsi_dist", "0.0", "hardcoded in discord_bot.py"),
        ]}
      />

      <FormulaEntry
        id="F-IND-23"
        name="The 4→3 Collapse and Regime Routing"
        status="live"
        statusNote='Mode from auto_config.HMM_REGIME_SOURCE, live "hmm". Fallback chain: ① HMM accepted → (mapped, "hmm:<STATE>,p=<prob>") · ② else non-empty rules regime → (rules_regime, "rules") · ③ else → ("NORMAL", "fallback").'
        source="regime_source.resolve_regime · regime_source.HMM_TO_RULES"
        tex={[
          String.raw`\text{TRENDING\_BULL} \mapsto \text{TRENDING}, \quad \text{TRENDING\_BEAR} \mapsto \text{TRENDING}, \quad \text{VOLATILE} \mapsto \text{VOLATILE}, \quad \text{RANGING} \mapsto \text{RANGING}`,
          String.raw`\text{HMM accepted} \iff \big(p_{\hat{s}} \ge 0.50\big) \wedge \big(\text{age} \le 900\text{s}\big)`,
        ]}
        symbols={[
          {
            sym: String.raw`p_{\hat{s}}`,
            means: "the winning state's probability; MIN_HMM_PROB = 0.50.",
          },
          {
            sym: String.raw`\text{age}`,
            means:
              "seconds since the inference row was written; STALE_AFTER_SEC = 15 × 60.",
          },
        ]}
        why="The HMM distinguishes bull from bear trends, but everything downstream — the market-state tier, the engine threshold — only cares whether a trend exists. Collapsing bull and bear into one TRENDING label keeps the model's extra resolution available for logging while giving consumers the 3-state vocabulary they were built against. The two acceptance conditions are the safety: a stale prediction or a coin-flip posterior is discarded in favour of the deterministic rules regime rather than trusted."
        caveat="Directional bias is not lost — it is sourced elsewhere. The counter-trend penalty (F-IND-26) reads trend_direction from regime_detail, i.e. from the RULES layer (close vs EMA21), not from the HMM's bull/bear split, and the two can disagree. A collapse consequence worth knowing: ticker_thresholds.ACTIVE_REGIMES is frozenset(['TRENDING']), and because the collapse happens BEFORE threshold classification, TRENDING_BULL and TRENDING_BEAR both become TRENDING and can reach the `active` tier — had the raw 4-state been passed through, neither would ever match. This output has three downstream consumers across three slices: the engine threshold (F-IND-24), the leverage regime multiplier (F-SIZE-07), and the ATR rung-1 regime multiplier (F-EXIT-09)."
        values={[
          liveConfig(
            "HMM_REGIME_SOURCE",
            "hmm",
            "permitted values rules | shadow | hmm",
          ),
          mirrored("MIN_HMM_PROB", "MIN_HMM_PROB"),
          mirrored("STALE_AFTER_SEC", "STALE_AFTER_SEC"),
          mirrored("FALLBACK_REGIME", "FALLBACK_REGIME"),
          mirroredTable("HMM_TO_RULES", "HMM_TO_RULES"),
        ]}
      />
    </MathSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Thresholds
// ─────────────────────────────────────────────────────────────────────────────

function SectionThresholds() {
  const adaptive = parseJson<
    Record<string, { threshold: number; required_groups: number; must_include: string[] }>
  >(MATH_CONSTANTS.ADAPTIVE_THRESHOLD_BY_REGIME?.value);

  const adaptiveRows: FormulaValue[] = ["TRENDING", "RANGING", "VOLATILE"].map(
    (regime) => {
      const row = adaptive?.[regime];
      if (!row) {
        return noLiveValue(
          regime,
          `\`ADAPTIVE_THRESHOLD_BY_REGIME.${regime}\` could not be read from the code-constant mirror at ${MIRRORED_FROM}.`,
        );
      }
      return {
        label: regime,
        value: String(row.threshold),
        note: `${row.required_groups} groups required · must include ${row.must_include.join(", ")}${
          regime === "VOLATILE"
            ? " (VOLATILE is the else-branch, so it is also the value for any unrecognised regime)"
            : ""
        }`,
      };
    },
  );

  return (
    <MathSection
      number={4}
      title={sectionTitle(4)}
      intro={
        <p>
          The bar a signal must clear is built in layers. The engine&apos;s
          internal gate depends on how trustworthy the environment is; the
          market-state tier answers how selective to be right now; and the
          per-ticker effective threshold composes how noisy an asset is with how
          much harder it is to fight a trend. The last entry in this section is
          the set of numbers everyone quotes — and it decides nothing.
        </p>
      }
    >
      <FormulaEntry
        id="F-IND-24"
        name="Regime-Adaptive Engine Threshold"
        status="live"
        source="scalp_engine.get_adaptive_threshold"
        tex={String.raw`T_{\text{regime}} \mathrel{+}= 10 \quad \text{if vol\_state} = \text{EXTREME}`}
        symbols={[
          {
            sym: String.raw`T_{\text{regime}}`,
            means:
              "the engine's internal threshold for the resolved regime — the per-regime row in the standing values below.",
          },
          {
            sym: String.raw`\text{vol\_state}`,
            means:
              "the volatility state; EXTREME adds a flat +10 surcharge to the regime's threshold.",
          },
        ]}
        why="The bar should depend on how trustworthy the environment is. In a clean trend, two confirming groups including trend is genuine evidence, so the bar is lowest. In a range, price is going nowhere and only real participation distinguishes a breakout from noise — hence volume is mandatory and the bar rises. VOLATILE sits between: three groups required, trend mandatory, because directionless violence is where the system loses money. The EXTREME surcharge is a blunt final tightening for conditions where every indicator degrades at once."
        caveat="This threshold is the engine's INTERNAL gate, not the posting gate. It decides signal_fires inside analyze_scalp_v2; the per-ticker threshold (F-IND-26) is applied afterwards and is strictly higher in every live configuration."
        values={[
          ...adaptiveRows,
          masterConst("EXTREME volatility surcharge", "+10"),
          masterConst(
            "Tunability",
            "none",
            "the table and the surcharge are hardcoded in scalp_engine.get_adaptive_threshold with NO auto_config key — not tunable without a code change",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-25"
        name="Market-State Classification"
        status="live"
        source="ticker_thresholds.classify_market_state"
        tex={String.raw`\text{state} = \begin{cases}\text{quiet} & P(\text{ATR}_\%) < 30\\ \text{active} & P(\text{ATR}_\%) > 70 \;\wedge\; \text{regime} \in \{\text{TRENDING}\}\\ \text{normal} & \text{otherwise}\end{cases}`}
        symbols={[
          {
            sym: String.raw`P(\text{ATR}_\%)`,
            means: "the rolling ATR percentile from F-IND-10.",
          },
          {
            sym: String.raw`\text{quiet vs. active}`,
            means:
              "note the asymmetry: quiet needs only low volatility; active needs high volatility AND a trend.",
          },
        ]}
        why="The tier answers 'how selective should we be right now?' A sleepy market produces few setups, so the bar drops to catch moves others ignore. A market that is both fast and trending produces many setups, most of them chasing — so the bar rises and only the best qualify. The asymmetry is deliberate: high volatility without a trend is chop, which deserves the normal bar rather than the selective one, because being selective in chop just means picking a better-looking loser."
        caveat="Cold-start consequence: with P = 50.0 returned for the first 50 samples after any restart, every ticker is pinned to `normal` for ~2.5 hours at the 3-minute cadence."
        values={[
          mirrored("ATR_QUIET_THRESHOLD", "ATR_QUIET_THRESHOLD"),
          mirrored("ATR_ACTIVE_THRESHOLD", "ATR_ACTIVE_THRESHOLD"),
          mirrored("ACTIVE_REGIMES", "ACTIVE_REGIMES"),
          masterConst(
            "Boundary handling",
            "exclusive on both sides",
            "P < 30 and P > 70 — a percentile of exactly 30 or exactly 70 is `normal`",
          ),
          masterConst(
            "Unrecognised regime",
            "normal",
            "classify_market_state only special-cases TRENDING, so the NORMAL fallback regime and any unrecognised label yield the normal tier — the intended conservative default",
          ),
          noLiveValue(
            "Tier currently in force",
            "the ATR-percentile history is memory-only, so the tier currently in force is NOT retrievable from the replica.",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-26"
        name="Effective Threshold (per ticker)"
        status="live"
        statusNote="Called from discord_bot behind PER_TICKER_THRESHOLDS_ENABLED, a module constant hardcoded True."
        source="ticker_thresholds.get_effective_threshold"
        tex={[
          String.raw`T_{\text{eff}} = B(\text{ticker}, \text{state}) + \Pi(\text{ticker}) \cdot \mathbb{1}[\text{counter-trend}]`,
          String.raw`\text{counter-trend} \iff (\text{dir}=\text{LONG} \wedge \text{trend\_dir}=\text{DOWN}) \;\vee\; (\text{dir}=\text{SHORT} \wedge \text{trend\_dir}=\text{UP})`,
        ]}
        symbols={[
          {
            sym: String.raw`B`,
            means:
              "the per-ticker base threshold for the active tier — the full table is in the standing values below.",
          },
          {
            sym: String.raw`\Pi`,
            means: "that ticker's counter-trend penalty.",
          },
          {
            sym: String.raw`\text{trend\_dir}`,
            means:
              "from the RULES regime layer (close vs EMA21). FLAT never incurs a penalty.",
          },
        ]}
        why="Two separate risk adjustments composed into one number. The base encodes how noisy an asset is — BTC's signals are cleaner than FARTCOIN's, so BTC needs less evidence. The penalty encodes that fighting a trend is harder than following it, scaled by how violently that asset reverses. Crucially the penalty is added to the THRESHOLD, never subtracted from the score: the bar rises, the evidence is untouched. That is what keeps the penalty's meaning stable when weights change — with the composite fixed to a 0–100 scale by the sum-to-5.0 invariant, +8 always means the same thing."
        caveat="PER_TICKER_THRESHOLDS_ENABLED is a module constant hardcoded True — there is NO auto_config row for it (verified: 0 rows), so the Hub cannot read this from the DB."
        values={[
          mirrored(
            "PER_TICKER_THRESHOLDS_ENABLED",
            "PER_TICKER_THRESHOLDS_ENABLED",
          ),
          liveConfig(
            "RECALIBRATED_THRESHOLDS_V2 (table selector)",
            "false",
            "so the PRODUCTION table below is the one in force — see F-IND-27 for the alternative",
          ),
          ...productionThresholdRows(),
          masterConst(
            "Structure",
            "+3 / +3 tier spacing",
            "four risk classes emerge — BTC (34) < ETH (36) < SOL/XRP (38) < HYPE/NEAR/SUI (39) < FARTCOIN/DOGE/kPEPE (42) — and the penalty tracks them monotonically (3→4→5→6→8)",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-27"
        name="Recalibrated Thresholds V2"
        status="dormant"
        statusNote="Gate / proof: auto_config.RECALIBRATED_THRESHOLDS_V2 = false (updated_at 2026-05-27 14:01:49). get_ticker_threshold reads the production table."
        source="ticker_thresholds.RECALIBRATED_THRESHOLDS_V2"
        tex={[]}
        symbols={[]}
        why="Built but not in force. The file's own comments already mark the V2 optima INSUFFICIENT_POWER."
        caveat="It carries a structural hazard worth stating plainly: the V2 dict defines only 5 of the 10 sacred tickers (BTC, ETH, SOL, HYPE, FARTCOIN). The lookup falls back to RECALIBRATED_THRESHOLDS_V2['FARTCOIN'] for any missing key, so flipping this flag would silently hand XRP, DOGE, NEAR, SUI and kPEPE FARTCOIN's thresholds (42/45/48). For DOGE and kPEPE that is coincidentally their current value; for NEAR and SUI it is a real change of +3, and for XRP it is +4 — the master records +3 for all three, but the mirror's own tables give XRP 38/41/44 → 42/45/48. The mirror wins."
        values={[
          liveConfig("RECALIBRATED_THRESHOLDS_V2 (flag)", "false"),
          ...recalibratedV2Rows(),
        ]}
      />

      <FormulaEntry
        id="F-IND-28"
        name="Confidence Calibration and Delta Cap"
        status="live"
        statusNote="Gates: auto_config.CALIBRATOR_LIVE = true; auto_config.CALIBRATOR_DELTA_CAP = true."
        source="confidence_calibrator.cap_applied_delta — applied in discord_bot"
        tex={String.raw`S_{\text{cal}} = \text{clip}\Big(S + \text{clip}\big(f(S,\text{ticker}) - S,\; -\Delta,\; +\Delta\big),\; 0,\; 100\Big), \qquad \Delta = 2.0 \;\;(\text{cap ON})`}
        symbols={[
          {
            sym: String.raw`f(S,\text{ticker})`,
            means:
              "the calibrator's per-ticker, per-bucket historical win-rate mapping.",
          },
          {
            sym: String.raw`\Delta`,
            means:
              "the maximum the calibrator may move a score: 2.0 with CALIBRATOR_DELTA_CAP on, 20.0 with it off.",
          },
        ]}
        why="The composite is a score, not a probability — a 45 does not mean 45% of anything. The calibrator learns from closed trades what each score band actually delivered per ticker, and nudges accordingly. The cap exists because the unbounded version failed in production: it dragged essentially every signal about 5 points into losing bands, so the clamp was tightened from ±20 to ±2. That is a real lesson worth showing — a feedback loop that adjusts everything by a similar amount has stopped calibrating and started shifting the threshold."
        caveat="Three further adjustments are applied to _calibrated after this, each clip(·, 0, 100): a chop-brake adjustment (CHOP_BRAKE_ENABLED live true), an MTF-asymmetry adjustment (MTF_ASYMMETRY_V2 live false → inert), and an alt-data adjustment. The value reaching the gate is the composite plus calibration plus these, not the raw composite."
        values={[
          mirrored("CALIBRATOR_DELTA_CAP_ON", "Δ with the cap ON"),
          mirrored("CALIBRATOR_DELTA_CAP_OFF", "Δ with the cap OFF"),
          liveConfig("CALIBRATOR_LIVE", "true"),
          liveConfig("CALIBRATOR_DELTA_CAP", "true"),
          liveConfig("CALIBRATOR_SHADOW_ENABLED", "true"),
          liveConfig("CHOP_BRAKE_ENABLED", "true"),
          liveConfig("MTF_ASYMMETRY_V2", "false", "→ that adjustment is inert"),
        ]}
      />

      <FormulaEntry
        id="F-IND-29"
        name="signal_guard.REGIME_THRESHOLDS"
        status="dead"
        statusNote="Proof of status: in discord_bot, immediately before should_post_signal, every key of signal_guard.REGIME_THRESHOLDS is set to _eff_thresh and BASE_THRESHOLD is likewise overwritten; should_post_signal is called; a finally restores both. Whichever branch check_confidence takes, the comparison is identical."
        source="signal_guard.REGIME_THRESHOLDS · signal_guard.BASE_THRESHOLD · signal_guard.check_confidence"
        tex={String.raw`\text{guard passes} \iff S_{\text{cal}} \ge T_{\text{eff}}`}
        symbols={[
          {
            sym: String.raw`S_{\text{cal}}`,
            means: "the calibrated score — see F-IND-28.",
          },
          {
            sym: String.raw`T_{\text{eff}}`,
            means:
              "the per-ticker effective threshold — see F-IND-26. This is the number the guard actually compares against.",
          },
        ]}
        why="The declared table — TRENDING 42 · VOLATILE 50 · RANGING 60 · EXTREME_VOLATILE 80 · BASE 65 — is confirmed present in the sacred file exactly as recorded, and cannot influence any live decision. The legacy branch (PER_TICKER_THRESHOLDS_ENABLED = False) would use them, and that constant is hardcoded True."
        caveat="THESE NUMBERS DECIDE NOTHING, AND THIS ENTRY IS NOT THE GATE. discord_bot overwrites every key of signal_guard.REGIME_THRESHOLDS in place with the per-ticker effective threshold before calling should_post_signal, and restores them in a finally — so four of the most quotable numbers in the posting gate are dead code on the live path. The live gate value is T_eff from F-IND-26. Do not confuse this with SIGNAL_V5_NO_CONFGATE (live true): that flag makes auto_trader/manager.py Gates 0.9 and 1 and auto_trader/judgment.py's confidence floor inert, and it has NO reader in signal_guard.py (verified by grep). The signal_guard gate still runs; it just runs against a different number than the one written in the file."
        values={[
          mirroredTable(
            "REGIME_THRESHOLDS",
            "Declared table — ⚫ DEAD, decides nothing",
          ),
          mirrored(
            "BASE_THRESHOLD",
            "Declared base — ⚫ DEAD, decides nothing",
          ),
          {
            label: "The value the gate actually uses",
            value: "T_eff (F-IND-26)",
            note: "the per-ticker effective threshold, written into these keys immediately before the call and restored immediately after",
          },
        ]}
      />
    </MathSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Cooldown & dedup
// ─────────────────────────────────────────────────────────────────────────────

function SectionCooldownDedup() {
  return (
    <MathSection
      number={5}
      title={sectionTitle(5)}
      intro={
        <p>
          Without a cooldown the scanner would re-post the same setup every scan
          for as long as it persisted, burying the real signal in duplicates.
          Price proximity is the belt-and-braces layer behind it — if the
          cooldown expires but price has not meaningfully moved, the &quot;new&quot;
          signal is the same setup wearing a new timestamp. An exact score tie is
          resolved to NEUTRAL rather than silently to LONG.
        </p>
      }
    >
      <FormulaEntry
        id="F-IND-30"
        name="Cooldown Window and Escalation Override"
        status="live"
        statusNote="Two layers on the same key: signal_cooldown.is_signal_on_cooldown (SQLite-backed, survives restarts) and signal_guard.check_cooldown (in-memory, warmed from SQLite at boot). Keyed on normalized ticker + direction."
        source="signal_cooldown.is_signal_on_cooldown · signal_guard.check_cooldown"
        tex={[
          String.raw`\text{blocked} \iff \big(t_{\text{now}} - t_{\text{posted}} < W\big) \;\wedge\; \neg\big(c_{\text{now}} \ge c_{\text{last}} + 10\big)`,
          String.raw`W = \begin{cases}\text{cfg}(\texttt{COOLDOWN\_WINDOW\_SECONDS}) & \text{if} \ge 60\\ 3600 & \text{on any error / below floor}\end{cases} \qquad W_{\text{live}} = 900`,
        ]}
        symbols={[
          {
            sym: String.raw`W`,
            means:
              "the cooldown window, live 900 s (15 min), 30-second cached, hard floor COOLDOWN_WINDOW_FLOOR = 60, fail-safe COOLDOWN_SECONDS = 3600.",
          },
          {
            sym: String.raw`c`,
            means: "confidence; CONFIDENCE_ESCALATION = 10.",
          },
        ]}
        why="Without a cooldown the scanner would re-post the same setup every scan for as long as it persisted, burying the real signal in duplicates. But a fixed window is too blunt: if a setup that scored 41 strengthens to 55, that is new information, not a duplicate. The escalation override lets a materially stronger reading through while a merely-repeated one waits. Both layers are keyed per ticker AND direction, so a genuine reversal is never suppressed by the original signal's cooldown."
        caveat="Three windows are deliberately kept in lockstep on the same key — signal_cooldown, signal_guard, and discord_bot._dedup_window_seconds (SIGNAL_DEDUP_SECONDS) — all read COOLDOWN_WINDOW_SECONDS with the same 3600 fallback and 60 floor, so no dead zone can form between layers."
        values={[
          liveConfig(
            "COOLDOWN_WINDOW_SECONDS",
            "900",
            "updated_at 2026-06-08 05:31:25",
          ),
          mirrored("COOLDOWN_WINDOW_FLOOR", "COOLDOWN_WINDOW_FLOOR"),
          mirrored("COOLDOWN_SECONDS", "COOLDOWN_SECONDS (fail-safe)"),
          masterConst("Config cache TTL", "30 s"),
          unmirrored("CONFIDENCE_ESCALATION", "CONFIDENCE_ESCALATION"),
          noDbRead(
            "Live per-ticker cooldown state",
            "signal_cooldowns.base_ticker, .direction, .posted_at (epoch float), .confidence, .entry_price",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-31"
        name="Price-Proximity Dedup"
        status="live"
        source="signal_guard.check_price_proximity"
        tex={String.raw`\text{blocked} \iff \frac{|P_{\text{now}} - P_{\text{last}}|}{P_{\text{last}}} < 0.005`}
        symbols={[
          {
            sym: String.raw`P_{\text{now}}`,
            means: "the price on the signal being considered now.",
          },
          {
            sym: String.raw`P_{\text{last}}`,
            means:
              "the last posted signal's price for this key — warm-cached from signal_cooldowns.entry_price.",
          },
        ]}
        why="A belt-and-braces layer behind the cooldown. If the cooldown expires but price has not meaningfully moved, the 'new' signal is the same setup wearing a new timestamp. Half a percent is the smallest move that is not just spread and noise on these assets."
        caveat="Cold-start note: the cache is in-memory, but warm_cache_from_sqlite seeds both it and the cooldown cache from signal_cooldowns at boot, closing the cold-start bypass window."
        values={[
          mirrored("PRICE_PROXIMITY_THRESHOLD", "PRICE_PROXIMITY_THRESHOLD"),
          noDbRead(
            "Live last prices",
            "signal_cooldowns.entry_price (the warm-cache source)",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-32"
        name="Tie Neutralization"
        status="live"
        statusNote="Gate: auto_config.SIGNAL_V5_NEUTRAL_TIE = true."
        source="scalp_engine.analyze_scalp_v2"
        tex={String.raw`S_{\text{LONG}} = S_{\text{SHORT}} \;\Longrightarrow\; \text{direction} := \text{NEUTRAL},\; S := 0`}
        symbols={[
          {
            sym: String.raw`S_{\text{LONG}}`,
            means: "the composite score computed for the LONG direction.",
          },
          {
            sym: String.raw`S_{\text{SHORT}}`,
            means: "the composite score computed for the SHORT direction.",
          },
        ]}
        why="The direction loop iterates LONG then SHORT and keeps the best with a strict >, so an exact tie silently resolved to LONG — a directional bias hidden in loop order rather than in any model. When both directions score identically the evidence genuinely favours neither, and emitting NEUTRAL is the honest answer. With the flag on, the tie is also surfaced on the result (score_tie, long_total, short_total) so it can be measured rather than inferred."
        values={[liveConfig("SIGNAL_V5_NEUTRAL_TIE", "true")]}
      />
    </MathSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Stage-A screens
// ─────────────────────────────────────────────────────────────────────────────

function SectionStageAScreens() {
  return (
    <MathSection
      number={6}
      title={sectionTitle(6)}
      intro={
        <p>
          Family 6 screens run <strong>before</strong> the AutoTrader manager
          sees anything, which is why <code>decision_log</code> records only ~11%
          of rejections.
        </p>
      }
    >
      <FormulaEntry
        id="F-IND-33"
        name="CandidateSignal Contract"
        status="live"
        overlay="dormant"
        statusNote="SPLIT — 🟢 LIVE is the STRUCTURE: the candidate is built on the live path every time. ⚪ DORMANT is the CONSUMER: PORTFOLIO_INTEGRATION_ENABLED = false keeps the R5 judgment chain dark. What receives it is not running."
        source="candidate_signal.build_candidate_signal · candidate_signal.CandidateSignal"
        tex={String.raw`\text{group\_scores}[g] = \text{pts}_{g,d^\*} \quad \forall g \in G \qquad \text{(no weights applied — raw points)}`}
        symbols={[
          {
            sym: String.raw`G`,
            means: "the five confluence groups.",
          },
          {
            sym: String.raw`\text{pts}_{g,d^\*}`,
            means:
              "the raw points group g scored for the winning direction d*, with no weighting applied.",
          },
        ]}
        why="A clean separation of concerns: the mechanical layer reports what it measured, the judgment layer decides what it means. Passing a pre-baked confidence number across that boundary would let a discredited composite quietly drive decisions it was never validated for. Handing over the five raw group scores lets the consumer weigh them itself."
        caveat="Two properties confirmed verbatim in code. (1) NO confidence field: the dataclass carries group_scores (raw per-group points) as evidence, with an explicit in-code prohibition on adding a confidence verdict — the v4 composite was anti-predictive and surfacing it would re-couple the interface to it. (2) regime is observed context, never a gate — nothing in the module filters on it. Also: market_context.oi_delta is None BY DESIGN — no OI history is stored (Hyperliquid's 5k-candle cap), so a true delta cannot be computed and is left explicitly null rather than faked (same root cause as the dead OI leg in F-IND-16). And the cross-family tension worth carrying: confidence was struck from THIS contract as anti-predictive — and it is still a live input to leverage weighting (F-SIZE-07) and to the exit rung-1 target height (F-EXIT-09)."
        values={[
          liveConfig(
            "PORTFOLIO_INTEGRATION_ENABLED",
            "false",
            "the R5 consumer is dormant; the candidate is still built on the live path",
          ),
          masterConst(
            "confidence field",
            "absent by design",
            "an explicit in-code prohibition on adding one",
          ),
          masterConst(
            "playable_space",
            "SCALP_WHITELIST + leverage_rec + max_hold_minutes",
            "field list is a set of constants in candidate_signal.py",
          ),
          masterConst("market_context.oi_delta", "None", "by design"),
        ]}
      />

      <FormulaEntry
        id="F-IND-34"
        name="Stage-A Screen: Trend Floor"
        status="live"
        statusNote="Gate: auto_config.TREND_FLOOR_V2_ENABLED = true; auto_config.TREND_FLOOR_V2_VALUE = 6."
        source="discord_bot._run_scalp_scan — [TREND-FLOOR] sentinel"
        tex={String.raw`\text{blocked} \iff \text{pts}_{\text{trend}} < F, \qquad F_{\text{live}} = 6`}
        symbols={[
          {
            sym: String.raw`\text{pts}_{\text{trend}}`,
            means:
              "read from signal.raw['groups_fired']['trend']['points'], 0–20 scale.",
          },
          {
            sym: String.raw`F`,
            means:
              "the floor, hot-readable from auto_config with NO restart required.",
          },
          {
            sym: String.raw`\text{fail-open}`,
            means:
              "a missing or malformed payload defaults pts_trend to 20, i.e. no block.",
          },
        ]}
        why="Trend is the only group with measured positive predictive value on live trades, and the cohort scoring below 6 on it was a documented disaster — 8.0% win rate over 25 trades. Cutting that cohort was projected to lift win rate by 2.6pp. This is the cheapest filter in the system: one integer comparison against a group score already computed. It is uniform across all 10 tickers and both directions, so it does not restrict any ticker or direction."
        caveat="Shadow mode is retained: when the flag is false the same comparison logs [TREND-FLOOR] SHADOW-BLOCK and proceeds. Candidate floors of 7/8/10 are logged to trend_floor_shadow for signals that CLEARED the live floor, so a tighten can be justified from forward data. Live-blocked signals never reach that logger, by design."
        values={[
          liveConfig("TREND_FLOOR_V2_ENABLED", "true"),
          liveConfig("TREND_FLOOR_V2_VALUE", "6"),
          mirrored(
            "TREND_FLOOR_FAIL_OPEN_POINTS",
            "Fail-open default",
            "the mirror's trailing \"(DEFAULTS 'false')\" belongs to TREND_FLOOR_V2_ENABLED, not to this 0–20 points value — and that flag's live auto_config row reads true, so the floor IS enforced",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-35"
        name="Stage-A Screen: P3 Entry Screen"
        status="live"
        statusNote="Gate: auto_config.P3_ENTRY_SCREEN_ENABLED = true; P3_MICRO_MIN = 6; P3_VOLUME_MIN = 6."
        source="discord_bot auto-trader wrapper — [P3-SCREEN] sentinel, immediately before mgr.on_signal(payload)"
        tex={String.raw`\text{blocked} \iff \Big(\text{micro} \in \text{gs} \;\wedge\; \text{volume} \in \text{gs}\Big) \wedge \Big(\text{pts}_\mu < 6 \;\vee\; \text{pts}_{\text{vol}} < 6\Big)`}
        symbols={[
          {
            sym: String.raw`\text{gs}`,
            means:
              "the payload's group_scores. BOTH keys must be present or the screen passes.",
          },
          {
            sym: String.raw`\text{P3\_MICRO\_MIN},\ \text{P3\_VOLUME\_MIN}`,
            means: "the floors — auto_config-tunable without a restart.",
          },
        ]}
        why="The sole survivor of a multiple-comparison-corrected search over entry filters. It demands that the two groups measuring real participation — order flow and volume — both independently confirm. A setup that looks good on price geometry alone but has nobody trading it is the profile that bled money."
        caveat="Placement is the important part. This is an ENTRY-ONLY block that runs AFTER the Discord post and after set_cooldown. A block removes the auto-trade and nothing else — it cannot free a cooldown, and it cannot change which signals post. The signal stream is unperturbed while the trade stream is filtered. It is also fail-open twice: a missing key passes, and any exception passes."
        values={[
          liveConfig("P3_ENTRY_SCREEN_ENABLED", "true"),
          liveConfig("P3_MICRO_MIN", "6"),
          liveConfig("P3_VOLUME_MIN", "6"),
        ]}
      />

      <FormulaEntry
        id="F-IND-36"
        name="Stage-A Screen: Volume-Aware Persistence Gate"
        status="inert"
        statusNote="Live, and structurally unable to block. Gate: auto_config.PERSISTENCE_GATE_RELAXED = true."
        source="discord_bot._run_scalp_scan"
        tex={[
          String.raw`\text{blocked} \iff \big|\{t \in H_{\text{key}} : t_{\text{now}} - t < 540\}\big| < N_{\min}`,
          String.raw`N_{\min} = \begin{cases} 1 & \texttt{PERSISTENCE\_GATE\_RELAXED} = \text{true} \quad (\textbf{live})\\ 1 & \text{low volume period}\\ 2 & \text{normal volume}\end{cases}`,
        ]}
        symbols={[
          {
            sym: String.raw`H_{\text{key}}`,
            means:
              "sliding history of qualifying scans for this (ticker, direction), pruned to the window.",
          },
          {
            sym: String.raw`540\text{ s}`,
            means: "a 9-minute window — 3 scan cycles at the 3-minute cadence.",
          },
          {
            sym: String.raw`N_{\min}`,
            means:
              "the required sighting count. The current scan is appended BEFORE the count, so with N_min = 1 the condition can never block.",
          },
        ]}
        why="A setup visible for one instant is often a data artifact; one that survives several scans is real. Requiring two sightings in nine minutes filters flicker at the cost of a few minutes of entry delay. A single below-threshold scan does not reset the history — only window expiry prunes it — so a momentary dip does not destroy accumulated persistence. On a direction flip the opposite direction's history is explicitly cleared, so a reversal cannot inherit the old side's persistence."
        caveat="LIVE, THIS GATE BLOCKS NOTHING. With PERSISTENCE_GATE_RELAXED = true, N_min = 1, and the current scan appended before the length check, len(_hist) >= 1 always — the block branch is STRUCTURALLY UNREACHABLE in the live configuration. The code's own comment records 'measured 0/hr this epoch'. The formula above is what the gate computes; the live parameterisation is what makes it inert."
        values={[
          liveConfig("PERSISTENCE_GATE_RELAXED", "true"),
          liveConfig(
            "PERSISTENCE_GATE_V2",
            "true",
            "shadow logging only",
          ),
          mirrored(
            "PERSISTENCE_WINDOW_SECONDS",
            "PERSISTENCE_WINDOW_SECONDS",
          ),
        ]}
      />

      <FormulaEntry
        id="F-IND-37"
        name="Shadow Scorers (×3)"
        status="shadow"
        statusNote="Three counterfactual scorers compute alternative composites and write them for forward analysis, with NO effect on firing."
        source="group_weight_shadow · shadow_scorer_v2 · trend_floor_shadow — three writers; the master records no single module.symbol for this entry"
        tex={String.raw`S_{\text{shadow}} = \text{clip}\Big(\sum_{g} \text{pts}_g \cdot w^{\text{shadow}}_g,\;0,\;100\Big), \qquad \delta = S_{\text{shadow}} - S`}
        symbols={[
          {
            sym: String.raw`S_{\text{shadow}}`,
            means:
              "the alternative composite computed under the shadow weights, clipped to [0, 100].",
          },
          {
            sym: String.raw`w^{\text{shadow}}_g`,
            means: "the shadow weight for group g.",
          },
          {
            sym: String.raw`\delta`,
            means:
              "the divergence from the live composite. |δ| ≥ 0.1 emits a [GROUP-WEIGHT-SHADOW] WARNING.",
          },
        ]}
        why="Three counterfactual scorers compute alternative composites and write them for forward analysis, with no effect on firing."
        caveat="The group-weight shadow is CURRENTLY A NO-OP: it only runs when GROUP_WEIGHTS_V2 is false, and GROUP_WEIGHTS_V2 is live true. There is no counterfactual to record, so group_weight_shadow receives nothing."
        values={[
          liveConfig(
            "GROUP_WEIGHTS_V2_SHADOW",
            "true",
            "gates the group-weight shadow, which is a no-op while GROUP_WEIGHTS_V2 is true → group_weight_shadow table",
          ),
          liveConfig(
            "SHADOW_SCORER_V2_ENABLED",
            "true",
            "5 alternative composites (configs A–E, optional F) per scan tick → shadow_scorer_v2 table",
          ),
          masterConst(
            "Trend-floor shadow",
            "always on",
            "runs inside the trend-floor try; would-be-block status at candidate floors 7/8/10 → trend_floor_shadow, written off-loop via run_db_write",
          ),
          masterConst("Divergence WARNING threshold", "|δ| ≥ 0.1"),
        ]}
      />
    </MathSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function MathRegimeThresholds() {
  return (
    <>
      <SectionRegime />
      <SectionThresholds />
      <SectionCooldownDedup />
      <SectionStageAScreens />
    </>
  );
}
