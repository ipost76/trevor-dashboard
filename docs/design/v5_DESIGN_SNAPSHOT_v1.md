# TREVOR v5 — LOCKED DESIGN SNAPSHOT (v1)
# Dated 2026-07-18 · AUTHORITATIVE ON-BOX COPY
# The chatbot-side context map mirrors this. If they diverge, reconcile deliberately.
# This is a point-in-time LOCK, not an auto-generated doc.

## THE VISION
All trades work together each day to build the portfolio and gain together — no trade
trades solo. Growth, not single-trade edges. The "edge" is the working-together of
everything, to be LEARNED by building + training, not derived. Success = gains a day,
a week-to-month ending NET POSITIVE; steady stacked gains. v5 REPLACES v4 in place.
Capital ~$81. Fully autonomous; CC is the sole changer; shadows/training find edges;
Ghost approves promotions.

## THE SIX SYSTEMS (a society of agents that train each other)
1. BOT-BRAIN — trades live; judges execution within the config's playable space; its
   own trainable LLM.
2. TRAINER — searches the 12-axis config space; an OPTIMIZER (bandit, no heredity, DSR +
   online-FDR alpha-budget); reasons like a quant, logs WHY + rejections; recommends how
   the bot-brain learns; zero don't-touch restrictions.
3. WATCHER — reviews the trainer after the fact (teacher/critic, its critiques train the
   trainer); owns level/ID integrity; surfaces drift/errors; observe-and-report only,
   never auto-halts; has its own learning.
4. LOOP ENGINE — runs propose→test→archive→promote (plumbing, not a reasoner).
5. BUILD-STATE TRACKER — rebuild_tracker.db (BUILT).
6. HUB COCKPIT — shows everything, legibly, screenshot-able.
Universal principle: every system has its own reasoning store, learning, and Hub page,
and surfaces its own failure (never swallows it).

## THE 12 AXES (the search space)
Tickers · Size · Leverage · Timeframe · Direction · Hedge-pairing · Entry/execution ·
Exit · Timing/context · Portfolio-level · Signal · Cost.

## THE LEVEL MODEL (R6 builds first)
Single global integer. Attaches to the entire money-path config. Reopen-forward (cheap,
no retro re-tag). A revert is ALWAYS a new level (tracking ID, not a config hash).
Money-path = anything that changes live trading behavior/structure; hub-only + non-invasive
fixes + pure bugfixes + META reasoning changes = NO level up. Change classifier = BOTH
self-declaration AND independent detection (watcher-owned reconciliation; mismatch → Hub).
Autonomous promotions increment too. Dead = "dead AT LEVEL N," reopens at N+1 as a low prior
(priors-not-blocks). Migrate the 30 false proven-negatives to reopenable state first.

## THE AUTONOMOUS LOOP + PROMOTIONS
PROPOSED → DEPLOYED → TESTING → { PROMOTION_CANDIDATE | ARCHIVED_NULL (never deleted,
auto-requeued at N+1) | ARCHIVED_STALE (requeued) }. Only human touch = Ghost approving on
the PROMOTIONS PAGE. Rows self-contained (config + stats + reasoning for a screenshot).
Promotions queue; leftovers re-validate at the new level; disregard logged as reasoning.
Approval → level auto-increments (watcher confirms). Two queues: CONFIG candidate (shadow
now) vs CAPABILITY request (needs code → own Hub list → a CC build prompt). A Hub PAUSE
button stops the trainer while CC applies a change; Ghost resumes.

## THE MEMORY / REASONING STORE (the "endless" problem solved)
Structured at write time (tags: subjects/action/because/level/outcome/confidence + prose),
queryable by tag, never scrolled. Three tiers: HOT (active, full) / WARM (compressed to
conclusion+tags) / COLD (summary stats). Rehydrate COLD→HOT when the space circles back
(a memory event, no level change). Trainer + watcher manage tiers silently (Ghost looks only
on error). "Have we tested X" = a fast structured query, not a log scan.

