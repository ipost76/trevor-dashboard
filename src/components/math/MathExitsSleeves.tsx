import * as React from "react";
import {
  FormulaEntry,
  MathSection,
  MathTex,
  type FormulaEntryProps,
  type FormulaSymbol,
} from "@/components/math";
import { MIRRORED_FROM } from "@/lib/math-constants";

/**
 * Sections 10–11 — the exit stack · sleeves.
 * Formula IDs F-EXIT-00…15 plus the four-sleeve registry.  [D4, 2026-08-05]
 *
 * Transcribed from the RM-MATH master spec (Family 2 + §3.3a) on the VM. Every
 * formula, symbol, explanation and number below traces to that master or to the
 * code-constant mirror in `src/lib/math-constants.ts` (stamped bcbce58). Where
 * the two disagree the mirror wins — measured at build time, they agreed on all
 * five of the constants the C1 reseed had corrected, so nothing is overridden.
 *
 * 🚨 THE ONE THING THIS SECTION EXISTS TO SAY. Three of the sixteen entries —
 * F-EXIT-05, 06 and 07 — are exchange-resident protections that are DORMANT and
 * have NEVER FIRED. Together they mean nothing on Hyperliquid is protecting an
 * open position: every stop is a software poll on a ~30 s cycle. That
 * consequence is rendered explicitly (see `NativeProtectionConsequence`) rather
 * than left for a reader to assemble from three separate entries.
 *
 * 🚨 F-EXIT-00 CARRIES NO BADGE, DELIBERATELY. The master gives it none — it is
 * definitional arithmetic, not a decision layer, so it has no status to report.
 * `FormulaEntry` requires a `status`, so rather than invent one it renders
 * through `SharedQuantities` below: identical layout, identical anchor, no
 * badge. Fifteen badged entries plus one unbadged block is the honest shape.
 *
 * 🚨 THE SLEEVE TABLE NEVER RENDERS WITHOUT ITS INERTNESS LINE. They are one
 * component (`SleeveRegistry`) for exactly that reason — the table alone would
 * teach Ghost that his positions are managed per-sleeve, and not one position
 * ever has been.
 */

/** TeX is passed through verbatim — String.raw keeps every backslash escape. */
const R = String.raw;

