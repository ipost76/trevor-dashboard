# 🗺️ TREVOR v5 — THE DREAM SPEC (THE RULER)

> **Installed by `R1-INSTALL-RULER` (RM-DREAM Wave 0), 2026-08-03, on `trevor@trevor-prime-2`.**

---

## 🚨 WHY THIS FILE EXISTS — read this before anything else

**The design record for TREVOR v5 was written in extraordinary detail: 30+ rounds of questions, Ghost's answers verbatim, a six-system architecture, an objective function, a level model, a cutover sequence.** Four investigation campaigns then found 30–60 defects each, and the discovery rate never fell — because every *"is this right?"* question was answered by **reading the code**, which is circular. Reading the code cannot detect drift, because **drift is the code changing.**

### 🚨 THE HEADLINE — the premise this file was built on was WRONG, and the truth is better

`R1`'s roadmap stated: *"the design was never on-box."* **Measured, and refuted.**

**The design HAS been on this box, git-tracked, since 2026-07-18** — four files under `docs/design/`, committed by `f72c0f5` (ENV-3) and `41fafae` (ENV-4). It was never missing.

🚨 **What was actually broken is that NOTHING EVER POINTED AT IT.** `grep 'docs/design'` over `CLAUDE.md` and `BEHAVIOR_RULES.md` returns **zero hits**. Repo-wide, the only files that reference `v5_DESIGN_SNAPSHOT` are the two files inside `docs/design/` referencing each other. The design was **written once and wired into no reading path** — not Phase 0, not the session context, not the rules.

> 🚨 **THE FAILURE WAS NON-DISCOVERY, NOT NON-EXISTENCE. A document nobody is pointed at is functionally absent.**

**And that is a far more fixable defect than a missing one.** The cost is measurable: `[B4-DESIGN-SALVAGE]` reconstructed R10, R11 and R12 from code — producing statements it had to mark `[UNKNOWN]` because *"the surviving record does not establish what R10 is"* — **while `docs/design/v5_ROADMAP_FRAME.md`, which names R10 as the WATCHER, sat two directories away, tracked in git, unread.** `[B4]` never grepped `docs/design/` at all.

### 🚨 WHAT THIS FILE IS

**This is THE RULER.** It is the design record, transcribed **verbatim** from `TREVOR — THE CONTEXT MAP` (the chatbot-side living outline), written to a git-tracked path so that **every future prompt can read intent from a source that is not the code it is judging.**

### ⚠️ WHAT THIS FILE IS NOT — the limitation that must never be forgotten

> 🚨 **THE MAP IS DATED 2026-07-17/18 — BEFORE THE v5 BUILD RAN (07-18 → 07-28, 110 commits).**
>
> **It is the design as of the START of the build, not a record of what shipped.** Decisions made *during* the build are not in it. Where this document and the code disagree:
>
> 🚨 **THIS STATES INTENT. THE CODE STATES REALITY. REPORT THE GAP. NEVER SILENTLY PICK.**

**Measuring that gap is `[R2]`'s job, not this file's.** `R1` installs the ruler; `R1` does **not** judge conformance.

### 🚨 THE OTHER RULER — `docs/design/` STAYS AUTHORITATIVE

**This file absorbs nothing and deletes nothing.** The four on-box files remain authoritative in their own right:

| File | Dated | What it is |
|---|---|---|
| `docs/design/v5_DESIGN_SNAPSHOT_v1.md` | 2026-07-18 (`f72c0f5`) | The full base design, §D.0–§D.11, condensed |
| `docs/design/v5_DESIGN_SNAPSHOT_v2.md` | 2026-07-18, committed 07-19 (`41fafae`) | §D.12 fine details; supersedes v1 |
| `docs/design/v5_CONTEXT_INDEX.md` | 2026-07-18, committed 07-19 (`41fafae`) | The single entry point; vision, invariants, laws, state |
| `docs/design/v5_ROADMAP_FRAME.md` | 2026-07-18, committed 07-19 (`41fafae`) | **The 14-roadmap frame R0–R13 + build order** |

🚨 **Ghost's ruling (2026-08-03): they stay authoritative because they are the artefact §D.12.9's entire safety model NAMES.** §D.12.9 says the paper-period safety model is *"recon + verification after EVERY fix, cross-checked against the on-box design snapshot."* **That snapshot is these files.** Destroying or absorbing them would destroy the mechanism.

> 🚨 **CONSEQUENCE FOR `[R2]`: audit against BOTH. The MAP is what Ghost intended. The SNAPSHOT is what the build was told.** Where they diverge — and they do — see **§X — MAP vs ON-BOX SNAPSHOT** below. **That divergence is evidence. Flattening it would destroy the only cross-check the project has.**

---

## 🚨 THE PROVENANCE TIERS — every statement carries one

| Tier | Meaning |
|---|---|
| 🚨 **`[FROM-GHOST]`** | **From the Context Map — Ghost's own words or a decision he recorded. THE ONLY NON-CIRCULAR TIER.** This is the entire value of this document. |
| **`[CLAUDE-DELEGATED]`** | A call Ghost explicitly delegated to Claude ("you decide"). Design authority — but **not Ghost's own words.** |
| **`[SURVIVING-VERBATIM]`** | Quoted from `recon_archive.summary` — survives regardless of where a file lives. |
| **`[RECOVERED]`** | From a commit body or a docstring. |
| ⚠️ **`[INFERRED-FROM-CODE]`** | 🚨 **Carries its circularity warning AT EVERY INSTANCE.** |
| **`[UNKNOWN]`** | The record cannot settle it. **A correct and expected outcome.** |
| **`[R1-MEASURED]`** | Measured on this box by `R1` on 2026-08-03. Provenance is a live command, stated inline. |

🚨 **AN UNTAGGED SENTENCE IS NON-CONFORMING.** If you take one line out of this file and quote it somewhere else, the tier must travel with it. **A reader must never be able to mistake an inference for the design.**

---

## PROVENANCE HEADER

| | |
|---|---|
| **Source** | `TREVOR — THE CONTEXT MAP`, chatbot-side living outline, pasted into session `R1-INSTALL-RULER` by Ghost, 2026-08-03 |
| **Source last updated** | **2026-07-17**, with §R.7 and §D.12 additions dated **2026-07-18** |
| **Build ran** | **2026-07-18 → 2026-07-28, 110 commits — AFTER this record was written** |
| **Transcription** | Verbatim. No summarising, no improving, no gap-filling, no correcting. |
| **Known source defect** | ⚠️ The §10 heading `### Structurally unanswerable` arrived **triplicated** in the paste. Transcribed **once**, flagged inline. **No content is missing** — a faithful transcription of a duplication would be faithful to the wrong thing. |
| **Body checksum** | 🚨 **`BODY-SHA256 = f38308e9309a837e1141cac06b1008ad8f3653ba1c8ba7616a64c03a5144699b`** — the `sha256sum` of every byte **below the BODY-START marker line** (878 lines). 🚨 **Reproduce with the ANCHORED form — the loose form is WRONG:** `awk 'f{print} /^<!-- BODY-START -->$/{f=1}' docs/DREAM_SPEC.md \| sha256sum`. ⚠️ **The anchor is load-bearing:** this header mentions the marker in prose, so an unanchored pattern matches *this row* instead of the real marker and silently hashes the wrong range — `R1` hit exactly that and caught it by re-deriving. ⚠️ **A self-referential whole-file hash is impossible** (writing it changes the file), so the body hash is the stable one — invariant to edits of this header. The whole-file hash is in the commit message. `[R2]` installs the WSL copy and must prove the **body** hash matches. |
| **Verbatim proof** | ✅ **34/34 Ghost quotations EXACT · 32/32 figure-anchors EXACT · 0 near-matches.** Method: an independent SECOND transcription of the source was written first, then every quotation and figure was matched byte-for-byte against this file (markdown emphasis and table pipe-escaping normalised on both sides; nothing else). **A paraphrase fails as an absent match, not as a judgement call.** ⚠️ **Honest limit: both transcriptions are Claude's, so this proves the two passes agree — it does not substitute for Ghost reading the file.** |

<!-- BODY-START -->

---
---

# 🚨 PART I — THE SPEC. This is the ruler.

---

## §V — THE VISION: TREVOR v5

**`[FROM-GHOST]`** **This is the section that must never be lost. Everything else serves it.**

### What v5 is

**`[FROM-GHOST]`** **TREVOR v5 is a full version rebuild, shipped as a CUTOVER — not a patch.** It replaces a stream of independent 32-minute scalps with a **portfolio of interacting positions** that share capital, slots, margin, and funding, designed so the pieces don't clash.

**`[FROM-GHOST]`** **Lineage:** the selector began as a Discord alert bot Ghost built. TREVOR is on **v4 now**. 🚨 **This rebuild marks v5.** Fully autonomous perp trading agent. **No manual intervention. CC is the sole changer. Shadows determine possible edges and opportunities.**

### 🚨 The thesis — Ghost's, in his words

**`[FROM-GHOST]`**

> *"All trades all tickers all regimes all sizes should all be working together and that's how they ensure growth, not single trade edges."*
>
> *"The edge for this specific TREVOR will be in the working together of purely everything we have found after this extensive research and more."*
>
> *"You are going to have to learn more about what that exactly and definitively means as we continue building and training. This is the edge you're looking for — you don't know it, can't find it, and don't know where to look, because exactly as you said before, they are not known. **If it was easily found and replicable it wouldn't be an edge.**"*
>
> *"If everything is always working together, any change will affect overall gains."*

### 🚨 Why this survives the campaign's null — the three arguments, all sound

**`[FROM-GHOST]`**

1. **Path dependence is real.** The trades you take determine the capital and slots you have, which determine the trades you *can* take next. Change one rule → the entire realized path diverges. 🚨 **You cannot A/B a portfolio system trade-by-trade. You compare CONFIGURATIONS, not levers.**
2. **The campaign's evidence is double-conditioned** — on the fossil selector *and* on the regime gate that locked TREVOR into the calmest 15–19% of vol-space. 🟨 **Path-conditioned findings cannot kill a rebuilt construction.** (See §0/§3.)
3. 🚨 **The epistemological argument, and it's legitimate:** if an edge were findable by 9,344 grid searches on daily bars, it would already be arbitraged. **What survives is what's hard to find.** "The grid found nothing" ≠ "nothing exists."

### 🚨 What "working together" concretely means (to be learned, not assumed)

**`[FROM-GHOST]`** **The pieces Ghost named:**
- **Small size / short term** — minutes-to-hours scalps (the NEAR +24%-in-5min shape)
- **Bigger size / short term**
- **Larger size / longer term** — up to **a week**
- **Smaller size / longer term**
- **Hedging** — 🚨 **both kinds: market-neutral pairs AND independent both-direction exposure. "Whatever could have potential."**
- **Funding capture** — *"making up funding rates money"*
- **The long grower** — *"while the week-long one really grows in size and could end +100% or sum wild"*

**`[FROM-GHOST]`** ⚠️ **Claude does NOT yet know what "working together" definitively means. That is the point.** It is to be **learned by building and training**, not derived in advance. **Keep an open mind. Do not collapse it into a formula.**

### The end state

**`[FROM-GHOST]`**
> *"The final production is gains as described in answer 3, and where none of the 'working together' pieces are clashing."*