## THE BOT / MONEY PATH (R3/R4/R5 — the rewrite)
ONE decision-maker, not sub-bots (separate bots = trades trading solo, the anti-pattern).
Config decides WHAT is playable; bot-brain judges execution. Sleeves are patterns the one
brain expresses. Hedging is EMERGENT (both kinds). Exit engine REPURPOSED to flow with the
sleeves (keep what's needed) — a strong incumbent the trainer may challenge at a high bar,
not protected. brain/* REWRITTEN (alert-bot era). Signal layer: mechanical + LLM reserved for
judgment (a scalper can't wait on LLM calls per signal; $3/day total API ceiling; model
delegation for efficiency). LIVE sleeves minutes→~24h; SHADOW sleeves days→week (same paper
$81, a trainer what-if). Funding factored in where it helps (emergent).

## THE COMPASS (the trainer's objective — a SHAPE, priority order)
1. SURVIVAL FIRST — bounded max drawdown (a constraint at any return; 25% daily kill switch
   is the last-resort wall).
2. CONSISTENCY SECOND — high Sortino, low downside deviation (steady-small beats
   volatile-bigger; the left tail liquidates a leveraged account).
3. MAGNITUDE THIRD — total return (the tiebreaker, not the goal).
Measured NET of the 8.098bps cost bar and PER EFFECTIVE BET, not per-trade. The exact
weighting is LEARNED per level. The compass MAY vary by regime if the trainer learns that's
best (regime as risk-posture, NOT as a signal — the one legitimate re-entry of regime).

## THE HUB (R8 — repurpose the existing cockpit, build LAST)
SHADOWS page → TRAINER (promotions as a tab; subpages: shadows, search, reasoning).
MEMORY page → WATCHER (subpages: critique/teaching, error layer, level/ID integrity).
Move DOCS to the end before HEALTH. Keep the existing plain-English design language
("worth a look / running normally"). Built LAST so bot changes don't force Hub rework.

## THE CUTOVER SEQUENCE
1. ALL roadmaps complete (green — technical).
2. Cutover roadmap → v5 replaces v4 → all ~$81 in place.
3. PAPER window (24h min, extends till Ghost's comfortable): engine-correctness + bug-fix
   only; NO leveling, NO promotions, NO real money; trainer runs sims + observes; watcher ON
   (knows it's paper).
4. Ghost says go (eyeball) → real money live, all $81, LEVEL 1; trainer starts proposing.
Kill switch 25% of DAILY-STARTING capital; trips → resumes next day; Ghost fixes the cause.
A malfunction (a bug, not a losing trade) → the watcher page → Ghost fixes via CC.
Portfolio layer decides total-capital-deployed-at-a-moment, under the trainer's tuning.

## TOPOLOGY
Trainer/watcher/shadow run on WSL (searcher freezes cost nothing; trader freezes cost money).
WSL RAM to be raised (.wslconfig, 6→8-10GB). Trainer streams <400MB. Live bot stays on the VM.
Data path: trainer reads the replica, writes a WSL-local archive, renders on the Hub;
promotions become CC prompts run on the VM. $3/day total API ceiling across LLM systems.

## BUILD ORDER
R0 ops spine (prep done) → R1 Universe (FIRST, alone — informs everything) → R2 substrate
→ R3 bot-brain → R4 portfolio engine (the rewrite, biggest) → R5 exits → R6 shadow+loop
→ R7 trainer+watcher → R8 hub (last) → R9 cutover. Each its own chat. Nothing ships until R9.

## THE INVARIANTS (bind v5 regardless)
Cost bar 8.098 bps RT (frequency-invariant). Scale-invariance E[aX]=aE[X]. One beta factor
(PC1 69-81%, rho~0.655, ~1.4 effective bets — but measured on the 10 personal tickers; R1
reopens it). The liquidation tail (2025-10-10: -48% to -86% in a day). Slippage is a net
benefit. Statistical proof is unreachable in the runway — the bar is Ghost's (net-positive
weeks). Additive-DB only. Phantom-bleeder (DISTINCT trade_id). Canonical P&L. The notional
trap (notional_usd IS margin). Clock truth (opened/closed = ET, created = UTC, 4h offset).
The leakage family. Sacred files need Ghost's approval to edit. Manifest 13/13.
