import * as React from "react";
import {
  FormulaEntry,
  MATH_SECTIONS,
  MathSection,
  StatusBadge,
  statusMeaning,
  type FormulaEntryProps,
  type FormulaStatus,
} from "@/components/math";

/**
 * Sections 15–17 — funding & slippage · equity & return · paper mode.
 * Formula IDs F-FEE-13…21 (F-FEE-16 excluded).  [D6, 2026-08-05 · scaffold: B1]
 *
 * TRANSCRIBED, NOT AUTHORED. Every formula, symbol gloss, explanation and
 * number below comes from the RM-MATH master spec
 * (`docs/reports/recon/2026-08-04_math-page/MASTER_2026-08-04_math-page.md`, VM)
 * or from the constant mirror `src/lib/math-constants.ts` (stamped `bcbce58`).
 * 🚨 Where the two disagree the MIRROR wins and the disagreement is reported.
 * Nothing here was inferred, rounded, or filled in from memory.
 *
 * 🚨 F-FEE-16 (`fees.estimate_funding_cost`) IS DELIBERATELY ABSENT. It is
 * ⚫ DEAD BY MISSING SYMBOL — no caller anywhere in the tree, and its live-rate
 * branch calls `funding_signals.get_current_funding_rate_per_hour`, which does
 * not exist, so every invocation would fall into `except Exception` and return
 * the hardcoded `0.0000125` fallback for every ticker, forever. The master's
 * exclusion list says keep it off the page. The gap between 15 and 17 is NOT a
 * transcription miss. Its formula is rendered NOWHERE; it is named only in
 * F-FEE-14's caveat, where the master itself names it, so that nobody
 * "fixes" the missing import without first noticing there is no caller.
 *
 * 🚨 THE OVERLAY. Entries whose arithmetic runs on today's live path carry
 * `overlay="paper"`: the maths executes, the fill is simulated. TWO
 * deliberately do NOT — F-FEE-18 and F-FEE-19 read the REAL Hyperliquid
 * account, which paper trades do not move. A 🟡 PAPER badge on those would say
 * the opposite of what is true, so each states in its own status note WHY the
 * badge is absent rather than leaving a reader to guess. §17 says so too.
 *
 * 🚨 THE BACKSLASH IS LOAD-BEARING. Every TeX string is a `String.raw`
 * template so `\text{funding\_paid\_usd}` reaches KaTeX with its escape
 * intact. Without it KaTeX renders a subscript instead of the column name.
 * Do not "clean up" the raw literals.
 *
 * 🚨 ZERO FETCH, BY CONTRACT. This file calls no API and reads no DB — the
 * `/math` contract is that the page renders with no data by construction. The
 * live figures below were read ONCE at authoring time from
 * `/api/math/values` (generatedAt 2026-08-06T01:11:56Z, replica lag 295 s) and
 * are transcribed WITH that provenance. §17's sleeve claim is the endpoint's
 * own three `sleeveStatus.proofs`, not an invented assertion — see
 * SLEEVE_PROOFS. Making the page's most important section depend on a live
 * fetch would make it the most fragile thing on the page.
 */

/** Titles come from the pinned registry — never hardcoded here. */
function sectionTitle(n: number): string {
  return MATH_SECTIONS.find((s) => s.number === n)?.title ?? `Section ${n}`;
}

/** Provenance suffixes, written once so they cannot drift between entries. */
const LIVE_READ =
  "auto_config, read live via /api/math/values 2026-08-06 01:11:56Z (replica lag 295 s)";
const MIRROR = "constant mirror src/lib/math-constants.ts, stamped bcbce58";
const RECON =
  "measured by the RM-MATH recon 2026-08-04; NOT served by /api/math/values, so it is quoted with its date rather than as a live read";