export function MathExitsSleeves() {
  return (
    <>
      <MathSection
        number={10}
        title="The exit stack"
        intro={
          <p>
            Fifteen badged entries plus one unbadged shared-quantities block.{" "}
            <strong className="text-fg-primary">
              All prices are RAW (un-leveraged) price space unless an entry says
              &ldquo;leveraged.&rdquo;
            </strong>{" "}
            Mixing the two is the single most common misreading of this engine.
          </p>
        }
      >
        <SharedQuantities />

        {ENTRIES_01_07.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}

        <NativeProtectionConsequence />

        {ENTRIES_08_15.map((e) => (
          <FormulaEntry key={e.id} {...e} />
        ))}
      </MathSection>

      <MathSection
        number={11}
        title="Sleeves"
        intro={
          <p>
            The four sleeves, read live from <code>sleeves.SLEEVES</code>.{" "}
            <code>stop_pct</code> belongs to F-EXIT-13 and the rest to
            F-SIZE-11 — one registry, two slices, rendered together here so the
            page never shows half of it. The 13-ticker{" "}
            <code>CASCADE_LMAX</code> table and the tail cap it produces live in
            section 8.
          </p>
        }
      >
        <SleeveRegistry />
      </MathSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// F-EXIT-00 — the unbadged shared-quantities block
// ─────────────────────────────────────────────────────────────────────────────

const SHARED_TEX: string[] = [
  R`\text{pnl}_{\%} = \frac{P_t - P_e}{P_e}\cdot 100 \cdot L \quad(\text{LONG}),\qquad
\text{pnl}_{\%} = \frac{P_e - P_t}{P_e}\cdot 100 \cdot L \quad(\text{SHORT})`,
  R`\rho = \begin{cases}
\rho_{\text{stored}} & \text{if } \rho_{\text{stored}} > 0\\
\left|P_e - S_0\right| & \text{else, and if } {>}\,0\\
0.02\,P_e & \text{else (fallback)}
\end{cases}`,
  R`R_t = \frac{P_t - P_e}{\rho}\ (\text{LONG}),\qquad R_t = \frac{P_e - P_t}{\rho}\ (\text{SHORT})`,
  R`P^{\text{fav}}_t=\max(P^{\text{peak}}_{t-1},P_t)\ (\text{LONG}),\qquad
P^{\text{fav}}_t=\min(P^{\text{trough}}_{t-1},P_t)\ (\text{SHORT})`,
  R`R^{\text{peak}}_t = \frac{P^{\text{fav}}_t - P_e}{\rho}\ (\text{LONG}),\qquad
R^{\text{peak}}_t = \frac{P_e - P^{\text{fav}}_t}{\rho}\ (\text{SHORT})`,
];

const SHARED_SYMBOLS: FormulaSymbol[] = [
  { sym: R`P_t`, means: "current mark price" },
  { sym: R`P_e`, means: "entry price (auto_trades.entry_price)" },
  { sym: R`S_0`, means: "the stop price at entry" },
  { sym: R`L`, means: "leverage (auto_trades.leverage)" },
  {
    sym: R`\rho`,
    means:
      "risk per unit — the price distance from entry to the original stop, in price units",
  },
  {
    sym: R`\rho_{\text{stored}}`,
    means: "auto_trades.original_risk_per_unit, frozen at entry",
  },
  { sym: R`R_t`, means: "current R-multiple" },
  {
    sym: R`P^{\text{fav}}_t`,
    means:
      "favourable extreme since entry: peak_price for LONG, trough_price for SHORT",
  },
  {
    sym: R`R^{\text{peak}}_t`,
    means:
      "best R reached so far — armed-and-stays-armed, never decays",
  },
];

/**
 * F-EXIT-00. Same layout as `FormulaEntry`, minus the badge — the master gives
 * this block none, and inventing a status for definitional arithmetic would be
 * exactly the kind of plausible-looking placeholder this page must not carry.
 */
function SharedQuantities() {
  return (
    <article
      id="F-EXIT-00"
      className="scroll-mt-24 rounded-lg border border-border-subtle bg-bg-card p-4 sm:p-5"
    >
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-micro text-fg-dim">F-EXIT-00</span>
          <h3 className="text-h3 text-fg-primary">Shared quantities</h3>
          <span className="font-mono text-micro text-fg-muted">NO BADGE</span>
        </div>
        <p className="text-caption text-fg-muted">
          No status of its own: this is the arithmetic almost every entry below
          consumes, not a layer that decides anything. Computed once per
          position per cycle.
        </p>
        <p className="font-mono text-caption text-fg-dim break-all">
          monitor.evaluate_exit_signals
        </p>
      </header>

      <div className="mt-3">
        {SHARED_TEX.map((t, i) => (
          <MathTex key={i} tex={t} />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {SHARED_SYMBOLS.map((s, i) => (
          <React.Fragment key={i}>
            <dt className="text-caption text-fg-primary">
              <MathTex tex={s.sym} display={false} />
            </dt>
            <dd className="text-caption text-fg-muted">{s.means}</dd>
          </React.Fragment>
        ))}
      </dl>

      <div className="mt-4">
        <h4 className="text-micro text-fg-dim">Why it works</h4>
        <p className="mt-1 text-caption-ui text-fg-primary">
          Why ρ is frozen at entry. If ρ were recomputed from the live stop, then
          every time breakeven or the ratchet pulled the stop toward entry, ρ
          would shrink and R would inflate for free — a trade would appear to
          gain R-multiples purely because its stop tightened. Freezing ρ makes R
          an honest measure of price progress. (monitor.py FIX 5, 2026-04-23.)
        </p>
      </div>

      <div className="mt-4">
        <h4 className="text-micro text-fg-dim">Standing values</h4>
        <ul className="mt-1.5 space-y-1">
          <li className="flex flex-wrap items-baseline gap-x-2 text-caption">
            <span className="text-fg-muted">ρ (stored)</span>
            <span className="font-mono text-fg-primary tabular-nums">
              per-trade
            </span>
            <span className="text-fg-dim">
              — auto_trades.original_risk_per_unit; trade-derived, not a standing
              constant
            </span>
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2 text-caption">
            <span className="text-fg-muted">ρ fallback</span>
            <span className="font-mono text-fg-primary tabular-nums">
              0.02 × entry
            </span>
            <span className="text-fg-dim">
              — a code constant in monitor.evaluate_exit_signals, used only when
              both the stored risk and the entry-stop distance are unusable
            </span>
          </li>
        </ul>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The consequence the three dormant native-trigger entries share
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🚨 MUST-LAND. F-EXIT-05, 06 and 07 are each honest on their own, but the
 * thing that matters is what they mean TOGETHER, and no reader should have to
 * derive it from three separate DORMANT badges.
 */
function NativeProtectionConsequence() {
  return (
    <div className="rounded-lg border border-border-red bg-accent-red/10 p-4 sm:p-5">
      <h3 className="text-h3 text-fg-primary">
        <span aria-hidden="true">🚨 </span>
        Nothing on the exchange is protecting an open position
      </h3>
      <div className="mt-2 space-y-2 text-caption-ui text-fg-primary">
        <p>
          The three entries above — the native stop-loss trigger, the native
          take-profit trigger, and the cancel-replace mirror that keeps them in
          step with the ratchet — are all{" "}
          <strong>DORMANT and have all NEVER FIRED</strong>. Native TP/SL arming
          is skipped entirely under the paper window:{" "}
          <code>execute_entry_live</code> arms native protection only when{" "}
          <code>not _paper_on</code>, and <code>PAPER_WINDOW_ENABLED</code> is
          live <code>true</code>.
        </p>
        <p>
          So there is <strong>no resting stop-loss and no resting take-profit
          on Hyperliquid</strong> for any open position. Every stop TREVOR has is
          a software stop, tested when the monitor loop polls — roughly every 30
          seconds.{" "}
          <strong>
            If the bot stops, wedges, or loses its connection between two polls,
            the position is unguarded until it comes back.
          </strong>{" "}
          The exchange is holding nothing on its behalf.
        </p>
        <p className="text-fg-muted">
          This is deliberate, not a defect: a synthetic native SL can never fire
          on mark, so arming one would set <code>native_sl_active = True</code>{" "}
          and <em>suppress</em> the software Layer-1 stop (F-EXIT-15), leaving a
          paper position that is never stopped out at all. The dormancy is the
          safer of the two options — but it is not the same thing as being
          protected.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// F-EXIT-01 … F-EXIT-07
// ─────────────────────────────────────────────────────────────────────────────

const ENTRIES_01_07: FormulaEntryProps[] = [
  {
    id: "F-EXIT-01",
    name: "Only-Tighten Ratchet Floor",
    status: "paper",
    fired:
      "FIRED · 93 of 1793 auto_trades rows carry ratchet_locked_r > 0, max 1.1577 (lifetime)",
    statusNote:
      "Gated by S1_RATCHET_ENABLED = live true. Reached from monitor.monitor_cycle → monitor.evaluate_exit_signals stage 4.5. This is the module the v5 rebuild preserved byte-for-byte.",
    source: "exit_helpers.compute_ratchet_floor",
    tex: [
      R`r_{\text{be}} = \frac{b\cdot P_e}{\rho}`,
      R`\ell_t \;=\; \max\Bigl(\{0\}\ \cup\ \bigl\{\,\lambda(\text{lock}) \;:\; (r_{\text{trig}},\text{lock})\in\Lambda,\ R^{\text{peak}}_t \ge r_{\text{trig}} \bigr\}\Bigr),
\qquad
\lambda(\text{lock}) = \begin{cases} r_{\text{be}} & \text{lock}=\texttt{'be'}\\ \text{lock} & \text{otherwise}\end{cases}`,
      R`S^{\text{ratchet}}_t = \begin{cases}
P_e + \ell_t\,\rho & \text{LONG}\\[2pt]
P_e - \ell_t\,\rho & \text{SHORT}
\end{cases}
\qquad\text{returns }(0,\ \text{None})\text{ if }\ell_t \le 0`,
    ],
    symbols: [
      {
        sym: R`\Lambda`,
        means: "the ratchet ladder — (trigger_peak_r, lock) pairs",
      },
      {
        sym: R`\ell_t`,
        means:
          "locked R — the most-protective milestone reached, in R units",
      },
      {
        sym: R`r_{\text{be}}`,
        means:
          "the R-equivalent of the breakeven buffer, so 'be' and numeric locks share ONE stop formula",
      },
      { sym: R`b`, means: "breakeven buffer (raw price fraction)" },
      {
        sym: R`S^{\text{ratchet}}_t`,
        means: "the ratchet's candidate stop price",
      },
    ],
    why:
      "A stop that can move both ways is not a stop — it is a suggestion. If the stop could widen after the price retraced, every gain the trade banked on paper could be handed back, and the position's worst case would keep resetting to its original risk no matter how far it had run. Making the floor a running maximum over milestones already reached means the guarantee only ever improves: once the price has touched +0.75R, the trade is contractually incapable of closing below +0.25R net, forever. The 'be' sentinel exists because the first milestone is qualitatively different — it locks not losing rather than locking a profit — and expressing it as an R-equivalent lets one stop-price formula serve both kinds. The clamps are part of the formula, not implementation detail: the helper returns (0.0, None) on any non-numeric input, on entry ≤ 0, on ρ ≤ 0 and on an empty ladder; a malformed milestone is skipped rather than fatal; a direction that is neither LONG nor SHORT returns (0.0, None); and it never raises, because it sits on the exit hot path.",
    values: [
      {
        label: "Λ (the ladder)",
        value: "[(0.5, 'be'), (0.75, 0.25), (1.0, 0.5)]",
        note: "code constant config.S1_RATCHET_LADDER — no auto_config row exists",
      },
      {
        label: "gate",
        value: "S1_RATCHET_ENABLED = true",
        note: "auto_config, live",
      },
      { label: "b", value: "0.003", note: "see F-EXIT-02" },
      {
        label: "ℓ_t persisted",
        value: "auto_trades.ratchet_locked_r",
        note: "REAL, default 0 — per-trade, not a standing constant",
      },
      {
        label: "per-sleeve ladder",
        value: "None today",
        note: "ExitProfile.ratchet_ladder — sleeve resolution returns nothing; see F-EXIT-13",
      },
    ],
    caveat:
      "Where the monotonicity actually lives. compute_ratchet_floor is STATELESS: it recomputes ℓ_t from R^peak_t every cycle and holds no memory. It is monotone only because R^peak_t is monotone AND because F-EXIT-03's combine step refuses to loosen. The persisted auto_trades.ratchet_locked_r is likewise guarded by an explicit `if _new_locked > _prev_locked` in monitor_cycle. Read this component as the floor's proposer, never as the thing that enforces the guarantee on its own.",
  },

  {
    id: "F-EXIT-02",
    name: "Fee-Floored Breakeven Buffer",
    status: "paper",
    fired:
      "FIRED · 584 auto_trades rows carry breakeven_stop_active = 1 (lifetime)",
    statusNote:
      "Armed at monitor.evaluate_exit_signals stage 3. Gated by S1_BREAKEVEN_FEE_AWARE = live true.",
    source: "exit_helpers.get_breakeven_buffer",
    tex: [
      R`b=\max(b_{\text{cfg}},\,f_{\text{rt}}),\qquad
S^{\text{be}}=\begin{cases}P_e\,(1+b) & \text{LONG}\\ P_e\,(1-b) & \text{SHORT}\end{cases}`,
    ],
    symbols: [
      {
        sym: R`b_{\text{cfg}}`,
        means: "configured buffer — the noise margin past entry",
      },
      {
        sym: R`f_{\text{rt}}`,
        means: "realistic round-trip fee fraction (entry taker + exit maker)",
      },
      { sym: R`r_{\text{arm}}`, means: "R at which breakeven arms" },
      { sym: R`S^{\text{be}}`, means: "the breakeven layer's candidate stop" },
    ],
    why:
      "“Breakeven” set exactly at entry is a loss: the round trip has already cost fees, so a stop-out at the entry price books negative. Flooring the buffer at the fee guarantees a stop-out at “breakeven” nets ≥ $0. The max() is deliberate future-proofing — today b_cfg = 0.003 (30 bps) already exceeds f_rt = 0.0006 (6 bps), so the practical value is the noise margin; the floor only becomes load-bearing if someone later lowers b_cfg below the fee. It arms on the first cycle where R_t ≥ r_arm, and only if strictly more protective than the current stop (S^be > S_t for LONG, S^be < S_t for SHORT, or S_t ≤ 0). It is defensive throughout: a negative or non-finite b_cfg or f_rt collapses to 0.0, so the helper can never widen a stop.",
    values: [
      {
        label: "b_cfg",
        value: "0.003",
        note: "code constant config.BREAKEVEN_BUFFER_PCT — 30 bps",
      },
      {
        label: "f_rt",
        value: "0.0006",
        note: "code constant config.HL_FEE_ENTRY_TAKER_EXIT_MAKER = HL_FEE_TAKER + HL_FEE_MAKER = 0.00045 + 0.00015 — 6 bps",
      },
      {
        label: "b (resolved)",
        value: "0.003",
        note: "max(0.003, 0.0006) — the noise margin wins today",
      },
      {
        label: "r_arm",
        value: "0.15",
        note: "code constant config.S1_BREAKEVEN_ARM_R — see the caveat",
      },
      {
        label: "armed count",
        value: "auto_trades.breakeven_stop_active",
        note: "COUNT(*) WHERE breakeven_stop_active = 1",
      },
      {
        label: "gate",
        value: "S1_BREAKEVEN_FEE_AWARE = true",
        note: "auto_config, live",
      },
    ],
    caveat:
      "THE CODE COMMENT CONTRADICTS THE CODE. The comment above S1_BREAKEVEN_ARM_R says 0.25R; the literal is 0.15. The rationale block reads “0.25R aligns with S1-P01's first partial rung”, which was true of an earlier value — the comment predates the G2 change (2026-06-29) that lowered it. The arming point in force is 0.15R. Read the literal, never the comment.",
  },

  {
    id: "F-EXIT-03",
    name: "The Effective Stop (the only-tighten combine)",
    status: "paper",
    fired: "FIRED · the write that produces every stop_hit (lifetime, ongoing)",
    statusNote:
      "Runs on the HOLD branch of every ~30 s cycle for every open position — the only site in the engine that writes auto_trades.stop_price.",
    source: "monitor.monitor_cycle",
    tex: [
      R`\mathcal{C}_t=\bigl\{\,S^{\text{be}}\ (\text{layer }3),\quad S^{\text{trail}}_t\ (\text{layer }4),\quad S^{\text{ratchet}}_t\ (\text{layer }4.5)\,\bigr\}\quad\text{(present candidates only)}`,
      R`S_t=\begin{cases}
\max\bigl(\mathcal{C}_t\cup\{S_{t-1}\}\bigr) & \text{LONG}\\[3pt]
\min\bigl(\{c\in\mathcal{C}_t : c>0\}\cup\{S_{t-1}\}\bigr) & \text{SHORT}
\end{cases}`,
    ],
    symbols: [
      {
        sym: R`\mathcal{C}_t`,
        means:
          "the candidate set this cycle — a layer that did not propose is simply absent",
      },
      {
        sym: R`S_{t-1}`,
        means: "the stop currently persisted in auto_trades.stop_price",
      },
      {
        sym: R`S_t`,
        means: "the working stop — the single value Layer 1 tests next cycle",
      },
    ],
    why:
      "Three layers each propose a stop; the combine step decides. Before this unification each layer wrote the stop directly, and a looser trail computed later in the same cycle could silently overwrite a more-protective breakeven stop. Routing every candidate through one max/min that includes the existing stop makes “the stop only ever tightens” a property of the code path rather than a property every author has to remember. It also means a layer can be added or removed without touching the guarantee — a new layer contributes a candidate and cannot do anything else. The DB write happens only when the winner strictly beats the stored stop: _best[0] > current_stop for LONG, and current_stop <= 0 or _best[0] < current_stop for SHORT.",
    values: [
      {
        label: "S_t",
        value: "auto_trades.stop_price",
        note: "REAL, NOT NULL — per-trade, trade-derived",
      },
      {
        label: "winning layer",
        value: "not persisted as a column",
        note: "carried in the [STOP-RATCHET] … src=… layer=… WARNING sentinel and in auto_trades.exit_signals_log (STOP_RATCHETED events)",
      },
      {
        label: "layer ids",
        value: "3 = breakeven · 4 = trail · 45 = ratchet",
      },
      {
        label: "candidate values",
        value: "computed at runtime, not persisted",
      },
    ],
    caveat:
      "The SHORT branch is not the mirror image of the LONG branch, and the difference is load-bearing. It carries an extra c > 0 filter and a current_stop <= 0 escape: a SHORT with no stop yet accepts the first positive candidate, which a bare min() over a set containing zero would never produce.",
  },

  {
    id: "F-EXIT-04",
    name: "Leveraged Hard P&L Stop (Layer 0.5)",
    status: "live",
    overlay: "paper",
    fired:
      "FIRED · n=120 lifetime — hard_stop_10pct 107 · hard_stop_15pct 12 · hard_stop_8pct 1",
    statusNote:
      "Badged LIVE rather than PAPER because hard_stop_8pct (the STOP-TRIM-8 value) has fired once on the live book — the lifetime count includes real-money fires. The paper overlay is today's gate: under PAPER_WINDOW_ENABLED a fire now closes a simulated fill. It is the first exit test in the evaluator and cannot be suppressed by the native SL.",
    source: "monitor.evaluate_exit_signals → exit_helpers.get_hard_stop_pct",
    tex: [
      R`H_{\text{eff}} = \min\Bigl(\underbrace{\mathrm{profile} \;\triangleright\; \mathrm{ticker} \;\triangleright\; H_{\text{cfg}}}_{\text{resolution chain}},\ \ H_{\text{trim}}\Bigr)`,
      R`\text{FIRE} \iff \text{pnl}_{\%} \le -H_{\text{eff}}
\quad\text{(subject to the debounce below)}`,
    ],
    symbols: [
      {
        sym: R`H_{\text{eff}}`,
        means:
          "effective hard-stop threshold, a positive leveraged % (8.0 means −8%)",
      },
      { sym: R`H_{\text{cfg}}`, means: "global default" },
      { sym: R`H_{\text{trim}}`, means: "the STOP-TRIM-8 clamp value" },
      { sym: R`d`, means: "consecutive-breach debounce count" },
    ],
    why:
      "stop_price is a price level; this is a leveraged P&L level. They can disagree badly — a stop 2% away in price is 20% away in P&L at 10× leverage, and a stale or zero stop_price leaves no price wall at all. Layer 0.5 is the backstop answering “how much am I willing to lose on this trade, in money” independently of any price geometry, and it is deliberately evaluated first. The min() is only-tighten: a trim value at or above the resolved stop is a no-op, so the clamp can never widen the catastrophic backstop. Both directions share one expression because pnl_% is already direction-signed (F-EXIT-00). The debounce exists because a single bad tick amplified by leverage produced 9 real phantom closes: if phantom_debounce = d > 1 the breach must hold for d consecutive cycles before firing, any non-breaching cycle resets the counter to 0, and withheld cycles fall through so every other layer still evaluates. Requiring persistence distinguishes a genuine move from a data glitch without moving the threshold.",
    values: [
      {
        label: "H_cfg",
        value: "10.0",
        note: "code constant config.HARD_STOP_PCT — leveraged %",
      },
      {
        label: "per-ticker",
        value: "BTC 10.0 · ETH 10.0 · SOL 10.0 · HYPE 10.0 · FARTCOIN 10.0",
        note: "code constant exit_helpers.TICKER_HARD_STOP_PCT — only 5 of the 10 sacred tickers are named; the other 5 ride H_cfg",
      },
      {
        label: "per-ticker gate",
        value: "HARD_STOP_V2 = true",
        note: "auto_config, live",
      },
      {
        label: "H_trim",
        value: "8.0",
        note: "auto_config STOP_TRIM_8_PCT — a leveraged %, gated by STOP_TRIM_8_ENABLED = true",
      },
      {
        label: "d",
        value: "debounce not configured",
        note: "auto_config HARD_STOP_PHANTOM_DEBOUNCE has NO ROW and no config.py DEFAULTS entry — see the caveat",
      },
      {
        label: "fire counts",
        value: "auto_trades.exit_reason LIKE 'hard_stop_%'",
        note: "counted with COUNT(DISTINCT id)",
      },
    ],
    caveat:
      "THE DEBOUNCE IS NOT CONFIGURED. No HARD_STOP_PHANTOM_DEBOUNCE row exists in auto_config and no config.py DEFAULTS entry was found, so the resolution takes the flag-OFF path (phantom_debounce is None) and the stop fires on a single tick. That is the current behaviour, reported as measured — do not assert a debounce value for this layer, and do not read the described debounce as active.",
  },

  {
    id: "F-EXIT-05",
    name: "Native SL Trigger Price + Cap",
    status: "dormant",
    fired:
      "NEVER FIRED in the paper era — of 45 paper-window rows, 6 carry a native_sl_oid and all six are synthetic (≥ 9e12)",
    statusNote:
      "NATIVE_TPSL_ENABLED is live true, but the arming call site in execute_entry_live reads `if _ntp_on and _position_confirmed and not _paper_on:`. With PAPER_WINDOW_ENABLED = true, _paper_on is True and native arming is skipped entirely (R13-B1). This is deliberate: a synthetic native SL can never fire on mark, so arming it would set native_sl_active = True and suppress the software Layer-1 stop, leaving a paper position never stopped out.",
    source:
      "live_executor._place_native_sl_order → live_executor._cap_native_sl_trigger, armed from live_executor._arm_native_protection",
    tex: [
      R`\text{cap} = \min\bigl(C_{\text{base}},\ C_{\text{trim}},\ \tfrac{\sigma}{100}\bigr),
\qquad \phi = \frac{\text{cap}}{L}`,
      R`T^{\text{SL}} = \begin{cases}
\max\bigl(T_{\text{raw}},\ P_e(1-\phi)\bigr) & \text{LONG}\\[2pt]
\min\bigl(T_{\text{raw}},\ P_e(1+\phi)\bigr) & \text{SHORT}
\end{cases}`,
      R`X^{\text{SL}} = \begin{cases}
T^{\text{SL}}\,(1+s) & \text{buy-to-close (closing a SHORT)}\\[2pt]
T^{\text{SL}}\,(1-s) & \text{sell-to-close (closing a LONG)}
\end{cases}`,
    ],
    symbols: [
      {
        sym: R`T_{\text{raw}}`,
        means: "the requested trigger price (the software stop)",
      },
      { sym: R`T^{\text{SL}}`, means: "the trigger price actually submitted" },
      {
        sym: R`X^{\text{SL}}`,
        means: "the limit price attached to the market-on-trigger order",
      },
      { sym: R`C_{\text{base}}`, means: "base native-SL cap, a raw fraction" },
      {
        sym: R`C_{\text{trim}}`,
        means: "STOP-TRIM-8 native cap, a raw fraction",
      },
      {
        sym: R`\sigma`,
        means: "per-sleeve stop_pct (a leveraged %, hence the /100)",
      },
      {
        sym: R`\phi`,
        means: "the raw price fraction from entry to the capped stop",
      },
      { sym: R`s`, means: "exit slippage tolerance" },
    ],
    why:
      "The exchange trigger fires on mark, continuously; the software stop fires only when the ~30 s poll happens to look. A fast wick can blow through the software stop and be gone before the bot sees it, so the native SL is the primary enforcement and the bot poll is the fallback. The cap exists because the trigger price alone says nothing about how much money is at risk — entry × (1 − cap/L) converts a money limit into a price limit at this position's leverage, and at the capped stop the leveraged loss is exactly (cap/L)·L = cap. The cap is downside-only: the max/min leave a trigger already tighter than the cap untouched and can never flip it to the favourable side. The limit price is set past the trigger, favourably, so a market-on-trigger order always finds a fill — certainty over fee, because a stop that doesn't fill isn't a stop. Every guard fails open, returning T_raw unchanged: flag off, missing or zero entry / leverage / T_raw, cap ≤ 0, φ ≥ 1, or any exception. The min-distance guard is the exception that fails the other way — the capped level is tick-rounded, and if it rounds onto or past entry the original wider trigger is kept rather than placing an invalid too-close order.",
    values: [
      {
        label: "C_base",
        value: "0.10",
        note: "auto_config NATIVE_SL_CAP_PCT — a RAW FRACTION, gated by NATIVE_SL_CAP_ENABLED = true",
      },
      {
        label: "C_trim",
        value: "0.08",
        note: "auto_config STOP_TRIM_8_NATIVE_CAP_PCT — a RAW FRACTION, not the 8.0 of STOP_TRIM_8_PCT",
      },
      {
        label: "σ",
        value: "None today",
        note: "sleeves.SLEEVES[*].stop_pct (code constant), gated by PER_SLEEVE_EXIT_PROFILES — sleeve resolution returns nothing; see F-EXIT-13 and section 11",
      },
      {
        label: "s",
        value: "0.02",
        note: "auto_config LIVE_EXIT_SLIPPAGE_PCT",
      },
      {
        label: "tick rounding",
        value: "NATIVE_SL_ROUNDING_ENABLED = true",
        note: "auto_config, live",
      },
      {
        label: "resting oid",
        value: "auto_trades.native_sl_oid",
        note: "INTEGER, nullable. A value ≥ 9e12 is SYNTHETIC and does not exist on Hyperliquid — any coverage query must exclude it, or it will count a placeholder as protection",
      },
      {
        label: "proof it has never rested",
        value: "6 of 45 paper-window rows, all synthetic",
        note: "oids 9000000000002, …006, …010, …531, …556, …006 — every one at or above the 9e12 synthetic floor; 0 rows carry a native_tp_oid",
      },
    ],
    caveat:
      "UNIT TRAP ON THE CAPS — three keys, two conventions, all in the STOP-TRIM-8 family. C_base and C_trim are RAW FRACTIONS (0.10, 0.08); σ is a LEVERAGED PERCENT (8.0) and is divided by 100 at the call site; STOP_TRIM_8_PCT (F-EXIT-04) is a LEVERAGED PERCENT (8.0) with NO division. Any worked example must state which convention it is using, or it will be off by two orders of magnitude and look plausible.",
  },

  {
    id: "F-EXIT-06",
    name: "Native TP Trigger",
    status: "dormant",
    fired: "NEVER FIRED — 0 of 45 paper-window rows carry a native_tp_oid",
    statusNote:
      "The same paper skip as F-EXIT-05, plus it is optional even when armed: target_px = (_tp_px if _tp_px and _tp_px > 0 else None).",
    source: "live_executor._place_native_tp_order",
    tex: [
      R`T^{\text{TP}} = \texttt{signal\_data["target\_price"]},\qquad X^{\text{TP}} = T^{\text{TP}}`,
    ],
    symbols: [
      { sym: R`T^{\text{TP}}`, means: "take-profit trigger price" },
      {
        sym: R`X^{\text{TP}}`,
        means: "the limit price it rests at once triggered",
      },
    ],
    why:
      "There is no arithmetic here — the trigger price is the target price supplied by the entry signal, passed through unchanged apart from tick and size rounding. A take-profit is not urgent: if it doesn't fill, the position simply keeps running under the trail and ratchet. So it rests as a maker limit at the trigger and earns the maker rate (1.5 bps) instead of paying taker (4.5 bps). The stop makes the opposite trade-off for the opposite reason — a stop that doesn't fill is a catastrophe, so it accepts the taker fee for certainty. The two orders are asymmetric on purpose, and that asymmetry is the whole design: the SL derives a limit s away from its trigger and submits isMarket=True, while the TP submits isMarket=False with limit_px == triggerPx. If the rounded size collapses to ≤ 0 (a sub-tick remainder) the helper raises rather than submitting sz=0; the caller then records native_tp_oid = NULL and the resting SL backstops the remainder.",
    values: [
      {
        label: "T^TP",
        value: "no live value available",
        note: "and there never will be one: the target price is supplied per-signal as signal_data[\"target_price\"] at entry and is not persisted as a dedicated column, so the page has nothing to read. The entry signal owns its derivation (Family 1, and an open gap)",
      },
      {
        label: "rounding gate",
        value: "NATIVE_TP_ROUNDING_ENABLED = true",
        note: "auto_config, live",
      },
      {
        label: "resting oid",
        value: "0 non-NULL across the entire paper window",
        note: "auto_trades.native_tp_oid",
      },
    ],
    caveat:
      "The take-profit target price is rendered as “no live value available” rather than a number, and that is the honest state — it is permanently unavailable to this page because nothing persists it. A zero here would read as “the target is $0”, and a blank would read as “nobody checked”. Neither is true.",
  },

  {
    id: "F-EXIT-07",
    name: "Native SL Mirror (cancel-replace on every ratchet)",
    status: "dormant",
    fired: "NEVER FIRED — there is no resting oid to replace (see F-EXIT-05)",
    statusNote:
      "Dispatched from monitor.monitor_cycle immediately after the effective-stop write, under `if config_native_tpsl_on and new_effective_stop is not None:` — so it fires only on a cycle where the effective stop actually moved, and only when NATIVE_TPSL_ENABLED.",
    source: "live_executor.replace_native_sl",
    tex: [
      R`S_t \ne S_{t-1} \;\Longrightarrow\; \texttt{cancel}(\text{oid}_{t-1});\quad \text{oid}_t \leftarrow \texttt{place}\bigl(T^{\text{SL}}(S_t)\bigr)`,
    ],
    symbols: [
      { sym: R`S_t`, means: "the effective stop from F-EXIT-03" },
      {
        sym: R`\text{oid}_t`,
        means: "the exchange order id of the SL now resting",
      },
    ],
    why:
      "This is what keeps the two stop systems from diverging. There is no independent arithmetic — the new trigger is S_t from F-EXIT-03, re-run through the F-EXIT-05 cap. Without it the exchange would hold the entry stop forever while the bot ratcheted its own stop upward, and because a confirmed native SL suppresses the software Layer-1 stop (F-EXIT-15), every tightening the ratchet earned would be invisible to the thing actually enforcing the stop. stop_price is the single source of truth and is already monotonic; the mirror just makes the exchange agree with it. It self-heals a missing SL (old_oid = None places a fresh one) and never raises; on dispatch failure the bot stop poll is the fallback.",
    values: [
      {
        label: "gate",
        value: "NATIVE_TPSL_ENABLED = true",
        note: "auto_config, live — the flag is on and the path still does not run, because F-EXIT-05 leaves nothing to mirror",
      },
      {
        label: "new values",
        value: "none",
        note: "S_t comes from F-EXIT-03 and the cap keys from F-EXIT-05",
      },
    ],
    caveat:
      "RECORD CORRECTION, CARRIED FORWARD. CLAUDE.md's Known Issues says “Trail-mirror-to-native … is a candidate edge but unproven — must go through an observe-only shadow first (no direct live wiring).” That is stale: it IS directly wired, at monitor.monitor_cycle → live_executor.replace_native_sl, with no shadow flag. Its sibling replace_native_tp is likewise wired for the post-partial TP resize. The path is dormant because nothing arms a native SL today, not because it was never connected.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// F-EXIT-08 … F-EXIT-15
// ─────────────────────────────────────────────────────────────────────────────

const ENTRIES_08_15: FormulaEntryProps[] = [
  {
    id: "F-EXIT-08",
    name: "Partial Ladder: Rung Selection and Fraction",
    status: "paper",
    fired:
      "FIRED · 429 of 1792 closed trades took ≥1 partial (364 at depth 1, 65 at depth 2) — lifetime",
    statusNote:
      "monitor.evaluate_exit_signals stage 5, reachable under `_partials_on and notional_usd > 0`, with PARTIAL_EXIT_ENABLED and LIVE_PARTIALS_ENABLED = live true. At most one rung decision per cycle.",
    source:
      "monitor.evaluate_exit_signals → exit_helpers.get_active_partial_schedule / get_partial_schedule",
    tex: [
      R`i^\star=\min\Bigl\{\,i \ge n_{\text{taken}} \;:\; R_t \ge r_i \ \wedge\ \Gamma_{\text{floor}} \ \wedge\ \Gamma_{\text{dust}} \ \wedge\ \Gamma_{\text{fee}}\Bigr\}`,
      R`A_i = N_t\cdot f_i \quad\text{(fraction of REMAINING margin)}`,
      R`\Gamma_{\text{floor}}:\quad \texttt{rung\_clears\_floor}(R_t,\rho,P_e,\pi)`,
      R`\Gamma_{\text{dust}}:\quad \neg\Bigl(A_i < M_{\text{margin}} \ \wedge\ A_i\cdot L < M_{\text{HL}}\Bigr)`,
      R`\Gamma_{\text{fee}}:\quad A_i\cdot\frac{\text{pnl}_\%}{100} \;>\; 1.5\cdot\Bigl(A_i\cdot L\cdot \frac{\beta}{10^4}\Bigr)`,
    ],
    symbols: [
      { sym: R`i^\star`, means: "the rung that fires this cycle" },
      {
        sym: R`n_{\text{taken}}`,
        means: "auto_trades.partial_exits_taken — the ladder cursor",
      },
      {
        sym: R`(r_i, f_i)`,
        means:
          "rung i's R-trigger and fraction OF THE REMAINING position",
      },
      {
        sym: R`N_t`,
        means: "auto_trades.notional_usd — see the notional trap",
      },
      { sym: R`A_i`, means: "margin amount closed at this rung" },
      {
        sym: R`\pi`,
        means: "minimum-profit-target floor (raw price fraction)",
      },
      { sym: R`M_{\text{margin}}`, means: "margin-denominated dust floor" },
      { sym: R`M_{\text{HL}}`, means: "Hyperliquid minimum order value" },
      { sym: R`\beta`, means: "modelled round-trip fee, in bps" },
    ],
    why:
      "A scalp book's problem is not that winners are too small — it is that winners become losers. The audit that motivated this ladder found 18.5% of trades went green then closed red, giving back ~1.9 pp. Banking a fraction at a modest R converts unrealised profit into realised profit before the market can take it back, while leaving a runner to capture the rare large move. The rungs are deliberately low because the measured exit_peak_r distribution is brutal: 82.8% of trades never exceed 0.25R, so a ladder starting at 0.75R fires on ~1% of trades and is effectively inert. Fractions are of the REMAINING position, which is why rung 2's 0.5833 banks only 35% of the original. The three gates are three different ways a partial can be worse than useless: Γ_floor blocks a rung whose raw move hasn't cleared the fee-plus-headroom floor; Γ_dust blocks a slice the exchange would reject; Γ_fee blocks a slice whose profit doesn't beat 1.5× its own round trip. The 1.5× is a headroom multiplier, not a break-even test — banking exactly the fee is a wash that costs an option on the runner. Rungs already taken are skipped by index, which is why partial_exits_taken is the ladder's cursor rather than a counter.",
    values: [
      {
        label: "active ladder",
        value: "[(0.25, 0.40), (0.5, 0.5833)]",
        note: "code constant config.S1_PARTIAL_SCHEDULE, selected when PARTIAL_LADDER_S1_ENABLED = live true. Rung 1 banks 40% of original; rung 2 banks 35% of original (0.35/0.60 = 0.5833 of the 60% left); the runner is 25% of original",
      },
      {
        label: "legacy ladder",
        value: "[(0.75, 0.33), (1.5, 0.50)]",
        note: "code constant config.PARTIAL_EXIT_SCHEDULE — the rollback path",
      },
      {
        label: "per-ticker",
        value: "BTC · ETH · SOL · HYPE · FARTCOIN, all [(0.75, 0.33), (1.5, 0.50)]",
        note: "code constant exit_helpers.TICKER_PARTIAL_SCHEDULES, gated by PARTIAL_V2 = live true",
      },
      {
        label: "M_margin",
        value: "3.00",
        note: "code constant config.PARTIAL_EXIT_MIN_USD — USD of margin",
      },
      {
        label: "M_HL",
        value: "10.0",
        note: "code constant risk_sizing.HL_MIN_ORDER_USD — USD of order value, gated by PARTIAL_GATE_LEVERAGE_AWARE = true",
      },
      {
        label: "β",
        value: "9",
        note: "code constant config.FEE_RATE_BPS",
      },
      {
        label: "π",
        value: "0.0018",
        note: "code constant config.MIN_PROFIT_TARGET_FLOOR_PCT = HL_FEE_ENTRY_TAKER_EXIT_MAKER × MIN_PROFIT_TARGET_FLOOR_MULT = 0.0006 × 3.0 — 18 bps, raised at runtime by the funding-aware floor when FUNDING_COST_AWARE_ENABLED = true (see F-FEE-15)",
      },
      {
        label: "depth distribution",
        value: "SELECT partial_exits_taken, COUNT(DISTINCT id) … GROUP BY partial_exits_taken",
        note: "auto_trades WHERE status='closed'",
      },
    ],
    caveat:
      "NOTIONAL TRAP — this entry touches position size. auto_trades.notional_usd IS THE POSTED MARGIN, not position notional. Real exchange order value is notional_usd × leverage. Dividing notional_usd by leverage gives a ~7× wrong figure and has already bitten the Hub once. The code is explicit about it: the dust gate compares A_i against a MARGIN floor AND A_i × L against the HL ORDER-VALUE minimum, because those are two different quantities. notional_usd is also decremented by each partial, so it is not a stable denominator across a trade's life — use original_notional_usd for anything spanning the whole position.",
  },

  {
    id: "F-EXIT-09",
    name: "ATR-Multiple Rung-1 Override",
    status: "paper",
    fired:
      "FIRED indirectly, via every rung-1 partial — the override has no independent fire counter",
    statusNote:
      "Called from monitor.evaluate_exit_signals stage 5 as `from exit_engine import calculate_dynamic_target` — the module lives at the repo root, not under auto_trader/. Gated by ATR_TP_RUNG1_ENABLED = live true, plus current_atr > 0 ∧ ρ > 0 ∧ entry > 0.",
    source: "exit_engine.calculate_dynamic_target",
    tex: [
      R`R_{\text{base}} = \begin{cases}2.0 & L \ge 5\\ 3.0 & L < 5\end{cases}
\qquad
m_{\text{regime}} = \begin{cases}1.5 & \text{TRENDING}\\ 1.2 & \text{VOLATILE}\\ 0.7 & \text{RANGING}\\ 1.0 & \text{otherwise}\end{cases}`,
      R`m_{\text{conf}} = \begin{cases}1.3 & c \ge 75\\ 1.0 & 60 \le c < 75\\ 0.7 & c < 60\end{cases}
\qquad
D = \frac{\text{ATR}\cdot R_{\text{base}}\,m_{\text{regime}}\,m_{\text{conf}}}{\sqrt{L}}`,
      R`P^{\text{tgt}} = P_e + D\ (\text{LONG}),\qquad P^{\text{tgt}} = P_e - D\ (\text{SHORT})`,
      R`r_{\text{floor}} = \frac{\pi\,P_e}{\rho},\qquad
r_1 = \max\!\left(r_{\text{floor}},\ \frac{\bigl|P^{\text{tgt}} - P_e\bigr|}{\rho}\right)`,
      R`r_1 \leftarrow r_2\cdot 0.999 \quad\text{if } r_1 \ge r_2 > r_{\text{floor}}\qquad\text{(preserve ladder ordering)}`,
    ],
    symbols: [
      {
        sym: R`c`,
        means:
          "the entry signal's confidence (0–100), defaulted to 50.0 when absent",
      },
      {
        sym: R`m_{\text{conf}}`,
        means:
          "the confidence multiplier — the subject of standing decision G-3",
      },
      { sym: R`D`, means: "target distance in price units" },
      {
        sym: R`r_1`,
        means: "rung-1 R-trigger after the override",
      },
      { sym: R`r_2`, means: "rung-2 R-trigger, unchanged by the override" },
    ],
    why:
      "A fixed R-trigger assumes every trade's risk unit means the same thing. It doesn't: ρ comes from the entry stop, while how far price can realistically travel comes from volatility. Scaling the first take-profit by ATR makes the rung adapt to the instrument and the day. The /√L term is the subtle part — at higher leverage the same price move is a much larger P&L move, so the absolute distance to a worthwhile target shrinks; the square root is a deliberately gentle discount rather than a linear one. The final max(r_floor, …) is the single floor authority: the fee floor can raise the rung, but the ATR calculation can never push it below the fee floor. The whole thing degrades to the static ladder rather than failing — it returns a no-op dict (target_price = None) when entry ≤ 0 or ATR ≤ 0, and any exception logs [ATR-TP] at INFO and falls back the same way.",
    values: [
      {
        label: "gate",
        value: "ATR_TP_RUNG1_ENABLED = true",
        note: "auto_config, live",
      },
      {
        label: "R_base, m_regime, m_conf bands",
        value: "code constants in exit_engine.calculate_dynamic_target",
        note: "literal dict / if-else values — no config surface at all",
      },
      {
        label: "c",
        value: "auto_trades.confidence, default 50.0",
        note: "per-trade, trade-derived",
      },
      {
        label: "ATR",
        value: "computed at runtime, not persisted",
        note: "despite the parameter name atr_14, the caller supplies current_atr computed at config.ATR_TRAIL_PERIOD = 10 — the NAME IS STALE. The value is exposed as atr_at_update and persisted to auto_trades.atr_at_update",
      },
      {
        label: "resulting r_1",
        value: "eval-result key atr_tp_rung1_r",
        note: "not a column",
      },
      { label: "π", value: "0.0018", note: "as F-EXIT-08" },
    ],
    caveat:
      "THE CONFIDENCE MULTIPLIER IS LIVE AND HAS NOT BEEN RE-VALIDATED. m_conf's input comes from the same confidence signal that R4 struck from the entry fire-path as anti-predictive. It is live and reachable here, on the exit side, and nobody has re-checked whether it earns its place. Recorded, not adjudicated — this is a flag for a decision, not a claim that the multiplier is wrong.",
  },

  {
    id: "F-EXIT-10",
    name: "The ATR / Chandelier Trail (Layer 4)",
    status: "paper",
    fired: "FIRED · n=36 lifetime (exit_layer = 4) · 0 in the paper era",
    statusNote:
      "The layer works and simply has not been exercised recently: all 36 fires are lifetime, none of them in the paper era. Do not read the lifetime count as current evidence. Called from monitor.evaluate_exit_signals stage 4, gated by ATR_TRAIL_ENABLED = live true.",
    source: "exit_helpers.compute_effective_stop",
    tex: [
      R`d_{\text{atr}} = \text{ATR}\cdot k,\qquad d_{\text{ch}} = \text{ATR}\cdot k_{\text{ch}},\qquad d_{\text{floor}} = P^{\text{fav}}_t\cdot \mu`,
      R`d^\star = \max\Bigl(\min(d_{\text{atr}},\,d_{\text{ch}}),\ d_{\text{floor}}\Bigr)`,
      R`S^{\text{trail}}_t = \begin{cases}
\max\bigl(P^{\text{fav}}_t - d^\star,\ S_{t-1}\bigr) & \text{LONG}\\[2pt]
\min\bigl(P^{\text{fav}}_t + d^\star,\ S_{t-1}\bigr) & \text{SHORT}
\end{cases}`,
      R`\phi_R = \mathrm{clip}\!\left(\frac{R_t - R_{\text{start}}}{R_{\text{full}} - R_{\text{start}}},\,0,\,1\right),
\qquad
k = \mathrm{clip}\Bigl(k_{\text{band}} - \phi_R\bigl(k_{\text{band}} - k_{\text{min}}\bigr),\ k_{\text{lo}},\ k_{\text{hi}}\Bigr)`,
      R`p = \max(\mu_{\text{cfg}},\ 0.01\cdot k_{\text{legacy}}),\qquad
S^{\text{trail}}_t = P^{\text{fav}}_t(1-p)\ (\text{LONG}),\quad P^{\text{fav}}_t(1+p)\ (\text{SHORT})`,
    ],
    symbols: [
      {
        sym: R`\text{ATR}`,
        means: "live ATR on 5 m bars, in PRICE UNITS (not %)",
      },
      { sym: R`k`, means: "effective ATR multiplier" },
      { sym: R`k_{\text{ch}}`, means: "Chandelier multiplier" },
      { sym: R`\mu`, means: "minimum trail floor, a fraction OF PEAK" },
      { sym: R`d^\star`, means: "effective trail distance" },
      {
        sym: R`\phi_R`,
        means: "how far the trade has progressed through the profit-step band",
      },
      {
        sym: R`k_{\text{legacy}}`,
        means:
          "the legacy-fallback multiplier, used when ATR_TRAIL_ENABLED is off or the ATR helper raises",
      },
    ],
    why:
      "Three mechanisms answer three different failure modes. The ATR term sizes the trail to current volatility so a quiet market isn't given the same room as a violent one. The Chandelier term caps that at a fixed multiple so an ATR spike can't hand a winner unlimited room. The floor stops the trail strangling the position when ATR collapses — without it, a low-volatility patch would place the stop so close to the peak that ordinary noise closes the trade. The profit-step tightening (φ_R) is the intuition that a trade already deep in profit has more to lose than to gain from another wide swing, so the trail tightens as R grows. The reported exit_type is “atr_trail” when d_atr ≤ d_ch and “chandelier” otherwise, overwritten to “min_floor” when the floor binds; the helper's own ratchet clause applies only when the current stop is above zero. The legacy fallback tightens k_legacy to 1.5 once R^peak reaches 2.0.",
    values: [
      {
        label: "k_ch",
        value: "3.0",
        note: "code constant exit_helpers.CHANDELIER_MULTIPLIER",
      },
      {
        label: "μ (V3, live)",
        value: "BTC 0.003 · ETH 0.003 · SOL 0.003 · HYPE 0.005 · FARTCOIN 0.007",
        note: "code constant exit_helpers.TICKER_TRAIL_FLOORS_V3, selected by TRAIL_V3_PROMOTED = live true",
      },
      {
        label: "μ (V2)",
        value: "BTC 0.015 · ETH 0.015 · SOL 0.015 · HYPE 0.020 · FARTCOIN 0.025",
        note: "code constant exit_helpers.TICKER_TRAIL_FLOORS, gated by WIDE_STOPS_V2 = true",
      },
      {
        label: "μ_cfg (global)",
        value: "0.015",
        note: "code constant config.TRAIL_MIN_PCT",
      },
      {
        label: "k_band",
        value: "low 1.0 · normal 1.5 · high 2.0",
        note: "code constant exit_helpers.ATR_BAND_MULTIPLIERS, banded by ATR_BAND_THRESHOLDS = {major [0.0015, 0.004], mid [0.0025, 0.006], memecoin [0.004, 0.01], default [0.0025, 0.006]}",
      },
      {
        label: "k_min, k_lo, k_hi",
        value: "1.0 · 1.0 · 2.0",
        note: "code constants exit_helpers.PROFIT_STEP_FLOOR_MULT, VOL_ADAPTIVE_MULT_MIN, VOL_ADAPTIVE_MULT_MAX — the vol-adaptive path is live under VOL_ADAPTIVE_EXITS_ENABLED = true",
      },
      {
        label: "R_start, R_full",
        value: "0.5 · 2.0",
        note: "code constants exit_helpers.PROFIT_STEP_START_R, PROFIT_STEP_FULL_R",
      },
      {
        label: "ATR period",
        value: "10",
        note: "code constant config.ATR_TRAIL_PERIOD",
      },
      {
        label: "k_legacy",
        value: "2.0",
        note: "code constant config.TRAIL_ATR_MULTIPLIER; tighten flag config.TRAIL_TIGHTEN_AT_2R = True",
      },
      {
        label: "trail arm",
        value: "0.5",
        note: "code constant config.TRAIL_ACTIVATION_R; per-ticker exit_helpers.TICKER_TRAIL_ACTIVATION_R is a uniform 0.5, gated by TRAIL_V2 = true",
      },
      {
        label: "per-trade forensics",
        value: "auto_trades.trail_type · .trail_multiplier · .atr_at_update",
      },
    ],
    caveat:
      "TWO THINGS READERS GET WRONG HERE. First: the floor is a percentage OF PEAK, not of entry — d_floor = P^fav · μ, so as the peak advances the floor distance grows in absolute terms and the trail WIDENS with the move rather than strangling a runner. Second: Layer 4 is largely shadowed by Layer 1. The trail's output is persisted into stop_price by F-EXIT-03, and Layer 1 runs first on the NEXT cycle — so a persisted trail comes back as stop_hit, not trailing_stop. Layer 4 wins outright only on an intra-cycle cross. That is why trailing_stop shows 36 lifetime fires against stop_hit's 62, and 0 in the paper era: a real property of the engine, not a data gap.",
  },

  {
    id: "F-EXIT-11",
    name: "Stale Exit (Layer 6.5)",
    status: "live",
    overlay: "paper",
    fired: "FIRED · n=111 lifetime, 15 in the paper era",
    statusNote:
      "Badged LIVE because the lifetime count includes real-money fires on the live book; the paper overlay is today's gate, so a fire now closes a simulated fill. monitor.evaluate_exit_signals stage 6.5, gated by config.STALE_TRADE_EXIT_ENABLED = True.",
    source: "monitor.evaluate_exit_signals → exit_helpers.get_stale_minutes",
    tex: [
      R`a_t = \frac{\texttt{now()} - t_{\text{open}}}{60}\ \text{minutes}`,
      R`\text{FIRE} \iff \bigl(a_t \ge \Theta_{\text{stale}}\bigr)\ \wedge\ \bigl(R^{\text{peak}}_t < \theta_R\bigr)`,
    ],
    symbols: [
      { sym: R`a_t`, means: "position age in minutes" },
      { sym: R`\Theta_{\text{stale}}`, means: "staleness threshold" },
      {
        sym: R`\theta_R`,
        means:
          "peak-R ceiling — above this the trade is not “drifting” and is spared",
      },
      { sym: R`t_{\text{open}}`, means: "auto_trades.opened_at (naive Eastern)" },
    ],
    why:
      "A position open for over an hour that has never reached even half a risk-unit of profit is not “developing” — it is dead capital occupying a concurrency slot and paying funding. The two-part predicate is what makes it safe: the age test alone would kill winners that simply take time, so the R^peak < θ_R clause spares anything that has demonstrably worked at some point. R^peak (not current R) is used precisely so a winner that has since retraced is still protected from being culled as stale.",
    values: [
      {
        label: "Θ_stale (global)",
        value: "75 minutes",
        note: "code constant config.STALE_TRADE_MINUTES — cut 120 → 75 by G3-STALE-75M (2026-06-29)",
      },
      {
        label: "Θ_stale (per-ticker)",
        value: "BTC 75 · ETH 75 · SOL 75 · HYPE 75 · FARTCOIN 75",
        note: "code constant exit_helpers.TICKER_STALE_MINUTES — only 5 of the 10 sacred tickers; the rest ride the default. Gated by STALE_V2 = live true",
      },
      {
        label: "θ_R",
        value: "0.5",
        note: "code constant config.TRAIL_ACTIVATION_R — the stale gate reuses the trail-activation constant",
      },
      {
        label: "t_open",
        value: "auto_trades.opened_at",
        note: "naive EASTERN — see the caveat",
      },
      {
        label: "reason string",
        value: 'f"stale_{int(a_t)}min"',
        note: "parameterised by the observed age, which is why stale_75min, stale_90min, stale_139min and stale_4222min are ALL Layer 6.5 — a distinct exit_reason count is NOT a layer count",
      },
      {
        label: "fire counts",
        value: "SELECT COUNT(DISTINCT id) … WHERE status='closed' AND exit_layer=65",
      },
    ],
    caveat:
      "CLOCK TRUTH. opened_at is parsed with datetime.strptime(s, \"%Y-%m-%d %H:%M:%S\") — NAIVE EASTERN — and differenced against datetime.now(), which is naive local (ET) on that box. Both operands are on the same clock, so the age is correct. Any worked example that converts opened_at to UTC first will be 4 hours wrong. For contrast auto_trades.created_at, equity_snapshots.ts and auto_config.updated_at are REAL UTC — never difference one of those against opened_at or closed_at without converting.",
  },

  {
    id: "F-EXIT-12",
    name: "Timeout Backstop (Layer 7)",
    status: "live",
    overlay: "paper",
    fired: "FIRED · n=21 lifetime, 1 in the paper era",
    statusNote:
      "Badged LIVE because the lifetime count includes real-money fires on the live book; the paper overlay is today's gate. monitor.evaluate_exit_signals stage 7 — unconditional on R, and the last statement in the evaluator before it returns.",
    source: "monitor.evaluate_exit_signals → exit_helpers.get_timeout_minutes",
    tex: [
      R`\text{FIRE} \iff a_t \ge \Theta_{\text{timeout}}`,
      R`\underbrace{R^{\text{peak}} < 0.5}_{\text{Layer 6.5 requires}} \quad\text{vs.}\quad \underbrace{R^{\text{peak}} \ge 0.5}_{\text{partial rung 2 requires}}`,
    ],
    symbols: [
      { sym: R`a_t`, means: "position age in minutes, as F-EXIT-11" },
      { sym: R`\Theta_{\text{timeout}}`, means: "timeout threshold" },
    ],
    why:
      "The two thresholds are numerically equal (75 == 75), so Layer 6.5 — which runs first — would appear to consume every trade Layer 7 could take. It does not, and the reason is structural: Layer 6.5 requires R^peak < 0.5, and taking partial rung 2 requires R^peak ≥ 0.5. Those predicates are exactly complementary. A trade that has taken partial rung 2 has by definition passed 0.5R, so Layer 6.5 can never close it — Layer 7 is its only time-based exit. Both post-convergence timeout fires carry partial_exits_taken = 2, including the paper-era timeout_4435min (id 101758, closed 2026-08-03). The better the partial ladder works, the more load-bearing Layer 7 becomes.",
    values: [
      {
        label: "Θ_timeout (global)",
        value: "75 minutes",
        note: "code constant config.TIMEOUT_MINUTES — cut 120 → 75 by G3-STALE-75M (2026-06-29)",
      },
      {
        label: "Θ_timeout (per-ticker)",
        value: "BTC 75 · ETH 75 · SOL 75 · HYPE 75 · FARTCOIN 75",
        note: "code constant exit_helpers.TICKER_TIMEOUTS — 5 of 10, gated by TIMEOUT_V2 = live true",
      },
      {
        label: "a_t clock",
        value: "naive Eastern throughout",
        note: "the age is built from auto_trades.opened_at (naive ET) against datetime.now() (naive local ET) — same clock, so the duration is correct. created_at is real UTC and sits 4 hours away; never mix them",
      },
      {
        label: "fire counts",
        value: "SELECT COUNT(DISTINCT id) … WHERE status='closed' AND exit_layer=7",
      },
    ],
    caveat:
      "THE FIVE-SURFACE stale == timeout INVARIANT. Θ_stale == Θ_timeout holds on EVERY configuration surface — config.*, exit_helpers.*, ticker_exit_profiles GLOBAL_DEFAULTS and per-ticker, the scalp sleeve profile, and the other three sleeves (equal by construction, both defaulting to horizon.max_minutes). Moving one without the other silently RE-ORDERS the exit engine: stale > timeout makes Layer 7 win outright, stale < timeout makes Layer 7 go dark. This is a threshold change under the Moratorium, not a cleanup.",
  },

  {
    id: "F-EXIT-13",
    name: "Per-Sleeve Exit Profile Resolution",
    status: "dormant",
    fired: "NEVER FIRED — auto_trades.sleeve is NULL on 1793 of 1793 rows",
    statusNote:
      "Consumed by monitor._resolve_position_sleeve (the Layer 0.5 / stale / timeout / ratchet-ladder overrides) and by live_executor._resolve_sleeve_stop_pct (the native-SL cap, F-EXIT-05). Both call sites are live; the resolver returns None every time.",
    source: "sleeves.resolve_sleeve / sleeves.active_sleeves",
    tex: [
      R`\mathrm{Sleeve}(T) = \begin{cases}
s \in \texttt{SLEEVES} & \text{if } T[\texttt{sleeve}] \text{ is a non-blank str} = s.\text{name}\\
\texttt{None} & \text{otherwise}
\end{cases}`,
      R`\texttt{active\_sleeves}(\ell) = \bigl(s \in \texttt{SLEEVES} : s.\texttt{enabled\_at\_level} \le \ell\bigr)`,
    ],
    symbols: [
      { sym: R`T`, means: "the trade row being resolved" },
      { sym: R`\ell`, means: "the current rebuild level" },
      {
        sym: R`s.\texttt{enabled\_at\_level}`,
        means: "the level at or above which a sleeve becomes active",
      },
    ],
    why:
      "When a sleeve resolves, its stop_pct replaces H_eff at Layer 0.5 and tightens the native SL cap (σ in F-EXIT-05); its stale_minutes, timeout_minutes, stale_peak_r, breakeven_activation_r, momentum_floor, partials_enabled and ratchet_ladder replace the corresponding globals. So a sleeve is not a separate exit engine — it is a set of per-horizon substitutions into the one engine described above. Nothing resolves today, so every one of those substitutions is currently the global value.",
    values: [
      {
        label: "per-sleeve stop_pct",
        value: "scalp 8.0 · short_hold 8.0 · intraday_24h 10.0 · multiday_week 12.0",
        note: "leveraged %. Code constants in sleeves.SLEEVES with no auto_config surface — rendered in full alongside lmax_fraction in section 11",
      },
      {
        label: "proof 1 — level",
        value: "MAX(level) = 0",
        note: "rebuild_tracker.db, 1 row in levels. Every sleeve declares enabled_at_level = 1, so active_sleeves(0) → () — verified by execution, not by reading; active_sleeves(1) → ('scalp', 'short_hold', 'intraday_24h', 'multiday_week')",
      },
      {
        label: "proof 2 — tagging",
        value: "SLEEVE_TAGGING_ENABLED = 'false'",
        note: "auto_config, 2026-07-24 17:06:55 — nothing ever writes the tag; live_executor._resolve_entry_sleeve returns None on its first line",
      },
      {
        label: "proof 3 — the data",
        value: "auto_trades.sleeve NULL on 1793 of 1793 rows",
        note: "every row in the table. resolve_sleeve({}) returns None, verified by execution",
      },
      {
        label: "proof 4 — the chain",
        value: "three flips needed, not one",
        note: "the R5/R6 consumer chain — see F-SIZE-13 and section 4",
      },
      {
        label: "PER_SLEEVE_STOP_ENABLED readers",
        value: "UNKNOWN",
        note: "a prior collector measurement found its only tree reference is scripts/cutover_flip.py, which SETS it — so it may have zero readers at all. Not independently re-derived: flagged UNKNOWN, not asserted",
      },
      {
        label: "go-live consequence",
        value: "more trades escape Layer 6.5 into Layer 7",
        note: "three of the four sleeve profiles set stale_peak_r BELOW 0.5 — short_hold 0.20, intraday_24h 0.30 (multiday_week 0.5, scalp 0.5). Once sleeve tagging arms, that is a REACHABILITY change, not a tuning change",
      },
    ],
    caveat:
      "NOT ONE POSITION HAS EVER BEEN MANAGED PER-SLEEVE. Four independent proofs are listed above, all measured at the same HEAD, and two separate recon passes measured them separately and agree exactly. PER_SLEEVE_EXIT_PROFILES = 'true' and PER_SLEEVE_STOP_ENABLED = 'true' are ON and doing nothing. A flag reading true is not evidence a path runs.",
  },

  {
    id: "F-EXIT-14",
    name: "Momentum Exit (Layer 6)",
    status: "paper",
    fired:
      "FIRED · n=752 lifetime, 5 in the paper era — the most-fired layer of all time",
    statusNote:
      "monitor.calculate_momentum_score + monitor.evaluate_exit_signals stage 6, floor raised by monitor.apply_native_lean_floor. Gated by MOMENTUM_EXIT_ENABLED = true. The indicator inputs themselves belong to Family 1; what follows is the exit-decision math only.",
    source: "monitor.calculate_momentum_score",
    tex: [
      R`C = \sum_{j} w_j\,x_j,\qquad C_{\text{int}} = \mathrm{clip}\bigl(\mathrm{round}(C),\,0,\,100\bigr)`,
      R`\text{tier} = \begin{cases}
\text{HOLD} & C_{\text{int}} > 70\\
\text{TIGHTEN} & \tau < C_{\text{int}} \le 70\\
\text{EXIT} & C_{\text{int}} \le \tau
\end{cases}`,
      R`F_{\text{eff}} = \max\bigl(F_{\text{resolved}},\ F_{\text{lean}}\bigr),
\qquad
\text{FIRE} \iff \text{tier}=\text{EXIT}\ \wedge\ C_{\text{int}} \ge F_{\text{eff}}\ \wedge\ \text{(min-hold + confirm + fee gates)}`,
    ],
    symbols: [
      { sym: R`C`, means: "the weighted composite momentum score" },
      {
        sym: R`x_j`,
        means: "factor j's sub-score, each in [0, 100], so C ∈ [0, 100] by construction",
      },
      { sym: R`w_j`, means: "factor j's weight — the five below sum to 1.00" },
      { sym: R`\tau`, means: "the EXIT/TIGHTEN threshold" },
      {
        sym: R`F_{\text{resolved}}`,
        means: "the resolved per-ticker momentum floor",
      },
      { sym: R`F_{\text{lean}}`, means: "the native-lean floor" },
      {
        sym: R`F_{\text{eff}}`,
        means: "the effective floor — the more protective of the two",
      },
    ],
    why:
      "A naive reading says “exit when momentum is weakest” — the lower C, the more urgent the exit. The measured data says the opposite: over n=506, composites 50/52/53 bled −$57.9 while composite 54 was roughly breakeven, and the trades left alone to hit the exchange-native bracket earned. So the engine BLOCKS the momentum exit below F_eff and lets the position ride to the trail or hard stop instead. The firing band is therefore a WINDOW [F_eff, τ], not a tail — exit when momentum has faded enough to matter but not so far that you are booking a loss the trail would have handled better. This is why every recent Layer-6 fire reads momentum_exit_54: the live floor is 54 and the live threshold is 55, so the window is two integers wide.",
    values: [
      { label: "w · rsi_trend", value: "0.25", note: "code constant monitor._MOMENTUM_WEIGHTS" },
      { label: "w · price_vs_ema", value: "0.25" },
      { label: "w · volume", value: "0.20" },
      { label: "w · candle_structure", value: "0.15" },
      { label: "w · profit_acceleration", value: "0.15", note: "the five sum to exactly 1.00" },
      {
        label: "τ",
        value: "55",
        note: "auto_config MOMENTUM_EXIT_THRESHOLD_LIVE (code fallback 55)",
      },
      {
        label: "display threshold",
        value: "55",
        note: "auto_config MOMENTUM_EXIT_THRESHOLD_DISPLAY",
      },
      {
        label: "F_resolved",
        value: "50 · per-ticker BTC 50 · ETH 50 · SOL 52 · HYPE 50 · FARTCOIN 50",
        note: "auto_config MOMENTUM_EXIT_FLOOR = 50; per-ticker code constant monitor.MOMENTUM_FLOOR_BY_TICKER, gated by MOMENTUM_FLOOR_V2 = true",
      },
      {
        label: "F_lean",
        value: "54",
        note: "auto_config LAYER6_NATIVE_LEAN_FLOOR, gated by LAYER6_NATIVE_LEAN_ENABLED = true",
      },
      {
        label: "F_eff (resolved)",
        value: "54",
        note: "max(50 or 52, 54) — 54 for all 10 tickers",
      },
      {
        label: "HOLD edge",
        value: "70",
        note: "hardcoded in calculate_momentum_score, deliberately not configurable",
      },
      {
        label: "min hold",
        value: "900 s",
        note: "auto_config MOMENTUM_MIN_HOLD_SECONDS",
      },
      {
        label: "confirm cycles",
        value: "2",
        note: "auto_config MOMENTUM_EXIT_CONFIRM_CYCLES (MOMENTUM_EXIT_CONFIRM_SHADOW = true)",
      },
      {
        label: "score at exit",
        value: "auto_trades.exit_momentum_score",
        note: "int; .exit_momentum_score_raw carries the pre-clamp float",
      },
    ],
    caveat:
      "TWO READING TRAPS. The reason string is parameterised as f\"momentum_exit_{C_int}\", which is why 20 distinct momentum_exit_NN reasons all belong to this ONE layer — counting reasons is not counting layers. And any exception in the aggregator returns 70, which is HOLD: a momentum-library crash can never auto-exit a position, so an absence of Layer-6 fires is not by itself evidence the scorer is healthy.",
  },

  {
    id: "F-EXIT-15",
    name: "The Software Stop (Layer 1)",
    status: "paper",
    fired:
      "FIRED · n=62 lifetime, 24 in the paper era — the most-fired layer of the paper era",
    statusNote:
      "monitor.evaluate_exit_signals stage 1. This is the stop that is actually enforcing every open position today, on the ~30 s poll — see the callout above.",
    source: "monitor.evaluate_exit_signals",
    tex: [
      R`\text{FIRE} \iff \bigl(S_t > 0\bigr)\ \wedge\ \neg\,\eta\ \wedge\ \begin{cases}P_t \le S_t & \text{LONG}\\ P_t \ge S_t & \text{SHORT}\end{cases}`,
    ],
    symbols: [
      { sym: R`S_t`, means: "the effective stop from F-EXIT-03" },
      {
        sym: R`\eta`,
        means:
          "native_sl_active — a confirmed reduce-only SL resting on Hyperliquid for this trade",
      },
    ],
    why:
      "When a native SL is confirmed resting, the exchange fires it on mark, continuously. Leaving the software stop armed too would give two references for one protective intent and let them double-fire — the exchange closes the position, the bot's next poll still sees a breach and issues a second close. So the native SL becomes primary and the software stop becomes fallback only. The moment the native SL is not confirmed (flag off, placement failed, already fired, reconcile gap, or a synthetic oid), η is False and Layer 1 fires exactly as it always did. Layer 0.5 above and every layer below stay active regardless — η suppresses one layer, not the engine.",
    values: [
      {
        label: "S_t",
        value: "auto_trades.stop_price",
        note: "per-trade, written by F-EXIT-03",
      },
      {
        label: "η",
        value: "computed per cycle, not persisted",
        note: "produced by live_executor.reconcile_native_triggers(open_trades) → {trade_id: bool}, which returns {} when NATIVE_TPSL_ENABLED is off. Determined by whether auto_trades.native_sl_oid appears in info.frontend_open_orders for that coin",
      },
      {
        label: "η today",
        value: "False for every open position",
        note: "no native SL is armed under the paper window (F-EXIT-05), so this layer is never suppressed — it is the working stop",
      },
    ],
    caveat:
      "A SYNTHETIC OID IS DEMOTED TO UNKNOWN, WHICH RESOLVES η TO False. An oid ≥ 9e12 does not exist on Hyperliquid, so the reconciler refuses to treat it as confirmed protection and Layer 1 stays armed. That is the safe direction, and it is the reason the paper window still has a working stop at all — but it also means a placeholder oid in the column is never evidence that anything is resting on the exchange.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Section 11 — the four-sleeve registry, and the inertness line it must never
// be shown without
// ─────────────────────────────────────────────────────────────────────────────

interface SleeveRow {
  name: string;
  lmaxFraction: string;
  stopPct: string;
  sizeBand: string;
  horizon: string;
  level: string;
  mode: string;
  tickers: string;
}

/** sleeves.SLEEVES, mirrored at bcbce58. Ordered by ascending horizon. */
const SLEEVE_ROWS: SleeveRow[] = [
  {
    name: "scalp",
    lmaxFraction: "0.50",
    stopPct: "8.0",
    sizeBand: "0.05 – 0.30",
    horizon: "1 – 60",
    level: "1",
    mode: "LIVE",
    tickers: "BTC, ETH, SOL, HYPE, ZEC",
  },
  {
    name: "short_hold",
    lmaxFraction: "0.40",
    stopPct: "8.0",
    sizeBand: "0.05 – 0.30",
    horizon: "60 – 360",
    level: "1",
    mode: "LIVE",
    tickers: "BTC, ETH, SOL, HYPE, ZEC",
  },
  {
    name: "intraday_24h",
    lmaxFraction: "0.30",
    stopPct: "10.0",
    sizeBand: "0.10 – 0.40",
    horizon: "360 – 1440",
    level: "1",
    mode: "LIVE",
    tickers: "BTC, ETH, SOL, HYPE, ZEC, PAXG, XMR",
  },
  {
    name: "multiday_week",
    lmaxFraction: "0.20",
    stopPct: "12.0",
    sizeBand: "0.10 – 0.50",
    horizon: "1440 – 10080",
    level: "1",
    mode: "SHADOW",
    tickers: "BTC, ETH, SOL, HYPE, ZEC, PAXG, XMR",
  },
];

const SLEEVE_COLUMNS = [
  "Sleeve",
  "lmax_fraction",
  "stop_pct",
  "Size band",
  "Horizon (min)",
  "Level",
  "Mode",
  "Tickers",
] as const;

/**
 * 🚨 THE TABLE AND ITS INERTNESS LINE ARE ONE COMPONENT ON PURPOSE. The master
 * warns that the page must never show half of this. Rendering the registry
 * without the status line below would teach Ghost that his positions are
 * managed per-sleeve; rendering the status line without the registry would
 * leave the reader with nothing to attach it to.
 */
function SleeveRegistry() {
  return (
    <div className="space-y-4">
      <article
        id="F-SLEEVE-REGISTRY"
        className="scroll-mt-24 rounded-lg border border-border-subtle bg-bg-card p-4 sm:p-5"
      >
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-micro text-fg-dim">
              sleeves.SLEEVES
            </span>
            <h3 className="text-h3 text-fg-primary">The four sleeves</h3>
            <span className="font-mono text-micro text-fg-muted">
              NEVER APPLIED — 0 of 1793 rows tagged
            </span>
          </div>
          <p className="font-mono text-caption text-fg-dim break-all">
            auto_trader.sleeves.SLEEVES · mirrored at {MIRRORED_FROM}
          </p>
        </header>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-caption">
            <thead>
              <tr className="border-b border-border-subtle text-left">
                {SLEEVE_COLUMNS.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="py-2 pr-4 font-mono text-micro font-normal text-fg-dim"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLEEVE_ROWS.map((s) => (
                <tr key={s.name} className="border-b border-border-subtle/60">
                  <td className="py-2 pr-4 font-mono text-fg-primary">
                    {s.name}
                  </td>
                  <td className="py-2 pr-4 font-mono text-fg-primary tabular-nums">
                    {s.lmaxFraction}
                  </td>
                  <td className="py-2 pr-4 font-mono text-fg-primary tabular-nums">
                    {s.stopPct}
                  </td>
                  <td className="py-2 pr-4 font-mono text-fg-muted tabular-nums">
                    {s.sizeBand}
                  </td>
                  <td className="py-2 pr-4 font-mono text-fg-muted tabular-nums">
                    {s.horizon}
                  </td>
                  <td className="py-2 pr-4 font-mono text-fg-muted tabular-nums">
                    {s.level}
                  </td>
                  <td className="py-2 pr-4 font-mono text-fg-muted">
                    {s.mode}
                  </td>
                  <td className="py-2 pr-4 text-fg-muted">{s.tickers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-caption text-fg-dim">
          <code>stop_pct</code> is a leveraged %; <code>lmax_fraction</code> is
          the fraction of a ticker&rsquo;s cascade ceiling the sleeve may use.
          Both are code constants with no <code>auto_config</code> surface.
        </p>

        <div className="mt-4">
          <h4 className="text-micro text-fg-dim">The coupling invariant</h4>
          <p className="mt-1 text-caption-ui text-fg-primary">
            Enforced in code by <code>sleeves.validate_sleeve_coupling</code>:
            sorted by ascending horizon, <code>lmax_fraction</code> must be{" "}
            <strong>non-increasing</strong> and <code>stop_pct</code>{" "}
            <strong>non-decreasing</strong>, else{" "}
            <code>CouplingViolation</code> is raised. Longer holds span more
            independent cascade windows, so they need less leverage and more
            room. This one function spans both slices of the registry — it
            asserts a sizing property and an exit property in the same
            assertion.
          </p>
        </div>

        <div className="mt-4">
          <h4 className="text-micro text-fg-dim">Ticker coverage</h4>
          <p className="mt-1 text-caption-ui text-fg-primary">
            Six sacred tickers appear in <strong>no sleeve&rsquo;s ticker
            set</strong> — FARTCOIN, XRP, DOGE, NEAR, SUI and kPEPE. If the
            sleeve layer were armed as written, those six would route to zero
            sleeves. The 13-ticker <code>CASCADE_LMAX</code> table that{" "}
            <code>lmax_fraction</code> multiplies, and the tail cap it produces,
            are rendered in section 8.
          </p>
        </div>
      </article>

      <InertnessStatus />
    </div>
  );
}

/**
 * 🚨 MUST-LAND. Never render `SleeveRegistry` without this, and never move this
 * away from the table it qualifies.
 */
function InertnessStatus() {
  return (
    <div className="rounded-lg border border-border-amber bg-accent-amber/5 p-4 sm:p-5">
      <h3 className="text-h3 text-fg-primary">
        <span aria-hidden="true">🚨 </span>
        The tail cap binds conservatively, not correctly
      </h3>
      <div className="mt-2 space-y-2 text-caption-ui text-fg-primary">
        <p>
          Read this with the table above, never apart from it.{" "}
          <strong>Sleeve resolution returns nothing today</strong> — the four
          proofs are in F-EXIT-13.
        </p>
        <p>
          The consequence, and it is why the table still matters:{" "}
          <code>_sleeve_lmax_fraction(None)</code> falls back to the hardcoded{" "}
          <code>live_executor._CONSERVATIVE_LMAX_FRACTION = 0.50</code>. So the
          tail cap <strong>is</strong> binding on every entry today — visibly,
          in the log — but it binds with the{" "}
          <strong>scalp constant, not a resolved sleeve</strong>. The{" "}
          <code>lmax_fraction</code> column is therefore live for scalp&rsquo;s
          value only, by coincidence of the fallback;{" "}
          <strong>
            the 0.40 / 0.30 / 0.20 rows have never been applied to anything.
          </strong>
        </p>
        <p>
          And because the paper bot holds positions for 1–60 minutes, 0.50 is
          arguably the <em>correct</em> fraction for it anyway —{" "}
          <strong>
            so the cap binds conservatively rather than correctly. That is safe,
            but it is not the designed behaviour.
          </strong>
        </p>
      </div>
    </div>
  );
}
