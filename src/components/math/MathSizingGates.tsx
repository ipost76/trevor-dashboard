import * as React from "react";
import {
  FormulaEntry,
  MathSection,
  MATH_SECTIONS,
  type FormulaEntryProps,
} from "@/components/math";
import { Pill, type PillProps } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  MATH_CONSTANTS,
  MIRRORED_AT,
  MIRRORED_FROM,
} from "@/lib/math-constants";

/**
 * Sections 7-9 — sizing · the tail cap · the gates.  [D3, 2026-08-05]
 * Formula IDs F-SIZE-01…15, plus the CASCADE_LMAX table (§8) and the 15-gate
 * roster + 4 extra numeric constraints (§9).
 *
 * Every entry is TRANSCRIBED from the RM-MATH master spec (VM,
 * docs/reports/recon/2026-08-04_math-page/). No formula, symbol, explanation or
 * number is authored here. Where the master and the constant mirror disagree,
 * THE MIRROR WINS and the disagreement is stated on the page.
 *
 * 🚨 THREE THINGS THIS FILE EXISTS TO SAY CORRECTLY:
 *
 *  1. F-SIZE-08, the tail cap, is the leverage authority that actually binds.
 *     It is wired UNCONDITIONALLY with NO feature flag and overwrites the
 *     computed leverage with floor(0.50 x CASCADE_LMAX) — BTC 2x, every other
 *     sacred ticker 1x. The machinery in F-SIZE-06/07 is discarded on 9 of 10.
 *  2. F-SIZE-07 is LIVE and OVERWRITTEN. Without its caveat a reader concludes
 *     their confidence score steers leverage. It does not.
 *  3. LIVE_HARD_CAPITAL_CAP_USD ($50) is a NO-OP STUB — `_check_capital_cap`
 *     returns (True, "OK") unconditionally. It must never render as a safety
 *     limit; doing so would teach Ghost his money is protected by a guard that
 *     does nothing.
 *
 * 🚨 THE NOTIONAL TRAP. `auto_trades.notional_usd` IS THE POSTED MARGIN, and it
 * is decremented by every partial exit. Position notional is
 * `notional_usd x leverage`. Dividing margin BY leverage produces a figure wrong
 * by L^2. Every entry that touches position size says so.
 *
 * BOUNDARY WITH D4: this file renders the CASCADE_LMAX table because it is the
 * tail cap's own table. The four-sleeve registry (its `lmax_fraction` AND
 * `stop_pct` columns, plus the inertness status line) belongs to D4 in section
 * 11 — F-SIZE-11 points there rather than reproducing it. Do not add a second
 * sleeve table here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Titles come from the shared registry — never hardcoded in a section file.
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_TITLE: Record<number, string> = Object.fromEntries(
  MATH_SECTIONS.map((s) => [s.number, s.title]),
);

/** Provenance for every code constant cited below. One stamp, one reseed. */
const MIRROR_STAMP = `Code constants are mirrored from the bot repo at commit ${MIRRORED_FROM} (${MIRRORED_AT}); live auto_config values were read on 2026-08-05.`;

// ─────────────────────────────────────────────────────────────────────────────
// Mirror readers. The cascade table and the cluster map are DERIVED from
// math-constants.ts rather than retyped, so a reseed can never leave this page
// asserting a number the mirror no longer holds.
// ─────────────────────────────────────────────────────────────────────────────

function mirroredNumber(key: string): number {
  const raw = MATH_CONSTANTS[key]?.value;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function mirroredJson(key: string): unknown {
  const raw = MATH_CONSTANTS[key]?.value;
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A malformed mirror entry must cost this one table, never the route.
    return null;
  }
}