/**
 * A reference table for the section intros. The master carries two tables that
 * belong to my entries, and `FormulaEntry` has no table affordance by design —
 * forking it would break the contract six sibling prompts share. `intro` takes
 * a ReactNode, so the tables live there. Scrolls in its own box so a wide
 * table never scrolls the page sideways.
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
        <table className="w-full min-w-[30rem] border-collapse text-caption">
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
// §15 — Funding & slippage.  F-FEE-13 · F-FEE-14 · F-FEE-15
// ─────────────────────────────────────────────────────────────────────────────

const FUNDING_SLIPPAGE_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-FEE-13",
    name: "Slippage",
    status: "split",
    statusNote:
      "🟢 LIVE as a MEASUREMENT — slippage_audit holds 2,745 rows and the divergence is computed from real fills. 🟡 MODELLED in paper — with no counterparty, executor.simulate_entry_fill applies a per-ticker constant instead. Both halves are real; they are different things.",
    source:
      "auto_trader.executor._walk_book (measurement) · auto_trader.executor.simulate_entry_fill / simulate_exit_fill (paper) · slippage_audit table (live audit)",
    tex: [
      String.raw`\text{slippage\_bps}^{\text{buy}} = \frac{P_{\text{avg fill}} - P_{\text{best ask}}}{P_{\text{best ask}}}\times 10^{4}
\qquad
\text{slippage\_bps}^{\text{sell}} = \frac{P_{\text{best bid}} - P_{\text{avg fill}}}{P_{\text{best bid}}}\times 10^{4}`,
      String.raw`\text{slippage\_bps} = \frac{|P_{\text{actual}} - P_{\text{planned}}|}{P_{\text{planned}}}\times 10^{4},
\qquad
\text{impact\_usd} = |P_{\text{planned}} - P_{\text{actual}}| \times \text{fill\_size}`,
    ],
    symbols: [
      {
        sym: String.raw`P_{\text{best}}`,
        means: "Top-of-book price on the side being taken.",
      },
      {
        sym: String.raw`P_{\text{avg fill}}`,
        means:
          "Size-weighted average price actually achieved walking the book.",
      },
      {
        sym: String.raw`P_{\text{planned}}`,
        means: "The mid (entry) or the intended exit price.",
      },
      {
        sym: String.raw`\text{impact\_usd}`,
        means: "The dollar cost of the divergence, on that fill only.",
      },
    ],
    why:
      "Slippage never appears as a term in the P&L identity, because it is already inside entry_price and exit_price. A worse fill produces a worse P_entry, which produces a smaller gross_pnl_usd in F-FEE-05. There is no slippage_usd column on auto_trades and there should not be one — adding it would double-count. slippage_audit is a parallel observability record, not part of the accounting.",
    values: [
      {
        label: "slippage_audit rows",
        value: "2,745",
        note: `all time · trade_id is nullable and is NULL on entry orphans — ${RECON}`,
      },
      {
        label: "realised entry-slippage divergence",
        value: "mean +11.738 bps",
        note: `window: all time · n = 1,551 deduped closed trades · entry_price vs signal_entry_price, direction-signed — ${RECON}`,
      },
      {
        label: "FALLBACK_SLIPPAGE_BPS (paper fills)",
        value:
          "BTC 4.7 · ETH 6.0 · SOL 7.4 · HYPE 8.2 · FARTCOIN 12.6 · NEAR 14.0 · SUI 7.7 · DOGE 5.9 · XRP 5.2 · KPEPE 6.3",
        note: `paper-fill and cost-reporting ONLY — the live path (live_executor) does not consume these — ${MIRROR}`,
      },
      {
        label: "DEFAULT_SLIPPAGE_BPS (unknown ticker)",
        value: "9.0",
        note: `applied to tickers absent from the table above; paper-fill only — ${MIRROR}`,
      },
      {
        label: "per-fill slippage",
        value: "no live value available",
        note:
          "emitted to the bot log only — never written to a table, so the replica cannot supply it. The formula and its audit columns are shown; the per-fill stream is not retrievable from this box.",
      },
    ],
    caveat:
      "DO NOT PRESENT SLIPPAGE AS A LOSS DRIVER. RECON-QUANT-006's campaign OVERTURNED that claim — slippage measured as a net BENEFIT to TREVOR. The +11.738 bps above is the raw signal-price-to-fill-price divergence and it INCLUDES ordinary market drift between the signal and the fill: it is divergence, not attributed cost. And because slippage is booked into the FILL PRICE, a reader hunting for a slippage cost column will not find one — that absence is correct, not a gap in the accounting.",
  },
  {
    id: "F-FEE-14",
    name: "Funding: Realised Accrual",
    status: "live",
    overlay: "paper",
    statusNote:
      "FUNDING_CONSUMER_ENABLED is live true, and the rate is the live Hyperliquid asset context (hyperliquid_data.funding_rate), not an estimate. The rate is real; the position it accrues against is simulated.",
    source:
      "auto_trader.funding_consumer.fetch_funding_rates → auto_trader.funding_consumer.apply_funding_to_trade",
    tex: [
      String.raw`\Delta\text{funding}_{\text{usd}} = \text{position\_notional} \times r_{\text{funding}} \times \Delta t_{\text{intervals}} \times
\begin{cases}
+1 & \text{LONG}\\
-1 & \text{SHORT}
\end{cases}`,
      String.raw`\text{funding\_paid\_usd} \mathrel{+}= \Delta\text{funding}_{\text{usd}}
\qquad\text{(idempotent per cycle via \texttt{funding\_last\_applied\_at})}`,
    ],
    symbols: [
      {
        sym: String.raw`r_{\text{funding}}`,
        means:
          "Hyperliquid's funding rate, a DECIMAL FRACTION PER HOUR (e.g. 0.0005 = 0.05%/hour). 🚨 Not a percent.",
      },
      {
        sym: String.raw`\Delta t_{\text{intervals}}`,
        means: "Hours elapsed since the last application.",
      },
      {
        sym: String.raw`\text{funding\_paid\_usd}`,
        means:
          "Cumulative. POSITIVE = a cost. Negative = a credit. A LONG pays when the sign is +1 and is paid when it is −1; a SHORT is the mirror.",
      },
    ],
    why:
      "A perpetual future has no expiry, so nothing forces its price back to spot. Funding is the mechanism that does it: when the perp trades above spot, longs pay shorts; when below, shorts pay longs. Holding a position therefore has a carrying cost (or credit) that accrues with time and is completely independent of whether the price moved. It enters net P&L as its own term (F-FEE-06).",
    values: [
      {
        label: "FUNDING_CONSUMER_ENABLED",
        value: "true",
        note: RECON,
      },
      {
        label: "closed trades with a non-zero funding accrual",
        value: "130",
        note: `window: all closed trades at the recon · n = 1,793 · funding_paid_usd is non-NULL on all 1,793 (it defaults to 0), so 130 is the count that ever actually accrued — consistent with short holds against a small hourly rate — ${RECON}`,
      },
      {
        label: "funding_last_applied_at non-NULL",
        value: "132",
        note: `window: all closed trades at the recon · n = 1,793 — ${RECON}`,
      },
      {
        label: "live funding rate, per tick",
        value: "no live value available",
        note:
          "NOT persisted per-tick — fetched from the hyperliquid_data asset context each cycle. No historical rate series is retrievable from trevor.db, so no funding-rate chart can be built from this box.",
      },
    ],
    caveat:
      "TWO PRODUCERS, TWO UNITS, AND ONE CONSUMER HAS ALREADY DIED OF IT. This path reads the fraction correctly. But a second producer, market_data.get_perp_data, MULTIPLIES BY 100 and supplies a PERCENT to a different consumer — and that exact mismatch (a producer supplying a fraction against thresholds assuming a percent) is what killed the microstructure funding leg, F-IND-16. A unit mismatch in funding is silent and compounding: nothing raises, the number is merely 100× wrong. Never present “the funding rate” without saying WHICH unit. Separately, fees.estimate_funding_cost looks like a third funding path and is not one — it is ⚫ DEAD (no caller, and its live-rate call target does not exist), which is why it is absent from this page.",
  },
  {
    id: "F-FEE-15",
    name: "Funding: Pre-Trade Estimate and the TP Floor",
    status: "live",
    overlay: "paper",
    statusNote:
      "get_effective_min_profit_floor is THE SINGLE TP-FLOOR AUTHORITY — one floor, three consumers, all agreeing at 0.0018. FUNDING_COST_AWARE_ENABLED is live true.",
    source:
      "auto_trader.exit_helpers.get_expected_funding_cost → auto_trader.exit_helpers.compute_directional_funding_cost; consumed by auto_trader.exit_helpers.get_effective_min_profit_floor; written to auto_trades.expected_funding_cost_at_entry",
    tex: [
      String.raw`\text{expected\_funding\_cost} = r_{\text{funding}} \times N_{\text{intervals}} \times
\begin{cases}
+1 & \text{LONG}\\ -1 & \text{SHORT}\end{cases}
\qquad\text{(signed RAW fraction of notional)}`,
      String.raw`\text{effective\_floor} = \max\!\big(\text{MIN\_PROFIT\_TARGET\_FLOOR\_PCT},\ \text{MIN\_PROFIT\_TARGET\_FLOOR\_PCT} + \text{expected\_funding\_cost}\big)`,
      String.raw`\text{MIN\_PROFIT\_TARGET\_FLOOR\_PCT} = \underbrace{(r_{\text{taker}} + r_{\text{maker}})}_{6\ \text{bps}=0.0006} \times \underbrace{3.0}_{\text{MULT}} = 0.0018 = 18\ \text{bps}`,
    ],
    symbols: [
      {
        sym: String.raw`N_{\text{intervals}}`,
        means: "FUNDING_HOLD_INTERVALS_EST — live 1 (one hour).",
      },
      {
        sym: String.raw`\text{MIN\_PROFIT\_TARGET\_FLOOR\_PCT}`,
        means: "The minimum take-profit distance, as a fraction.",
      },
      {
        sym: String.raw`\text{expected\_funding\_cost}`,
        means:
          "The SIGNED raw fraction: +1 for a LONG, −1 for a SHORT. A long expecting to pay carries a positive term that raises the floor; a short in the same market carries the negative one.",
      },
    ],
    why:
      "If you expect to pay funding while holding, your take-profit has to clear the fee and the carry, or the trade is negative-expectancy before it starts. The funding term can only RAISE the floor, never lower it — a funding CREDIT does not license a tighter target, because the credit is not guaranteed to persist for the hold. That asymmetry is what the max() in the second line enforces.",
    values: [
      {
        label: "FUNDING_HOLD_INTERVALS_EST",
        value: "1",
        note: RECON,
      },
      {
        label: "FUNDING_COST_AWARE_ENABLED",
        value: "true",
        note: RECON,
      },
      {
        label: "MIN_PROFIT_TARGET_FLOOR_MULT",
        value: "3.0",
        note: MIRROR,
      },
      {
        label: "HL_FEE_ENTRY_TAKER_EXIT_MAKER",
        value: "0.0006",
        note: `6 bps — taker in, maker (ALO) out — ${MIRROR}`,
      },
      {
        label: "MIN_PROFIT_TARGET_FLOOR_PCT",
        value: "0.0018",
        note: `18 bps, derived as the two above multiplied — ${MIRROR}`,
      },
      {
        label: "trades carrying a pre-trade estimate",
        value: "1,440",
        note: `window: all closed trades at the recon · n = 1,793 · auto_trades.expected_funding_cost_at_entry — ${RECON}`,
      },
    ],
    caveat:
      "This floor is the π consumed by F-EXIT-08's Γ_floor and F-EXIT-09's r_floor — ONE authority, three consumers. Change it in one place and all three move; “fix” it in one consumer and they silently disagree. It also inherits F-FEE-14's unit hazard: expected_funding_cost is a RAW FRACTION of notional, so a percent arriving here would inflate the floor 100× and mute every take-profit on the book.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §16 — Equity & return.  F-FEE-17 … F-FEE-21
// ─────────────────────────────────────────────────────────────────────────────

const EQUITY_RETURN_ENTRIES: FormulaEntryProps[] = [
  {
    id: "F-FEE-17",
    name: "Virtual Equity",
    status: "live",
    overlay: "paper",
    statusNote:
      "THE FALLBACK PATH, NOT THE AUTHORITY. On today's configuration this is reached only if the exchange read FAILS or EQUITY_SOURCE_REAL_HL is flipped off. F-FEE-18 is the number that governs.",
    source: "auto_trader.models.get_equity (alias get_equity_display)",
    tex: String.raw`E_{\text{virtual}} = \text{CAPITAL\_USD} + \sum_{\text{closed}}\big(\text{pnl\_usd} + \text{COALESCE}(\text{partial\_pnl\_realized},\,0)\big)`,
    symbols: [
      {
        sym: String.raw`\text{CAPITAL\_USD}`,
        means: "The configured starting capital — live 191.75.",
      },
      {
        sym: String.raw`\sum_{\text{closed}}`,
        means:
          "Over every closed trade, PARTIALS-INCLUSIVE. The bare form (pnl_usd alone) under-counted by $60.10 and sign-flipped the result; fixed at RF3T2-B0.",
      },
    ],
    why:
      "It is a bookkeeping reconstruction: what you started with plus everything you have realised. It needs no network call, which is why it is the fallback when the exchange read fails. Its weakness is that it drifts from the real account whenever capital moves in or out.",
    values: [
      {
        label: "CAPITAL_USD",
        value: "191.75",
        note: RECON,
      },
      {
        label: "partials-inclusive correction",
        value: "$60.10",
        note:
          "how far the bare pnl_usd form under-counted before RF3T2-B0 — enough to flip the sign of the result",
      },
    ],
    caveat:
      "DO NOT READ CAPITAL_USD AS CAPITAL. Its sole non-archive consumer is this function, and get_effective_equity() returns the REAL Hyperliquid value while EQUITY_SOURCE_REAL_HL is true — which it is. Gate 5 and Gate 6.8 call get_effective_equity(), not this. So 191.75 is “the number the system falls back to when it cannot see the exchange”, never the account's capital, and never a live sizing input. The legacy paper executor (executor.py) does still call get_equity() directly.",
  },
  {
    id: "F-FEE-18",
    name: "Effective Equity",
    status: "live",
    statusNote:
      "🚨 THIS IS THE AUTHORITY — the figure Gate 5 and Gate 6.8 actually read. EQUITY_SOURCE_REAL_HL is live true, so the live branch is taken. NO 🟡 PAPER BADGE, DELIBERATELY: this reads the REAL Hyperliquid account, and paper trades do not move it. A paper badge here would say the opposite of what is true.",
    source:
      "auto_trader.models.get_effective_equity → auto_trader.live_executor.get_account_state_live",
    tex: String.raw`E_{\text{effective}} =
\begin{cases}
\text{HL unified account value} & \text{if the exchange read succeeds}\\
E_{\text{virtual}} & \text{on ANY failure (fails DOWN, logs WARNING, never raises)}
\end{cases}`,
    symbols: [
      {
        sym: String.raw`\text{HL unified account value}`,
        means:
          "The perps marginSummary.accountValue, verified to already include spot USDC on this account (EQF-02).",
      },
      {
        sym: String.raw`E_{\text{virtual}}`,
        means: "F-FEE-17's reconstruction — the fallback, not the measurement.",
      },
    ],
    why:
      "The exchange's own account value is the only number that reflects reality including funding, fees, unrealised P&L on open positions, and any deposits. The virtual figure is a reconstruction; this is the measurement. The fallback direction is deliberately conservative — a network blip must not halt the trading loop, and it must not inflate the book.",
    values: [
      {
        label: "live account value",
        value: "$82.0542",
        note: `LIVE_ACCOUNT_VALUE_USD, ${LIVE_READ}, row updated 2026-08-06 01:02:42 UTC`,
      },
      {
        label: "newest equity snapshot",
        value: "2026-08-06 00:32:43 UTC · 2,353 s old",
        note:
          "window: newest equity_snapshots.ts · n = 1,515 snapshots. 🚨 This is NOT the replica lag — equity_snapshots advances on an HOURLY cadence, so this age is routinely far larger than the replica's and means something different. ts is real UTC.",
      },
      {
        label: "EQUITY_SOURCE_REAL_HL",
        value: "true",
        note: RECON,
      },
      {
        label: "free margin",
        value: "no live value available",
        note:
          "an exchange-side account figure read live from Hyperliquid at decision time; no column stores it, so it cannot be shown here.",
      },
    ],
    caveat:
      "THE RECONSTRUCTION AND THE MEASUREMENT DO NOT AGREE, and the divergence is documented at the source: get_equity() yields ~$56.35 against a live ~$82.05 — a ~$25.70 gap that is a CAPITAL_USD-vs-live reconciliation NOBODY HAS RESOLVED. It is recorded here rather than reconciled, because picking a winner silently is how an equity page starts lying. If the exchange read ever fails, the book does not merely lose precision — it drops to a number that is currently about $25.70 lower.",
  },
  {
    id: "F-FEE-19",
    name: "Percentage Return",
    status: "live",
    statusNote:
      "NO 🟡 PAPER BADGE, DELIBERATELY: this is computed over equity_snapshots, which track the REAL Hyperliquid account. The percentages are real arithmetic on real equity — what is simulated is the trading that did or did not move it.",
    source:
      "scripts/digest/collect_money_safety._pct · scripts/digest/collect_money_safety._collect_equity",
    tex: String.raw`\Delta_{\text{usd}}^{(w)} = E_{\text{now}} - E_{\text{anchor}}^{(w)}
\qquad
\Delta_{\text{pct}}^{(w)} = 100 \times \frac{\Delta_{\text{usd}}^{(w)}}{E_{\text{anchor}}^{(w)}}`,
    symbols: [
      {
        sym: String.raw`w`,
        means: "The window — 24h, 7d, or since-cutover.",
      },
      {
        sym: String.raw`E_{\text{anchor}}^{(w)}`,
        means:
          "The equity snapshot taken AT OR AFTER the start of window w. 🚨 The denominator is that window's OWN anchor equity — never a fixed epoch base shared across windows.",
      },
    ],
    why:
      "A percentage return only means anything relative to the capital actually at risk over that window. Dividing every window's dollar move by ONE FIXED BASE makes the short windows look tiny and the long ones enormous, purely as an artefact of the denominator. Verified in the code: \"delta_pct\": _pct(delta, anchor_eq) — anchor_eq is re-resolved per window inside the loop. This is the trap the rule exists to close, and the Hub has shipped the wrong version of it before.",
    values: [
      {
        label: "AUTO_CUTOVER_EPOCH",
        value: "2026-07-22 20:44:56",
        note: `naive EASTERN, not UTC — ${LIVE_READ}`,
      },
      {
        label: "measured hole in equity_snapshots",
        value: "~102 hours",
        note: `why anchors are taken at-or-AFTER the window start: at-or-before lands days stale — ${RECON}`,
      },
      {
        label: "the worked deposit-contamination case",
        value: "+$51.00 read vs +$1.18 traded",
        note: `window: since-cutover, anchor only 0.36 h past the epoch so the staleness guard did NOT fire · the $49.82 remainder was a ~$50 capital deposit — ${RECON}`,
      },
      {
        label: "ANCHOR_STALE_GAP_H · EXTERNAL_FLOW_TOLERANCE_USD",
        value: "no live value available",
        note:
          "both are constants in scripts/digest/collect_money_safety and are not carried in the constant mirror at bcbce58, so their literals cannot be quoted from this box. The guards they parameterise are described above; their thresholds are not.",
      },
    ],
    caveat:
      "TWO GUARDS, BOTH REQUIRED, AND THE PAGE MUST RENDER “UNKNOWN” WHENEVER trustworthy IS FALSE — never the number. (1) STALE ANCHOR: an anchor further than ANCHOR_STALE_GAP_H from the window start yields a hard UNKNOWN with delta_usd = None. (2) DEPOSIT CONTAMINATION: guard 1 alone is INSUFFICIENT — the since-cutover anchor sat only 0.36 h past the epoch, so guard 1 did not fire, yet the delta read +$51.00 against +$1.18 of actual trading. Every delta is therefore reconciled against the SAME window's trading P&L and a residual above EXTERNAL_FLOW_TOLERANCE_USD marks it trustworthy: false. AVAILABILITY IS NOT PROFIT — a page printing “+$51.00” beside “+$1.18” is confidently wrong. And a clock trap on top: equity_snapshots.ts is real UTC while AUTO_CUTOVER_EPOCH's value is naive ET, so read literally the gap looks like 4.36 h when it is 0.36 h. The collector renames the field anchor_ts_utc for exactly this reason — a field named anchor_ts cannot tell you its clock.",
  },
  {
    id: "F-FEE-20",
    name: "Partial-Exit Accounting",
    status: "live",
    overlay: "paper",
    statusNote:
      "PARTIAL_LADDER_S1_ENABLED and LIVE_PARTIALS_ENABLED are both live true. The ladder fires; the fills are simulated.",
    source: "auto_trader.executor.execute_partial_exit",
    tex: [
      String.raw`\text{close\_amount} = \text{notional\_usd}\times\varphi
\qquad
\text{remaining} = \text{notional\_usd}\times(1-\varphi)`,
      String.raw`\text{gross}_{\text{slice}} = \text{close\_amount}\times\frac{\text{pnl\_pct}}{100}
\qquad\text{(pnl\_pct as in F-FEE-05, leverage baked in)}`,
      String.raw`\text{exit\_fee}_{\text{slice}} = \underbrace{(\text{close\_amount}\times L)}_{\text{slice exposure}}\times\frac{r_{\text{exit}}}{10^{4}}
\qquad
\text{net}_{\text{slice}} = \text{gross}_{\text{slice}} - \text{exit\_fee}_{\text{slice}}`,
      String.raw`\text{notional\_usd} \leftarrow \text{remaining},\quad
\text{partial\_exits\_taken} \mathrel{+}= 1,\quad
\text{partial\_pnl\_realized} \mathrel{+}= \text{net}_{\text{slice}}`,
    ],
    symbols: [
      {
        sym: String.raw`\varphi`,
        means:
          "The rung's fraction, 0 < φ < 1, OF THE NOTIONAL REMAINING AT THAT MOMENT — not of the original.",
      },
      {
        sym: String.raw`r_{\text{exit}}`,
        means:
          "The exit-leg rate ONLY (F-FEE-04), maker or taker per the measured fill path.",
      },
      {
        sym: String.raw`\text{net}_{\text{slice}}`,
        means: "What this rung banked, net of its own exit fee.",
      },
    ],
    why:
      "Only ONE leg's fee is charged because the entry fee for the whole position was already paid at open, on the original notional. A partial is only an exit, so it owes only the exit leg. The final close then charges its own round trip against whatever notional remains. The convention is slightly asymmetric — the final close re-charges an entry-leg fee on the remainder that was arguably already paid — but it keeps each partial self-contained and it is what the ledger records.",
    values: [
      {
        label: "PARTIAL_LADDER_S1_ENABLED",
        value: "true",
        note: `${LIVE_READ}, row updated 2026-05-29 19:35:01 UTC`,
      },
      {
        label: "LIVE_PARTIALS_ENABLED",
        value: "true",
        note: `${LIVE_READ}, row updated 2026-06-04 03:03:40 UTC`,
      },
      {
        label: "S1_PARTIAL_SCHEDULE",
        value: "[[0.25, 0.4], [0.5, 0.5833]]",
        note: `fractions are OF REMAINING: rung 1 banks 40% of original, rung 2 banks 35% of original (0.35/0.60 = 0.5833 of the 60% left), runner = 25% of original — ${MIRROR}`,
      },
      {
        label: "PARTIAL_EXIT_SCHEDULE",
        value: "[[0.75, 0.33], [1.5, 0.5]]",
        note: MIRROR,
      },
      {
        label: "PARTIAL_EXIT_MIN_USD",
        value: "3.0",
        note: MIRROR,
      },
      {
        label: "PARTIAL_MIN_ORDER_USD",
        value: "10.50",
        note: `${LIVE_READ}, row updated 2026-06-05 12:46:40 UTC`,
      },
      {
        label: "PARTIAL_DUST_GUARD_USD",
        value: "1.50",
        note: `${LIVE_READ}, row updated 2026-05-24 18:14:33 UTC`,
      },
    ],
    caveat:
      "THE TRUE COST IS FLAT WITH LADDER DEPTH — the partial ladder does NOT cost more in real fees. Measured in bps of ENTRY notional: 8.322 at 0 partials (n=283), 8.176 at 1 (n=237), 7.591 at 2 (n=37) — arguably slightly FALLING. THE CIRCULATED “PARTIALS COST 50–212% MORE” RESULT WAS A BOOKKEEPING ARTEFACT of the decrementing denominator, not an execution cost, and A4 reproduced the flat result independently. What genuinely moves is the MODELLED figure: because notional_usd is decremented by every partial, the final close's modelled fee is billed against a SHRUNKEN base, so the model under-books by 16.2% (7.0644 modelled vs 8.2094 true bps, same 557 trades, same original_notional_usd denominator). One more paper caveat on top: paper IOC always fully fills, so PAPER PARTIAL-EXIT FILL RATES ARE AN UPPER BOUND.",
  },
  {
    id: "F-FEE-21",
    name: "Partial-Exit Fee Guard v2",
    status: "dormant",
    statusNote:
      "PARTIAL_FEE_GUARD_V2_ENABLED reads live TRUE — and the function has NO NON-TEST CALLER. grep finds only its own def and a comment in config.py. Flag-on, structurally unwired.",
    source: "auto_trader.fees.partial_exit_fee_guard_v2",
    tex: String.raw`\text{allow} \iff \text{expected\_partial\_profit\_usd} \;\ge\; \text{partial\_notional\_usd}\times r_{\text{taker}}`,
    symbols: [
      {
        sym: String.raw`\text{expected\_partial\_profit\_usd}`,
        means: "What the slice is expected to bank before its fee.",
      },
      {
        sym: String.raw`r_{\text{taker}}`,
        means:
          "The taker rate, 0.00045 — one leg only, because for a partial the entry fee is already sunk.",
      },
    ],
    why:
      "It WOULD work because for a partial the entry fee is sunk — only the exit leg's fee stands between the slice and profitability. The conservative v1 guard bakes in a full round trip at 1.5×, which blocks partials that would in fact have been profitable. Note the conditional voice throughout: this describes a capability, not a behaviour.",
    values: [
      {
        label: "PARTIAL_FEE_GUARD_V2_ENABLED",
        value: "true",
        note: `${LIVE_READ}, row updated 2026-05-24 14:58:21 UTC — a flag that says ON, wired to nothing`,
      },
      {
        label: "non-test callers",
        value: "0",
        note:
          "grep over the bot tree finds the def itself and one comment in config.py; nothing invokes it",
      },
      {
        label: "what the LIVE layer-6 fee guard reads instead",
        value: "config.FEE_RATE_BPS = 9",
        note: `a DIFFERENT constant family (gating, not booking) — ${MIRROR}`,
      },
    ],
    caveat:
      "THIS IS THE PAGE'S MOST VALUABLE SHAPE: A SWITCH THAT SAYS ON, WIRED TO NOTHING. The flag is live true, so every dashboard, config dump and reader will report this guard as enabled — and it has never once run. FLIPPING THE FLAG WOULD CHANGE NOTHING, because nothing calls the function; the live layer-6 fee guard reads config.FEE_RATE_BPS, a different constant family entirely. The page must NOT present this as a live gate. If you want this behaviour, the work is wiring a caller, not touching the flag.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §17 — Paper mode. The lens for the other sixteen sections.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🚨 THESE ARE THE ENDPOINT'S OWN `status.sleeveStatus.proofs`, transcribed
 * verbatim from the live read — NOT a hardcoded assertion of inertness.
 *
 * The distinction is the whole point. The obvious claim would be "the sleeve
 * layer is inert because MAX(level) = 0", and this box CANNOT KNOW THAT:
 * `rebuild_tracker.db` is not litestream-replicated, so the API pins
 * `level: null` / `levelSource: "unavailable"` and lists `global_level` in its
 * `unavailable` register rather than baking a 0 that would become a lie the
 * moment Ghost mints level 1. Inertness is proven from three live replica
 * reads instead, so the claim self-corrects if any of them changes.
 */
