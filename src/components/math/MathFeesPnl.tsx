import * as React from "react";
import {
  FormulaEntry,
  MATH_SECTIONS,
  MathSection,
  MathTex,
  type FormulaEntryProps,
} from "@/components/math";

/**
 * Sections 12–14 — fees · P&L · break-even.
 * Formula IDs F-FEE-01…11.  [D5, 2026-08-05 · scaffold: B1]
 *
 * TRANSCRIBED, NOT AUTHORED. Every formula, symbol gloss, explanation and
 * number below comes from the RM-MATH master spec
 * (`docs/reports/recon/2026-08-04_math-page/MASTER_2026-08-04_math-page.md`, VM)
 * or from the constant mirror `src/lib/math-constants.ts` (stamped `bcbce58`).
 * 🚨 Where the two disagree the MIRROR wins and the disagreement is reported.
 * Nothing here was inferred, rounded, or filled in from memory.
 *
 * 🚨 F-FEE-12 (`fees.compute_breakeven_move_pct`) IS DELIBERATELY ABSENT.
 * It is ⚫ DEAD — zero references in the entire tree — and its docstring is
 * unit-wrong (it multiplies by leverage, which is the wrong direction for a
 * price move). The master's own exclusion list (§7.4) says keep it off the
 * page. The gap between 11 and 13 is not a transcription miss. Its arithmetic
 * and its output are rendered NOWHERE; it is named only where the master itself
 * names it — in the fee-reachability census and in F-FEE-10's source note —
 * so a later reader cannot mistake it for the live break-even helper.
 *
 * 🚨 THE OVERLAY. Every entry whose arithmetic runs on today's live path
 * carries `overlay="paper"`: the maths executes, the fill is simulated. Two
 * entries deliberately do NOT — F-FEE-02 and F-FEE-09 are ledger measurements
 * over 557 REAL (`paper_window = 0`) pre-cutover closed trades, and a 🟡 PAPER
 * badge on those would say the opposite of what is true. Each says so in its
 * own status note rather than leaving the absence to be guessed at.
 *
 * 🚨 THE BACKSLASH IS LOAD-BEARING. Every TeX string is a `String.raw`
 * template so `\text{pnl\_usd}` reaches KaTeX with its escape intact. Without
 * it KaTeX renders a subscript — "pnl" with a subscripted "usd" — instead of
 * the column name. Do not "clean up" the raw literals.
 */

/** Titles come from the pinned registry — never hardcoded here. */
function sectionTitle(n: number): string {
  return MATH_SECTIONS.find((s) => s.number === n)?.title ?? `Section ${n}`;
}

/**
 * A reference table for the section intros. §3.4a of the master is three
 * tables, and `FormulaEntry` has no table affordance by design — forking it
 * would break the contract five sibling prompts share. `intro` takes a
 * ReactNode, so the tables live there instead. Scrolls in its own box so a
 * wide table never scrolls the page sideways.
 */
function RefTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="mt-3">
      <h4 className="text-micro text-fg-dim">{caption}</h4>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-caption">
          <thead>
            <tr className="border-b border-border-subtle text-left">
              {head.map((h, i) => (
                <th key={i} className="py-1.5 pr-3 font-normal text-fg-dim">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border-subtle/50">
                {r.map((cell, j) => (
                  <td
                    key={j}
                    className={
                      j === 0
                        ? "py-1.5 pr-3 align-top text-fg-primary"
                        : "py-1.5 pr-3 align-top text-fg-muted"
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §12 — Fees.  F-FEE-01 … F-FEE-04  (master §8.1: "What it costs")
// ─────────────────────────────────────────────────────────────────────────────

const FEES_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-FEE-01",
    name: "The Hyperliquid Fee Schedule",
    status: "live",
    overlay: "paper",
    statusNote:
      "Booking path, and it has no gating flag: FEE_MODEL_V2_ENABLED is live false and the booking sites deliberately do not consult it — adding the gate would silently revert to taker-only.",
    source:
      "auto_trader.fees.HL_MAKER_FEE_RATE · auto_trader.fees.HL_TAKER_FEE_RATE — mirrored as bps at auto_trader.executor.MAKER_FEE_BPS · TAKER_FEE_BPS",
    tex: String.raw`r_{\text{maker}} = 1.5\ \text{bps} = 1.5\times10^{-4} = 0.015\%
\qquad
r_{\text{taker}} = 4.5\ \text{bps} = 4.5\times10^{-4} = 0.045\%`,
    symbols: [
      {
        sym: String.raw`r_{\text{maker}}`,
        means:
          "the fee charged when the order rests on the book and is filled by someone else (post-only / ALO).",
      },
      {
        sym: String.raw`r_{\text{taker}}`,
        means:
          "the fee charged when the order crosses the spread and removes liquidity (market, IOC, native trigger).",
      },
    ],
    why: "An exchange pays you to supply liquidity and charges you to consume it, because a resting order makes the market tighter for everyone else. Hyperliquid's base tier charges 4.5 bps to take and 1.5 bps to make. TREVOR is on the BASE tier with no referral or staking discount — asserted by the module and, more importantly, measured by the ledger (F-FEE-02).",
    values: [
      {
        label: "Maker rate",
        value: "0.00015",
        note: "1.5 bps · auto_trader.fees.HL_MAKER_FEE_RATE — an external market constant, not an auto_config row",
      },
      {
        label: "Taker rate",
        value: "0.00045",
        note: "4.5 bps · auto_trader.fees.HL_TAKER_FEE_RATE — an external market constant, not an auto_config row",
      },
      {
        label: "Maker rate, bps mirror",
        value: "1.5",
        note: "auto_trader.executor.MAKER_FEE_BPS — not currently consumed; aggressive flow is all taker",
      },
      {
        label: "Taker rate, bps mirror",
        value: "4.5",
        note: "auto_trader.executor.TAKER_FEE_BPS",
      },
      {
        label: "Round trip, taker in / taker out",
        value: "9.0 bps",
        note: "auto_trader.executor.ROUND_TRIP_BPS, defined as TAKER_FEE_BPS × 2",
      },
      {
        label: "Fee tier",
        value: "no live value available",
        note: "BASE tier, no referral and no staking discount — an assumption asserted in code, not a value read from anywhere on the box. Nothing stores it.",
      },
    ],
    caveat:
      "The tier is NOT STORED ANYWHERE. “BASE tier, no discount” is a code assertion, and it is stated here as an assumption rather than a reading. What is not an assumption is the rate itself: F-FEE-02 measures it against the ledger.",
  },
  {
    id: "F-FEE-02",
    name: "Ledger Verification of the Rates",
    status: "live",
    statusNote:
      "Measured, not asserted — this is not a formula the code runs, it is the evidence that F-FEE-01's constants are the real ones. No paper overlay on purpose: the cohort is 557 REAL closed trades with paper_window = 0, so a 🟡 PAPER badge would say the opposite of what is true. There are 0 such rows post-cutover.",
    source:
      "auto_trades.fees_usd_true / auto_trades.original_notional_usd — a ledger measurement, not a code path",
    tex: String.raw`\text{RT}_{\text{bps}}^{\text{measured}}
= \frac{\sum_i \text{fees\_usd\_true}_i}{\sum_i \text{original\_notional\_usd}_i}\times 10^{4}`,
    symbols: [
      {
        sym: String.raw`\text{fees\_usd\_true}_i`,
        means:
          "the real per-leg Hyperliquid fee on trade i, captured by the Fee-Model Truth Fix — what the exchange actually charged.",
      },
      {
        sym: String.raw`\text{original\_notional\_usd}_i`,
        means:
          "trade i's entry position notional (exposure = margin × leverage), immutable after open.",
      },
      {
        sym: String.raw`10^{4}`,
        means: "fraction → basis points.",
      },
    ],
    why: "The blend sits between taker/taker 9.0 bps and maker-entry 6.0 bps because the real book is taker-heavy with a minority of ALO maker entries. The 4.5 / 1.5 bps rates are CONFIRMED against the ledger — this is the difference between a page that quotes a constant and a page that can show the constant was right.",
    values: [
      {
        label: "Σ fees_usd_true",
        value: "$41.6726",
        note: "the real exchange fees actually charged over the window",
      },
      {
        label: "Σ original_notional_usd",
        value: "$50,762.09",
        note: "entry position notional — exposure-scale, not margin-scale",
      },
      {
        label: "Blended true round-trip",
        value: "8.2094 bps",
        note: "n = 557 deduped closed trades",
      },
      {
        label: "Per-trade mean true round-trip",
        value: "8.2456 bps",
        note: "n = 557 — the mean and the blend differ because the blend is notional-weighted",
      },
      {
        label: "Window",
        value: "2026-07-01 07:51:03 → 2026-07-18 07:02:53",
        note: "opened → closed, naive ET; cohort all paper_window = 0",
      },
      {
        label: "Sharper per-cohort proof",
        value: "191 rows @ 9.0 bps · 41 rows @ 6.0 bps",
        note: "documented in fees.py, restricted to partial_exits_taken = 0 so the denominator is untouched — taker-entry rows land on exactly 9.0, ALO-entry rows on exactly 6.0",
      },
    ],
    caveat:
      "This is a HISTORICAL cohort — n = 557, 2026-07-01 → 2026-07-18, all paper_window = 0 — and it must never be read as a current rate. auto_trades.id is the PK, so dedup is structural: there is NO trade_id column on auto_trades. Always state the window with the number.",
  },
  {
    id: "F-FEE-03",
    name: "The Fee Base",
    status: "live",
    overlay: "paper",
    statusNote:
      "🚨 The single most important thing on this page to get right. A fee rate applied to the wrong base is wrong by the leverage multiple.",
    source:
      "auto_trader.executor.calculate_pnl · auto_trader.live_executor._close_live_position",
    tex: String.raw`\text{fees\_usd} = \underbrace{(\text{notional\_usd} \times L)}_{\text{position notional (exposure)}} \times \frac{\text{fees\_bps}}{10^{4}}`,
    symbols: [
      {
        sym: String.raw`\text{notional\_usd}`,
        means:
          "🚨 the POSTED MARGIN, not the position size. Its name lies. It is also DECREMENTED by every partial exit.",
      },
      { sym: String.raw`L`, means: "leverage — auto_trades.leverage." },
      {
        sym: String.raw`\text{notional\_usd} \times L`,
        means:
          "the actual position notional (exposure). THIS IS THE FEE BASE.",
      },
      {
        sym: String.raw`\text{fees\_bps}`,
        means:
          "the round-trip rate in bps, written to the row at close — a model, not a measurement.",
      },
    ],
    why: "An exchange charges a fee on the size of the position you move, not on the collateral you posted against it. At 5× leverage a $10 margin controls a $50 position, and the fee is charged on the $50. Applying the rate to notional_usd directly would understate the fee by exactly the leverage multiple.",
    values: [
      {
        label: "Fee base",
        value: "auto_trades.notional_usd × auto_trades.leverage",
        note: "evaluated AT CLOSE — the notional remaining, not the notional at entry",
      },
      {
        label: "Verified",
        value: "1786 / 1786",
        note: "closed rows with both columns non-NULL where fees_usd == notional_usd × leverage × fees_bps/10⁴, tolerance $0.0002",
      },
      {
        label: "Competing hypothesis — bare notional_usd",
        value: "41 / 1786",
        note: "FAILS — this is the margin-as-notional error",
      },
      {
        label: "Competing hypothesis — original_notional_usd × leverage",
        value: "56 / 1786",
        note: "FAILS",
      },
      {
        label: "Entry position notional",
        value: "auto_trades.original_notional_usd",
        note: "exposure-scale, not margin-scale; equals notional_usd × leverage on 448 of 466 undecremented (partial_exits_taken = 0) rows, the other 18 being leverage = 1.0 rows where the two are trivially equal",
      },
      {
        label: "original_notional_usd coverage",
        value: "NULL on 994 / 1793 rows",
        note: "pre-M10 history; populated going forward",
      },
    ],
    caveat:
      "THE TRAP: auto_trades.notional_usd IS the posted margin, not the position notional. Position notional is notional_usd × leverage, and the immutable entry figure is original_notional_usd — which is NULL on 994 of 1793 rows. A fee applied to margin instead of notional is wrong by exactly the leverage multiple, and dividing notional_usd by leverage to “get margin” is wrong by a factor of L² — the error that has already bitten the Hub once. 🚨 IT IS INVISIBLE TODAY: the tail cap forces 1× on nine of the ten sacred tickers (BTC 2×), and at L = 1 the posted margin IS the full position notional, so both readings agree. The error costs nothing today and becomes lethal the moment leverage rises.",
  },
  {
    id: "F-FEE-04",
    name: "Per-Leg Fee Resolution (is_maker-aware)",
    status: "live",
    overlay: "paper",
    statusNote:
      "LOADED AND RUNNING — the service restarted 2026-08-04 21:23:04 EDT, after P2's commit e196098 at 12:28:27 EDT, and 0 commits are inert.",
    source:
      "auto_trader.fees.round_trip_bps ← fees.entry_fee_bps + fees.exit_fee_bps ← fees.is_maker_fill_path",
    tex: String.raw`\text{fees\_bps} = r_{\text{entry}} + r_{\text{exit}},\qquad
r_{\text{leg}} =
\begin{cases}
1.5\ \text{bps} & \text{if } \text{fill\_path} \in \{\texttt{alo},\ \texttt{maker}\}\\[2pt]
4.5\ \text{bps} & \text{otherwise (default TAKER)}
\end{cases}`,
    symbols: [
      {
        sym: String.raw`\text{fill\_path}`,
        means:
          "a recorded token naming how that leg actually filled.",
      },
      {
        sym: String.raw`r_{\text{entry}}`,
        means: "the resolved rate for the entry leg.",
      },
      {
        sym: String.raw`r_{\text{exit}}`,
        means: "the resolved rate for the exit leg.",
      },
    ],
    why: "The two legs of a trade are independent — the entry can rest and earn the maker rate while the exit crosses and pays taker, so a single round-trip constant cannot express what really happened. The whitelist is closed and fails to TAKER: None, a missing key, an empty string, “market”, “unknown”, a typo, a non-string, or any raised exception all resolve to taker. That asymmetry is deliberate — mislabelling a taker fill as maker under-costs a trade and makes a losing strategy look viable, whereas the conservative error only costs accuracy. And there are THREE legs, not two: entry (maker or taker), partial exit (maker or taker), and final exit, which is ALWAYS taker — market_close, IOC reduce-only and native TP/SL triggers are taker by construction, and no maker final-close path exists.",
    values: [
      {
        label: "Maker fill-path whitelist",
        value: '["alo", "maker"]',
        note: "auto_trader.fees._MAKER_FILL_PATHS — a frozenset in Python. Only a CONFIRMED post-only fill (alo) or a confirmed maker partial (maker) is billed at the maker rate.",
      },
      {
        label: "Booked per-trade rate",
        value: "auto_trades.fees_bps",
        note: "🚨 a MODEL, not a measurement — 9.0 on all 1786 non-NULL closed rows today",
      },
      {
        label: "Entry fill path",
        value: "auto_trades.entry_fill_path",
        note: "forward-only; NULL on all 1789 pre-P2 rows by design (additive-DB law)",
      },
      {
        label: "Rows carrying a fill path",
        value: "exactly 1",
        note: "id 101778, opened 2026-08-04 23:23:48, entry_fill_path = market (taker fallback), paper_window = 1. Booked fee $0.0587 on notional_usd = 65.166744, leverage = 1.0 → 65.166744 × 9/10⁴ = $0.05865. P2 is writing, and correctly defaulting to taker.",
      },
      {
        label: "Historical maker/taker mix per trade",
        value: "no live value available",
        note: "the fill-path column is forward-only, so the mix is NOT retrievable for any historical trade. The 8.2094 blend (F-FEE-02) measures the mix's EFFECT; the 191/41 cohort split measures its COMPOSITION. Beyond that: UNKNOWN.",
      },
    ],
    caveat:
      "No maker fill has been booked yet. Every closed row still reads fees_bps = 9.0 (1786 rows) or NULL (6 rows), so the 6.0 bps maker-entry case is a rate the system CAN resolve, not one it has yet charged.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §13 — P&L.  F-FEE-05 … F-FEE-09  (master §8.1: "What you actually made")
// ─────────────────────────────────────────────────────────────────────────────

const PNL_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-FEE-05",
    name: "Perpetual Gross P&L, both directions",
    status: "live",
    overlay: "paper",
    source:
      "auto_trader.executor.calculate_pnl — mirrored in auto_trader.live_executor._close_live_position and auto_trader.executor.execute_partial_exit",
    tex: [
      String.raw`\text{pnl\_pct}_{\text{long}} = \frac{P_{\text{exit}} - P_{\text{entry}}}{P_{\text{entry}}}\times 100 \times L
\qquad
\text{pnl\_pct}_{\text{short}} = \frac{P_{\text{entry}} - P_{\text{exit}}}{P_{\text{entry}}}\times 100 \times L`,
      String.raw`\text{gross\_pnl\_usd} = \text{notional\_usd}\times\frac{\text{pnl\_pct}}{100}
\;=\;\underbrace{(\text{notional\_usd}\times L)}_{\text{exposure}}\times\frac{\pm(P_{\text{exit}}-P_{\text{entry}})}{P_{\text{entry}}}`,
      String.raw`\text{PnL}^{\text{gross}}_{\text{long}} = q\,(P_{\text{exit}} - P_{\text{entry}}),
\qquad
\text{PnL}^{\text{gross}}_{\text{short}} = q\,(P_{\text{entry}} - P_{\text{exit}}),
\qquad q = \frac{\text{notional\_usd}\times L}{P_{\text{entry}}}`,
    ],
    symbols: [
      {
        sym: String.raw`P_{\text{entry}}`,
        means: "entry fill price, USD per unit.",
      },
      {
        sym: String.raw`P_{\text{exit}}`,
        means: "exit fill price, USD per unit.",
      },
      { sym: String.raw`L`, means: "leverage." },
      {
        sym: String.raw`\text{notional\_usd}`,
        means: "posted margin — the name lies (F-FEE-03).",
      },
      {
        sym: String.raw`q`,
        means: "position size, in units of the coin.",
      },
      {
        sym: String.raw`\text{pnl\_pct}`,
        means:
          "return ON MARGIN, in percent. Because L is baked in, this is NOT the price move.",
      },
    ],
    why: "A perpetual future has no expiry and no delivery — you are long or short a quantity q of the coin, and your P&L is q times the price change, signed by your direction. Leverage does not change that identity; it only sets how large q is for a given amount of collateral. The two directions are exact mirrors, which is why a page showing only the long form teaches half the system — so both are written out here, in full, rather than one with a note saying the short is the mirror.",
    values: [
      {
        label: "Entry / exit price",
        value: "auto_trades.entry_price · auto_trades.exit_price",
      },
      { label: "Leverage", value: "auto_trades.leverage" },
      {
        label: "Margin",
        value: "auto_trades.notional_usd",
        note: "AT CLOSE — partials shrink it",
      },
      { label: "Return on margin", value: "auto_trades.pnl_pct" },
    ],
    caveat:
      "pnl_pct is a return on MARGIN, not a price move. At L = 5, a pnl_pct of 10 means the price moved 2%. Conflating the two is the single easiest error to make with these columns.",
  },
  {
    id: "F-FEE-06",
    name: "Booked Net P&L",
    status: "live",
    overlay: "paper",
    source:
      "auto_trader.executor.calculate_pnl (the net_pnl_usd key), then the funding subtraction at auto_trader.live_executor._close_live_position and ._capture_native_fill",
    tex: String.raw`\text{pnl\_usd} \;=\; \underbrace{\text{gross\_pnl\_usd}}_{\text{F-FEE-05}} \;-\; \underbrace{\text{fees\_usd}}_{\text{F-FEE-03}} \;-\; \underbrace{\text{funding\_paid\_usd}}_{\text{F-FEE-14}}`,
    symbols: [
      {
        sym: String.raw`\text{pnl\_usd}`,
        means:
          "the value written to auto_trades.pnl_usd — the booked net on the REMAINING position only.",
      },
      {
        sym: String.raw`\text{fees\_usd}`,
        means: "the modelled round-trip fee.",
      },
      {
        sym: String.raw`\text{funding\_paid\_usd}`,
        means:
          "cumulative funding for the position's life; POSITIVE MEANS COST.",
      },
    ],
    why: "Gross P&L is what the price move earned; net is what reached the account. Three things stand between them on a perpetual: the exchange fee both ways, funding paid or received while the position was open, and slippage — and slippage is already inside P_entry and P_exit, so it never appears as a separate term (F-FEE-13).",
    values: [
      {
        label: "Booked net per trade",
        value:
          "auto_trades.pnl_usd + COALESCE(auto_trades.partial_pnl_realized, 0)",
        note: "never a bare SUM(pnl_usd); id is PK so dedup is structural; state the window",
      },
      { label: "Booked fee", value: "auto_trades.fees_usd" },
      { label: "Funding", value: "auto_trades.funding_paid_usd" },
    ],
    caveat:
      "pnl_usd does NOT include partial_pnl_realized. Money banked through the partial ladder lives in its own column, so a SUM(pnl_usd) over the book is the ~80-site partials undercount. Realised net for a trade is ALWAYS pnl_usd + COALESCE(partial_pnl_realized, 0).",
  },
  {
    id: "F-FEE-07",
    name: "True Net P&L, and what FEES_TRUE_CAPTURE_ENABLED changes",
    status: "split",
    overlay: "paper",
    statusNote:
      "SPLIT — 🟢 LIVE where the flag is true: config.cfg_bool(“FEES_TRUE_CAPTURE_ENABLED”) reads true in auto_config, updated_at 2026-07-16 12:01:16. / 🟡 UNAVAILABLE IN PAPER: a simulated fill produces no exchange fee, so the true columns cannot populate in the current era. Both halves are true at the same time, which is what the split badge means.",
    source:
      "auto_trader.live_executor._capture_native_fill (the true-fee block) · scripts/backfill_fees_true.py (the backfill mechanism)",
    tex: [
      String.raw`\text{fees\_usd\_true} = \sum_{f \in \text{fills}(\text{position})} \text{fee}_f
\qquad\text{over } t_f \in [\,t_{\text{start}},\ t_{\text{next\_open}}\,)`,
      String.raw`\text{net\_pnl\_usd\_true} = \text{gross\_pnl\_usd} - \text{fees\_usd\_true} - \text{funding\_paid\_usd}`,
    ],
    symbols: [
      {
        sym: String.raw`\text{fills}(\text{position})`,
        means:
          "the real Hyperliquid fills belonging to this position: the entry opens, every partial close, and the final close.",
      },
      {
        sym: String.raw`\text{fee}_f`,
        means:
          "the fee Hyperliquid actually charged on fill f, as reported by the exchange.",
      },
      {
        sym: String.raw`t_{\text{start}},\ t_{\text{next\_open}}`,
        means:
          "the millisecond window isolating this position's fills from the next position's.",
      },
    ],
    why: "With the flag OFF, both true columns are written None, the close_trade UPDATE COALESCEs them, and the row keeps NULL — byte-identical to no capture at all. With it ON, the real fee is summed from fills already in hand — no new exchange query, off the hot trade loop — and both columns populate. It is accounting-only: fees_usd and pnl_usd are untouched, so the daily-loss breaker, the fee-aware exit and the partial guard all still read the modelled numbers.",
    values: [
      {
        label: "Flag",
        value: "true",
        note: "auto_config FEES_TRUE_CAPTURE_ENABLED, updated_at 2026-07-16 12:01:16",
      },
      { label: "True fee", value: "auto_trades.fees_usd_true" },
      { label: "True net", value: "auto_trades.net_pnl_usd_true" },
      {
        label: "Availability, lifetime",
        value: "557 / 1792 closed rows",
        note: "non-NULL fees_usd_true",
      },
      {
        label: "Availability, post-cutover",
        value: "0 / 46 rows — no live value available",
        note: "Unavailable in the paper window: a simulated fill produces no exchange fee. This is STRUCTURAL, not a fault, and the flag is not the cause. The page must never fall through to the booked value as though it were measured.",
      },
    ],
    caveat:
      "net_pnl_usd_true is NOT net P&L — it omits partial_pnl_realized, and F-FEE-09 measures how large that omission is (178% of the reported figure over the laddered cohort). Do not read the name as a complete statement of what a trade made.",
  },
  {
    id: "F-FEE-08",
    name: "The Realised-P&L Column Ledger",
    status: "live",
    overlay: "paper",
    statusNote:
      "Twelve columns, each written at a different moment in the trade's life. The ledger is the entry — there is no formula, and none is invented here.",
    source:
      "auto_trader.models.close_trade (the UPDATE) — the partial path via auto_trader.executor.execute_partial_exit",
    tex: [],
    symbols: [],
    why: "The columns do not all mean what their names suggest, and they are not all written at the same moment — some at open, some at close, some accrued during the position's life, and two only on the native-fill capture path. Reading any one of them without knowing which moment it belongs to is how a correct column produces a wrong total. The list below is that mapping: what each column holds, and when it was written.",
    values: [
      {
        label: "pnl_usd",
        value: "close",
        note: "gross − modelled fee − funding, ON THE REMAINING POSITION ONLY",
      },
      {
        label: "pnl_pct",
        value: "close",
        note: "return on MARGIN in percent, leverage baked in — not a price move",
      },
      {
        label: "fees_usd",
        value: "close",
        note: "modelled round-trip fee on notional_usd × leverage AT CLOSE",
      },
      {
        label: "fees_bps",
        value: "close",
        note: "🚨 a MODEL, not a measurement — constant 9.0 on all 1786 non-NULL closed rows today; 6.0 will appear on maker-entry rows going forward",
      },
      {
        label: "fees_usd_true",
        value: "close (native-fill capture only)",
        note: "real summed exchange fee for the whole position lifetime",
      },
      {
        label: "net_pnl_usd_true",
        value: "close (native-fill capture only)",
        note: "gross − true fee − funding, PARTIALS EXCLUDED",
      },
      {
        label: "partial_pnl_realized",
        value: "each partial",
        note: "cumulative net banked by the ladder (gross slice − exit-leg fee on the slice)",
      },
      {
        label: "partial_exits_taken",
        value: "each partial",
        note: "ladder rung count / cursor",
      },
      {
        label: "notional_usd",
        value: "open, DECREMENTED at each partial",
        note: "posted margin remaining",
      },
      {
        label: "original_notional_usd",
        value: "open",
        note: "entry POSITION NOTIONAL (exposure = margin × leverage)",
      },
      {
        label: "funding_paid_usd",
        value: "accrued during life",
        note: "cumulative funding, POSITIVE = COST",
      },
      {
        label: "expected_funding_cost_at_entry",
        value: "open",
        note: "pre-trade estimate, signed fraction of notional",
      },
    ],
    caveat:
      "fees_bps is a MODEL. It is never an observed rate. The nightly digest carries an explicit fees_bps_column_note saying so, and this page says it too — a reader who treats that column as a measurement will conclude the fee schedule is flat when it is not.",
  },
  {
    id: "F-FEE-09",
    name: "The Money Identity",
    status: "live",
    statusNote:
      "VERIFIED. No paper overlay on purpose: the verification cohort is 557 REAL closed trades with paper_window = 0, so a 🟡 PAPER badge would misdescribe the evidence. The identity itself is algebra and holds regardless; what is historical is the data it was checked against.",
    source:
      "derived from auto_trader.executor.calculate_pnl and auto_trader.live_executor._capture_native_fill — verified against auto_trades",
    tex: [
      String.raw`\text{net\_pnl\_usd\_true} \;=\; \text{pnl\_usd} \;+\; \text{fees\_usd} \;-\; \text{fees\_usd\_true}`,
      String.raw`\text{realised\_net} = \underbrace{\text{pnl\_usd}}_{\text{final leg}} + \underbrace{\text{partial\_pnl\_realized}}_{\text{ladder}}`,
    ],
    symbols: [
      {
        sym: String.raw`\text{pnl\_usd}`,
        means: "booked net on the final leg = gross − modelled fee − funding.",
      },
      {
        sym: String.raw`\text{fees\_usd}`,
        means: "the modelled round-trip fee that was subtracted.",
      },
      {
        sym: String.raw`\text{fees\_usd\_true}`,
        means: "the real exchange fee, added back in its place.",
      },
      {
        sym: String.raw`\text{partial\_pnl\_realized}`,
        means: "cumulative net banked by the partial ladder.",
      },
    ],
    why: "Both sides expand to the same thing: pnl_usd = gross − fees_usd − funding and net_pnl_usd_true = gross − fees_usd_true − funding, so subtracting one from the other leaves exactly the fee difference. It is not an approximation, it is algebra — and it is why the true columns can be reconstructed from the booked ones plus one measurement. The identity is complete only after adding partials, which is the second line.",
    values: [
      {
        label: "Rows with all four columns non-NULL",
        value: "557",
        note: "deduped; auto_trades.id is the PK",
      },
      {
        label: "Rows where the identity holds at tolerance 1e-3",
        value: "557 / 557",
        note: "it holds",
      },
      { label: "Max absolute residual", value: "1.46e-4 USD" },
      {
        label: "Window",
        value: "opened 2026-07-01 07:51:03 → closed 2026-07-18 07:02:53",
        note: "naive ET; cohort all paper_window = 0",
      },
      {
        label: "Σ partial_pnl_realized",
        value: "$37.3405",
        note: "274 laddered rows inside the true-fee cohort",
      },
      {
        label: "Σ net_pnl_usd_true",
        value: "$20.9808",
        note: "same 274 rows",
      },
      {
        label: "Omission as a share of the reported figure",
        value: "178%",
        note: "what net_pnl_usd_true leaves out is larger than what it reports",
      },
    ],
    caveat:
      "Tolerance matters. At 1e-4 the same data reads 552/557 — the five “misses” are float rounding against 4-decimal stored values, not a second identity. A tolerance that is too tight manufactures a finding. And realised net is always pnl_usd + COALESCE(partial_pnl_realized, 0), never a bare SUM(pnl_usd).",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §14 — Break-even.  F-FEE-10 … F-FEE-11  (master §8.1: "The bar")
// 🚨 F-FEE-12 is EXCLUDED — see the file header.
// ─────────────────────────────────────────────────────────────────────────────

const BREAKEVEN_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-FEE-10",
    name: "Round-Trip Break-Even",
    status: "live",
    overlay: "paper",
    statusNote:
      "Derived, and reproduced from the ledger. 🚨 There is NO live helper that computes this — fees.compute_breakeven_move_pct exists but is unreachable and its docstring is unit-wrong, so it is not on this page and must not be used. Use the derivation above.",
    source: "derived from F-FEE-01, F-FEE-02 and F-FEE-03 — no live helper",
    tex: String.raw`\text{break-even: } \quad \frac{|\Delta P|}{P_{\text{entry}}} \;\ge\; f_{\text{RT}},
\qquad f_{\text{RT}} = r_{\text{entry}} + r_{\text{exit}}`,
    symbols: [
      {
        sym: String.raw`f_{\text{RT}}`,
        means:
          "total round-trip fee as a FRACTION of position notional.",
      },
      {
        sym: String.raw`\Delta P`,
        means:
          "the price move between entry and exit fills, signed by direction.",
      },
      {
        sym: String.raw`\text{required\_move}`,
        means:
          "the minimum favourable price move that leaves the trade at exactly zero.",
      },
    ],
    why: "Both the fee and the profit are proportional to the position notional, so the position size divides out entirely. That is why leverage does not appear: 25× leverage makes the fee 25 times larger in dollars AND makes the profit on a given price move 25 times larger, and the two cancel exactly. What leverage changes is how fast you reach the bar in MARGIN terms, not where the bar is in PRICE terms.",
    values: [
      {
        label: "Break-even bar, taker in / taker out",
        value: "9.0 bps",
        note: "derived from the two constants: (0.00045 + 0.00045) × 10⁴",
      },
      {
        label: "Break-even bar, ALO maker in / taker out",
        value: "6.0 bps",
        note: "(0.00015 + 0.00045) × 10⁴",
      },
      {
        label: "Break-even bar, TREVOR measured blend",
        value: "8.2094 bps — HISTORICAL COHORT, n = 557, 2026-07-01 → 07-18",
        note: "🚨 NOT a current figure. There is no live break-even bar: fees_usd_true has 0 post-cutover rows, so no post-cutover window can produce one. Reproduced independently by A4, not carried forward from a brief, and it lands on RECON-QUANT-006's prior figure to four significant figures.",
      },
      {
        label: "Live break-even bar",
        value: "no live value available",
        note: "fees_true_rows_post_cutover measured 0. A real fee comes from a real exchange fill, and a simulated fill produces none — structural, not a fault.",
      },
    ],
    caveat:
      "The 8.2 bps figure is a HISTORICAL COHORT and must never render as current. Its label always carries “historical cohort, n = 557, 2026-07-01 → 07-18”, because a bar quoted without its window reads as today's bar, and today there is none to quote.",
  },
  {
    id: "F-FEE-11",
    name: "Frequency Invariance",
    status: "live",
    overlay: "paper",
    statusNote: "A property of F-FEE-10, not a separate mechanism.",
    source: "derived from F-FEE-10 — no stored value; this is a derivation",
    tex: [
      String.raw`\mathbb{E}[\text{net per trade}] = \underbrace{e}_{\text{gross edge, bps}} - \underbrace{f_{\text{RT}}\times 10^4}_{\text{cost, bps}}
\quad\Longrightarrow\quad
\text{break-even} \iff e \ge f_{\text{RT}}\times 10^4`,
      String.raw`\text{total over } n \text{ trades} = n\,(e - f_{\text{RT}}\times 10^4)
\qquad \text{— } n \text{ multiplies both terms and cancels from the inequality}`,
    ],
    symbols: [
      {
        sym: String.raw`e`,
        means:
          "average gross edge per trade, in bps of position notional.",
      },
      {
        sym: String.raw`n`,
        means: "number of round trips over the period.",
      },
      {
        sym: String.raw`f_{\text{RT}}\times 10^4`,
        means: "the round-trip cost, in bps — the bar from F-FEE-10.",
      },
    ],
    why: "This is the counter-intuitive part the page exists to teach. The fee is charged PER ROUND TRIP, as a fraction of the notional traded. Trading twice as often doubles the fee dollars, but it also doubles the notional traded and the gross edge earned — so the per-trade bar, 8.2 bps, is exactly where it was. That makes “trade less and the fees will stop killing us” false as stated: trading less reduces the total drag, but it reduces the total edge by the same factor, and a strategy whose per-trade gross edge is below 8.2 bps loses money at EVERY frequency. What frequency does change is variance and the time available to accumulate edge — never the bar.",
    values: [
      {
        label: "The bar",
        value: "F-FEE-10",
        note: "8.2094 bps blended, historical cohort n = 557, 2026-07-01 → 07-18",
      },
      {
        label: "The property",
        value: "no stored value — a derivation",
        note: "nothing in the system computes or stores frequency invariance; it is a consequence of the bar being per-round-trip",
      },
    ],
    caveat:
      "n cancels from the INEQUALITY, not from the account. Trading less does reduce total fee dollars — it just reduces total edge dollars by the same factor, so it cannot turn a below-bar strategy into a profitable one. The only thing that clears the bar is per-trade gross edge above it.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export function MathFeesPnl() {
  return (
    <>
      <MathSection
        number={12}
        title={sectionTitle(12)}
        intro={<FeesIntro />}
      >
        {FEES_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>

      <MathSection number={13} title={sectionTitle(13)} intro={<PnlIntro />}>
        {PNL_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>

      <MathSection
        number={14}
        title={sectionTitle(14)}
        intro={<BreakevenIntro />}
      >
        {BREAKEVEN_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>
    </>
  );
}

/**
 * §12 intro — the master's §3.4a, which is three tables. The first is where the
 * bps ↔ fraction ↔ percent conversion is shown, once and in one place: it is
 * the most common source of a 100× error on this page.
 */
function FeesIntro() {
  return (
    <div className="space-y-4">
      <p>
        What a trade costs. Fees are the dominant economic force in TREVOR, and
        every number below applies to the <strong>position notional</strong>{" "}
        &mdash; margin &times; leverage &mdash; never to the posted margin
        alone. Read <span className="font-mono">F-FEE-03</span> before anything
        else in this section.
      </p>

      <RefTable
        caption="The fee schedule — bps, fraction and percent are the same number in three dresses"
        head={["Leg / mix", "bps", "fraction", "percent", "Base it applies to"]}
        rows={[
          [
            "Maker, one leg",
            "1.5",
            "0.00015",
            "0.015%",
            "position notional (margin × leverage)",
          ],
          ["Taker, one leg", "4.5", "0.00045", "0.045%", "position notional"],
          [
            "Round trip — taker / taker",
            "9.0",
            "0.00090",
            "0.090%",
            "position notional",
          ],
          [
            "Round trip — ALO maker in / taker out",
            "6.0",
            "0.00060",
            "0.060%",
            "position notional",
          ],
          [
            "Round trip — TREVOR measured blend (n = 557)",
            "8.2094",
            "0.00082094",
            "0.082094%",
            "entry position notional",
          ],
        ]}
      />

      <p className="text-fg-muted">
        <span aria-hidden="true">🚨 </span>
        The fill mix is taker-heavy, and two different mechanisms must not be
        conflated. The <strong>blend</strong> sits at 8.21 rather than 9.0
        because a minority of entries fill as ALO makers at 6.0 bps round trip.
        The <strong>model</strong> reads 7.06 against entry notional because the
        partial ladder shrinks its denominator (
        <span className="font-mono">F-FEE-20</span>) &mdash; not because the
        rate is wrong.
      </p>

      <RefTable
        caption="Two separate fee constant families — they agree numerically today, they are separate declarations, and they can drift"
        head={["Family", "Members", "Used by"]}
        rows={[
          [
            "Booking",
            <span key="b" className="font-mono">
              fees.HL_TAKER_FEE_RATE · fees.HL_MAKER_FEE_RATE ·
              executor.TAKER_FEE_BPS · executor.MAKER_FEE_BPS ·
              executor.ROUND_TRIP_BPS
            </span>,
            "what gets WRITTEN to auto_trades",
          ],
          [
            "Gating",
            <span key="g" className="font-mono">
              config.FEE_RATE_BPS = 9 · config.HL_FEE_TAKER = 0.00045 ·
              config.HL_FEE_MAKER = 0.00015 ·
              config.HL_FEE_ENTRY_TAKER_EXIT_MAKER = 0.0006 ·
              config.MIN_PROFIT_TARGET_FLOOR_PCT = 0.0018
            </span>,
            "live DECISION GATES — the partial fee guard, FEE_AWARE_EXIT, the TP floor, the breakeven arm",
          ],
        ]}
      />

      <RefTable
        caption="fees.py reachability census — which fee code actually runs (grep, excluding _archive/, tests and self-references)"
        head={["Symbol", "Non-self callers", "Status"]}
        rows={[
          [
            "round_trip_bps",
            "executor.calculate_pnl, live_executor._close_live_position",
            "🟢 LIVE",
          ],
          [
            "exit_fee_bps",
            "executor.execute_partial_exit, round_trip_bps",
            "🟢 LIVE",
          ],
          ["entry_fee_bps", "round_trip_bps", "🟢 LIVE (transitively)"],
          ["is_maker_fill_path", "the three above", "🟢 LIVE"],
          [
            "HL_TAKER_FEE_RATE / HL_MAKER_FEE_RATE",
            "the four above",
            "🟢 LIVE",
          ],
          [
            "calculate_entry_fee / calculate_exit_fee / calculate_round_trip_fee",
            "only fees.py internals + partial_exit_fee_guard_v1",
            "⚪ DORMANT",
          ],
          ["fee_pct_of_notional", "0 (one comment in config.py)", "⚪ DORMANT"],
          [
            "partial_exit_fee_guard_v2",
            "0 (one comment in config.py)",
            "⚪ DORMANT",
          ],
          [
            "estimate_funding_cost",
            "0 — and its live-rate call target does not exist",
            "⚫ DEAD — F-FEE-14 / F-FEE-15 are the live funding path",
          ],
          [
            "compute_breakeven_move_pct",
            "0 — not one reference in the tree",
            "⚫ DEAD — not on this page; use F-FEE-10",
          ],
        ]}
      />
    </div>
  );
}

/** §13 intro — the one complete form, stated before any column is shown. */
function PnlIntro() {
  return (
    <div className="space-y-3">
      <p>
        What a trade actually made. Gross is what the price move earned; net is
        what reached the account.
      </p>
      <p>
        <span aria-hidden="true">🚨 </span>
        <strong>
          The only complete form is{" "}
          <span className="font-mono">
            realised_net = pnl_usd + partial_pnl_realized
          </span>
          .
        </strong>{" "}
        Money banked through the partial ladder lives in its own column, so a
        bare <span className="font-mono">SUM(pnl_usd)</span> undercounts. Over
        the 274 laddered rows inside the true-fee cohort the omission is{" "}
        <strong>178% of the reported figure</strong> &mdash; larger than what
        the reported figure contains. It is measured in{" "}
        <span className="font-mono">F-FEE-09</span>.
      </p>
    </div>
  );
}

/**
 * §14 intro — F-FEE-10's derivation, rendered as numbered steps with units at
 * each one rather than as a single equation (master §8.3). It is the page's
 * best pedagogical moment and the reason the section stands alone.
 */
function BreakevenIntro() {
  return (
    <div className="space-y-3">
      <p>
        How far price has to move before a trade earns anything at all.
      </p>

      <div>
        <h4 className="text-micro text-fg-dim">
          F-FEE-10 — the derivation, in steps, with units at every step
        </h4>
        <ol className="mt-2 space-y-2 text-caption-ui">
          <li>
            <span className="text-fg-dim">1. </span>
            Gross P&amp;L on a price move:{" "}
            <MathTex
              display={false}
              tex={String.raw`\text{gross} = q\cdot\Delta P = (\text{notional\_usd}\cdot L)\cdot(\Delta P / P_{\text{entry}})`}
            />{" "}
            &mdash; <strong>USD</strong>.
          </li>
          <li>
            <span className="text-fg-dim">2. </span>
            Round-trip fee:{" "}
            <MathTex
              display={false}
              tex={String.raw`\text{fee} = (\text{notional\_usd}\cdot L)\cdot f_{\text{RT}}`}
            />{" "}
            &mdash; <strong>USD</strong>, where{" "}
            <MathTex display={false} tex={String.raw`f_{\text{RT}}`} /> is a{" "}
            <strong>fraction</strong>.
          </li>
          <li>
            <span className="text-fg-dim">3. </span>
            Break-even is{" "}
            <MathTex display={false} tex={String.raw`\text{gross} = \text{fee}`} />
            . <strong>The exposure term</strong>{" "}
            <MathTex
              display={false}
              tex={String.raw`(\text{notional\_usd}\cdot L)`}
            />{" "}
            <strong>appears on both sides and cancels.</strong>
          </li>
          <li>
            <span className="text-fg-dim">4. </span>
            Therefore{" "}
            <MathTex
              display={false}
              tex={String.raw`\Delta P / P_{\text{entry}} = f_{\text{RT}}`}
            />
            . The required price move equals the round-trip fee fraction, and it
            is <strong>independent of both position size and leverage</strong>.
          </li>
          <li>
            <span className="text-fg-dim">5. </span>
            In bps:{" "}
            <MathTex
              display={false}
              tex={String.raw`\text{required\_move\_bps} = f_{\text{RT}} \times 10^{4}`}
            />
            .
          </li>
        </ol>
      </div>

      <RefTable
        caption="The three cases"
        head={["Fill mix", "f_RT (fraction)", "bps", "percent"]}
        rows={[
          ["taker in, taker out", "0.00090", "9.0", "0.090%"],
          ["maker in (ALO), taker out", "0.00060", "6.0", "0.060%"],
          [
            "TREVOR measured blend — historical cohort, n = 557",
            "0.00082094",
            "8.2094",
            "0.082094%",
          ],
        ]}
      />

      <p className="text-fg-muted">
        <span aria-hidden="true">🚨 </span>
        The 8.2094 bps figure is a <strong>historical cohort</strong> &mdash; n
        = 557, 2026-07-01 &rarr; 07-18, all{" "}
        <span className="font-mono">paper_window = 0</span>. There is{" "}
        <strong>no live break-even bar</strong>:{" "}
        <span className="font-mono">fees_true_rows_post_cutover</span> measured{" "}
        <strong>0</strong>, so it must never render as a current figure.
      </p>
    </div>
  );
}