**`[FROM-GHOST]`** **Success (Ghost's bar):** 🚨 **gains a day; a week-to-month ending net positive.** Some days lose — *"that's what working together is about, net gains over time but stacked so it adds up."*

### The method

**`[FROM-GHOST]`** **Build → cutover → add capital → go live → TRAIN.** ⚠️ **Expect rocky. That's what training is for.** Continuous testing, changing, tweaking, heavy careful fine-tuning. **Shadows test the "what ifs."** Loss along the way is **tuition, not failure.**

### 🚨 The timeframe ruling (Ghost delegated; Claude decided 2026-07-17)

**`[FROM-GHOST]`** **Ghost pulled back on the week-long hold himself:**
> *"Stay away more from the riskier longer term. I was only offering that bc we had deemed so lost with where we were before. But with this version change, if it is risky, we could probably just shadow it and put into training and let it accrue over time and see. **You decide timeframe, but you have to keep the open mind about the never knowing what could work.**"*

**`[CLAUDE-DELEGATED]`** **THE RULING:**
- 🚨 **LIVE sleeves: minutes → ~24 hours.**
- 🚨 **Multi-day / week-long: SHADOW ONLY** — accruing from day one, **promotable on evidence.**

**`[CLAUDE-DELEGATED]`** **Why:** v4's longest hold **ever** is **1.35h** — 24h is **~18× beyond anything TREVOR has done**, so it genuinely tests the "longer" thesis. It **bounds the tail**: 2025-10-14 class events (**−48% to −86% across 6 tickers in ONE DAY**, invisible to every regime label) liquidate a week-long scalp-leverage hold **before a stop fires**; a 24h low-leverage hold survives. Funding: **~24 stamps vs ~168** *(⚠️ interval needs live verification)*.

**`[CLAUDE-DELEGATED]`** 🚨 **THE OPEN MIND IS STRUCTURAL, NOT RHETORICAL: the week sleeve runs in shadow from cutover, accrues indefinitely, and PROMOTES if it shows something. Nothing is killed. If shadow says it works, it goes live and Claude was wrong about the timeframe. That is the system working as designed.**

**`[CLAUDE-DELEGATED]`** ⚠️ **Standing design constraint regardless:** any sleeve longer than the scalp horizon needs **its OWN low-leverage ladder** — it cannot ride the scalp ladder.

> ⚠️ **`[R1-MEASURED]` TRANSCRIPTION NOTE, not a correction:** the map writes the cascade date as **2025-10-14** here and as **2025-10-10** in §2 and §D.10's invariants. **Both are transcribed as written.** The record disagrees with itself on the day; this is logged as **contradiction #11** in §C below. **Do not resolve it from code.**

---

## 🚨 §R.7 (the durable half) — VM COST REDUCTION: THE OPEN QUESTION

> **`[FROM-GHOST]`** Ghost's scope addition, **2026-07-18**:
> *"During this whole rebuild let's try to get the cost down as much as possible on the VM side. Whatever is doable while still keeping live quality. It will give me more API availability if I can cut this a tad."*

**`[CLAUDE-DELEGATED]`** 🚨 **VM cost ≠ Anthropic API cost — DIFFERENT BILLS.** Cutting the GCP spend does **NOT** add API availability. API headroom is the swarm's daily-cost cap (separate). ⚠️ **If API room is the real goal, the lever is the swarm's model mix + cadence, NOT the VM.**

> 🚨 **`[FROM-GHOST]` OPEN, UNANSWERED, AND DURABLE: which does Ghost want — the GCP bill down, or Claude API room? They are fixed by different things.**

**`[CLAUDE-DELEGATED]`** ⚠️ **The real lever is instance SIZE, not trimming services** — but the recon found the VM's 2 vCPU already contends with the live bot, and the Hub was EVICTED for CPU starvation. **Downsizing is the big lever with the highest risk to live quality — needs measurement first.**

*(§R.7's dated figures — the $2.30/day, the $71.59/mo forecast, the −70% — are **historical state** and live in the appendix, §H.1. Ghost's ruling, 2026-08-03: the open question is durable intent; the figures are dead state.)*

---

## 🚨 §D — THE v5 SYSTEM DESIGN (rounds 11–29, hammered 2026-07-17/18)

**`[FROM-GHOST]`** **This is the architecture the whole build implements. Everything here is decided unless marked OPEN.**

### 🚨 §D.0 — THE SIX SYSTEMS (the "society of agents")

**`[FROM-GHOST]`** 🚨 **Ghost's reframe (#4, round 17): every system is an LLM training itself, and they train each other.** Not "a bot with monitors" — a small society of reasoning agents that improve one another, with Ghost as final arbiter via CC.

| # | System | Role | Reasons? | Own Hub page? |
|---|---|---|---|---|
| 1 | 🚨 **BOT-BRAIN** | Trades live. Judges execution quality/timing within the config's playable space. **Its own LLM being trained** — the trainer recommends how IT should learn/adapt. | Yes | AUTO (existing) |
| 2 | 🚨 **TRAINER** | Searches the 12-axis config space. Reasons, proposes promotions, recommends how the bot-brain learns. **Zero don't-touch restrictions — can propose changes to ANY layer/engine.** | Yes | **SHADOWS→TRAINER** |
| 3 | 🚨 **WATCHER** | Reviews the trainer AFTER the fact (teacher/critic — its critiques are training signal for the trainer). ALSO owns level/ID integrity. ALSO surfaces drift/errors. Has its OWN reasoning + learning. | Yes | **MEMORY→WATCHER** |
| 4 | **LOOP ENGINE** | The plumbing: runs propose→test→archive→promote. Not a reasoner — the reliable machinery the brains sit on. | No | (under trainer) |
| 5 | **BUILD-STATE TRACKER** | `rebuild_tracker.db` — records every prompt + level. ✅ **BUILT (ENV-1/ENV-2).** | No | build-state subpage |
| 6 | **HUB COCKPIT** | Shows everything, legibly, screenshot-able. | No | (is the surface) |

**`[FROM-GHOST]`** 🚨 **Universal design principle (from the reframe):** every system needs its OWN reasoning store, its OWN learning, its OWN Hub page — and every output must be legible enough to screenshot into a chat and act. **Every autonomous component surfaces its own failure, never swallows it** (the recon found 3 silent failures — this is the antidote).

### 🚨 §D.1 — THE TRAINER (the optimizer + the intelligence)

**`[FROM-GHOST]`**
- 🚨 **It's an OPTIMIZER, not a p-value factory** (MASTER §2.5). Bandit-allocated search (Thompson/UCB) over arbitrary-depth subsets, **NO heredity constraint** (so pure interactions — "no trade trades solo" — aren't missed). Tools: **Deflated Sharpe (trial-count as input) + PBO + online-FDR/alpha-investing (the α-budget that grows/throttles the search) + purged-CV.**
- 🚨 **Reasons "like a real quant in their own brain"** (#5, round 13): pushes back on its OWN ideas, compares against its OWN history, stores WHY not just WHAT. Intelligence-with-brute-force-fallback (retest-all "once in a while" when intelligence feels not-up-to-par).
- 🚨 **Rejected ideas ARE logged** (#3, round 15): "considered X, rejected because Y, didn't spend the alpha" — so it never reconsiders the same dead-end, and it learns from its own rejections.
- 🚨 **Recommends how the BOT-BRAIN learns** (#2, round 27→#2 confirmed): the trainer tunes the search; it also proposes how the bot adapts its in-the-moment execution. Bot-brain = its own trainable LLM.
- **First live action is UNDERSTANDING, not proposing** (#6): ~24h watching live fills + running sims to "build a thought process and a ground to be at" before it searches.
- **Data source: ALL of it** — live fills + shadow fills + simulation.
- **Runs continuously.** Champion = the live config; challenger = a shadow. Promotion = challenger becomes champion = level++.

### 🚨 §D.2 — THE WATCHER (the teacher + the integrity arm)

**`[FROM-GHOST]`**
- 🚨 **Reviews the trainer AFTER the fact, comments ONLY on problems** (#4, round 16): "that decision was rash / logged wrong / done wrong." Critique → its own Hub subpage → Ghost weighs it in chat/CC → maybe adjust the trainer's reasoning. **The watcher TEACHES the trainer.**
- 🚨 **Owns level/ID integrity** (#3, round 14): knows what level CC should work on, confirms the level didn't wrongly change during a fix, keeps ID organization straight. **The level system's enforcement arm.** *(Split level/ID into a sub-module inside the watcher so if the review-brain misbehaves, ID-tracking doesn't fall with it.)*
- 🚨 **Observe-and-report ONLY. NEVER auto-halts** (#2, round 8 + #5 round 29). Pause is ALWAYS Ghost's Hub button, never the watcher's hand. Fail-open, alert-only.
- **Has its own reasoning + learning** — it's an LLM being trained too.
- 🚨 **If the watcher itself drifts/dies:** it shows on its OWN error-layer subpage; Ghost catches it (monitoring hard, manually) and fixes via CC. *(Ghost, round 8: "who watches the watcher" → Ghost does, through the error page + manual vigilance.)*

### 🚨 §D.3 — THE LEVEL MODEL (the spine — R6 builds it FIRST)

**`[FROM-GHOST]`** *(⚠️ the "R6" in this heading is the MAP's roadmap numbering — see §C contradiction #6 and §X divergence #1. Transcribed as written.)*
- 🚨 **A single global integer** (Claude's call, round 2). Attaches to the ENTIRE money-path config, not per-parameter.
- **Cheaper reopen-forward** (#1, round 1): a level increment REOPENS old results as fresh candidates going forward; it does NOT retroactively re-tag. Sufficient + cheap.
- 🚨 **A revert is ALWAYS a new level** (#2, round 1/5): levels are tracking IDs, not config hashes. Level 20 could be byte-identical to Level 15 — understood as a revert-by-design.
- 🚨 **Money-path = anything that changes live trading behavior/structure** (#3, round 5). Config the bot loads-but-never-acts-on doesn't count. Hub-only changes + non-invasive error fixes = NO level up. A pure bugfix restoring intended behavior = NO level up (#2, round 2).
- 🚨 **A META change (adjusting the trainer's REASONING) = NO level up** (#2, round 17). "How it thinks" ≠ "what it trades." Rehydrating a COLD memory to HOT = NO level up (pure memory movement, #5 round 12).
- 🚨 **The change classifier is BOTH self-declaration AND independent detection** (#1, round: "both"): the CC prompt stamps its own change; the level system independently detects any money-path change and flags a mismatch; if it can't self-resolve → surfaces on the Hub for Ghost to fix via CC. **Declared-vs-detected reconciliation, owned by the watcher.**
- **Autonomous promotions increment the level too** (built into prompts + project instructions; watcher confirms; if it doesn't auto-happen, Ghost runs "this is now live at level N+1").
- 🚨 **The fail-closed trap FIX** (§R.5): a dead result is only "dead AT LEVEL N." Reopens at N+1 as a low-prior candidate (priors-not-blocks). **R6 migrates the 30 false proven-negatives to reopenable state before any trainer config runs.**

### 🚨 §D.4 — THE AUTONOMOUS LOOP + PROMOTIONS

**`[FROM-GHOST]`**
- **Lifecycle:** `PROPOSED → DEPLOYED → TESTING → { PROMOTION_CANDIDATE | ARCHIVED_NULL (never deleted, auto-requeued at N+1) | ARCHIVED_STALE (level moved mid-test, requeued) }`.
- 🚨 **The ONLY human touch = Ghost approving on the PROMOTIONS PAGE.** Everything else self-runs.
- **Promotion rows are self-contained** (#1, round 11): config + stats + enough reasoning that a screenshot explains it to chat/CC. CC can investigate the reasoning + talk to the trainer.
- **Promotions can queue** (#2, round 11): approve 2 of 5, the other 3 stay "ready" — 🚨 **but they RE-VALIDATE at the new level** (#1, round 11), and the disregard is logged as reasoning ("CC judged the other 2 higher-priority").
- **Approval → level increments automatically** (#3, round 11): built into prompts + project instructions; watcher confirms; else Ghost runs the manual "live at level N+1."
- 🚨 **Two queues** (round: two-queue split): **CONFIG candidate** (expressible now → shadow it) vs **CAPABILITY request** (needs new code → its own Hub list → becomes a CC build prompt). *"Tells me I need to create a CC prompt for that."*
- **During a promotion's apply:** Ghost hits a **Hub PAUSE button** for the trainer (#2, round 11) → runs the CC prompt → resumes. *(Manual pause beats fragile mid-change detection — same pattern as the v4 trading pause.)* ⚠️ **REFINED by §D.12.7, round 30–34 — see §C contradiction #7.**
- **If CC's build hits a problem applying a promotion** → surfaces on the watcher's error page (#3, round 11).

### 🚨 §D.5 — THE MEMORY / REASONING STORE (the "endless" problem — SOLVED)

**`[FROM-GHOST]`**
- 🚨 **Structured at WRITE time, queryable by tag — never scrolled.** Every entry: `subjects` (tags) · `action` · `because` · `level` · `outcome` · `confidence` + a prose field. "Have we tested X" = a fast structured-verdict query, NOT a log scan.
- 🚨 **THREE TIERS:** **HOT** (active/recent levels, full detail) · **WARM** (older, compressed to conclusion + tags) · **COLD** (ancient, summary stats). Rehydrate COLD→HOT when the config space circles back (a memory event, no level change).
- **Trainer + watcher decide tier transitions + can rehydrate.** Transitions are **silent — Ghost only looks if something's wrong** (#4, round 12).
- 🚨 **"Like a real quant reasoning in their own brain"** — good memory, recollection, reasoning, thought process. This is the intelligence layer; the store is its brain.

### 🚨 §D.6 — THE BOT / MONEY PATH (R3/R4/R5 — the rewrite)

**`[FROM-GHOST]`** *(⚠️ "R3/R4/R5" is the MAP's numbering — see §X divergence #1.)*
- 🚨 **ONE decision-maker, NOT separate sub-strategy bots** (#1, round 20, Claude's rec accepted): separate bots would each optimize themselves = "trades trading solo," the exact anti-pattern. Instead: **one brain places varied trades (size/horizon/leverage per opportunity); the portfolio layer coordinates them to work together.** "Sleeves" are PATTERNS the one brain expresses, not separate agents.
- 🚨 **The config decides WHAT is playable; the bot-brain judges execution within it** (#2, round 20): the level's learned config sets the space (tickers/sizes/horizons live); the swarm/bot-brain judges THIS entry. Different layers → the bot is trainable on execution without touching strategy.
- 🚨 **Hedging is EMERGENT** (#3, round 20): not a bot decision — the portfolio just holds offsetting positions because that's what works together. Both kinds (market-neutral pairs + independent both-direction).
- 🚨 **Exit engine: REPURPOSED to flow with the sleeves** (#4, round 21) — NOT kept as-is. Keep only what's needed to make the new system smooth. Different-horizon sleeves need exits that fit them. ⚠️ **CONTRADICTS §10 — see §C contradiction #1.**
- 🚨 **Trainer CAN propose exit changes — zero don't-touch restrictions** (#5, round 21). ⚠️ **BUT the exit engine beat 298 alternatives — treat it as a STRONG INCUMBENT CHAMPION (a high prior to beat), not a protected component.** Open mind, high bar.
- 🚨 **The swarm/brain is REWRITTEN** (#2, round 27): `brain/*` was built for the alert-bot era → fair game to rewrite. **Signal layer: Claude to recommend the best architecture FOR THE BUILD** (#1, round 27) — a scalper firing often can't wait on 6 LLM calls/signal or blow the API budget; likely a cheaper/faster mechanical layer + LLM reserved for higher-level judgment. ⚠️ **OPEN — Claude recommends at R3 build time.** ⚠️ **CONTRADICTS §10 — see §C contradiction #2, WHICH CARRIES AN OPERATIONAL HAZARD.**
- **LIVE sleeves: minutes → ~24h. SHADOW sleeves: days → a week** (§V timeframe ruling), same paper-$81 capital model, as a trainer what-if baseline (#4, round 28). Nothing killed; promotes on evidence.
- **Funding** (#3, round 28): factored in where it helps (emergent, like hedging) — Claude + CC decide where at build time. Not a dedicated sleeve. ⚠️ **CONTRADICTS §10 — see §C contradiction #10.**

### 🚨 §D.7 — THE COMPASS: THE TRAINER'S OBJECTIVE FUNCTION (round 19 — the most important target)

**`[FROM-GHOST]`** 🚨 **A quant doesn't optimize P&L — P&L is the byproduct.** The target is a SHAPE, three things in priority order:

1. 🚨 **SURVIVAL FIRST — bounded max drawdown.** No config that risks a ruinous day is acceptable at ANY return. A constraint, not a preference. The trainer optimizes UNDER it, never trades it away.
2. 🚨 **CONSISTENCY SECOND — high Sortino, low downside deviation.** Steady small gains that compound = Ghost's "net-positive weeks, stacked." 🚨 **Steady-small BEATS volatile-bigger, and it's not close** — for a leveraged account the left tail is what liquidates you.
3. **MAGNITUDE THIRD — total return.** The tiebreaker, not the goal. Maximized only AFTER survival + consistency.

**`[FROM-GHOST]`**
- 🚨 **Measured NET of the 8.098bps cost bar and PER EFFECTIVE BET, not per-trade** — or it optimizes toward an illusion (fee-burn or fake diversification).
- 🚨 **The exact weighting is LEARNED, not set once** — the trainer tunes consistency-vs-magnitude per level. Claude gave the starting compass (the priority order); the balance is refined over time. "Working together, learned not derived" applied to the objective itself.
- 🚨 **The compass can vary by regime IF the trainer learns that's best** (#2, round: regime as risk-posture): "trade smaller/survive in chaos, push in calm" is something it's ALLOWED to learn. ⚠️ **This is the ONE legitimate re-entry of regime — NOT as a signal, but as a risk-posture the objective respects.** The trainer decides; it also recommends how the bot-brain learns to adapt to regime.
- **Max-drawdown wall = the 25% daily kill switch is the LAST RESORT** (#1, round: last resort). The trainer should design configs that never approach it.

### 🚨 §D.8 — THE HUB (R8 — repurpose the existing cockpit, don't rebuild)

**`[FROM-GHOST]`** 🚨 **Ghost's screenshot (2026-07-18) shows the cockpit already exists** — SHADOW/PROMOTIONS tabs, bottom nav AUTO/SHADOWS/DOCS/MEMORY/HEALTH, the "3 worth a look / 62 running normally / HASN'T UPDATED LATELY" plain-English pattern. **The visual grammar for the watcher is already built.** The plan (#6, round 22):

- **SHADOWS page → TRAINER** (PROMOTIONS moves here as a tab; subpages for shadows, search state, reasoning)
- **MEMORY page → WATCHER** (subpages: critique/teaching layer, error layer, level/ID integrity)
- **Move DOCS to the end, before HEALTH**
- Keep the existing design language; add subpages accordingly; **design flare to separate the discovery pages cleanly without overload** (#3, round 8 — "make it pop, don't be too eccentric").
- 🚨 **Build the Hub LAST** (#7, round 22): leave it as-is during the multi-week build; it becomes the FINAL design so bot-design changes don't force Hub rework. Don't show "rebuild in progress" — just let it be until cutover.

### 🚨 §D.9 — THE CUTOVER SEQUENCE (definitive — rounds 26/16/10 + this turn)

**`[FROM-GHOST]`**
```
1. ALL ~10 roadmaps complete (every prompt run green — a TECHNICAL state)
2. CUTOVER roadmap fires → v5 REPLACES v4 in place → all ~$81 in place
3. PAPER WINDOW opens — 24h MINIMUM, extends until Ghost says he's comfortable
     · engine-correctness + bug-fixing ONLY · NO leveling · NO promotions · NO real money
     · trainer runs SIMULATIONS to learn + OBSERVES (building its thought process)
     · WATCHER is ON (knows it's paper, catches bugs early) (#6, round 18/23)
     · Ghost fixes everything live-on-paper (#5, round 16)
4. GHOST SAYS GO (pure eyeball, "when I'm comfortable") → REAL MONEY LIVE, all $81, LEVEL 1 begins
     · trainer starts proposing (champion/challenger live) (#4, round 18)
```

**`[FROM-GHOST]`**
- 🚨 **"Complete" = technical (green prompts) for the CUTOVER trigger. PAPER is the you're-satisfied gate, AFTER cutover.** The cutover isn't the risk moment — the paper→live call is, and it's purely Ghost's eyeball.
- **Capital: all $81 at once at go-live** (not ramped) — it was proven safe in the paper window first.
- 🚨 **Portfolio layer decides total-capital-deployed-at-a-moment UNDER the intelligence** (#4, round 25): how much of the $81 is live right now is itself something the trainer prunes for — a risk-posture tied to the survival compass.
- **Kill switch: 25% of DAILY STARTING capital. Trips → resumes next day** at the new lower daily-start (#6, round 29). No manual sign-off to resume — but Ghost is "monitoring hard, instantly fixing whatever caused it." 🚨 **CONTRADICTS §10 — see §C contradiction #3, A LIVE SAFETY BEHAVIOUR.**
- 🚨 **A malfunction (not a losing trade — an actual bug) routes to the WATCHER page** (#5, round 29); Ghost catches it via manual vigilance + fixes through CC. No separate auto-halt.

### 🚨 §D.10 — THE UNIVERSE (R1 — runs FIRST, informs everything)

**`[FROM-GHOST]`**
- 🚨 **R1 picks the BEST starting universe, thoroughly** (#1/#2, round 24): free to pick whatever, drop sacred tickers, add non-sacred — "super thorough." It sets Level 1's tickers.
- **Post-cutover, the trainer explores tickers too** — but tickers are a **"think harder before changing" axis** (extra caution, not a block). **Rule 30 is DISSOLVED as a production law; it survives only as trainer-caution.** ⚠️ **See §C contradiction #5. 🚨 Transcribe faithfully — do NOT "correct" this toward the older absolute form.**
- 🚨 **The real R1 question: does Hyperliquid list ANYTHING off the crypto beta factor?** ρ=0.655 / ~1.4 effective bets was measured on Ghost's 10 PERSONAL tickers — a different universe could move it. **First genuine breadth the project has ever had access to, if it exists.**
- **R1 also carries: the autocorrelation question** (is aggression-sizing live or dead — but that's a STANDING trainer hypothesis per level, not a one-shot) + the HL 2.5-vs-4.5 bps reconcile.

### 🚨 §D.11 — BUILD ORDER (round 23 + this turn)

**`[FROM-GHOST]`**
- 🚨 **R1 (Universe) runs FIRST and alone** — its answer informs every downstream roadmap.
- **Each roadmap runs independently, in order**, then all work together.
- 🚨 **ONE final CUTOVER roadmap** goes live, cuts over, starts paper + training.
- **Nothing ships until everything's built** (#12 of the 13) — no incremental live, no co-flip problem during the build.

### 🚨 §D.12 — FINE-DETAIL DECISIONS (round 30–34, 2026-07-18 — the "one wrong thing ends it" pass)

**`[FROM-GHOST]`** 🚨 **§D.12.1 — WHAT THE BUILD'S SUCCESS ACTUALLY IS (the reframe that matters most).**
**Ghost #5:** *"The build is supposed to go into this knowing it's vague, has no edge, nothing to start with, and will NOT be successful from the start. The only goal of the start is to set a baseline for the bot — how the structure should look for everything. Live trading + training then piece things together."*
🚨 **So Level 1's baseline is a STRUCTURAL SKELETON, not a working strategy.** It establishes the SHAPE (sleeves, axes, money path) with **NO expectation of profit or edge.** The trainer **cannot propose from scratch** (#5) — there's nothing to propose toward yet; Level 1 gives the pieces a form, and training turns "correctly-shaped but trades badly" into "working together." 🚨 **The build's honest success criterion = "a correctly-shaped system that trades badly." Profit is training's job, not the build's.**

**`[FROM-GHOST]` + `[CLAUDE-DELEGATED]`** 🚨 **§D.12.2 — WHAT A SLEEVE IS (Claude's rec, accepted).** A **named, config-toggleable trading STYLE** = a bundle of (size band + horizon + leverage range + optionally direction/hedge behavior). Named so the trainer can reference/test/tune/enable/disable it. 🚨 **The sleeve is the UNIT OF COORDINATION** — "working together" needs nameable things that work together. **But a sleeve is a STYLE the one bot-brain expresses, NOT a separate bot** (§D.6). Config says "these N sleeves are live at Level N"; the portfolio layer + intelligence decides moment-to-moment which fires + how capital flows. **Named styles, one brain, learned coordination.**

**`[FROM-GHOST]`** **§D.12.3 — CAPITAL ARBITRATION (#2, #3).** When two sleeves want the same capital, or the same ticker could be in two sleeves at once → 🚨 **the PORTFOLIO LAYER + bot intelligence decide, LEARNED not fixed.** Not a fixed priority. "That's what learning helps." Same-ticker-multi-sleeve is a trained/system decision, weighed by training.

**`[FROM-GHOST]`** 🚨 **§D.12.4 — THE TRAINER'S EXPLORATION POLICY (#4).** Start on **ONE axis**, slowly broaden to all 12+ **as grounding builds and context secures.** 🚨 **A BALANCE RULE: never test one thing too much or too little; give every axis opportunity; don't get stuck; don't over-focus.** (This is the explore/exploit balance the bandit + alpha-budget machinery enforces — Ghost's instinct matched the math.)

**`[CLAUDE-DELEGATED]`** 🚨 **§D.12.5 — THE REPLICA-LAG PROMOTION PROBLEM (#6, Claude's rec).** Do NOT compare champion-vs-challenger on the lagged replica. 🚨 **The champion's results are recorded LIVE on the VM (zero lag); the challenger's shadow is computed on the same box, same data window; the comparison happens on MATCHED data; the verdict flows to the WSL trainer.** The ~10-20min replica lag affects only display + search, **never the promotion decision.** A promotion never finalizes on a stale-vs-fresh mismatch. **Build constraint for R6/R7.** *(⚠️ the on-box snapshot renumbers this to R8/R9 — §X divergence #1.)*

**`[FROM-GHOST]`** **§D.12.6 — SHADOW TEST WINDOW (#7).** Shadows test **CURRENT LEVEL ONLY** — honest to path-dependence. Not all-history (which would mix configs).

**`[FROM-GHOST]`** **§D.12.7 — IN-FLIGHT SEARCH DURING A PROMOTION (#8).** The trainer's search does NOT pause for a promotion — it **keeps searching against the OLD champion until the level flips**, then the new champion is live. (The Hub PAUSE button is for when CC is mid-CODE-change, §D.4 — not for a normal promotion.) ⚠️ **See §C contradiction #7.**

**`[FROM-GHOST]`** 🚨 **§D.12.8 — PROMOTIONS ARE ENTIRELY POST-BUILD (#9).** The ~100+ build prompts come FIRST. Promotions begin only AFTER the build, per-level, once trading + training are live. **Ghost + CC decide promotion priority** (which candidates upgrade to the next level) — **NO auto-ranking by the trainer.** Chat + CC determine which promotions are best.

**`[FROM-GHOST]`** 🚨 **§D.12.9 — NO PRE-FLIGHT GATE; ACTIVE VIGILANCE INSTEAD (#10).** Ghost declined an automated R9 pre-flight checklist. 🚨 **The safety model IS the paper period: recon + verification after EVERY fix, cross-checked against the on-box design snapshot (`docs/design/v5_DESIGN_SNAPSHOT_v1.md`).** *"There will be problems after 100+ prompts and nothing will work right at first — that's why it's paper until I say otherwise. I'll be actively fixing everything, constantly cross-checking the original plan, till everything works perfectly before I go live."* **Safety = Ghost's active vigilance + continuous re-recon against the snapshot, NOT an automated gate.** For a system this bespoke, that's stronger than a checklist.

> 🚨 **`[R1-MEASURED]` — THE SNAPSHOT §D.12.9 NAMES EXISTS.** `ls docs/design/` on `trevor-prime-2`, 2026-08-03: `v5_DESIGN_SNAPSHOT_v1.md` is present and git-tracked (`f72c0f5`), and **a `v2` supersedes it** (`41fafae`). **The map does not know v2 exists.** ⚠️ **Whether the "recon + verification after EVERY fix, cross-checked against the snapshot" mechanism was ever PERFORMED is `[UNKNOWN]` and is `[R2]`'s question, not `R1`'s.** What `R1` measured is only that the artefact exists and that **nothing points at it** (`grep 'docs/design'` over `CLAUDE.md` + `BEHAVIOR_RULES.md` → 0 hits).

---

## 0. 🚨 THE DISTINCTION THAT ORGANIZES EVERYTHING

**`[FROM-GHOST]`** Ghost's challenge, 2026-07-17:

> *"All of these have been proven by backtesting the current cutover trades — the specific set of trades that were already manufactured to trade a certain way. Were you able to cleanly see through all the simulations and reports that all of that will not work if TREVOR gets rebuilt?"*

**Answer: no. Not cleanly.** Much of the campaign's evidence is **double-conditioned** — on the fossil selector *and* the regime gate.

🚨 **Every fact below carries its bucket. Nothing gets quoted without it.**

| Bucket | Meaning |
|---|---|
| 🟦 **CONSTRUCTION-INVARIANT** | True of *any* TREVOR on this venue. Arithmetic, or a property of crypto perps. **Survives the rebuild.** |
| 🟨 **PATH-CONDITIONED** | Measured on the 536 trades *v4* produced. **v5 may void it.** **Cannot be used to kill a rebuilt construction.** |

---

## 2. 🟦 CONSTRUCTION-INVARIANT — binds v5 too

**`[FROM-GHOST]`**

| Fact | Number | Why invariant |
|---|---|---|
| 🚨 **The cost bar** | **8.098 bps round-trip** | Arithmetic on the fee schedule. Derived twice independently (A1: 8.098 · A6: 8.0997). **Frequency-invariant. Every trade in v5 pays it.** |
| 🚨 **Real fees** | **+14.42% over** flat 9-bps | Cohort-dependent (winners +38.8–40.5%, losers −2.5 to −5.7%). Use `fees_usd_true`. |
| 🚨 **Scale-invariance** | E[aX] = aE[X] · **6 methods** | Arithmetic. Size multiplies the whole distribution — winners *and* losers. ⚠️ **Does NOT forbid a rebuilt construction from having different components.** |
| 🚨 **One beta factor** | **PC1 = 69–81%** · **ρ ≈ 0.655** · down-tail **ρ → 0.87+** | A property of **crypto perps**. v5 on these 10 faces it. 🚨 **The core obstacle to "hedging" as diversification.** |
| 🚨 **Effective bets** | 4-slot cap ≈ **1.4**, not 4 | Three methods (A2 PR 1.50 · A6 avg-ρ 1.23 · A10 MTM-ρ 1.3–1.6). |
| 🚨 **The wall** | bar **\|t\|>3.5** · deflated ceiling **1.4–1.7** · **n_req ≈ 6,011** = 3.6–16.5 yr | ⚠️ **Statistical PROOF is unreachable. v5's bar is Ghost's (net-positive weeks), not the house's.** |
| **Slippage** | **NET BENEFIT −$3.11** | Never a loss driver. |
| 🚨 **Liquidation tail** | **2025-10-10: −48% to −86%, 6 tickers, ONE DAY**, invisible to every label | A market fact. **The single biggest threat to the week-long sleeve.** |
| **The venue** | Hyperliquid, fixed | Real breadth needs markets it can't reach. **The instrument may be the constraint.** |

---

## 7. 🚨 THE CORPSE LIST — and its boundary

**`[FROM-GHOST]`** **Settled NO for v4. Do not re-ask *as v4 questions*.** ⚠️ **Read the boundary — it is what separates a rebuild from a resurrection.**

**Entry:** RM-ENTRY's K=114 · `total_score` · `confidence` as-is · **raising the confidence floor (ACTIVELY HARMFUL)** · OBI/CVD/VPIN as computed · cross-sectional ranking · sessions (0/12) · weekday · funding top-of-hour (p=0.40) · **funding carry as alpha (103:1)** · liquidation-cascade capture as a **non-directional** structure.

**Exit:** **all time-cuts (0/5)** · timeout re-tune · stale wall · adverse-hold · **winner-side trail geometry** (winners capture 80–91% of peak) · **`momentum_exit` as a winner-cutter (REFUTED — loser-cutter)** · per-ticker scoped stop · every ticker×direction×regime cell (interaction variance **0.0000**) · the 1–3 day static barrier grid (270 cells, GEOMETRY-FAILS).

**Sizing/portfolio:** **adding capital (scale-invariant, 6 methods)** · Kelly / edge-proportional · **confidence-scaled sizing (HURTS, t≈−2.3)** · all conditional sizing · vol-targeting as a rescue · net-exposure / max-concurrent / cluster caps · per-ticker tilt · **LONG/SHORT static tilt** · **static cluster map as diversification (REFUTED, ρ 0.694)**.

**Structural:** 🚨 **regime-conditional anything as a trading input (BLOCKED — C1b: HMM labels 77.2% wrong)** · TRENDING stand-down · R3 macro risk-off · fee-tier chase ($0) · maker as the rescue (Sharpe −109) · market making · re-optimizing execution · slippage-recovery routing (≈$0) · **the slow trend engine (KILLED — 3 kills, 3 methods)** · all 8 RM-QUANT strategy families.

**Quant vocabulary does not resurrect a corpse.** *"Risk-adjusted sleeve sizing" = Kelly. "Dynamic horizon allocation" = conditional sizing. "Multi-strategy risk budgeting" = the cap family.*

### 🚨 THE BOUNDARY (formalized from Ghost's challenge)

**`[FROM-GHOST]`** **Every corpse was killed under one of two conditions:**
1. **On the 32-min scalper, in ONE 14-day calm window, with the fossil's features** → 🟨 **path-conditioned. v5 may void it.**
2. **On 4 years of DAILY bars** → 🟦 real, multi-regime — 🚨 **but at the WRONG HORIZON, and it could not test layers that don't exist yet.**

🚨 **The test for any v5 proposal:** *"is this re-running a dead lever on the same data with the same construction (CORPSE — stop), or asking what the corpse never answered — at v5's horizons, in v5's portfolio, with layers that didn't exist (LEGITIMATE)?"*

⚠️ **Both failures are real:** lazily killing a new question with the corpse list, and letting a dead lever through under a new name. **Neither is acceptable.**

---

## 8. THE LAWS

**`[FROM-GHOST]`**

| Law | Content |
|---|---|
| ⚠️ **RULE 30 — RELAXED 2026-07-17** | **See §9. No longer an absolute production law.** ⚠️ **§D.10 goes further and DISSOLVES it — §C contradiction #5.** |
| 🚨 **Phantom-bleeder** | `DISTINCT trade_id` before ANY sum. Raw row-sum off **100–1000×**. |
| 🚨 **Canonical P&L** | `flat = SUM(pnl_usd + partial_pnl_realized)` · `true = flat − SUM(fees_usd_true − fees_usd)`. **Naive `SUM(net_pnl_usd_true)` = −$77.98 = WRONG** vs canonical **−$41.7721**. ✅ *(Write-path only — not on any surface Ghost reads.)* |
| 🚨 **Notional trap** | `auto_trades.notional_usd` **IS posted margin.** ÷leverage = **~7× wrong.** Use `original_notional_usd`. |
| 🚨 **Additive-DB** | ALTER ADD / INSERT / new-column UPDATE only. **No DROP, DELETE, TRUNCATE, non-NULL overwrite.** |
| 🚨 **Clock truth** | `opened_at`/`closed_at` = **naive Eastern** (subtracting = SAFE). `created_at`/`equity_snapshots.ts` = **UTC**. **4h offset** to join. Candles UTC. |
| 🚨 **Leakage family** | `stop_price` · `notional_usd` · `mae_pnl_pct` (**leverage proxy, corr=1.000**) · `peak_pnl_pct` · `peak_price` · `trough_price` · `adverse_price` · `ratchet_locked_r` · `breakeven_stop_active` · `native_*_oid` · `funding_paid_usd` · `partial_pnl_realized`. 🚨 **`stop_price` + `notional_usd` made \|t\|~10–20 fakes that PASSED OOS AND LOO.** |
| 🚨 **The ruler's blind spot** | Catches banned **ledger columns**, **NOT look-ahead in a DERIVED feature.** **Leak persists at `/tmp/rmr_a3/harness.py:82-83` + `fam_INTERACTIONS.py:314-318`.** |
| 🚨 **`underpowered-abandoned` ≠ `proven-negative`** | `shadow_history.db` is **fail-CLOSED** — a wrong tag is a **permanent lie for the LIFE of the project.** ⚠️ **The K=114→0 mis-tag is WHY RM-REBUILD existed.** |
| ⚠️ **NO-CO-FLIP — REFRAMED 2026-07-17** | Written for **separable levers**. 🚨 **v5 is a portfolio where everything interacts — per-lever attribution was never meaningful. The unit of measurement is the CONFIGURATION, not the lever.** The rule survives as: **compare configurations, pin each one, never claim a per-lever number.** |
| **Frozen** | `active_trades` frozen 2026-04-22. Live positions = `auto_trades WHERE status='open'`. |
| **Epoch** | `AUTO_CUTOVER_EPOCH = 2026-07-02 01:43:27 UTC` — the **v4** floor. 🚨 **v5's cutover sets a NEW epoch.** |

---

## 9. 🚨 DECISIONS ON RECORD

### The 12 answers — Ghost, 2026-07-17

**`[FROM-GHOST]`** *(treat as **hypotheses to build from**, not commandments — his words: *"take all of my answers as hypotheticals"*)*

| # | Question | Ghost's answer |
|---|---|---|
| **1** | Frozen or trading while we build? | 🚨 **NO UNBLOCK.** *"Idc about loss along the way. Once this is all built we will do a cutover, and add capital to begin the test phase."* **Reason: every change to how it trades changes everything downstream — path dependence.** |
| **2** | Shadow mode acceptable? | ✅ **YES.** 🚨 **Separate roadmap → another chat.** Reconstruct the shadow system for the new understanding. |
| **3** | What number = success? | 🚨 **Gains a day; a week-to-month ending NET POSITIVE.** *"Some days will be losses — that's what working together is about. Net gains over time but stacked so it adds up."* |
| **4** | Is $31.29 expendable? | ✅ **YES — and the added capital too.** *"Can't have everything blown in one day, but a few dollars loss on some days won't kill me."* |
| **5** | How long is "longer term"? | 🚨 **Up to a WEEK.** With minutes-scale trades running alongside — *"making up funding rates money, hedging, or simply making good short term trades while the week long one really grows in size and could end +100%."* |
| **6** | 🚨 **Rule 30 still absolute?** | 🚨 **NO — RELAXED.** *"I want all options open, I do not want restrictions."* **The mechanism: ticker/direction what-ifs become SHADOW TESTS, not production blocks.** His example: *"what if the port traded without FARTCOIN/DOGE/HYPE shorts — this would become a shadow to test."* ⚠️ **Reading: relaxed for EXPLORATION. Production adoption still requires shadow evidence. Claude proposes shadows, never silent production blocks.** |
| **7** | G3 fixed-dollar sizing? | ❌ **STILL DECLINED.** *"I don't need to minimize losses, I need to maximize gains. A few dollars loss a day is the price of learning and training data."* |
| **8** | Which hedging? | 🚨 **BOTH.** *"Whatever could have potential."* |
| **9** | Selector: strip or replace? | 🚨 **"Entirely how much it benefits the new version."** The selector was a Discord alert bot's base. **TREVOR is v4; this cutover marks v5.** Fully autonomous, **no manual intervention. CC is the sole changer. Shadows determine possible edges.** |
| **10** | STOP-8 / P3? | **Ghost didn't recognize them** → explained (see §H.2). **His call, folded into the v5 decision.** |
| **11** | Time budget? | 🚨 **ALL LIVE THIS WEEK. Training goes live this week too.** *"Expecting things to be rocky while I build and go live, and for a time after — that's what training is there for."* |
| **12** | If intraday returns 0? | 🚨 **SHIP ANYWAY. DON'T STOP.** *"Intraday might come back 0 bc it cannot test new unbuilt layers and structure. That's what the rebuild and the new training is for."* |

### 🚨 CLAUDE'S DECISIONS — delegated by Ghost, 2026-07-17

**`[CLAUDE-DELEGATED]`**

| Decision | Call | Reasoning |
|---|---|---|
| **#10 — STOP-8 + P3** | 🚨 **RETIRE BOTH AT THE CUTOVER.** Their window recorded **zero trades** — nothing to preserve. **Declare it void.** | They are **v4 constructs**. `STOP_TRIM_8_ENABLED`'s 8% trim → becomes a **per-sleeve stop parameter** in v5 (each sleeve needs its own stop → its own leverage via the coupling). `P3_ENTRY_SCREEN_ENABLED`'s liquidity screen → becomes a **v5 execution-quality question, tested in shadow.** ⚠️ **Neither is inherited blind as a legacy toggle.** |
| 🚨 **TIMEFRAME** | **LIVE sleeves = minutes → ~24 hours.** **Multi-day and week-long = SHADOW ONLY**, accruing from day one, **promotable on evidence.** | v4's longest hold **ever** is **1.35h**. 24h is **~18× beyond anything TREVOR has done** — genuinely new, and it tests the "longer" thesis for real. It **bounds the tail**: a 24h hold at low leverage survives a cascade day; a week-long one at scalp leverage does not. Funding: **~24 stamps vs ~168** *(⚠️ Hyperliquid's funding interval needs live verification — do not hardcode)*. 🚨 **THE DOOR STAYS OPEN — that is the point of shadowing it. If shadow shows the multi-day sleeve working, it promotes and Claude was wrong. Nothing is killed.** |
| 🚨 **TICKER SCOPE** *(Ghost's addition)* | **Accepted → its own recon slice.** | 🚨 **The ONE place "working together" has a mathematically real mechanism.** ρ=0.655 → **~1.4 effective bets** from 10 tickers. **Lower ρ → more effective bets → ACTUAL diversification, not a costume.** 🚨 **The real question: does Hyperliquid list anything NOT on the crypto beta factor?** The MASTER said *"real breadth needs cross-asset markets Hyperliquid can't reach"* — **but nobody checked what Hyperliquid actually lists now.** A non-crypto perp on that venue would be **the first genuine breadth this project has ever had access to.** ⚠️ **Alternative outcome Ghost named: leave it to shadowing.** |

### Standing decisions

**`[FROM-GHOST]`**

| Decision | Who | Status |
|---|---|---|
| **G1** (leakage whitelist) + **G2** (canonical P&L) | Ghost — **ACCEPTED** | 🚨 **Never built.** Campaign ran the whitelist BY HAND. |
| **G3** fixed-dollar sizing | Ghost — **DECLINED**, reconfirmed 2026-07-17 | |
| **Hyperliquid** | Ghost — the ONE fixed constant | Not investigable. |
| **Nothing ported from sibling bots** | Ghost | Standing. |
| 🚨 **Path-conditioning challenge** | Ghost, 2026-07-17 | **CONCEDED by Claude.** Drove §0, §4, §7-boundary. |
| 🚨 **v5 = this cutover** | Ghost, 2026-07-17 | **The rebuild's name.** |
| 🚨 **Training gets its own Hub page** | Ghost, 2026-07-17 | *"Dedicated to keeping track of the training of the 'working together, pattern, memory, knowing how to gain the profit' page."* |

---

## 10. 🚨 OPEN

### ✅ The 13 v5 questions — ALL ANSWERED 2026-07-17

**`[FROM-GHOST]`** **Full detail in `RM_V5_MASTER_Roadmap_of_Roadmaps.md` §5 + §7. Headlines:**

- **v5 replaces v4 in place** (an overhaul) · **capital ~$81** ($31 + ~$50) · **concurrent positions = a design output, not an input**
- 🚨 **The swarm gets remodeled** — *"6 might not be enough now. Reform to the best new system, but keep the context. The only thing that matters to me is scalp perp trader on Hyperliquid."*
- 🚨 **ROADMAP OF ROADMAPS** — the overhaul is too big for one roadmap. **9 roadmaps + a master.**
- 🚨 **The TRAINER** = shadow's structure + working-together tracking + **LEVEL tagging.** Continuous. Uses **all** data (live + shadow + sim). **Nothing ever deleted.** **Everything retests on level increment.**
- 🚨 **A PROMOTIONS PAGE** — Ghost reads what hit and what to archive; **CC executes.** *(This is how "no manual intervention" and "CC is sole changer" reconcile: Ghost never trades by hand — he approves promotions.)*
- 🚨 **Level increment = any money-path or flag change.** Hub-only / non-invasive fixes → no increment.
- **Kill switch: 25% of DAILY STARTING capital. Ghost decides continuation via a CC prompt.** ⚠️ **CONTRADICTED by §D.9 round 29 — §C contradiction #3.**
- 🚨 **Exit engine: KEEP IT** — *"that's what works. Repremise the project, but don't scrap everything."* ⚠️ **CONTRADICTED by §D.6 round 21 — §C contradiction #1.**
- **Funding sleeve: DISREGARD** — it was only about week-long holds, now shadow-only. ⚠️ **CONTRADICTED by §D.6 round 28 — §C contradiction #10.**
- **v4's 536 trades:** building v5 **uses** them; v5 post-cutover **ignores** them.
- 🚨 **TICKERS WERE PERSONAL, NOT PERFORMANCE** — *"Please broaden. Investigate any token, every possibility."* **The single biggest unlock in the project's history.**
- 🚨 **Cutover gate:** nothing ships until **every** roadmap + **every** deferred item is complete. **All untested → cutover → Level 1.**

### 🚨 Claude's delegated calls (Ghost: "you decide")

**`[CLAUDE-DELEGATED]`**

| Item | Call |
|---|---|
| **STOP-8 + P3** | **Retire at cutover.** Zero trades recorded — void the window. 8% trim → a per-sleeve stop param (R5). Liquidity screen → a shadow question (R6). |
| **Timeframe** | **LIVE: minutes → ~24h. SHADOW: days → a week**, accruing, promotable. **Nothing killed.** |
| **Shadow vs Trainer** | 🚨 **ONE system, TWO views.** One engine, one archive, one level model, a `kind` column. **Two systems = two sources of truth = gaps.** |
| **Journal artifact** | 🚨 **DB-primary** (CC must query it, level-indexed, never deleted). **Markdown renders FROM the DB.** Obsidian export later, optional — **never the store.** |
| **Swarm context** | 🚨 **KEEP the knowledge, REPLACE the plumbing.** Keep `brain/*` (sacred) + ChromaDB memory + history-as-reference. **Reform the agent topology freely — "6 agents" is plumbing, not the mind.** ⚠️ **CONTRADICTED by §D.6 round 27 — §C contradiction #2, WITH AN OPERATIONAL HAZARD.** |

### 🚨 THE SEARCH PROBLEM — Ghost's reframe, 2026-07-17 (full detail: MASTER §2.5)

**`[FROM-GHOST]`** ⚠️ **Claude's first framing was WRONG. Recorded so it is never repeated:** Claude modelled the trainer as a **hypothesis-testing machine** and called the retest loop a "self-feeding false-promotion loop."

🚨 **Ghost's correction — and he is right:** *"If it doesn't retest, then it won't be able to see if what was tested worked with the new thing... See how it could be an endless loop a tad — **but that's the point**, there are endless combinations."*

**His worked example (the shape of the whole problem):**
**L15** HYPE+SOL+BTC → **L16** SOL+HYPE *(BTC was wearing SOL down)* → **L17** SOL only *(HYPE also hurt)* → **L18** SOL+BTC *(is BTC still hurting SOL? maybe not now)* → **and HYPE must now be retested against BTC alone, because it was only ever judged alongside SOL.**

### 🚨 THE REFRAME: the trainer is an OPTIMIZER, not a p-value factory

**`[FROM-GHOST]`** **The endless loop IS search, and search is supposed to be endless.** 10 tickers = **2^10 = 1,024 subsets**; add size × leverage × timeframe × direction × hedge-pairing → astronomical. 🚨 **It cannot be grid-searched. It must be SEARCHED.**

**Wrong tool:** FWER/Bonferroni across all arms. **Right tool:** overfitting control + intelligent allocation.

### 🚨 THE MACHINERY EXISTS — SERVANT, never wired up ([B2] G-8)

**`[SURVIVING-VERBATIM]`** `SERVANT_ENABLED = false`. **The PBO / Deflated-Sharpe / walk-forward machinery EXISTS and was NEVER traced to a shipped lever.** 🚨 **It is R7's spine, not decoration.**

**`[FROM-GHOST]`**

| Tool | Role |
|---|---|
| 🚨 **Deflated Sharpe** | **Takes trial-count as an INPUT** — states how good a result must be *given* how much you searched. |
| **PBO** | Is the best config good, or did you just look a lot? |
| 🚨 **Online FDR / alpha-investing** (LORD, SAFFRON) | **Built for INFINITE hypothesis streams.** An **alpha budget**: tests spend, **discoveries pay back**. 🚨 **A trainer finding real things earns more search; one chasing noise throttles itself.** ← **This IS Ghost's "grow and evolve with each level."** |
| **Bandit allocation** (Thompson/UCB) | Allocates by **expected information gain** — turns L15→L18 from spinning into principled search. |

### 🚨 TWO TRAPS for R7

**`[CLAUDE-DELEGATED]`**
1. 🚨 **ALPHA-FARMING:** if the budget resets on level increment, **the trainer learns to increment levels to farm alpha.** → carries across levels, partial refresh proportional to how much the money path moved.
2. ⚠️ **NO FREE LUNCH:** more search → more candidates → **each needs a higher bar.** Deflated ceiling t≈1.4–1.7 vs bar 3.5; **more searching makes deflation worse.** 🚨 **WHERE you search > HOW MUCH.**

### ✅ §7.1 CORRECTED — Ghost was right, Claude was closing off

**`[FROM-GHOST]`** **Claude proposed a one-shot recon on return autocorrelation.** 🚨 **Ghost: "It cannot be determined in a recon either. This kinda counts as a 'working together' piece. This will change based on things we change such as tickers. This is where you are closing off again. If stuff like this seems like it won't work or was 'already tested' — that's the problem. Everything will be different with different changes. That's what training is for."**

✅ **CONCEDED.** Autocorrelation is a property of the **return series**, which depends on tickers, entries, exits, sizes. Measuring it on v4's 536 trades describes **v4**, not v5-at-L18. 🚨 **→ a STANDING TRAINER HYPOTHESIS, re-evaluated every level, accumulating evidence across levels. Not a recon.**

⚠️ **THE STANDING LESSON:** *"already tested" is only ever true AT A LEVEL.* **The corpse list is level-conditioned too.**

### Structurally unanswerable (~6, per [B2] G-7 — no data exists and none can)

> ⚠️ **`[R1-MEASURED]` TRANSCRIPTION FLAG:** this heading arrived **triplicated** in the pasted source (`### Structurally unanswerable### Structurally unanswerable### Structurally unanswerable (~6, …)`). **Transcribed ONCE, by Ghost's ruling 2026-08-03.** No content is missing.

**`[FROM-GHOST]`**
- The **intraday** 2022 bear — no sub-daily data before 2024-04-05
- Delisted-token survivorship magnitude
- Per-trade liquidation probability in a 2022-grade cascade
- The cascade-magnitude distribution in the untested ~81%

> ⚠️ **`[UNKNOWN]`** — the heading says **~6**; the record lists **4**. **The other two are not recoverable from the map.** Recorded as a gap, not filled.

### Still open

**`[FROM-GHOST]`**
- 🚨 **What "working together" definitively means** — **to be learned by building + training. THE central open question.**
- 🚨 **The scalp-horizon transfer** (UNKNOWN #4)
- 🚨 **Does the regime gate feed the same classifier C1b proved 77.2% wrong?** — **load-bearing for v5's gate removal**
- The bear-inversion question ([B1] — untestable in-window)
- Whether post-flush/bear-reversion clears at adequate `n`
- An entry-time predictor of fast resolution (none found, **r=0.16**)
- Order-flow / on-chain / tick features TREVOR doesn't collect
- 🚨 **THE UNIVERSE QUESTION (Ghost, 2026-07-17): should tickers be added/removed for better "working together"? Does Hyperliquid list ANYTHING off the crypto beta factor?** — its own recon slice
- 10→16 effective-bets re-test
- Whether low-vol-long is a real filter in high-vol (~33%) vs the degenerate calm block it is now
- 🚨 **`[FROM-GHOST]`, from §R.7: GCP bill down, or Claude API room? — different bills, fixed by different things. UNANSWERED.**

### Infrastructure debt

**`[FROM-GHOST]`**
- 🚨 **`/tmp/rmr_a3` + `/tmp/rmr_a10` — only copies of A3/A10 code**
- **G-2 harness fix** — expanding-window quantile + fire-mask review step
- **G1 + G2** — absent from live code
- **Archive defects** — malformed taxonomy row (`RECON-RECON-ARCHIVE-001`), 38 subsystem variants, 004/005 holes, latent slice-prune

---

## 12. HOW WE WORK

**`[FROM-GHOST]`**
- **Roadmap first** for anything >3 prompts. Chatbot-side. **CC never sees it.** ⚠️ **`[R1-MEASURED]` — THIS SENTENCE IS THE PROPAGATING ERROR. It is TRUE of the map and FALSE of the on-box design snapshot, and it taught every prompt that the design was off-box. See the header.**
- **Waves:** A recon (read-only, parallel) · B parallel build (lock-guard) · C solos (DB schema / CLAUDE.md single-writer) · D rare, Ghost-approved only.
- **2 prompts authored per turn.** `go wave [X]` → first 2. `continue` → next 2. 🚨 **Authoring ≠ running. Never interleave.**
- **Up to 5 parallel per box.** VM = `trevor@trevor-prime-2` (bot, live DB). WSL = `ghost@Ghost` (Hub, recon, the `ssh vm` pipe).
- **Two screenshots per prompt:** the Phase 0 gate, and the final summary. **Pushes are automatic.**
- **Every recon:** archive-check at Phase 0, register on delivery. **>3 recons → all save, last slot compiles ONE master.**
- **Every build:** box check · Phase 0 + Thoughts? Gate · per-file `lock_acquire` · sacred manifest 13/13 · flags default OFF · additive DB · regression-pattern checks · `Causes found: N` · honesty protocol.
- 🚨 **Audit-first.** Every line number here is a **HINT to confirm live**, never a fact to hardcode.
- 🚨 **Sacred files** (explicit Ghost approval to edit): `brain/IDENTITY.md` · `brain/BRAIN.md` · `brain/SOUL.md` · `brain/AGENTS.md` · `swarms_brain.py` · `training_bridge.py` · `signal_guard.py` · `signal_cooldown.py` · `signal_cleanup.py`.

---
---

# 🚨 §C — CONTRADICTIONS: where the record disagrees with itself

> 🚨 **THE RULE: the LATER ROUND WINS. BOTH SIDES STAY ON THE PAGE, with their round numbers.**
>
> **This section resolves nothing by reading code.** A contradiction resolved by looking at the implementation would be exactly the circularity this file exists to end.

**Contradictions found: 11.**

### 🚨 #3 — THE KILL SWITCH. A LIVE SAFETY BEHAVIOUR. THE TWO READINGS DIFFER IN WHAT HAPPENS AFTER A 25% DAY.

| Side | Text | Round / date |
|---|---|---|
| ❌ **LOSES (earlier)** | **`[FROM-GHOST]` §10:** *"Kill switch: 25% of DAILY STARTING capital. **Ghost decides continuation via a CC prompt.**"* | §10, 2026-07-17 |
| ✅ **WINS (later)** | **`[FROM-GHOST]` §D.9:** *"Kill switch: 25% of DAILY STARTING capital. Trips → **resumes next day** at the new lower daily-start (#6, round 29). **No manual sign-off to resume** — but Ghost is 'monitoring hard, instantly fixing whatever caused it.'"* | **round 29** |

🚨 **THE RESOLVED DESIGN: the kill switch AUTO-RESUMES the next day at the new lower daily-start. There is NO human gate on resumption.** The earlier reading would have halted trading until Ghost ran a prompt; the later one does not. **These are materially different live behaviours after a 25%-loss day, and a builder who read only §10 would build a manual gate that Ghost did not ask for.**

### 🚨 #2 — `brain/*`: KEEP vs REWRITE. Design permission with a ~20× cost consequence.

| Side | Text | Round / date |
|---|---|---|
| ❌ **LOSES (earlier)** | **`[CLAUDE-DELEGATED]` §10:** *"Swarm context: **KEEP the knowledge, REPLACE the plumbing. Keep `brain/*` (sacred)** + ChromaDB memory + history-as-reference. Reform the agent topology freely — '6 agents' is plumbing, not the mind."* | §10, 2026-07-17 |
| ✅ **WINS (later)** | **`[FROM-GHOST]` §D.6 #2:** *"The swarm/brain is **REWRITTEN** — `brain/*` was built for the alert-bot era → **fair game to rewrite**."* | **round 27** |

🚨 **THE RESOLVED DESIGN: `brain/*` is fair game to rewrite.**

> ⚠️ **`[FROM-GHOST]` OPERATIONAL HAZARD, ON THE PAGE BESIDE IT — Ghost's explicit instruction, 2026-08-03.** *"Fair game to rewrite" is a **DESIGN PERMISSION with a ~20× cost consequence attached.* Those bytes are:
> - **SACRED** — `brain/IDENTITY.md`, `brain/BRAIN.md`, `brain/SOUL.md`, `brain/AGENTS.md` require **explicit Ghost approval** to edit (§12) and are **manifest-enforced** (`.sacred_manifest.sha256`, 13/13).
> - 🚨 **THE CACHED PREFIX.** `brain/* ≈ 7,523 tokens injected as the cached prefix on EVERY swarm call.* **"Keep the context" = preserve these bytes or Haiku's cache breaks → ~20× cost blowup."**
>
> 🚨 **BOTH FACTS ARE THE DESIGN. The permission is real AND the cost is real. A rewrite is authorized; a rewrite that ignores the cache economics is not what was authorized.**

### #1 — The exit engine: KEEP vs REPURPOSE

| Side | Text | Round / date |
|---|---|---|
| ❌ **LOSES (earlier)** | **`[FROM-GHOST]` §10:** *"Exit engine: **KEEP IT** — 'that's what works. Repremise the project, but don't scrap everything.'"* | §10, 2026-07-17 |
| ✅ **WINS (later)** | **`[FROM-GHOST]` §D.6 #4:** *"Exit engine: **REPURPOSED to flow with the sleeves** — **NOT kept as-is.** Keep only what's needed to make the new system smooth. Different-horizon sleeves need exits that fit them."* | **round 21** |

**RESOLVED: repurposed, not kept as-is.** ⚠️ **Both texts agree it is a strong incumbent** — §D.6 #5: *"the exit engine beat 298 alternatives — treat it as a STRONG INCUMBENT CHAMPION (a high prior to beat), not a protected component."*

### #5 — Rule 30: RELAXED vs DISSOLVED

| Side | Text | Round / date |
|---|---|---|
| ❌ **LOSES (earlier)** | **`[FROM-GHOST]` §8 + §9 #6:** *"RULE 30 — **RELAXED** 2026-07-17. No longer an absolute production law."* Mechanism: ticker/direction what-ifs become shadow tests. | 2026-07-17 |
| ✅ **WINS (later)** | **`[FROM-GHOST]` §D.10:** *"**Rule 30 is DISSOLVED as a production law; it survives only as trainer-caution.**"* Tickers are a *"think harder before changing"* axis — **extra caution, not a block.** | **round 24** |

🚨 **RESOLVED: DISSOLVED as a production law, surviving only as trainer-caution.** ⚠️ **Do NOT restore this toward the older absolute form. Never block any ticker or direction.**

### #4 — Is the book frozen?

| Side | Text | Date |
|---|---|---|
| ❌ **LOSES (earlier)** | **`[FROM-GHOST]` §5:** *"The book is **FROZEN.** Zero trades since 2026-07-17 08:52:34 ET. N = exactly **536**. 0 open. Equity static at **$31.2873**."* | §5, 2026-07-17 |
| ✅ **WINS (later)** | **`[FROM-GHOST]` §R.1:** *"**The book is NOT frozen** — v4 resumed, **3 trades after the 'frozen' pin**, one closed *during the recon*. **Equity $31.29 → $30.74.** The 'freeze' was **regime starvation**, not a stop."* Ghost's call: **"LET IT BLEED. *Idc lol.*"** | **§R.1, 2026-07-17 recon** |

**RESOLVED: not frozen; regime starvation, not a stop; let it bleed.** ⚠️ **Both figures are DEAD STATE — see §H. Neither is current.**

### #6 — Who builds the level model: R2 or R6?

| Side | Text |
|---|---|
| **`[FROM-GHOST]` §R.3** | *"**R6 + R7 are largely ONE job** … Consider folding them into one 'discovery loop' roadmap, with **R2 owning only the shared math library + level model**."* (a recommendation) |
| **`[FROM-GHOST]` §D.3 + §R.5** | *"**THE LEVEL MODEL (the spine — R6 builds it FIRST)**"* · *"**R6 builds the LEVEL MODEL FIRST** — most-tested component."* |

⚠️ **Unresolvable by round order — §R.3 is a recon recommendation and §D.3 is the design.** 🚨 **The ON-BOX FRAME (2026-07-18, later than both) adopted §R.3: `R2 — LEVEL MODEL`. See §X divergence #1.**

### #7 — Does the trainer pause during a promotion?

| Side | Text | Round |
|---|---|---|
| ❌ **LOSES (earlier)** | **`[FROM-GHOST]` §D.4:** *"During a promotion's apply: Ghost hits a **Hub PAUSE button** for the trainer → runs the CC prompt → resumes."* | round 11 |
| ✅ **WINS (later)** | **`[FROM-GHOST]` §D.12.7:** *"The trainer's search does **NOT** pause for a promotion — it keeps searching against the OLD champion until the level flips. The Hub PAUSE button is for when CC is **mid-CODE-change**, §D.4 — not for a normal promotion."* | **rounds 30–34** |

**RESOLVED: no pause on a normal promotion. The PAUSE button is scoped to mid-code-change only.**

### #8 — How many roadmaps?

| Side | Text |
|---|---|
| **`[FROM-GHOST]` §11** | *"**v5 needs THREE roadmaps**"* — RM-V5, RM-SHADOW, RM-TRAIN. |
| **`[FROM-GHOST]` §10** | *"**ROADMAP OF ROADMAPS** … **9 roadmaps + a master.**"* |
| ✅ **`[FROM-GHOST]` §D.9 (later)** | *"**ALL ~10 roadmaps complete**"* |

**RESOLVED in-map: ~10.** 🚨 **But the ON-BOX FRAME (2026-07-18) locks FOURTEEN, R0–R13 — and the build followed the frame. §X divergence #1. This is the single most consequential divergence in the record.**

### #9 — Week-long holds: LIVE or SHADOW?

| Side | Text |
|---|---|
| ❌ **LOSES (earlier)** | **`[FROM-GHOST]` §1:** *"v4 horizon: ~32-min scalps … **v5 extends to a week.**"* |
| ✅ **WINS (later)** | **`[CLAUDE-DELEGATED]` §V timeframe ruling, 2026-07-17:** **LIVE minutes → ~24h. Multi-day / week-long = SHADOW ONLY**, accruing, promotable on evidence. |

**RESOLVED: week-long is SHADOW-ONLY at cutover.** 🚨 **Nothing is killed — it promotes on evidence.**

### #10 — Funding: DISREGARD or emergent?

| Side | Text | Round |
|---|---|---|
| ❌ **LOSES (earlier)** | **`[FROM-GHOST]` §10:** *"Funding sleeve: **DISREGARD** — it was only about week-long holds, now shadow-only."* | §10, 2026-07-17 |
| ✅ **WINS (later)** | **`[FROM-GHOST]` §D.6 #3:** *"Funding: **factored in where it helps** (emergent, like hedging) — Claude + CC decide where at build time. **Not a dedicated sleeve.**"* | **round 28** |

**RESOLVED: funding is factored in as EMERGENT, not built as a dedicated sleeve, and not disregarded.** ⚠️ Both sides agree there is **no dedicated funding sleeve** — they disagree on whether funding is considered at all. **`[FROM-GHOST]` §V still lists "Funding capture — *'making up funding rates money'*" as a named working-together piece**, consistent with the later reading.

### #11 — The cascade date: 2025-10-10 or 2025-10-14?

| Side | Text |
|---|---|
| **`[FROM-GHOST]` §2 + §D.10 invariants** | *"Liquidation tail — **2025-10-10**: −48% to −86%, 6 tickers, ONE DAY"* |
| **`[CLAUDE-DELEGATED]` §V timeframe ruling** | *"**2025-10-14** class events (−48% to −86% across 6 tickers in ONE DAY)"* |

⚠️ **`[UNKNOWN]` — the record states two different dates for the same event with identical magnitudes.** **Not resolvable from the map, and deliberately NOT resolved from code or from an external source.** 🚨 **The magnitudes agree and are the load-bearing part; the date is a transcription-grade discrepancy `[R2]` should settle against the venue's actual history, not against TREVOR's code.**

---
---

# 🚨 §X — MAP vs ON-BOX SNAPSHOT

> **`[R1-MEASURED]`** — approved by Ghost 2026-08-03 as **additive recording only. Not a single word of the map is changed.**
>
> 🚨 **The MAP is what Ghost intended. The SNAPSHOT is what the build was told.** Where they diverge, **that divergence IS evidence.** `[R2]` audits against **both**.

### 🚨 DIVERGENCE #1 — THE ROADMAP NUMBERING. The map's is dead, and the build already followed the other one.

| Source | Dated | Numbering |
|---|---|---|
| **THE MAP** | 2026-07-17/18 | *"~10 roadmaps"* / *"9 roadmaps + a master"* / *"three roadmaps"*. **R6 = level model** (§D.3) · **R3/R4/R5 = the money-path rewrite** (§D.6) · **R6/R7 = shadow + trainer** (§D.12.5) · **R7 = SERVANT's spine** · **R8 = Hub** · **R9 = pre-flight** |
| ✅ **`docs/design/v5_ROADMAP_FRAME.md`** | **2026-07-18**, committed 07-19 (`41fafae`) | **FOURTEEN, R0–R13.** R0 ops · **R1 universe** · **R2 LEVEL MODEL** · R3 validation math · R4 signal · **R5 BOT-BRAIN** · **R6 PORTFOLIO ENGINE** · **R7 EXIT ENGINE** · R8 shadow+loop · **R9 TRAINER** · **R10 WATCHER** · **R11 MEMORY** · **R12 HUB** · **R13 CUTOVER** |

🚨 **THE FRAME WON, AND THE BUILD PROVES IT.** `[R1-MEASURED]`, from `scripts/check_preferences.py` over `CLAUDE.md`'s preference record:
- *"**R5 Bot-Brain** EXECUTION-JUDGMENT layer — `BOTBRAIN_JUDGMENT_ENABLED` … **2026-07-20**"*
- *"**R6 Portfolio Engine** — SLEEVE CONFIG SCHEMA foundation `auto_trader/sleeves.py` … **2026-07-20**, commit `f3cf100`"*
- *"**R7 Exit Engine** — PER-SLEEVE EXIT PROFILES … **2026-07-21**, commit `734e156`"*

> 🚨 **CONSEQUENCE: EVERY ROADMAP REFERENCE IN THE MAP POINTS AT THE WRONG ROADMAP.** The map's *"R6 builds the level model FIRST"* names, in the numbering the build actually used, the **PORTFOLIO ENGINE**. Its *"R7's spine"* names the **EXIT ENGINE**, not the trainer. **A reader who quotes the map's roadmap IDs without this table will mis-attribute every one of them.** Read the map for **intent**; read `v5_ROADMAP_FRAME.md` for **which roadmap**.

### DIVERGENCE #2 — The map does not know three of the four on-box files exist

**`[FROM-GHOST]` §D.12.9** names exactly one path: `docs/design/v5_DESIGN_SNAPSHOT_v1.md`.
**`[R1-MEASURED]`, `ls docs/design/` 2026-08-03:** four files. **`v5_DESIGN_SNAPSHOT_v2.md`** (§D.12, *"supersedes v1"*), **`v5_CONTEXT_INDEX.md`** (*"Hand THIS to every new roadmap chat"*), **`v5_ROADMAP_FRAME.md`**. All committed `41fafae`, 2026-07-19 — **after the map's last update.**

⚠️ **A prompt following §D.12.9 literally cross-checks against v1 and misses the superseding v2, the entry point, and the frame.**

### DIVERGENCE #3 — The API ceiling: `$1.00/day` vs `$3/day`

| Source | Value |
|---|---|
| **THE MAP** `[FROM-GHOST]` §R.6 | *"The '$0.25/day cap' is STALE — **live cap is `MAX_DAILY_COST_USD=1.00`**, and active days already run $0.906–$0.965 (within 5% of cap). **Ghost's $2/day trainer needs its own budget key + a cap raise** — it is NOT free headroom."* |
| **`v5_DESIGN_SNAPSHOT_v1.md`** + **`v5_CONTEXT_INDEX.md`** (later) | *"**$3/day total API ceiling** across LLM systems"* · *"`$3/day` total API ceiling; model delegation for efficiency"* |

⚠️ **The snapshot states a `$3/day` TOTAL ceiling the map never mentions** — consistent with the map's *"needs a cap raise,"* but **the raise itself is recorded only on the box, never in Ghost's record.** 🚨 **`[UNKNOWN]` whether Ghost approved `$3/day` or the build inferred it. `[R2]` should ask, not assume.**

### DIVERGENCE #4 — Topology: the map leaves it open, the snapshot decides it

**`[FROM-GHOST]` §R.2** records only that *"'Trainer runs on WSL' doesn't hold as-configured"* — `.wslconfig` caps WSL at `memory=6GB`; Ghost is *"upgrading to 8GB, maybe 10GB"*; recon caution says **8GB is the safe ceiling** and `autoMemoryReclaim=gradual` is the key gap.
**`v5_DESIGN_SNAPSHOT_v1.md` (later)** states it as settled design: *"Trainer/watcher/shadow run on WSL (searcher freezes cost nothing; trader freezes cost money). Live bot stays on the VM. Data path: trainer reads the replica, writes a WSL-local archive, renders on the Hub; promotions become CC prompts run on the VM."*

⚠️ **The rationale — *"searcher freezes cost nothing; trader freezes cost money"* — appears ONLY on the box, never in the map.** `[UNKNOWN]` whether it is Ghost's or Claude's.

### DIVERGENCE #5 — The snapshot names a 12-axis list the map never enumerates

**`v5_DESIGN_SNAPSHOT_v1.md`:** *"THE 12 AXES (the search space): Tickers · Size · Leverage · Timeframe · Direction · Hedge-pairing · Entry/execution · Exit · Timing/context · Portfolio-level · Signal · Cost."*
**THE MAP** repeatedly says *"the 12-axis config space"* and *"all 12+"* (§D.1, §D.12.4) **but never lists them.** ⚠️ **The enumeration exists ONLY on the box.** `[UNKNOWN]` whether Ghost ratified this exact list.

### DIVERGENCE #6 — The snapshot states R10's independence as a requirement; the map does not

**`v5_ROADMAP_FRAME.md`:** *"R10 — WATCHER — independent oversight (**MUST be separate from what it watches**)."*
**THE MAP §D.2** establishes the watcher reviews the trainer and is observe-and-report-only, **but never states the separation as a build requirement.** ⚠️ **A load-bearing constraint recorded only on the box.**

### DIVERGENCE #7 — State drift, expected and harmless

`v5_CONTEXT_INDEX.md` records *"v4 PAUSED (`AUTO_TRADER_ENABLED=false`)"* and *"Equity ~$30.74, frozen."* 🚨 **`[R1-MEASURED]`: `CLAUDE.md`'s live-flag table records `AUTO_TRADER_ENABLED=true`, re-measured `RP-D1` 2026-07-29 (`updated_at 2026-07-23`) — the pause was LIFTED 2026-07-23.** ⚠️ **Both the map's §5 and the snapshot's STATE block are stale on this. `auto_config` is the authority. Neither document is.**

---
---

# 📎 §B4 — POINTER to the code-derived salvage

**`docs/DESIGN_RECORD_R10_R11_R12_RECONSTRUCTION.md`** (`[B4-DESIGN-SALVAGE]`) holds real R10/R11/R12 detail that is **not** in the map — loop names, flag names, the `:3941` RPC endpoint, the `watchlist_scan_loop` decoy trap.

> 🚨 **CARRY ITS CIRCULARITY CAVEAT FORWARD. `[B4]`'s `[INFERRED-FROM-CODE]` statements were derived from the code they would be used to judge, and CANNOT verify that code.** ⚠️ **They may be REFERENCED. They must NEVER sit beside a `[FROM-GHOST]` statement without their tier visible.**

**`[R1-MEASURED]` — measured tier counts in `[B4]`: 34 `[SURVIVING-VERBATIM]` · 13 `[UNKNOWN]` · 9 `[RECOVERED]` · 8 `[INFERRED-FROM-CODE]` instances** (its own summary table reports **4 INFERRED / 10 UNKNOWN** — those are **distinct statements**, not instances; both counts are correct at their own unit).

### ✅ THREE OF `[B4]`'s UNKNOWNs ARE NOW SETTLED `[FROM-GHOST]` — three circular gaps removed from the project

| `[B4]` said | This spec settles it |
|---|---|
| **§1.5 "What R10 is — `[UNKNOWN]`"** — *"does not establish what the watcher watches; what a 'critique' contains; …"* | ✅ **`[FROM-GHOST]` §D.2** — the watcher reviews the trainer after the fact, comments only on problems, teaches the trainer, owns level/ID integrity, observe-and-report only, never auto-halts, has its own reasoning + learning + error subpage. |
| **§2.5 "What R11 is — `[UNKNOWN]`"** — *"does not establish what the three tiers are called … the 'HOT/WARM/COLD' naming appears in `CLAUDE.md`'s roadmap blurb, not in any surviving R11 source"* | ✅ **`[FROM-GHOST]` §D.5** — **HOT / WARM / COLD are Ghost's design**, with what each holds, who manages transitions (trainer + watcher, silently), and that rehydration COLD→HOT is a memory event with **no level change**. |
| **§3.7 "What R12 is — `[UNKNOWN]`"** — *"does not establish what the TRAINER / WATCHER Hub pages display; the nav reorder …"* | ✅ **`[FROM-GHOST]` §D.8** — SHADOWS→TRAINER (promotions as a tab; shadows/search/reasoning subpages), MEMORY→WATCHER (critique/error/level-ID subpages), **DOCS moves to the end before HEALTH**, keep the plain-English design language, **build LAST**. |

> 🚨 **`[R1-MEASURED]` — THE COST, STATED EXACTLY: all three were ALREADY ANSWERABLE ON THIS BOX.** `docs/design/v5_ROADMAP_FRAME.md` names **R10 = WATCHER, R11 = MEMORY STORE, R12 = HUB**, git-tracked since 2026-07-19. **`[B4]` reconstructed them from code while that file sat two directories away** — `grep 'docs/design\|DESIGN_SNAPSHOT\|ROADMAP_FRAME'` over `[B4]`'s text returns **zero hits.** **It never looked.**

**⚠️ NOT upgraded — still `[UNKNOWN]`, honestly:** `[B4]`'s counts of enumerated locked decisions (R10's *"six locked decisions,"* R11's *"7,"* R12's *"7"*), the *"4 blocking B-wave items,"* the *"three structural denials"* vs *"five independence denials"* taxonomy. **The map does not enumerate any of them.** 🚨 **7 of `[B4]`'s 10 distinct UNKNOWNs remain UNKNOWN, and that is the correct outcome.**

---
---

# 📚 APPENDIX — HISTORICAL STATE

> # 🚨 STATE AS OF 2026-07-17 — SUPERSEDED. HISTORICAL ONLY. DO NOT QUOTE AS CURRENT.
>
> ⚠️ **EVERY FIGURE BELOW IS DEAD.** §5 says the book is frozen at **N=536** with equity **$31.2873**; §R says the VM has **2.8G free**, 95% used. **All of it was already false weeks before this file was written** — §R.1 refutes §5's freeze *within the same document*, the disk was reclaimed by OPS-1a/OPS-1b, and `AUTO_TRADER_ENABLED` was flipped back to `true` on 2026-07-23.
>
> 🚨 **A prompt quoting these as current commits exactly the stale-premise failure that has refuted 47 claims across these campaigns.**
>
> ✅ **THEY ARE KEPT, NOT DELETED**, because they are the record of what was BELIEVED when the design was made — and `[R2]` needs them to tell *"the design changed"* apart from *"the world changed."*

## §H.1 — §R: V5 READINESS RECON (RECON-V5-001, 2026-07-17) — SUPERSEDED

**`[FROM-GHOST]`, HISTORICAL**

### §R.1 — Two things that needed Ghost (both actioned)
- 🚨🚨🚨 **VM disk ~34h to 100%** — 48G disk, **95% used, 2.8G free** (deteriorated 90→95% *during* the recon). Cause: **10 daily snapshots = 19GB**; the 14-day cleanup won't cut the oldest until Jul 21; **the keep-2 script (`disk_cleanup.sh`, would reclaim ~16GB) was NEVER SCHEDULED.** At 100% the WAL DB can't commit → **the live bot dies mid-trade.** WAL healthy (21 frames). ✅ **Ghost: CLEANUP NOW + a scheduled routine.**
- 🚨 **The book is NOT frozen** — v4 resumed, **3 trades after the "frozen" pin**, one closed during the recon. **Equity $31.29 → $30.74.** The "freeze" was **regime starvation** (7/10 VOLATILE, gate blocks VOLATILE), not a stop. ✅ **Ghost: LET IT BLEED.** *"Idc lol."*

### §R.2 — Three master premises broken
1. 🚨 **The validation math ALREADY EXISTS and works.** `servant_gate.py` (594 lines, pure stdlib) — real, executing **PBO (CSCV), Deflated Sharpe** (takes `n_trials` as input), **walk-forward-OOS.** SERVANT wasn't removed — RM-DECOM B7 culled **one** job (`rank_shadows`); the gate math + 2 of 3 jobs survive, disabled (`SERVANT_ENABLED=false`), unwired. 🚨 **R2/R7 is a RE-WIRE, not a build.** The ONE genuinely-missing piece: **online-FDR / alpha-investing (α-budget) — not found anywhere.**
2. 🚨 **"Trainer runs on WSL" doesn't hold as-configured.** `.wslconfig` caps WSL at **`memory=6GB`** on a **16GB / 14-core** host. Swap already **4.6GB/8GB (57%)**. **`autoMemoryReclaim` ABSENT.** ✅ **Ghost: upgrading to 8GB, maybe 10GB.** ⚠️ **At 10GB Windows (needs ~7.5GB) swaps — 8GB is the safe ceiling; `autoMemoryReclaim=gradual` is what makes 8GB workable.** **Trainer must stream <400MB** — the archive is **601MB `training_trades`** alone.
3. 🚨 **`/tmp/rmr_a3` + `/tmp/rmr_a10` are GONE** — tmp cleanup deleted them. **The "/tmp rescue" sub-task is VOID.** → recover from the `.md` reports.

### §R.3 — What the master under-scoped
- 🚨 **R4 is a REWRITE, not a refactor.** v4 is **ONE flat hardcoded strategy** — no sleeve / config-set / version tag exists (grep = 0). 🚨 **Honest re-estimate: ~100–140 prompts, ~30–45h** (was 66–87).
- 🚨 **A whole roadmap is MISSING: operational survival.** → **new roadmap R0 (Ops Spine).**
- ⚠️ **R6 + R7 are largely ONE job** — consider folding them, **with R2 owning only the shared math library + level model.** *(→ §C #6; the on-box frame adopted this.)*

### §R.4 — Two answers Ghost waited months for
- 🚨 **THE "$4-ON-$5 FEE" WAS A PHANTOM.** `MAX(fees_usd_true)` across **all 1,745 trades ever = $0.22.** It was the **notional trap.** **Fees are PURELY RATE-DEPENDENT: ~8.21 bps blended, flat across $11–$246 notional, NO floor, NO minimum.** 🚨 **The Size axis has no economically-forced minimum. Question CLOSED.** ⚠️ **Residual: HL docs quote 2.5 bps taker; the ledger implies 4.5 bps/side. UNKNOWN — reconcile in R0/R1.** **The "+14.42%" reconciled:** it is `fees_usd_true` over the internal estimate `fees_usd`, NOT over a 9-bps model; actual 8.21 bps is **8.8% BELOW** flat-9.
- 🚨 **THE REGIME GATE DOES feed the 77.2%-wrong HMM — BUT the HMM has been silently STALE 33.8h**, so the gate falls back to an **unevaluated RULES classifier** (`scalp_engine.detect_scalp_regime`: ADX>25→TRENDING, BB-width<20th→RANGING, else VOLATILE). ⚠️ **Measure the rules classifier's VOLATILE accuracy before blind gate-removal.**

### §R.5 — The fail-closed trap
**30 of 86 blocked shadows were marked dead having NEVER FIRED A SINGLE TRADE** (`verdict='dead' AND n_distinct IS NULL`). **Not proven-negative — ABANDONED, recorded as "proven bad forever."** *(The other 56 have 200–450 trades each — genuinely dead.)* 🚨 **Fatal for v5:** the trainer would **permanently ban its own search space faster than it explores it** — *"autonomous self-lobotomy."* ✅ **Direction → Claude's call: a dead result is only "dead AT LEVEL N." Nothing banned for the life of the project — only deprioritized as a low prior.** *(This design decision is LIVE and sits in §D.3, not here.)*

### §R.6 — Other confirmed facts
- **`DAILY_LOSS_LIMIT_PCT=-25.0` is ALREADY LIVE** (⚠️ confirm it's *daily-starting* based).
- **`MAX_CONCURRENT=0` and `MAX_DAILY=0`** — position caps **disabled live.**
- **The swarm is 6 agents** (4 always-on Haiku + Derivatives ON + Microstructure OFF) + 1 Sonnet synthesis + a dormant Devil's-Advocate. **`brain/* = ~7,523 tokens` injected as the cached prefix on EVERY call** — 🚨 **"keep the context" = preserve these bytes or Haiku's cache breaks → ~20× cost blowup.** *(⚠️ **This fact is NOT historical — it is a live operational constraint. It is carried into §C #2 as the hazard beside the rewrite permission.**)*
- 🚨 **The "$0.25/day cap" is STALE — live cap is `MAX_DAILY_COST_USD=1.00`**, active days run **$0.906–$0.965**. **Ghost's $2/day trainer needs its own budget key + a cap raise.** *(→ §X divergence #3.)*
- **ChromaDB = 1.6GB / 303,637 embeddings / 21 collections.** `servant_vectordb` = a dead 0-embedding shell.
- **Hub:** Next.js 15.5.19, port 3000, zones DASHBOARD/AUTO/INTEL(="SHADOWS")/DOCS/MEMORY/HEALTH. **The promotions page needs a NEW write op on VM `:3940` + `gatewayWrite`** — today display-only.
- **`training_bridge.py` (sacred) is LIVE** — called every entry, influence flag-zeroed.
- **`49Agents` / `cmux` NOT FOUND.**

### §R.7 — VM cost reduction: THE FIGURES (the durable question is in the SPEC)
**Current state (GCP console, 2026-07-18):** ~**$2.30/day** · forecast **$71.59/mo** · **already −70% vs June.** The VM is a fixed **e2-standard-2** (2 vCPU / 8GB); **~90%+ of the $2.30/day is the flat instance hourly rate.**

## §H.2 — §5: THE LIVE STATE (verified [B2], 2026-07-17) — SUPERSEDED

**`[FROM-GHOST]`, HISTORICAL** ⚠️ **Refuted by §R.1 inside the same document — see §C #4.**

| Thing | State |
|---|---|
| 🚨 **The book** | **FROZEN.** Zero trades since **2026-07-17 08:52:34 ET**. **N = exactly 536.** 0 open. |
| 🚨 **The consequence** | **A frozen bot does not bleed. Equity static at $31.2873.** ✅ Ghost's #1: keep it frozen. |
| **The cause** | AT regime gate blocks VOLATILE; 7/10 tickers VOLATILE → `reason=regime_blocked`. *(Hint: `manager.py:1465` — verify live, never hardcode.)* |
| **Causes found** | **4** — C-c scan-gate · C-d P3 screen · C-f alt-data/HMM degradation · **C-g deliberate regime gate = PRIMARY** |
| **`trevor.service`** | ✅ ACTIVE, healthy, **NRestarts=0**, up since 07-15 22:18 EDT. **Not a crash.** |
| **STOP-8 + P3** | Both **ON**, co-flipped **2026-07-15 18:25:53 UTC** as a 1-week paired test. 🚨 **Window never closed; ZERO trades recorded. It measured NOTHING.** ⚠️ **The ~37–46% overlap figure has NO derivation — UNKNOWN, not measured.** |
| **THE PIN** *(byte-identical across all 13 reports, zero drift)* | **N=536 · flat −$36.0675 · true −$41.7721 · WR 56.16% · equity $31.2873 · sha `2412a431051dac2ae2a4d3a96d1f544d7f204b0df36ea279617955efb8117fb0` · bleed −$2.713/day · LONG 269 (−$12.56) / SHORT 267 (−$23.51)** |

## §H.3 — §6: THE CAMPAIGN RECORD (RM-REBUILD — closed) — HISTORICAL

**`[SURVIVING-VERBATIM]`**

| Slice | ID | Verdict |
|---|---|---|
| A1 Data + Honest Ruler | `RECON-REBUILD-001` | 4/4 self-tests PASS. Cost bar **8.098**. |
| A2 Regime Atlas | `-002` | TREVOR's window = **calmest 15–19%**. **C-f fired: the easiest regime, still lost.** ~81% untested. |
| A3 Entry Hunt | `-003` | **0/2,004.** Post-flush/slingshot = T4, decaying (+1.28 → −1.03). |
| A6 Sizing + Universe | `-006` | Scale-invariant every regime. **6th method.** |
| A5 Joint Construction | `-007` | **0/1,040.** Separable. **Link-2 FAILS.** |
| A4 Exit Hunt | `-008` | **~298 constructions, 0 beat the incumbent.** |
| A9 Hold-Duration Autopsy | `-009` | **MONOTONIC.** t=−3.10 = **reverse causation.** NEAR +24% = **n=1 of 1,689.** |
| A10 Two-Speed Book | `-010` | Residual **−2.1**, **0.00 at every ratio.** Eviction 32–73%. |
| A7 The Adversary | `-011` | Ruler re-verified 4/4. 4 KILLED-FALSE. **T1 = 0.** |
| **MASTER** | `-012` | 🚨 **T2 BOARD. T1 = 0.** ~9,344 constructions. |
| A11 The Synthesis | `-013` | **Leverage cap alone, or nothing.** P0 equal-first. |
| B2 Operational Flags | `-014` | 🚨 **The freeze = the regime gate.** All 10 fire-masks CAUSAL. 7/7 gaps answered. |
| B1 SHORT-Book Autopsy | `-015` | 🚨 **Shape A REFUTED — the tape favored shorts, they lost anyway.** ~100% within-path WR. |

**Reports:** `/home/ghost/docs/reports/recon/2026-07-18_RM-REBUILD/` · **Data + ruler:** `/home/ghost/data/rm-rebuild/`
🚨 **`/tmp/rmr_a3` + `/tmp/rmr_a10` = the ONLY copies of A3/A10 code. A reboot destroys them.**

## §H.4 — §3: PATH-CONDITIONED FINDINGS — v5 MAY VOID THESE

**`[FROM-GHOST]`, HISTORICAL** 🚨 **Measured on v4's 536 trades, inside the regime gate's calm-only window. They describe v4. They CANNOT kill v5.**

| Finding | Number | What voids it |
|---|---|---|
| Confidence anti-predictive | LONG **−0.21** (p=0.001) · SHORT **−0.117** (p=0.055) | Measured on trades the confidence input generated. |
| Hold-duration monotone | ρ=−0.30, **t=−3.10** (highest \|t\| in campaign) | 🚨 **Pure artifact of v4's exit engine sorting losers long.** |
| Exit-path WRs | `trailing_stop` 96% · `external_close` 76% · `momentum_exit` 15% · `stale_75min` 8% · `hard_stop` 0% | Properties of *those* paths. |
| The 1–2h bucket | **−$29.28 of −$36.07** (81%), WR 24%, n=91 | Reverse causation. |
| The 5–15m bucket | **+$10.46**, WR 88%, n=108 — only positive | Same conditioning. |
| SHORT vs LONG | **−$23.51** (267) vs **−$12.56** (269) · WR 53.93% vs 58.36% | ~100% "within-path" — within **v4's** paths. |
| SHORT concentration | 🚨 **90.5% in FARTCOIN/DOGE/HYPE.** Drop all 3 → **+$8.52**. FARTCOIN alone = 48.8% in 8 trades | 🚨 **Now a SHADOW HYPOTHESIS — see §9 Rule 30.** |
| The DON'T-list (C-f) | Rule-30-clean subtraction = **$0.77, n=3** = noise. Squeeze-fuel removal **HARMS** | Reconstructed on v4's trades. **v5 fires different patterns.** |
| Book stats | N=536 · WR 56.16% · bleed −$2.713/day | Same book. |

## §H.5 — §4: THE HOLE — never actually tested

**`[FROM-GHOST]`** ⚠️ *Kept in the appendix because its figures are campaign-state — **but its live question is SPEC-grade and is restated in §10 "Still open."***

**[A11] UNKNOWN #4, verbatim:**
> *"The daily→32-min-scalp transfer of any A3 daily-horizon signal — **never proven**; the C-f nulls are `underpowered-abandoned` for the scalp horizon."*

- The **~9,344 constructions** ran on **DAILY OHLCV**, 4 years incl. the 2022 bear. 🟦 **Real, multi-regime, NOT path-conditioned.**
- 🚨 **But TREVOR trades 32 MINUTES.** The daily hunt tested a bot that doesn't exist.
- **Intraday exists only post-2024-04-05** — ~2.3 yr, **no 2022 bear.**

| Claim | Status |
|---|---|
| Weighting can rescue **fixed** negative components | ❌ **REFUTED — arithmetic.** |
| Two-speed **as A10 defined it** | ❌ **REFUTED.** Residual **−2.1 bps**, **0.00 at every size ratio.** |
| Diversity's hedge protects in a crash | ❌ **REFUTED.** **75.5% calm → 11.5% bear → ~6.5% cascade.** ρ **−0.51 → +0.77.** |
| 🚨 **A rebuilt v5 portfolio, trained live, at its own horizons** | 🚨 **UNRUN. Not refuted. THIS IS THE LIVE QUESTION.** |

⚠️ **Ghost's #12:** *"Intraday might come back 0 bc it cannot test new unbuilt layers and structure. That's what the rebuild and the new training is for."* 🚨 **Correct. A backtest cannot test a layer that doesn't exist yet.**

## §H.6 — §1: THE PREMISE — HISTORICAL

**`[FROM-GHOST]`**
- **TREVOR** — fully autonomous Hyperliquid perp agent. Auto-executes entries AND exits. Live since Feb 2026. **v4 → v5 at this cutover.**
- **v4 horizon:** ~32-min scalps. 🚨 **Longest hold EVER: 1.35 hours.** Every multi-day figure is projection with zero precedent. **v5 extends to a week.** ⚠️ **SUPERSEDED by the timeframe ruling — §C #9.**
- **The 10 tickers:** BTC, ETH, SOL, HYPE, FARTCOIN, XRP, DOGE, NEAR, SUI, kPEPE.
- **Venue:** Hyperliquid. **Fixed constant — not investigable.**
- **Authority:** Ghost final on execution. Claude = architect/PM. **CC = the sole changer.** Shadows = the discovery engine.

## §H.7 — §11: ROADMAP STATUS — SUPERSEDED TWICE OVER

**`[FROM-GHOST]`** ⚠️ **`RM_ENGINE_Rebuild_Roadmap.md` (11 prompts) is SUPERSEDED IN SCOPE.** It assumed *unblock now, patch the engine*. **Ghost's answers changed the shape: stay frozen, rebuild to v5, cutover, add capital, train.**

| Roadmap | Scope | Home |
|---|---|---|
| 🚨 **RM-V5 — THE ENGINE** | The portfolio engine: multi-horizon sleeves (minutes → a week), per-sleeve sizing + leverage ladders, hedging (both kinds), funding capture, slot/margin arbitration, the v5 selector, the cutover mechanism + new epoch. | **this chat** |
| 🚨 **RM-SHADOW — THE DISCOVERY ENGINE** | Rebuild the shadow system for v5: shadows as the "what-if" tester (incl. the now-legal ticker/direction hypotheses), configuration-vs-configuration comparison, the promote/kill pipeline. | **separate chat** — Ghost's #2 |
| 🚨 **RM-TRAIN — THE HUB PAGE + LEARNING LOOP** | The dedicated Hub training page: working-together tracking, pattern, memory, "knowing how to gain the profit." The live learning loop. | **TBD** |

**Still valid from the old roadmap, folded into RM-V5:** regime-gate removal (E1) · confidence strip (E2) · tie-break neutralize (E3) · leverage tail cap (E4) · G-2 harness fix (E5) · G1+G2 live (E6) · `/tmp` rescue (E7) · archive repair (E8) · CLAUDE.md (E10).

🚨 **[A1]'s load-bearing question survives:** *does the regime gate feed the same classifier C1b proved 77.2% wrong?* **If yes → removal is removing a corpse. If it's a different, sound classifier → the premise collapses and Ghost must be told before any build.**

> 🚨 **THIS THREE-ROADMAP TABLE IS DEAD TWICE: superseded in-map by §10's "9 roadmaps + a master" / §D.9's "~10", and superseded again on-box by `v5_ROADMAP_FRAME.md`'s FOURTEEN. See §C #8 and §X #1.**

---
---

## 🚨 CLOSING — how to use this file

1. **Read the tier before the sentence.** `[FROM-GHOST]` is the only non-circular tier.
2. **This states INTENT. The code states REALITY. Report the gap. Never silently pick.**
3. **This is dated 2026-07-17/18, BEFORE the build.** Anything decided during the build (07-18 → 07-28) is **not here**.
4. **Read `docs/design/` too** — the map is Ghost's record; the snapshot is what the build was told. **§X lists where they diverge.**
5. **`[UNKNOWN]` is a correct answer.** A confident reconstruction of something the record cannot settle is a defect — **and a dangerous one, because it will be trusted.**