const SLEEVE_PROOFS: { name: string; value: string }[] = [
  { name: "SLEEVE_TAGGING_ENABLED (auto_config)", value: "false" },
  { name: "auto_trades rows with a non-NULL sleeve", value: "0 of 1795" },
  {
    name: "PER_SLEEVE_EXIT_PROFILES / PER_SLEEVE_STOP_ENABLED",
    value: "true / true — on, and deciding nothing while nothing is tagged",
  },
];

/** The seven-badge vocabulary, glossed from StatusBadge so it cannot drift. */
const BADGE_ORDER: FormulaStatus[] = [
  "live",
  "paper",
  "dormant",
  "shadow",
  "dead",
  "inert",
  "split",
];

function PaperModeBody() {
  return (
    <div className="space-y-6">
      {/* ── 1. The gate itself ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-border-amber bg-accent-amber/5 p-4">
        <h3 className="text-h3 text-fg-primary">
          <span aria-hidden="true">🚨 </span>
          No real order has left the box
        </h3>
        <p className="mt-2 text-caption-ui text-fg-primary">
          <span className="font-mono">PAPER_WINDOW_ENABLED = true</span> at the
          Hyperliquid SDK boundary. Every formula on this page executes. Nothing
          on the exchange has been asked to do anything.
        </p>
        <ul className="mt-3 space-y-1.5 text-caption text-fg-primary">
          <li>
            <strong>Prices are real.</strong> Entry and exit prices come from
            the live market.
          </li>
          <li>
            <strong>Fills are simulated.</strong> No order was placed, so no
            counterparty existed.
          </li>
          <li>
            <strong>Modelled fees are booked in full</strong> — computed by the
            identical <span className="font-mono">calculate_pnl</span> path as a
            live trade.
          </li>
          <li>
            <strong>
              True exchange fees are structurally impossible to capture.
            </strong>{" "}
            <span className="font-mono">FEES_TRUE_CAPTURE_ENABLED</span> is
            live <span className="font-mono">true</span> — the flag is not the
            cause. The fills simply do not exist.
          </li>
        </ul>
        <p className="mt-3 text-caption text-fg-muted">
          Read live from <span className="font-mono">/api/math/values</span>:{" "}
          <span className="font-mono">status.paperGated = true</span>;{" "}
          <span className="font-mono">PAPER_WINDOW_ENABLED</span> row last
          updated <span className="font-mono">2026-07-23 00:43:47 UTC</span>.
        </p>
      </section>

      {/* ── 2. The badge system ─────────────────────────────────────────── */}
      <section>
        <h3 className="text-h3 text-fg-primary">
          The 🟡 PAPER badge is an OVERLAY, not an alternative
        </h3>
        <p className="mt-2 text-caption-ui text-fg-primary">
          This is where you learn to read the other sixteen sections. Every 🟢
          LIVE entry in the sizing and fee families{" "}
          <strong>also runs behind the paper gate</strong> — the arithmetic
          executes, the fill is simulated. That is why those entries carry{" "}
          <strong>two badges</strong>.
        </p>
        <p className="mt-2 text-caption-ui text-fg-primary">
          <span aria-hidden="true">🚨 </span>
          <strong>
            🟢 LIVE must never be read as &ldquo;real money moved&rdquo;.
          </strong>{" "}
          It means &ldquo;this code runs on every signal or position today&rdquo;
          — nothing more.
        </p>

        <dl className="mt-4 space-y-2">
          {BADGE_ORDER.map((s) => (
            <div key={s} className="flex flex-wrap items-baseline gap-x-3">
              <dt className="shrink-0">
                <StatusBadge status={s} />
              </dt>
              <dd className="text-caption text-fg-muted">
                {statusMeaning(s)}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-caption text-fg-muted">
          Two entries on this page deliberately carry <em>no</em> paper overlay
          — <span className="font-mono">F-FEE-18</span> (Effective Equity) and{" "}
          <span className="font-mono">F-FEE-19</span> (Percentage Return). Both
          read the <strong>real</strong> Hyperliquid account, which paper trades
          do not move. A 🟡 there would claim those numbers are simulated, and
          they are not. Each says so in its own status note.
        </p>
      </section>

      {/* ── 3. Nothing is protecting a position ─────────────────────────── */}
      <section className="rounded-lg border border-border-amber bg-accent-amber/5 p-4">
        <h3 className="text-h3 text-fg-primary">
          <span aria-hidden="true">🚨 </span>
          Nothing on the exchange is protecting a position
        </h3>
        <p className="mt-2 text-caption-ui text-fg-primary">
          Native TP/SL arming is <strong>skipped entirely</strong> under the
          paper window. Of <strong>45 paper-era rows</strong> measured at the
          2026-08-04 recon, <strong>6</strong> carry a{" "}
          <span className="font-mono">native_sl_oid</span> and{" "}
          <strong>all six are synthetic</strong> (
          <span className="font-mono">&ge; 9e12</span>, addressing no real
          order); <strong>0</strong> carry a{" "}
          <span className="font-mono">native_tp_oid</span>.{" "}
          <strong>Zero real order ids have ever rested.</strong>
        </p>
        <p className="mt-2 text-caption-ui text-fg-primary">
          Every stop in this era is enforced solely by a{" "}
          <strong>~30-second software poll</strong>. So: if{" "}
          <span className="font-mono">trevor.service</span> stopped right now,
          what would protect an open position?{" "}
          <strong>Nothing.</strong>
        </p>
        <p className="mt-2 text-caption text-fg-muted">
          This is <strong>deliberate, not a defect</strong> (R13-B1). Arming a
          synthetic SL would set <span className="font-mono">&eta; = True</span>{" "}
          and suppress the software Layer-1 stop &mdash; muting the exact
          component the paper window exists to exercise. The book was flat at
          slice time (0 open rows), so there is no live exposure. But the page
          must not tell you the exchange is holding your stop, because today it
          is not.
        </p>
      </section>

      {/* ── 4. The sleeve / portfolio layer ────────────────────────────── */}
      <section>
        <h3 className="text-h3 text-fg-primary">
          The whole sleeve and portfolio layer is structurally inert
        </h3>
        <p className="mt-2 text-caption-ui text-fg-primary">
          Not one position in TREVOR&rsquo;s history has ever been managed
          per-sleeve. Sections 10&ndash;11 teach maths that has never decided
          anything.
        </p>
        <p className="mt-2 text-caption-ui text-fg-primary">
          <strong>How that is known from the Hub&rsquo;s side:</strong> the
          global <span className="font-mono">LEVEL</span> lives in{" "}
          <span className="font-mono">rebuild_tracker.db</span>, which is{" "}
          <strong>not litestream-replicated and unreachable from this box</strong>
          . So the values layer refuses to state it &mdash;{" "}
          <span className="font-mono">level: null</span>,{" "}
          <span className="font-mono">levelSource: &quot;unavailable&quot;</span>
          , with <span className="font-mono">global_level</span> named in its{" "}
          <em>unavailable</em> register. Baking in a{" "}
          <span className="font-mono">0</span> would become a lie the moment
          Ghost mints level 1. Inertness is proven from{" "}
          <strong>three live replica reads</strong> instead, so the claim
          self-corrects if any of them changes:
        </p>
        <ul className="mt-3 space-y-1.5">
          {SLEEVE_PROOFS.map((p) => (
            <li
              key={p.name}
              className="flex flex-wrap items-baseline gap-x-2 text-caption"
            >
              <span className="text-fg-muted">{p.name}</span>
              <span className="font-mono text-fg-primary">{p.value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-caption text-fg-muted">
          Source: <span className="font-mono">/api/math/values</span>{" "}
          <span className="font-mono">status.sleeveStatus.proofs</span>, read{" "}
          <span className="font-mono">2026-08-06 01:11:56Z</span> (replica lag
          295 s). <span className="font-mono">sleeveStatus.inert = true</span>.
        </p>
      </section>

      {/* ── 5. The sample is tiny ──────────────────────────────────────── */}
      <section className="rounded-lg border border-border-amber bg-accent-amber/5 p-4">
        <h3 className="text-h3 text-fg-primary">
          <span aria-hidden="true">🚨 </span>
          The sample is tiny. Nothing measured in it is evidence.
        </h3>
        <p className="mt-2 text-caption-ui text-fg-primary">
          <strong>47 closed trades</strong> carry{" "}
          <span className="font-mono">paper_window = 1</span>, against a full
          closed book of <strong>1,795</strong>. Post-cutover the count is{" "}
          <strong>48</strong>.
        </p>
        <p className="mt-2 text-caption-ui text-fg-primary">
          <strong>
            Nothing measured in that window is statistically meaningful.
          </strong>{" "}
          No rate, no ratio, no win percentage and no per-trade average drawn
          from ~47 trades is evidence of anything. If a number on this page
          comes from the paper era, treat it as an anecdote with a decimal
          point.
        </p>
        <p className="mt-2 text-caption text-fg-muted">
          Read live 2026-08-06 01:11:56Z. Both counts were{" "}
          <strong>lower two days earlier</strong> &mdash; the 2026-08-04 recon
          measured 44&ndash;45 paper rows and 46 post-cutover. A book that moves
          this much in two days is exactly why no sample size on this page is
          hardcoded, and why every count above carries its window and{" "}
          <span className="font-mono">n</span>.
        </p>
        <p className="mt-2 text-caption text-fg-muted">
          One figure has <strong>not</strong> moved:{" "}
          <span className="font-mono">fees_usd_true</span> is non-NULL on{" "}
          <strong>0</strong> post-cutover rows. There is{" "}
          <strong>no live break-even bar</strong>. The 8.2 bps figure in section
          14 is a historical cohort (n = 557, all{" "}
          <span className="font-mono">paper_window = 0</span>) and must never be
          read as current &mdash; comparing a paper result against it is
          comparing a 9.0-bps-modelled number against a bar derived from real
          fills of a different era.
        </p>
      </section>

      {/* ── 6. What the flip would and would not change ─────────────────── */}
      <section>
        <h3 className="text-h3 text-fg-primary">
          What would change when paper is turned off &mdash; and what would not
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded border border-border-subtle p-3">
            <h4 className="text-micro text-fg-dim">CHANGES</h4>
            <ul className="mt-1.5 space-y-1.5 text-caption text-fg-primary">
              <li>
                Orders reach the exchange. A real counterparty fills them, at a
                real price, or does not fill them at all.
              </li>
              <li>
                The native SL becomes <strong>primary</strong>:{" "}
                <span className="font-mono">&eta;</span> turns{" "}
                <span className="font-mono">True</span> for healthy positions
                and Layer 1 becomes fallback-only.{" "}
                <strong>
                  That is a reachability change, not a tuning change
                </strong>{" "}
                &mdash; it changes <em>which layer enforces the stop</em>.
              </li>
              <li>
                <span className="font-mono">fees_usd_true</span> starts
                populating, so a live break-even bar becomes measurable for the
                first time.
              </li>
              <li>
                The 🟡 badges come off. Partial-exit fill rates stop being an
                upper bound; maker entries start carrying adverse selection.
              </li>
            </ul>
          </div>

          <div className="rounded border border-border-subtle p-3">
            <h4 className="text-micro text-fg-dim">DOES NOT CHANGE</h4>
            <ul className="mt-1.5 space-y-1.5 text-caption text-fg-primary">
              <li>
                <strong>Every formula on this page is identical either way.</strong>{" "}
                Not one line of the arithmetic in sections 1&ndash;16 is
                conditional on the paper flag.
              </li>
              <li>
                The sleeve layer stays inert &mdash; that is gated on{" "}
                <span className="font-mono">LEVEL</span> and{" "}
                <span className="font-mono">SLEEVE_TAGGING_ENABLED</span>, not
                on the paper window.
              </li>
              <li>
                <span className="font-mono">F-FEE-21</span> stays dormant. Its
                flag already reads <span className="font-mono">true</span>;
                nothing calls it in either mode.
              </li>
              <li>
                The tiny sample stays tiny. Flipping the flag does not
                retroactively make ~47 paper trades into evidence.
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-3 text-caption text-fg-muted">
          <span aria-hidden="true">🚨 </span>
          Put plainly: <strong>only the SDK boundary and the badges change.</strong>{" "}
          The maths you are reading is the maths that will run. What you cannot
          learn from the paper era is how it behaves when a real counterparty is
          on the other side.
        </p>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section intros
// ─────────────────────────────────────────────────────────────────────────────

/** §15 intro — the one thing a reader gets wrong about each of the two. */
function FundingSlippageIntro() {
  return (
    <div className="space-y-3">
      <p>
        Two costs that do not behave like the fees in section 12. One is
        invisible in the ledger by design; the other accrues while you do
        nothing at all.
      </p>
      <p>
        <span aria-hidden="true">🚨 </span>
        <strong>
          Slippage never appears as a term in the P&amp;L identity, because it
          is already inside{" "}
          <span className="font-mono">entry_price</span> and{" "}
          <span className="font-mono">exit_price</span>.
        </strong>{" "}
        There is no <span className="font-mono">slippage_usd</span> column and
        there should not be one &mdash; adding it would double-count.
      </p>
      <p>
        <strong>Funding is what pins a perpetual to spot.</strong> A perp has no
        expiry, so nothing forces its price back to the underlying: when the
        perp trades above spot, longs pay shorts; when below, shorts pay longs.
        Holding a position therefore carries a cost or a credit that accrues
        with time and is <strong>completely independent of price movement</strong>
        .
      </p>
    </div>
  );
}

/** §16 intro — carries the master's partial-depth table (F-FEE-20). */
function EquityReturnIntro() {
  return (
    <div className="space-y-3">
      <p>
        What the account is actually worth, how a percentage return is computed
        against it, and how the partial ladder books what it banks.
      </p>
      <p>
        <span aria-hidden="true">🚨 </span>
        <strong>
          <span className="font-mono">F-FEE-18</span> is the authority.
        </strong>{" "}
        <span className="font-mono">F-FEE-17</span>&rsquo;s virtual equity is a{" "}
        <strong>fallback reconstruction</strong>, reached only when the exchange
        read fails. The two do not agree, by about{" "}
        <strong>$25.70</strong>, and nobody has reconciled them.
      </p>

      <RefTable
        caption="F-FEE-20 — true round-trip cost by ladder depth, in bps of ENTRY notional"
        head={["partial_exits_taken", "n", "true RT bps"]}
        rows={[
          ["0", "283", "8.322"],
          ["1", "237", "8.176"],
          ["2", "37", "7.591"],
        ]}
      />
      <p className="text-fg-muted">
        <span aria-hidden="true">🚨 </span>
        Read that table carefully: the <strong>true</strong> cost is{" "}
        <strong>flat</strong>, arguably slightly falling, with ladder depth.{" "}
        <strong>The partial ladder does not cost more in real fees.</strong> What
        changes is the <em>modelled</em> figure, because{" "}
        <span className="font-mono">notional_usd</span> is decremented by every
        partial and the final close is billed against a shrunken base &mdash;
        which is the whole of the <strong>16.2%</strong> under-booking.
      </p>
    </div>
  );
}

/** §17 intro — one sentence, because the section body is the point. */
function PaperModeIntro() {
  return (
    <p>
      <strong>Read this section before you trust a single badge above it.</strong>{" "}
      Sixteen sections have just taught you how TREVOR thinks. This one tells
      you which of it has ever touched real money.
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function MathFundingEquityPaper() {
  return (
    <>
      <MathSection
        number={15}
        title={sectionTitle(15)}
        intro={<FundingSlippageIntro />}
      >
        {FUNDING_SLIPPAGE_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>

      <MathSection
        number={16}
        title={sectionTitle(16)}
        intro={<EquityReturnIntro />}
      >
        {EQUITY_RETURN_ENTRIES.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>

      <MathSection number={17} title={sectionTitle(17)} intro={<PaperModeIntro />}>
        <PaperModeBody />
      </MathSection>
    </>
  );
}