function mirroredNumberMap(key: string): Record<string, number> {
  const parsed = mirroredJson(key);
  if (!parsed || typeof parsed !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** `f`, the tail-cap fraction actually in force today. */
const TAIL_CAP_FRACTION = mirroredNumber("_CONSERVATIVE_LMAX_FRACTION");
/** `φ`, the ladder floor. */
const LADDER_FLOOR = mirroredNumber("LEVERAGE_LADDER_FLOOR");

const FRACTION_LABEL = Number.isFinite(TAIL_CAP_FRACTION)
  ? TAIL_CAP_FRACTION.toFixed(2)
  : "—";

/**
 * The three tickers carried in CASCADE_LMAX that are NOT in the sacred trading
 * universe today. Forward-looking sleeve config — diversifiers and a liquidity
 * name — not tradeable.
 */
const NOT_TRADEABLE = new Set(["PAXG", "XMR", "ZEC"]);

interface CascadeRow {
  ticker: string;
  lambda: number;
  venue: number;
  /** f · Λ_T */
  scaled: number;
  /** C_T = max(φ, min(f·Λ_T, venue_max)) */
  cap: number;
  /** L = floor(C_T) — HL leverage is an integer. */
  lev: number;
  /** True where the ladder floor, not the cascade ceiling, set the cap. */
  fromFloor: boolean;
  tradeable: boolean;
}

/**
 * The cap each ticker produces at today's `f`, evaluated with the code's own
 * expression — `sleeves.effective_lev`, mirrored as EFFECTIVE_LEV_FORMULA:
 *   max(floor, min(lmax_fraction * CASCADE_LMAX[ticker], venue_max[ticker]))
 * Insertion order is the mirror's, which is descending Λ_T.
 */
const CASCADE_ROWS: CascadeRow[] = (() => {
  const lambdas = mirroredNumberMap("CASCADE_LMAX");
  const venues = mirroredNumberMap("VENUE_MAX");
  if (!Number.isFinite(TAIL_CAP_FRACTION) || !Number.isFinite(LADDER_FLOOR)) {
    return [];
  }
  return Object.entries(lambdas).flatMap(([ticker, lambda]) => {
    const venue = venues[ticker];
    if (venue === undefined) return [];
    const scaled = TAIL_CAP_FRACTION * lambda;
    const cap = Math.max(LADDER_FLOOR, Math.min(scaled, venue));
    return [
      {
        ticker,
        lambda,
        venue,
        scaled,
        cap,
        lev: Math.floor(cap),
        fromFloor: cap > Math.min(scaled, venue),
        tradeable: !NOT_TRADEABLE.has(ticker),
      },
    ];
  });
})();

/** The live cluster map — `CORRELATION_CLUSTERS_JSON` is blank, so this is it. */
const DEFAULT_CLUSTERS_LABEL: string = (() => {
  const parsed = mirroredJson("DEFAULT_CLUSTERS");
  if (!parsed || typeof parsed !== "object") return "";
  return Object.entries(parsed as Record<string, unknown>)
    .filter((e): e is [string, string[]] => Array.isArray(e[1]))
    .map(([name, members]) => `${name} {${members.join(", ")}}`)
    .join(" · ");
})();

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — Sizing
// ─────────────────────────────────────────────────────────────────────────────

const SIZING_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-SIZE-01",
    name: "Risk$ — the dollar amount at risk",
    status: "live",
    overlay: "paper",
    statusNote:
      "Guarded by RISK_BUDGET_SIZING_ENABLED = 'true' (live auto_config). The live log carries [RISK-SIZING] … Risk$=$1.0257 (1.25% of $82.05) at 2026-08-04 23:23:47.",
    source:
      "risk_sizing.compute_risk_dollars ← risk_sizing.resolve_risk_budget ← live_executor.execute_entry_live",
    tex: String.raw`p_{\text{clamped}} = \min\!\big(\max(p_{\text{risk}},\, p_{\min}),\; p_{\max}\big)
\qquad
R =
\begin{cases}
E_{\text{live}} \cdot \dfrac{p_{\text{clamped}}}{100} & \text{if the equity read succeeded and } E_{\text{live}} > 0\\[2ex]
R_{\text{fallback}} = \$0.70 & \text{otherwise (fail-down)}
\end{cases}`,
    symbols: [
      {
        sym: String.raw`p_{\text{risk}}`,
        means:
          "RISK_PCT_PER_TRADE, the configured per-trade risk — in PERCENT (live 1.25).",
      },
      {
        sym: String.raw`p_{\min},\; p_{\max}`,
        means: "RISK_PCT_MIN / RISK_PCT_MAX clamp band, percent (live 0.5 / 3.0).",
      },
      {
        sym: String.raw`E_{\text{live}}`,
        means: "Live Hyperliquid unified equity, USD.",
      },
      {
        sym: "R",
        means: "Risk$ — the dollars lost if the stop fills exactly, USD.",
      },
      {
        sym: String.raw`R_{\text{fallback}}`,
        means: "risk_sizing.RISK_DOLLARS_FALLBACK, USD (constant 0.70).",
      },
    ],
    why:
      "Fixed-fractional risk makes the loss constant, not the position. A tight stop buys a big position and a wide stop a small one, so every trade puts the same dollars on the line regardless of how volatile the instrument is. Without it a wide-stop trade risks many multiples of a tight-stop one, and the account's fate is decided by whichever setup happened to have the loosest stop. The $0.70 fallback is the same idea applied to failure: if equity is unknowable, size for a small account, never a large one.",
    values: [
      {
        label: "p_risk — auto_config RISK_PCT_PER_TRADE",
        value: "1.25 %",
        note: "live row, updated_at 2026-07-30 21:23:22 UTC",
      },
      {
        label: "p_min / p_max — auto_config RISK_PCT_MIN / RISK_PCT_MAX",
        value: "0.5 % / 3.0 %",
      },
      {
        label: "R_fallback — risk_sizing.RISK_DOLLARS_FALLBACK",
        value: "$0.70",
        note: "code constant",
      },
      {
        label: "E_live — auto_config LIVE_ACCOUNT_VALUE_USD",
        value: "$82.0542",
        note:
          "rewritten by trevor.service every ~5 min (330 change_log writes in 27.4 h); Hub-retrievable from the replica. Secondary: equity_snapshots.equity, hourly.",
      },
    ],
    caveat:
      "Note the /100. RISK_PCT_PER_TRADE is a PERCENT, converted to a fraction inside resolve_risk_budget (rp / 100.0). Passing 1.25 as if it were already a fraction would size the position 100× small.",
  },
  {
    id: "F-SIZE-02",
    name: "C1 — notional from the stop distance",
    status: "live",
    overlay: "paper",
    statusNote:
      "Unconditional inside resolve_risk_budget. The live log records source=min(C1,C3) C1=$65.17.",
    source: "risk_sizing._notional_from_stop",
    tex: String.raw`s = \begin{cases}
\dfrac{|P_{\text{entry}} - P_{\text{stop}}|}{P_{\text{entry}}} & P_{\text{entry}}>0 \;\wedge\; P_{\text{stop}}>0\\[2ex]
s_{\text{fallback}} = 0.02 & \text{otherwise}
\end{cases}
\qquad\qquad
N_{C1} = \frac{R}{s}`,
    symbols: [
      {
        sym: String.raw`P_{\text{entry}},\; P_{\text{stop}}`,
        means: "Signal entry and stop prices, USD per coin.",
      },
      {
        sym: "s",
        means:
          "Stop distance as a FRACTION of entry (0.016 = 1.6%).",
      },
      {
        sym: String.raw`s_{\text{fallback}}`,
        means: "risk_sizing.FALLBACK_STOP_FRAC = 0.02.",
      },
      {
        sym: String.raw`N_{C1}`,
        means:
          "Position notional in USD — not margin, not coin units.",
      },
    ],
    why:
      "A position of notional N loses N · s dollars when price moves s against it — and that is true at any leverage, because leverage changes what you post, not what you hold. So setting N = R/s makes the stop-loss cost exactly R. This single line is why the whole sizing chain can be leverage-independent.",
    values: [
      {
        label: "s_fallback — risk_sizing.FALLBACK_STOP_FRAC",
        value: "0.02",
        note: "code constant — the stop distance used when the signal carries no usable stop",
      },
      {
        label: "P_entry / P_stop",
        value: "no standing value",
        note:
          "per-signal prices — the page shows the formula and the fallback, never a price",
      },
    ],
    caveat:
      "N here is POSITION NOTIONAL, not margin. auto_trades.notional_usd is the posted MARGIN — the two are related by N = margin × leverage. See F-SIZE-09 for the full trap.",
  },
  {
    id: "F-SIZE-03",
    name: "C3 — notional from ATR",
    status: "live",
    overlay: "paper",
    statusNote: "Same call, same live log line: C3=$297.30.",
    source: "risk_sizing._notional_from_atr",
    tex: String.raw`N_{C3} = \frac{R}{\left(\dfrac{a}{100}\right)\cdot m_{\text{atr}}}
\qquad \text{(returns } \varnothing \text{ if } a \le 0 \text{ or } m_{\text{atr}} \le 0\text{)}`,
    symbols: [
      {
        sym: "a",
        means:
          "ATR as a PERCENT of price (signal_data['atr_pct'], the scalp-engine convention from F-IND-08 — 0.23 means 0.23%).",
      },
      {
        sym: String.raw`m_{\text{atr}}`,
        means:
          "ATR_STOP_MULT — how many ATRs a synthetic stop sits away (dimensionless).",
      },
      {
        sym: String.raw`N_{C3}`,
        means: "USD position notional — not margin.",
      },
    ],
    why:
      "The signal's stop can be tight for reasons that have nothing to do with how much the instrument actually moves. C3 asks a second, independent question — how big would this be if the stop were m ATRs wide? — so a signal with an artificially tight stop cannot buy an oversized position.",
    values: [
      {
        label: "m_atr — auto_config ATR_STOP_MULT",
        value: "1.5",
      },
      {
        label: "a (atr_pct)",
        value: "no standing value",
        note: "per-signal input",
      },
    ],
    caveat:
      "UNIT TRAP. atr_pct is a percent and IS divided by 100 here. LEVERAGE_TARGET_VOL in F-SIZE-07 uses the SAME percent units WITHOUT dividing, because it forms a ratio. Both are correct; they are not the same convention and must not be copied across.",
  },
  {
    id: "F-SIZE-04",
    name: "Reconciliation — take the smaller",
    status: "live",
    overlay: "paper",
    source: "risk_sizing.resolve_risk_budget (the min(candidates) line)",
    tex: String.raw`N_{\text{risk}} = \min\{\,N \in \{N_{C1},\,N_{C3}\} : N \ne \varnothing \;\wedge\; N > 0 \,\}`,
    symbols: [
      {
        sym: String.raw`N_{\text{risk}}`,
        means:
          "The reconciled position notional, USD — the size the risk budget actually asks for.",
      },
    ],
    why:
      "If both candidates are available the recorded source is min(C1,C3); if only one, C1 or C3; if neither, resolve_risk_budget returns None and execute_entry_live SKIPS the trade. Two estimators disagreeing means one of them is wrong about the risk. Taking the smaller means the dollar risk is never understated — the error can only ever be \u201cwe traded smaller than we could have\u201d, which is survivable, rather than \u201cwe risked more than we intended\u201d, which compounds.",
    values: [
      {
        label: "Standing values",
        value: "none",
        note: "pure arithmetic over C1 and C3 — no constant enters here",
      },
    ],
  },
  {
    id: "F-SIZE-05",
    name: "The buyable ceiling + the decoupling guard",
    status: "live",
    overlay: "paper",
    statusNote:
      "The guard is gated on _dyn_lev_on = LEVERAGE_DYNAMIC_ENABLED AND RISK_BUDGET_SIZING_ENABLED; both are live 'true'.",
    source:
      "risk_sizing.resolve_risk_budget (ceiling) · live_executor.execute_entry_live (the [LEVERAGE-DECOUPLE] guard)",
    tex: [
      String.raw`B = \begin{cases}
M_{\text{free}} & M_{\text{free}} > 0\\
E_{\text{live}} & M_{\text{free}} \le 0 \;\wedge\; E_{\text{live}} > 0\\
\varnothing & \text{otherwise (ceiling skipped)}
\end{cases}
\qquad
N_{\max} = B \cdot L`,
      String.raw`N = \min\!\left(N_{\text{risk}},\, N_{\max}\right),
\qquad
\texttt{clamped} = \big[\,N_{\max} < N_{\text{risk}}\,\big]`,
      String.raw`\textbf{Guard: } \texttt{clamped} \wedge \texttt{dyn\_lev\_on} \;\Longrightarrow\; \textbf{ABORT the entry}`,
    ],
    symbols: [
      {
        sym: String.raw`M_{\text{free}}`,
        means: "Hyperliquid free margin, USD.",
      },
      { sym: "B", means: "The ceiling basis." },
      {
        sym: "L",
        means:
          "The POST-tail-cap leverage — the cap runs first, deliberately.",
      },
      {
        sym: String.raw`N_{\max}`,
        means: "The most notional the account can actually buy.",
      },
    ],
    why:
      "This is the one place leverage touches size, and it can only reduce. The guard then goes further: if the ceiling bound, then leverage moved the final size, which breaks the promise that size is leverage-independent — so the entry is REFUSED rather than silently taken at a different risk than intended. A guard that only clamps would hide the violation; one that aborts makes it visible.",
    values: [
      {
        label: "M_free — Hyperliquid free margin",
        value: "no live value available",
        note:
          "comes from live_executor.get_account_state_live() → marginSummary.totalMarginUsed, consumed in-process and persisted to NO trevor.db column and NO auto_config key. The page can state the rule; it cannot show today's free margin.",
      },
      {
        label: "The clamp event",
        value: "observable only",
        note:
          "via the [LEVERAGE-DECOUPLE] WARN sentinel, and by comparing auto_trades.original_notional_usd against the risk-budget notional",
      },
    ],
    caveat:
      "N and N_max are POSITION NOTIONAL. The posted margin is N / L, and it is the posted margin — not this figure — that auto_trades.notional_usd stores. See F-SIZE-09.",
  },
  {
    id: "F-SIZE-09",
    name: "Notional → margin → coin units → exchange rounding",
    status: "live",
    overlay: "paper",
    source:
      "risk_sizing.resolve_risk_budget (margin) · live_executor.execute_entry_live → ._round_size → ._ensure_min_order_units",
    tex: [
      String.raw`M = \begin{cases}\dfrac{N}{L} & L>0\\ N & L \le 0\end{cases}
\qquad
q_{\text{raw}} = \frac{N}{P_{\text{mid}}}
\qquad
q = \operatorname{round}\!\left(q_{\text{raw}},\; d_T\right)`,
      String.raw`q' = \begin{cases}
q & q\,P_{\text{ref}} \ge \$10\\[1ex]
\dfrac{\left\lceil \dfrac{10}{P_{\text{ref}}}\cdot 10^{d_T} - \varepsilon \right\rceil}{10^{d_T}} & \text{otherwise},\quad \varepsilon = 10^{-9}
\end{cases}`,
      String.raw`N < \text{HL\_MIN\_ORDER\_USD} = \$10 \;\Longrightarrow\; \textbf{SKIP the trade}`,
      String.raw`N = M \cdot L
\qquad\text{i.e.}\qquad
\texttt{original\_notional\_usd} = \texttt{notional\_usd} \times \texttt{leverage}`,
    ],
    symbols: [
      { sym: "M", means: "The POSTED MARGIN, USD." },
      { sym: "N", means: "Position notional, USD." },
      { sym: "q", means: "Order size in COIN UNITS." },
      {
        sym: String.raw`P_{\text{mid}}`,
        means: "Live mid price, USD per coin.",
      },
      { sym: "d_T", means: "Per-asset szDecimals." },
      {
        sym: "q'",
        means:
          "The defensive submit-side floor on the PARTIAL-EXIT path (PARTIAL_MIN_NOTIONAL_ENABLED = 'true').",
      },
    ],
    why:
      "Everything upstream reasons in notional — the economically meaningful quantity, because P&L is a fraction of notional. Margin is derived last and is purely a funding question: how much collateral the exchange wants locked to carry that position. Converting to coin units and rounding to the venue's szDecimals is the final translation into something the exchange will accept. The $10 floors exist because Hyperliquid rejects smaller orders outright, and the entry-side choice to SKIP rather than round up is deliberate — rounding up would overshoot the risk budget and defeat fixed-fractional sizing.",
    values: [
      {
        label: "HL minimum order — risk_sizing.HL_MIN_ORDER_USD",
        value: "$10.00",
        note: "code constant",
      },
      {
        label: "partial bump target — auto_config PARTIAL_MIN_ORDER_USD",
        value: "referenced in monitor.py",
        note: "the floor used on this path is the $10 code constant",
      },
      {
        label: "d_T (szDecimals) — the runtime value the formula uses",
        value: "no live value available; defaults to 2 when unknown",
        note:
          "populated at runtime into live_executor._sdk_state['sz_decimals'] from the Hyperliquid SDK, and persisted to no table and no config key. The page can state the rule and the default, not today's per-ticker values.",
      },
      {
        label: "Static config map — auto_trader.config.HL_MAX_LEVERAGE_MAP",
        value:
          "BTC 5 · ETH 4 · SOL 2 · HYPE 2 · FARTCOIN 1 · XRP 0 · DOGE 0 · NEAR 1 · SUI 1 · kPEPE 0",
        note:
          "🚨 STATIC CONFIG, NOT today's d_T. This map carries a sz_decimals field per asset, but the value the formula above actually uses is the runtime SDK read on the row before. Shown so the constant is not hidden — never read it as the live runtime value.",
      },
      {
        label: "recorded margin — auto_trades.notional_usd",
        value: "= margin",
        note: "decremented by every partial exit",
      },
      {
        label: "recorded full notional — auto_trades.original_notional_usd",
        value: "NULL on 994 of 1,793 rows",
        note: "pre-M10 history; populated going forward",
      },
      {
        label: "skip events",
        value: "[ENTRY-SKIP-HLMIN] WARN sentinel",
        note: "in-process tally live_executor._ENTRY_SKIP_HLMIN — not persisted",
      },
    ],
    caveat:
      "THE NOTIONAL TRAP. auto_trades.notional_usd IS THE POSTED MARGIN M, not the position notional N — it is written as \u201cnotional_usd\u201d: size_usd where size_usd = _rb.margin_used, and it SHRINKS on every reduce-only partial exit. The correct relationship is N = M × leverage; the immutable full entry figure is original_notional_usd, which is NULL on 994 of 1,793 rows. DIVIDING notional_usd BY LEVERAGE PRODUCES A FIGURE WRONG BY A FACTOR OF L² — the error that has already bitten the Hub once. And at the 1× the tail cap forces on 9 of 10 tickers, posted margin EQUALS position notional, which makes the trap invisible today and lethal the moment leverage rises.",
  },
  {
    id: "F-SIZE-10",
    name: "size_position_in_sleeve",
    status: "dormant",
    statusNote:
      "Its only caller is the R5/R6 chain behind PORTFOLIO_INTEGRATION_ENABLED = 'false' → PORTFOLIO_COORDINATION_ENABLED = 'false' → PORTFOLIO_CAPITAL_ENABLED = 'false'. Additionally active_sleeves(0) returns ().",
    source: "sleeve_sizing.size_position_in_sleeve → risk_sizing.resolve_risk_budget",
    tex: [
      String.raw`w = \operatorname{clamp01}(w_{\text{band}}), \qquad
\theta = \beta_{\min} + w\,(\beta_{\max}-\beta_{\min}), \qquad
p_{\text{sleeve}} = 100\,\theta`,
      String.raw`\text{then } \texttt{resolve\_risk\_budget}\!\left(E \!=\! K_{\text{sleeve}},\; M_{\text{free}} \!=\! K^{\text{free}}_{\text{sleeve}},\; L \!=\! \ell_{\text{eff}},\; p_{\text{risk}} \!=\! p_{\min} \!=\! p_{\max} \!=\! p_{\text{sleeve}}\right)`,
    ],
    symbols: [
      {
        sym: String.raw`w_{\text{band}}`,
        means: "in_band_weight — neutral-null 0.5.",
      },
      {
        sym: String.raw`\beta_{\min},\; \beta_{\max}`,
        means: "The sleeve's SizeBand fractions.",
      },
      {
        sym: String.raw`\theta`,
        means: "Fraction of SLEEVE capital — not of account equity.",
      },
      {
        sym: String.raw`K_{\text{sleeve}}`,
        means: "The sleeve's allocated capital, USD.",
      },
      {
        sym: String.raw`\ell_{\text{eff}}`,
        means: "effective_lev_for_sleeve — see F-SIZE-11.",
      },
    ],
    why:
      "It re-uses the identical risk-budget machinery with the account swapped for a sleeve's slice, so the leverage-decoupling invariant survives at the sleeve level unchanged. A 24-hour sleeve cannot ride the scalp leverage ladder, because its own lmax_fraction is passed.",
    values: [
      {
        label: "in_band_weight — sleeve_sizing.NEUTRAL_NULL_IN_BAND_WEIGHT",
        value: "0.5",
        note: "code constant",
      },
      {
        label: "β_min / β_max — the sleeve size bands",
        value: "see the sleeve registry in section 11",
        note: "one registry, rendered once — this section does not duplicate it",
      },
      {
        label: "K_sleeve — portfolio.capital.sleeve_capital(ledger, names)",
        value: "no live value available",
        note: "no ledger exists today, so there is nothing to read",
      },
    ],
    caveat:
      "THE CLAMP IS PINNED. risk_pct_min = risk_pct_max = p_sleeve deliberately overrides risk_sizing's own [0.5%, 3.0%] band, so the sleeve's size band governs rather than the global risk clamp. The consequence: at scalp's band (0.05, 0.30) with w = 0.5, θ = 0.175 → 17.5% of SLEEVE capital as Risk$, an order of magnitude above the account-level 1.25%. That is coherent ONLY because the denominator is sleeve capital, not equity.",
  },
  {
    id: "F-SIZE-12",
    name: "Deployment ceiling",
    status: "dormant",
    statusNote:
      "PORTFOLIO_CAPITAL_ENABLED = 'false' (capital.is_enabled).",
    source: "portfolio.capital.deployment_ceiling",
    tex: String.raw`D_{\max} = \gamma \cdot K_{\text{total}}, \qquad \gamma_{\text{null}} = 0.45`,
    symbols: [
      {
        sym: String.raw`\gamma`,
        means:
          "The fraction of total capital allowed to be DEPLOYED at one instant.",
      },
      {
        sym: String.raw`K_{\text{total}}`,
        means: "Total portfolio capital, USD.",
      },
    ],
    why:
      "Availability is not deployment. All capital being available and only ~45% being at risk simultaneously are compatible statements; the ceiling is what keeps a run of correlated entries from converting the whole book into one bet.",
    values: [
      {
        label: "γ — portfolio.capital.DEPLOYMENT_CEILING_NULL",
        value: "0.45",
        note:
          "code constant, trainer-tunable later. No live auto_config row today — verified absent from the queried key set.",
      },
      {
        label: "K_total — total portfolio capital",
        value: "no live value available",
        note: "the portfolio capital layer is gated off, so no ledger total exists",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 — The tail cap
// ─────────────────────────────────────────────────────────────────────────────

const TAIL_CAP_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-SIZE-06",
    name: "Liquidation-safe leverage cap",
    status: "live",
    overlay: "paper",
    statusNote:
      "LEVERAGE_DYNAMIC_ENABLED = 'true' AND RISK_BUDGET_SIZING_ENABLED = 'true'. Live log: [DYN-LEV] NEAR SHORT stop_frac=… -> 10x.",
    source: "dynamic_leverage.select_leverage · .maintenance_margin_fraction",
    tex: String.raw`mm_T = \frac{1}{2\,L^{\text{venue}}_T}
\qquad
L_{\text{liq}} = \left\lfloor \frac{1}{k\,s + mm_T} \right\rfloor
\qquad
L_{\text{cap}} = \operatorname{clamp}\!\left(L_{\text{liq}},\; L_{\min},\; L^{\text{venue}}_T\right)`,
    symbols: [
      {
        sym: "mm_T",
        means:
          "Hyperliquid isolated maintenance-margin fraction for ticker T (dimensionless).",
      },
      {
        sym: String.raw`L^{\text{venue}}_T`,
        means:
          "Hyperliquid max leverage from config.get_hl_max_leverage (integer ×).",
      },
      {
        sym: "k",
        means:
          "LEVERAGE_LIQ_BUFFER_K — how many stop-distances the liquidation price must sit beyond the stop.",
      },
      { sym: "s", means: "The same stop fraction C1 uses." },
      {
        sym: String.raw`L_{\min}`,
        means: "LEVERAGE_MIN — the capital-efficiency floor.",
      },
    ],
    why:
      "Liquidation is not a bad trade, it is the END of trading — the exchange closes you at a price you did not choose. This picks the largest leverage at which the real maintenance-margin liquidation price is still at least k stop-widths beyond your stop, so the stop always fires first by a wide margin. Using the true 1/L − mm distance rather than the naive 1/L matters: the naive form sits INSIDE the real liquidation point and would overstate safety. Edge case: if s is missing or ≤ 0 the function returns min(L_fallback, L^venue_T) with L_fallback = 5, unweighted.",
    values: [
      { label: "k — auto_config LEVERAGE_LIQ_BUFFER_K", value: "2.5" },
      {
        label: "L_min — auto_config LEVERAGE_MIN",
        value: "2",
        note: "code default dynamic_leverage.LEVERAGE_MIN_DEFAULT = 2",
      },
      {
        label: "L_fallback — dynamic_leverage.LEVERAGE_FALLBACK",
        value: "5",
        note: "code constant — used when the stop is missing or zero",
      },
      {
        label: "L^venue_T",
        value: "13 tickers in the table below",
        note:
          "code table sleeves.venue_max, and config.HL_MAX_LEVERAGE_MAP via get_hl_max_leverage",
      },
      {
        label: "L_cap per trade",
        value: "no live value available",
        note:
          "runtime only — the cap= field of the [LEV-WEIGHT] log sentinel; not persisted to any column",
      },
    ],
  },
  {
    id: "F-SIZE-07",
    name: "Leverage weighting — confidence · regime · volatility",
    status: "live",
    overlay: "paper",
    statusNote:
      "LEVERAGE_WEIGHTING_ENABLED = 'true' and LEVERAGE_VOL_TARGET_ENABLED = 'true'. Live log: [LEV-WEIGHT] NEAR SHORT cap=10x conf=0.64 regime=1.00 vol=2.00 -> weighted=6.40x final=10x. It runs — and then the tail cap overwrites it.",
    source:
      "dynamic_leverage.confidence_multiplier · .regime_multiplier · .volatility_multiplier, combined in .select_leverage",
    tex: [
      String.raw`\mu_{\text{conf}} = \operatorname{clamp}\!\left(\mu^{-}_{c} + \frac{\operatorname{clamp}(c, c_{\text{lo}}, c_{\text{hi}}) - c_{\text{lo}}}{c_{\text{hi}} - c_{\text{lo}}}\left(\mu^{+}_{c}-\mu^{-}_{c}\right),\; \mu^{-}_{c},\; \mu^{+}_{c}\right)`,
      String.raw`\mu_{\text{reg}} = \text{RegimeTable}[\,\text{upper}(\rho)\,] \;\text{ else }\; \mu^{\text{def}}_{\text{reg}}
\qquad
\mu_{\text{vol}} = \operatorname{clamp}\!\left(\frac{v^{*}}{v},\; \mu^{-}_{v},\; \mu^{+}_{v}\right)`,
      String.raw`L_{\text{sel}} = \operatorname{clamp}\!\Big(\big\lfloor L_{\text{cap}} \cdot \mu_{\text{conf}} \cdot \mu_{\text{reg}} \cdot \mu_{\text{vol}} \big\rfloor,\; L_{\min},\; L_{\text{cap}}\Big)`,
    ],
    symbols: [
      {
        sym: "c",
        means: "Signal composite confidence, on a 0–100 scale.",
      },
      {
        sym: String.raw`c_{\text{lo}},\; c_{\text{hi}}`,
        means: "The ramp endpoints.",
      },
      {
        sym: String.raw`\mu^{-}_{c},\; \mu^{+}_{c}`,
        means:
          "The multiplier at or below the floor, and at or above the ceiling. A missing c gives μ⁻_c.",
      },
      {
        sym: String.raw`\rho`,
        means:
          "The resolved 3-state regime from F-IND-23 (TRENDING / RANGING / VOLATILE), case-insensitive; anything else falls to the default.",
      },
      {
        sym: "v",
        means:
          "Current ATR PERCENT. Missing or ≤ 0 gives μ_vol = 1.0.",
      },
      {
        sym: String.raw`v^{*}`,
        means:
          "LEVERAGE_TARGET_VOL, in the SAME percent units — the ratio is dimensionless, so there is no /100 here. Contrast F-SIZE-03.",
      },
    ],
    why:
      "The liquidation cap answers \u201cwhat is survivable\u201d; these three answer \u201chow much of that should we actually use\u201d. Low conviction, a choppy regime, or unusually high volatility each argue for sitting further inside the safe envelope. The outer min(…, L_cap) is the load-bearing part: μ_vol can exceed 1.0 in a calm market, and the clamp guarantees that a calm tape can never push leverage past the liquidation-safe wall.",
    values: [
      { label: "LEVERAGE_CONF_FLOOR / _CEIL", value: "50 / 80" },
      { label: "LEVERAGE_CONF_MULT_MIN / _MAX", value: "0.6 / 1.0" },
      {
        label: "LEVERAGE_REGIME_MULT_TRENDING / _RANGING / _VOLATILE / _DEFAULT",
        value: "1.0 / 0.8 / 0.6 / 0.8",
      },
      { label: "LEVERAGE_TARGET_VOL", value: "1.5", note: "percent units" },
      { label: "LEVERAGE_VOL_MULT_MIN / _MAX", value: "0.5 / 2.0" },
      {
        label: "Per-trade breakdown",
        value: "no live value available",
        note:
          "runtime only — the [LEV-WEIGHT] sentinel; _lev_weight_breakdown is not persisted to a column",
      },
    ],
    caveat:
      "COMPUTED, THEN OVERWRITTEN. In the live log above the multipliers produced weighted=6.40x against L_cap=10, and select_leverage returned final=10x — then _apply_tail_cap (F-SIZE-08) reduced it to 1x. Any claim that leverage is chosen by confidence, regime and volatility is describing arithmetic whose output DOES NOT SURVIVE THE NEXT LINE for 9 of the 10 sacred tickers. (The [LEV-WEIGHT] weighted_target field deliberately excludes vol_mult, which is why the printed 6.40 and the printed final 10 differ without contradiction.)",
  },
  {
    id: "F-SIZE-08",
    name: "The tail cap — the leverage authority that actually binds",
    status: "live",
    overlay: "paper",
    statusNote:
      "Called UNCONDITIONALLY at the single last-write-wins point in execute_entry_live — a bare statement, not inside an if, and behind NO feature flag. Live evidence: 13 [TAIL-CAP] lines in logs/trevor.log, most recent 2026-08-04 23:23:47 | [TAIL-CAP] NEAR leverage 10.00x -> 1x (sleeve-wall cap 1.0450x floored, lmax_fraction=0.5, branch=cap).",
    source:
      "live_executor._apply_tail_cap → portfolio.tail_cap.hard_tail_cap_leverage → sleeves.effective_lev",
    tex: [
      String.raw`f = \operatorname{clamp01}(f_{\text{lmax}}) =
\begin{cases}
1.0 & f_{\text{lmax}} > 1\\
10^{-9} & f_{\text{lmax}} \le 0\\
f_{\text{lmax}} & \text{otherwise}
\end{cases}`,
      String.raw`C_T = \max\!\Big(\phi,\; \min\big(f \cdot \Lambda_T,\; L^{\text{venue}}_T\big)\Big)
\qquad
L = \big\lfloor \min(L_{\text{sel}},\, C_T) \big\rfloor`,
      String.raw`L = \big\lfloor \min(L_{\text{sel}},\, L_{\min})\big\rfloor \quad\text{on KeyError (no measured } \Lambda_T)\text{ or ANY exception,}\quad L_{\min}=2`,
    ],
    symbols: [
      {
        sym: String.raw`f_{\text{lmax}}`,
        means:
          "The sleeve's lmax_fraction (dimensionless, intended (0,1]).",
      },
      {
        sym: String.raw`\Lambda_T`,
        means:
          "sleeves.CASCADE_LMAX[T] — the MEASURED cascade tail ceiling = 1 / |worst daily open→low excursion|. FARTCOIN's −86.06% worst day gives 1.16×.",
      },
      {
        sym: String.raw`\phi`,
        means: "The ladder floor, LeverageLadder.floor = 1.0.",
      },
      { sym: "C_T", means: "The hard cap — a real number." },
      {
        sym: "L",
        means: "The final INTEGER leverage Hyperliquid is set to.",
      },
    ],
    why:
      "The third line is the fail-CLOSED branch: on a KeyError (no measured Λ_T) or ANY exception the cap falls back to L_min = 2 — never skipped, never falling open to the venue max. Why the floor to an integer matters: Hyperliquid leverage is an integer, and margin = notional / leverage, update_leverage(int(...)) and the recorded leverage_at_entry must all agree. Flooring keeps them consistent AND is survival-safe (floor ≤ cap ≤ Λ_T), and it is what turns a cap of 1.045 into 1× rather than 1.045× — the single largest practical effect in the whole chain. Why a leverage ceiling that only tightens matters more than the leverage choice itself: a stop is a PRICE instruction, firing when the market trades through a level; liquidation is a BALANCE event, firing when the position's loss consumes the posted margin. In an ordinary market the stop is nearer, so it wins. In a cascade — 2025-10-10 is the reference event — price wicks through many levels within a single candle, and the stop is not filled at its level, it is filled somewhere far below. If leverage was high enough that the liquidation price sat inside that wick, the account is gone before any stop-management logic runs. select_leverage reasons about ORDINARY geometry — stop distance, maintenance margin, current volatility — and every one of those inputs looks calm right before a cascade, because the wick strikes FROM a calm regime. The tail cap ignores all of them and bounds leverage by the worst move that ticker has ever actually made. Because it is a min(), it can only ever lower what the clever machinery proposed: the sophisticated path can be wrong in any direction and still cannot breach the wall. And because lmax_fraction is clamped to (0,1] in code, the future trainer can tune only HOW FAR INSIDE the wall to sit — it cannot move the wall. That asymmetry — the smart layer proposes, the dumb layer disposes — is the entire design. A leverage choice that is too low costs basis points; one that is too high costs the account.",
    values: [
      {
        label: "Λ_T — sleeves.CASCADE_LMAX",
        value: "13 tickers",
        note: "full values in the table below",
      },
      {
        label: "L^venue_T — sleeves.venue_max",
        value: "13 tickers",
        note: "in the same table",
      },
      {
        label: "φ — sleeves.LeverageLadder.floor",
        value: Number.isFinite(LADDER_FLOOR) ? LADDER_FLOOR.toFixed(1) : "—",
        note: "code constant, dataclass field default",
      },
      {
        label: "f_lmax TODAY — live_executor._CONSERVATIVE_LMAX_FRACTION",
        value: FRACTION_LABEL,
        note:
          "the value in force, because sleeve resolution returns None (F-EXIT-13) and _sleeve_lmax_fraction(None) falls back to this hardcoded constant",
      },
      {
        label: "L_min on the fail-closed branch — dynamic_leverage.LEVERAGE_MIN_DEFAULT",
        value: "2",
        note: "code constant",
      },
      {
        label: "Per-clamp event",
        value: "[TAIL-CAP] WARN sentinel — fires on every entry",
        note:
          "the POST-cap leverage IS persisted: auto_trades.leverage, .leverage_at_entry, .liq_distance_at_entry",
      },
    ],
    caveat:
      "THIS IS THE LEVERAGE AUTHORITY THAT ACTUALLY BINDS. It is wired unconditionally, with NO feature flag, and it overwrites the computed leverage with floor(0.50 × CASCADE_LMAX) — BTC 2×, and EVERY OTHER SACRED TICKER 1×. The elaborate leverage machinery in F-SIZE-06 and F-SIZE-07 is, in practice, discarded on 9 of the 10 sacred tickers.",
  },
  {
    id: "F-SIZE-11",
    name: "effective_lev — the sleeve leverage ladder",
    status: "split",
    overlay: "paper",
    statusNote:
      "SPLIT: ⚪ DORMANT as a SLEEVE mechanism — it has never been called with a resolved sleeve's fraction. 🟢 LIVE as the tail cap's engine — tail_cap.hard_tail_cap_leverage calls it on EVERY entry, and today it always receives the hardcoded 0.50. The live half is downstream of the paper gate like the rest of this family.",
    source: "sleeves.effective_lev · .effective_lev_for_sleeve",
    tex: String.raw`\ell_{\text{eff}}(T, \text{ladder}) = \max\!\Big(\phi,\; \min\big(f_{\text{lmax}} \cdot \Lambda_T,\; L^{\text{venue}}_T\big)\Big)`,
    symbols: [
      {
        sym: String.raw`\ell_{\text{eff}}`,
        means:
          "The effective leverage ceiling for ticker T under a given ladder.",
      },
      {
        sym: String.raw`f_{\text{lmax}}`,
        means:
          "The sleeve's lmax_fraction — in practice always the hardcoded 0.50 today.",
      },
    ],
    why:
      "Identical arithmetic to C_T in F-SIZE-08 — tail_cap deliberately PULLS this rather than re-deriving it, and adds only the clamp01 on f_lmax. One expression, one place it can be wrong.",
    values: [
      {
        label: "Λ_T and L^venue_T",
        value: "the same tables as F-SIZE-08",
        note: "rendered once, in the cascade table below",
      },
      {
        label: "The four-sleeve registry (lmax_fraction, stop_pct, size bands)",
        value: "rendered in section 11, Sleeves",
        note:
          "one registry, one place — this section does not reproduce it, and the 0.40 / 0.30 / 0.20 fractions have never been applied to anything",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Section 9 — The gates
// ─────────────────────────────────────────────────────────────────────────────

const GATE_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-SIZE-13",
    name: "The playable-space invariant",
    status: "dormant",
    statusNote:
      "Its only caller is bot_brain_judgment.judge_candidate, whose only non-test caller is portfolio.integration.integrate_candidate, which returns None at `if not is_enabled()` BEFORE the lazy import of the judgment module. PORTFOLIO_INTEGRATION_ENABLED = 'false'. BOTBRAIN_JUDGMENT_ENABLED is live 'true' and is IRRELEVANT — the module is never imported.",
    source: "bot_brain_judgment.enforce_playable_space (repo root, not under auto_trader/)",
    tex: String.raw`\forall\,\text{ordinal } x:\quad x_{\text{verdict}} = \max\!\big(1,\ \min(x_{\text{proposed}},\ x_{\text{cap}})\big)
\qquad
\forall\,\text{categorical } y:\quad y_{\text{proposed}} \notin \mathcal{Y} \Longrightarrow \textsf{SKIP}`,
    symbols: [
      {
        sym: String.raw`\text{ticker}`,
        means:
          "Categorical. Cannot be clamped. A ticker outside playable_space.tickers is REJECT → SKIP. A proposed DIFFERENT ticker is discarded and the verdict ticker fixed to the candidate's.",
      },
      {
        sym: String.raw`\text{direction}`,
        means:
          "Strategy-owned. A proposed direction ≠ the mechanical direction is a flip → REJECT → SKIP. The brain never turns a LONG candidate SHORT.",
      },
      {
        sym: String.raw`\text{leverage}`,
        means:
          "Ordinal. L_verdict = max(1, min(L_proposed, L_rec)). If no leverage_rec was declared, leverage is DROPPED to None — the brain does not size a leverage the config never declared.",
      },
      {
        sym: String.raw`\text{max\_hold\_minutes}`,
        means:
          "Ordinal. H_verdict = max(1, min(H_proposed, H_cap)); same drop-if-undeclared rule.",
      },
      {
        sym: String.raw`\text{any non-directional action}`,
        means:
          "WATCH / AVOID / garbage → SKIP. Declining is always inside the codomain.",
      },
    ],
    why:
      "The rule, as the code enforces it: every decision's codomain must be a subset of the candidate's playable space — the brain may only NARROW or DECLINE, never WIDEN. An LLM in the loop is only safe if the worst thing it can do is NOTHING. Ordinal variables have a natural \u201cless\u201d direction, so they can be clamped; categorical ones do not, so the only in-codomain response to an out-of-set proposal is to decline the whole entry. Every narrow or reject appends a string to verdict.clamps — the audit proof that the invariant held. Recording each clamp rather than silently applying it means a model that is persistently trying to widen is VISIBLE IN THE DATA rather than merely neutralised.",
    values: [
      {
        label: "The playable space itself",
        value: "no standing values",
        note:
          "built per-candidate by candidate_signal.build_sleeve_playable_space(sleeve, ticker) — the rule above is the content, not a number",
      },
    ],
  },
  {
    id: "F-SIZE-14",
    name: "Gate 6.8 — correlation cluster limit",
    status: "live",
    overlay: "paper",
    statusNote:
      "CORRELATION_LIMITS_ENABLED = 'true'; live auto_config.CORRELATION_LIMITS_STATE_JSON was rewritten 2026-08-05 03:23:46, one second before the recon read it.",
    source: "correlation_limits.decide · .cluster_exposure · .full_risk_unit",
    tex: [
      String.raw`u = E\cdot\frac{p}{100}
\qquad
\Xi_{\text{cluster}} = \sum_{j\in\text{cluster}} \begin{cases} r_j & r_j > 0\\ u & r_j \text{ NULL or} \le 0\end{cases}`,
      String.raw`\textsf{BLOCK} \iff \underbrace{\big(n_{\max}>0 \wedge n \ge n_{\max}\big)}_{\texttt{concurrent\_cap}} \;\vee\; \underbrace{\Big(\pi_{\max}>0 \wedge \Xi_{\text{cluster}} + u > E\cdot\tfrac{\pi_{\max}}{100}\Big)}_{\texttt{risk\_cap}}`,
    ],
    symbols: [
      { sym: "u", means: "One full risk unit, USD." },
      {
        sym: "r_j",
        means: "auto_trades.risk_dollars_at_entry for open trade j.",
      },
      { sym: "n", means: "Open positions in the cluster." },
      {
        sym: String.raw`n_{\max}`,
        means: "MAX_CONCURRENT_PER_CLUSTER.",
      },
      {
        sym: String.raw`\pi_{\max}`,
        means: "MAX_CLUSTER_RISK_PCT, in percent.",
      },
      { sym: "E", means: "models.get_effective_equity()." },
    ],
    why:
      "Which sub-cap binds first, arithmetically, at live values: E = 82.0542 and p = 1.25 give u = $1.0257; π_max = 4.0 gives a cap of $3.2822, which matches the live cap_risk: 3.282168 in every one of the five cluster entries — an exact reproduction, not an estimate. The risk cap first blocks when (n+1)u > 3.2822, i.e. at n ≥ 3 — it refuses the 4th position. The count cap n_max = 2 refuses the 3rd. So concurrent_cap binds first.",
    values: [
      { label: "auto_config MAX_CONCURRENT_PER_CLUSTER", value: "2" },
      { label: "auto_config MAX_CLUSTER_RISK_PCT", value: "4.0 %" },
      { label: "auto_config RISK_PCT_PER_TRADE", value: "1.25 %" },
      {
        label: "The cluster map — correlation_limits.DEFAULT_CLUSTERS",
        value: DEFAULT_CLUSTERS_LABEL || "no live value available",
        note:
          "CORRELATION_CLUSTERS_JSON is live BLANK (''), so the code fallback IS the live map. Any unmapped ticker becomes the UNKNOWN cluster — fail-safe: treated as correlated, never free.",
      },
      {
        label: "The whole live snapshot",
        value: "auto_config.CORRELATION_LIMITS_STATE_JSON",
        note: "Hub-readable directly from the replica",
      },
    ],
    caveat:
      "THE CLUSTER IS RESOLVED FROM THE TICKER, never from auto_trades.cluster. The stored column is NULL on 27 post-gate rows, so any GROUP BY cluster rollup under-counts by 27. This does not affect the gate — only anything that reads the column afterwards.",
  },
  {
    id: "F-SIZE-15",
    name: "Gate 0.5 — the daily-loss breaker",
    status: "live",
    overlay: "paper",
    statusNote:
      "RISK_BREAKERS_ENABLED = 'true'. Live RISK_BREAKERS_STATE_JSON (rewritten 2026-08-05 03:23:44) shows daily_loss: {realized_pnl_usd: −2.13, day_start_equity: 82.0542, loss_pct: −2.596, limit_pct: −25.0, active: false}. THE ONLY ARMED RISK BREAKER.",
    source: "risk_breakers._check_daily_loss",
    tex: String.raw`\text{loss\%} = 100\cdot\frac{\Pi_{\text{realized, ET-day}}}{E_{\text{day-start}}}
\qquad
\textsf{HALT ENTRIES} \iff \text{loss\%} \le \lambda,\quad \lambda = -25.0`,
    symbols: [
      {
        sym: String.raw`\Pi_{\text{realized, ET-day}}`,
        means: "Realized P&L over the Eastern calendar day, USD.",
      },
      {
        sym: String.raw`E_{\text{day-start}}`,
        means: "Equity at the start of that ET day, USD.",
      },
      {
        sym: String.raw`\lambda`,
        means: "DAILY_LOSS_LIMIT_PCT — the halt threshold, in percent.",
      },
    ],
    why:
      "It is the one breaker that halts new entries on a MEASURED breach rather than on a heuristic, and it is keyed on the ET calendar day — which is why fixtures that stamp UTC produce spurious red between 20:00 EDT and midnight ET.",
    values: [
      { label: "auto_config DAILY_LOSS_LIMIT_PCT", value: "−25.0 %" },
      {
        label: "Live evaluated state",
        value: "auto_config.RISK_BREAKERS_STATE_JSON",
        note: "rewritten on each evaluation — directly Hub-readable",
      },
      {
        label: "MAX_CONSECUTIVE_LOSSES — present but NOT armed",
        value: "10",
        note: "live streak 4, active: false",
      },
      {
        label: "MAX_DAILY_ROUND_TRIPS — present but NOT armed",
        value: "8",
      },
    ],
    caveat:
      "Do NOT call risk_breakers.evaluate_breakers() to obtain these numbers — IT WRITES auto_config (RISK_BREAKERS_STATE_JSON and RISK_BREAKERS_LAST_EVAL). Read the row instead. A sibling hazard for anyone building against this: simulating any halt path POSTS A REAL DISCORD ALERT unless _post_trip_webhook is monkeypatched first.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// The gate roster — 15 gates + 4 extra numeric constraints.
// Reconciled against the in-code registry at manager._on_signal_impl.
// Row ORDER is the registry's, which is why 6.8 precedes 6.6.
// ─────────────────────────────────────────────────────────────────────────────

type GateVerdict = "armed" | "inert" | "shadow" | "dead";

interface GateRow {
  /** The gate's number in the chain, e.g. '6.25'. */
  gate: string;
  name: string;
  computes: string;
  limit: string;
  verdict: GateVerdict;
  /** Does it constrain anything today? Taken from the master's own status text. */
  binds: string;
  proof: string;
}

const GATE_ROSTER: GateRow[] = [
  {
    gate: "0",
    name: "Killswitch",
    computes: "boolean halt",
    limit: "EMERGENCY_KILLSWITCH = false",
    verdict: "armed",
    binds:
      "Armed. Halts everything when engaged; the live row reads false, so nothing is halted right now.",
    proof: "auto_config",
  },
  {
    gate: "0.5",
    name: "Risk breakers",
    computes: "100·Π / E_start ≤ λ (F-SIZE-15)",
    limit: "DAILY_LOSS_LIMIT_PCT = −25.0",
    verdict: "armed",
    binds:
      "Armed — daily_loss only. Not tripped: loss_pct −2.596 against the −25.0 limit, active: false.",
    proof: "live RISK_BREAKERS_STATE_JSON",
  },
  {
    gate: "0.9",
    name: "conf ≤ 0 reject",
    computes: "conf ≤ 0",
    limit: "—",
    verdict: "inert",
    binds:
      "No. SIGNAL_CONF_ZERO_REJECT = 'true' LOOKS armed and rejects nothing.",
    proof:
      "SIGNAL_V5_NO_CONFGATE = 'true' is the `not` term in the predicate",
  },
  {
    gate: "1",
    name: "Confidence threshold",
    computes: "conf < per-ticker floor",
    limit: "—",
    verdict: "inert",
    binds: "No — disabled by the same flag.",
    proof: "SIGNAL_V5_NO_CONFGATE = 'true'",
  },
  {
    gate: "1.5",
    name: "Chop brake + loss-streak",
    computes:
      "loss-streak → hard block; whipsaw → confidence-floor bump",
    limit:
      "CHOP_BRAKE_ENABLED = 'true'; CHOP_WHIPSAW_ENABLED = 'false'",
    verdict: "armed",
    binds:
      "Armed on the bench arm only — the loss-streak block is live, the whipsaw bump is off.",
    proof: "[CHOP-BRAKE] BENCH sentinel",
  },
  {
    gate: "5",
    name: "Capital + max-concurrent",
    computes: "n_open ≥ n_max, or E < per_trade",
    limit: "MAX_CONCURRENT_POSITIONS = 6; PER_TRADE_USD = 10.0",
    verdict: "armed",
    binds: "YES — binds at 6 open positions.",
    proof: "if max_concurrent > 0 and open_count >= max_concurrent",
  },
  {
    gate: "6",
    name: "Duplicate ticker + direction",
    computes: "exact-match dedup",
    limit: "—",
    verdict: "armed",
    binds: "Yes — unconditional.",
    proof: "unconditional loop over open trades",
  },
  {
    gate: "6.1",
    name: "Daily trade cap",
    computes: "today_count ≥ max_daily",
    limit: "MAX_DAILY_TRADES = 0",
    verdict: "inert",
    binds:
      "🚨 NO — 0 means UNLIMITED, not blocked. The block is guarded by `if max_daily > 0`, so a cap of zero disables the sub-cap entirely.",
    proof: "guarded `if max_daily > 0:`",
  },
  {
    gate: "6.25",
    name: "Per-ticker daily cap",
    computes: "per-ticker count",
    limit: "MAX_TRADES_PER_TICKER_PER_DAY_V2_SHADOW = 'true'",
    verdict: "shadow",
    binds: "No — logs only.",
    proof: "logs only",
  },
  {
    gate: "6.5",
    name: "Regime gate",
    computes: "regime cell allow/deny",
    limit: "REGIME_GATE_V2_MODE = 'trending_ranging'",
    verdict: "armed",
    binds: "Yes — blocks VOLATILE.",
    proof: "auto_config",
  },
  {
    gate: "6.7",
    name: "Exhaustion filter",
    computes: "weighted tell score",
    limit: "ENTRY_EXHAUSTION_ENABLED = 'false'",
    verdict: "shadow",
    binds: "No.",
    proof: "auto_config",
  },
  {
    gate: "6.9",
    name: "Order-flow context",
    computes: "context only",
    limit: "ORDERFLOW_ENTRY_ENABLED = 'false'",
    verdict: "inert",
    binds: "No.",
    proof: "auto_config",
  },
  {
    gate: "6.8",
    name: "Correlation cluster limit",
    computes: "F-SIZE-14",
    limit: "MAX_CONCURRENT_PER_CLUSTER = 2; MAX_CLUSTER_RISK_PCT = 4.0",
    verdict: "armed",
    binds:
      "Yes — the count cap binds first, refusing the 3rd position in a cluster; the risk cap would bind at the 4th.",
    proof:
      "live CORRELATION_LIMITS_STATE_JSON — cap_risk: 3.282168 reproduces exactly",
  },
  {
    gate: "6.6",
    name: "Time gate",
    computes: "UTC-hour membership",
    limit: "TIME_GATE_BLOCKED_UTC_HOURS_JSON = [13, 15, 17]",
    verdict: "armed",
    binds: "Yes — LIVE-BLOCKING, roughly 3 UTC hours a day.",
    proof: "TIME_GATE_PROMOTED = 'true'",
  },
  {
    gate: "7",
    name: "Loss-streak shadow",
    computes: "streak count",
    limit: "—",
    verdict: "shadow",
    binds: "No — logs only.",
    proof: "logs only",
  },
];

const EXTRA_CONSTRAINTS: GateRow[] = [
  {
    gate: "—",
    name: "LIVE_HARD_CAPITAL_CAP_USD",
    computes: "a hard cap on deployed capital",
    limit: "50.0",
    verdict: "inert",
    binds:
      "🚨 NO — A NO-OP STUB. live_executor._check_capital_cap returns (True, \u201cOK\u201d) UNCONDITIONALLY. It is NOT a safety limit and must not be read as one; only monitor_center display panels read the key at all.",
    proof: "live_executor._check_capital_cap",
  },
  {
    gate: "—",
    name: "Per-cell size down-weight",
    computes: "a 0.25 size factor on flagged regime cells",
    limit: "factor 0.25",
    verdict: "inert",
    binds:
      "No — inert by leverage. PER_CELL_DOWNWEIGHT_LIVE = 'true', but the classifier needs leverage ∈ [PER_CELL_SHADOW_HIGH_LEV_MIN = 15, MAX = 20], and it runs AFTER _apply_tail_cap, which yields 1–2×.",
    proof: "ordering against _apply_tail_cap",
  },
  {
    gate: "—",
    name: "Counter-regime block",
    computes: "HMM probability and leverage thresholds",
    limit: "HMM prob ≥ 0.9, leverage ≥ 15.0",
    verdict: "armed",
    binds:
      "Conditionally armed. COUNTER_REGIME_CHECK_ENABLED = 'true', HIGH_LEV_ONLY = 'true'; it runs BEFORE the tail cap, so it sees the PRE-cap leverage — the ordering is what keeps it reachable where the down-weight is not.",
    proof: "auto_config + ordering against _apply_tail_cap",
  },
  {
    gate: "—",
    name: "Post-outage 5× leverage arm",
    computes: "min(L, 5) after an outage",
    limit: "POST_OUTAGE_LEVERAGE_CAP = 5.0",
    verdict: "dead",
    binds:
      "No — DEAD. _apply_tail_cap runs after it and always yields ≤ 2×, so min(L, 5) can never change the outcome. Documented-dead in-code and deliberately retained. The counter-regime BLOCK arm of the same gate is separate and live.",
    proof: "_apply_tail_cap ordering",
  },
];

/** Counted from the rows above, so a tally can never contradict its own table. */
function tally(rows: GateRow[]): Record<GateVerdict, number> {
  const out: Record<GateVerdict, number> = {
    armed: 0,
    inert: 0,
    shadow: 0,
    dead: 0,
  };
  for (const r of rows) out[r.verdict] += 1;
  return out;
}

const GATE_TALLY = tally(GATE_ROSTER);
const EXTRA_TALLY = tally(EXTRA_CONSTRAINTS);
const TOTAL_TALLY = tally([...GATE_ROSTER, ...EXTRA_CONSTRAINTS]);

function tallyLabel(t: Record<GateVerdict, number>): string {
  return `${t.armed} armed · ${t.inert} inert · ${t.shadow} shadow · ${t.dead} dead`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentational helpers — local to this section, nothing shared is forked.
// ─────────────────────────────────────────────────────────────────────────────

const VERDICT_TONE: Record<GateVerdict, NonNullable<PillProps["tone"]>> = {
  armed: "green",
  inert: "red",
  shadow: "cyan",
  dead: "neutral",
};

const VERDICT_GLYPH: Record<GateVerdict, string> = {
  armed: "🟢",
  inert: "🟠",
  shadow: "🔵",
  dead: "⚫",
};

/**
 * The gate roster's status chip. It deliberately keeps the master's own
 * vocabulary (ARMED, not LIVE) — `StatusBadge` is the FORMULA badge and says
 * something different. Same `<Pill>` primitive, same tones, no fork.
 */
function VerdictPill({ verdict }: { verdict: GateVerdict }) {
  return (
    <Pill
      tone={VERDICT_TONE[verdict]}
      className={cn(verdict === "dead" && "opacity-60")}
    >
      <span aria-hidden="true">{VERDICT_GLYPH[verdict]}</span>
      {verdict.toUpperCase()}
    </Pill>
  );
}

/**
 * One roster row. Rendered as a stacked block rather than a table row: 19 rows
 * of long prose in a <table> is unreadable at 375px, and this needs no
 * horizontal scroll at any width.
 */
function GateCard({ row, index }: { row: GateRow; index: number }) {
  return (
    <li className="rounded border border-border-subtle bg-bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-micro tabular-nums text-fg-dim">
          {String(index).padStart(2, "0")}
        </span>
        {row.gate !== "—" ? (
          <span className="font-mono text-micro tabular-nums text-accent-cyan-soft-strong">
            Gate {row.gate}
          </span>
        ) : null}
        <span className="flex-1 text-caption-ui text-fg-primary">
          {row.name}
        </span>
        <VerdictPill verdict={row.verdict} />
      </div>

      <dl className="mt-2 space-y-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-micro text-fg-dim">Computes</dt>
          <dd className="flex-1 text-caption text-fg-muted">{row.computes}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-micro text-fg-dim">Live limit</dt>
          <dd className="flex-1 font-mono text-caption text-fg-primary break-words">
            {row.limit}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-micro text-fg-dim">Binds today?</dt>
          <dd className="flex-1 text-caption text-fg-primary">{row.binds}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-micro text-fg-dim">Proof</dt>
          <dd className="flex-1 font-mono text-caption text-fg-dim break-words">
            {row.proof}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/** A callout that is neither a formula nor a gate — the master's 🚨 notes. */
function Callout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border-amber bg-accent-amber/5 p-3">
      <p className="text-caption text-fg-primary">
        <span aria-hidden="true">🚨 </span>
        <strong>{title}</strong> {children}
      </p>
    </div>
  );
}

/**
 * The cascade table — 13 tickers and the cap each produces at today's `f`.
 * Numbers are DERIVED from the mirrored CASCADE_LMAX / venue_max tables using
 * the code's own effective_lev expression, never retyped.
 */
function CascadeTable() {
  if (CASCADE_ROWS.length === 0) {
    return (
      <p className="rounded border border-border-subtle bg-bg-card p-3 text-caption text-fg-muted">
        No live value available — the mirrored CASCADE_LMAX table could not be
        read, so no cap is shown rather than a wrong one.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-caption tabular-nums">
        <caption className="pb-2 text-left text-caption text-fg-muted">
          Every ticker in <span className="font-mono">sleeves.CASCADE_LMAX</span>,
          and the integer leverage the tail cap produces at today&rsquo;s{" "}
          <span className="font-mono">f = {FRACTION_LABEL}</span>.
        </caption>
        <thead>
          <tr className="border-b border-border-subtle text-left text-micro text-fg-dim">
            <th scope="col" className="py-1 pr-2 font-normal">
              Ticker
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-normal">
              Λ_T
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-normal">
              Venue
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-normal">
              {FRACTION_LABEL}·Λ
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-normal">
              Cap C_T
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Lev
            </th>
          </tr>
        </thead>
        <tbody>
          {CASCADE_ROWS.map((r) => (
            <tr
              key={r.ticker}
              className={cn(
                "border-b border-border-subtle/50",
                !r.tradeable && "text-fg-muted",
              )}
            >
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <span
                  className={cn(
                    "font-mono",
                    r.tradeable ? "text-fg-primary" : "text-fg-muted",
                  )}
                >
                  {r.ticker}
                </span>
                {!r.tradeable ? (
                  <span className="block text-micro text-fg-dim">
                    not tradeable today
                  </span>
                ) : null}
              </th>
              <td className="py-1.5 pr-2 text-right font-mono">
                {r.lambda.toFixed(2)}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono text-fg-muted">
                {r.venue.toFixed(1)}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono">
                {r.scaled.toFixed(3)}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono">
                {r.cap.toFixed(4)}
                {r.fromFloor ? (
                  <span className="block text-micro text-fg-dim">← floor</span>
                ) : null}
              </td>
              <td className="py-1.5 text-right font-mono font-bold text-fg-primary">
                {r.lev}×
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function MathSizingGates() {
  return (
    <>
      <MathSection
        number={7}
        title={SECTION_TITLE[7]}
        intro={
          <div className="space-y-2">
            <p>
              How TREVOR decides how big a position is. Risk is fixed in
              dollars first, two independent estimators propose a notional, the
              smaller wins, and margin is derived last.
            </p>
            <p>
              Every 🟢 entry in this family is downstream of{" "}
              <span className="font-mono">PAPER_WINDOW_ENABLED = true</span>:
              the math runs, the fill is simulated.
            </p>
            <p className="text-fg-dim">{MIRROR_STAMP}</p>
          </div>
        }
      >
        {SIZING_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>

      <MathSection
        number={8}
        title={SECTION_TITLE[8]}
        intro={
          <div className="space-y-2">
            <p>
              Two entries here compute a leverage with some care. The third
              throws it away. The tail cap is called unconditionally, behind no
              feature flag, and bounds leverage by the worst move each ticker
              has ever actually made — so the smart layer proposes and the dumb
              layer disposes.
            </p>
            <p>
              Read F-SIZE-06 and F-SIZE-07 knowing that F-SIZE-08 overwrites
              them on 9 of the 10 sacred tickers.
            </p>
          </div>
        }
      >
        {TAIL_CAP_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}

        <div className="rounded-lg border border-border-subtle bg-bg-card p-4 sm:p-5">
          <h3 className="text-h3 text-fg-primary">
            CASCADE_LMAX — the wall, per ticker
          </h3>
          <p className="mt-1 font-mono text-caption text-fg-dim break-all">
            auto_trader.sleeves.CASCADE_LMAX · auto_trader.sleeves.venue_max
          </p>

          <div className="mt-3">
            <CascadeTable />
          </div>

          <div className="mt-4 space-y-2 text-caption text-fg-muted">
            <p>
              Λ_T is the measured cascade tail ceiling — 1 / |worst daily
              open→low excursion| — and the cap is the code&rsquo;s own
              expression{" "}
              <span className="font-mono">
                max(floor, min(f · Λ_T, venue_max))
              </span>
              , floored to the integer Hyperliquid accepts. Cross-checked
              against the live log: <span className="font-mono">
                [TAIL-CAP] SUI leverage 5.00x -&gt; 1x (sleeve-wall cap 1.0000x
                floored)
              </span>{" "}
              and{" "}
              <span className="font-mono">
                [TAIL-CAP] NEAR leverage 10.00x -&gt; 1x (sleeve-wall cap
                1.0450x floored)
              </span>{" "}
              — both match exactly.
            </p>
            <p>
              CASCADE_LMAX covers 13 tickers; the sacred ten are ten of them.
              The three extras — PAXG, XMR and ZEC — are forward-looking sleeve
              config (diversifiers and a liquidity name) and are{" "}
              <strong className="text-fg-primary">
                not in the sacred trading universe today
              </strong>
              .
            </p>
            <p>
              SUI (1.21) and FARTCOIN (1.16) are the two thin-history names and
              are deliberately the most conservative values in the table. The
              code carries a 4-condition gate on revisiting them: thin history
              is a reason for caution, not for relaxation.
            </p>
          </div>

          <div className="mt-4">
            <Callout title="What this table means in practice.">
              BTC caps at 2×. Every other sacred ticker caps at 1×. Whatever
              confidence, regime and volatility computed upstream, this is the
              leverage the position actually gets.
            </Callout>
          </div>
        </div>
      </MathSection>

      <MathSection
        number={9}
        title={SECTION_TITLE[9]}
        intro={
          <div className="space-y-2">
            <p>
              What stops a trade before it starts. Reconciled against the
              in-code registry at{" "}
              <span className="font-mono">manager._on_signal_impl</span>:{" "}
              <strong className="text-fg-primary">
                a gate rejects a signal; it never alters size.
              </strong>
            </p>
            <p>
              A gate being present is not a gate being armed, and a gate being
              armed is not a gate that binds. The roster below states all three
              separately.
            </p>
          </div>
        }
      >
        {GATE_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}

        <div className="rounded-lg border border-border-subtle bg-bg-card p-4 sm:p-5">
          <h3 className="text-h3 text-fg-primary">
            The gate roster — {GATE_ROSTER.length} gates
          </h3>
          <p className="mt-1 text-caption text-fg-muted">
            {tallyLabel(GATE_TALLY)}
          </p>

          <ol className="mt-3 space-y-2">
            {GATE_ROSTER.map((row, i) => (
              <GateCard key={`${row.gate}-${row.name}`} row={row} index={i + 1} />
            ))}
          </ol>

          <h3 className="mt-6 text-h3 text-fg-primary">
            {EXTRA_CONSTRAINTS.length} extra numeric constraints, outside the
            gate chain
          </h3>
          <p className="mt-1 text-caption text-fg-muted">
            {tallyLabel(EXTRA_TALLY)}
          </p>

          <ol className="mt-3 space-y-2">
            {EXTRA_CONSTRAINTS.map((row, i) => (
              <GateCard
                key={`${row.name}`}
                row={row}
                index={GATE_ROSTER.length + i + 1}
              />
            ))}
          </ol>

          <div className="mt-5 space-y-3">
            <div className="rounded border border-border-subtle bg-bg-elevated p-3">
              <p className="text-caption text-fg-primary">
                <strong>Tally</strong> — {GATE_ROSTER.length} gates:{" "}
                {tallyLabel(GATE_TALLY)}. {EXTRA_CONSTRAINTS.length} extras:{" "}
                {tallyLabel(EXTRA_TALLY)}. Across all{" "}
                {GATE_ROSTER.length + EXTRA_CONSTRAINTS.length} rows:{" "}
                <strong>{tallyLabel(TOTAL_TALLY)}</strong>.
              </p>
              <p className="mt-2 text-caption text-fg-muted">
                These counts are computed from the rows above rather than
                transcribed. The RM-MATH master spec&rsquo;s own summary line
                reads <span className="font-mono">
                  8 armed · 4 inert · 4 shadow · 1 dead
                </span>{" "}
                — that sums to 17 across{" "}
                {GATE_ROSTER.length + EXTRA_CONSTRAINTS.length} rows and counts
                4 shadow where its table lists {TOTAL_TALLY.shadow}, so it does
                not reconcile with its own table. Recorded rather than repeated.
              </p>
            </div>

            <Callout title="Two 0s, two meanings.">
              A cap of <span className="font-mono">0</span> means{" "}
              <strong>UNLIMITED</strong> — <span className="font-mono">
                if max_daily &gt; 0:
              </span>{" "}
              guards the block, and the docstring says &ldquo;a cap value ≤ 0
              disables that sub-cap&rdquo;. But{" "}
              <span className="font-mono">lmax_fraction ≤ 0</span> is clamped to{" "}
              <span className="font-mono">1e-9</span>, so leverage stays at the{" "}
              <strong>floor</strong> rather than becoming unbounded. The same
              literal means &ldquo;no limit&rdquo; in one place and &ldquo;maximum
              limit&rdquo; in the other.
            </Callout>

            <Callout title="The $50 cap is not a safety limit.">
              <span className="font-mono">LIVE_HARD_CAPITAL_CAP_USD = 50.0</span>{" "}
              reads like a hard ceiling on deployed capital. It is a no-op stub:{" "}
              <span className="font-mono">
                live_executor._check_capital_cap
              </span>{" "}
              returns <span className="font-mono">(True, &ldquo;OK&rdquo;)</span>{" "}
              unconditionally, and only monitor_center display panels read the
              key. Nothing is capped at $50.
            </Callout>
          </div>
        </div>
      </MathSection>
    </>
  );
}
