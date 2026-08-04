# ─────────────────────────────────────────────────────────────
# LOCKED v5 CONTEXT — authoritative on-box copy · stamped 2026-07-18 (ENV-4)
# The chatbot-side context map mirrors this; reconcile deliberately if they diverge.
# Point-in-time LOCK, not an auto-generated doc. Payload below is byte-for-byte verbatim.
# ─────────────────────────────────────────────────────────────

# TREVOR v5 — LOCKED DESIGN SNAPSHOT (v2)
# Dated 2026-07-18 · supersedes v1 (v1 RETAINED at v5_DESIGN_SNAPSHOT_v1.md)
# v2 = v1 + the round 30-34 fine-detail decisions (§D.12). Read v1 for the full base design.

## §D.12 — FINE-DETAIL DECISIONS (the "one wrong thing ends it" pass)

### D.12.1 — THE BUILD'S SUCCESS CRITERION (the key reframe)
The Level-1 baseline is a STRUCTURAL SKELETON, not a working strategy. It establishes the SHAPE
(sleeves, axes, money path) with NO expectation of profit or edge. The trainer cannot propose
from scratch — Level 1 gives the pieces a form; live trading + training then piece them into
something that works together. The build's honest success criterion = "a correctly-shaped system
that trades badly." Profit is training's job, not the build's. Every roadmap prompt builds the
RIGHT SHAPE correctly, with no expectation it wins yet.

### D.12.2 — WHAT A SLEEVE IS
A named, config-toggleable trading STYLE = a bundle of (size band + horizon + leverage range +
optionally direction/hedge behavior). Named so the trainer can reference/test/tune/enable/disable
it. The sleeve is the UNIT OF COORDINATION. But a sleeve is a STYLE the one bot-brain expresses,
NOT a separate bot. Config says which N sleeves are live at Level N; the portfolio layer +
intelligence decides moment-to-moment which fires and how capital flows. Named styles, one brain,
learned coordination.

### D.12.3 — CAPITAL ARBITRATION
When two sleeves want the same capital, or the same ticker could be in two sleeves at once → the
PORTFOLIO LAYER + bot intelligence decide, LEARNED not fixed.

### D.12.4 — THE TRAINER'S EXPLORATION POLICY
Start on ONE axis, slowly broaden to all 12+ as grounding builds. A BALANCE RULE: never test one
thing too much or too little; give every axis opportunity; don't get stuck; don't over-focus.

### D.12.5 — THE REPLICA-LAG PROMOTION PROBLEM
Do NOT compare champion-vs-challenger on the lagged replica. The champion's results are recorded
LIVE on the VM (zero lag); the challenger's shadow is computed on the same box, same data window;
comparison on MATCHED data; verdict flows to the WSL trainer. The ~10-20min lag affects only display
+ search, never the promotion decision. Build constraint for R8 (shadow/loop) + R9 (trainer).

### D.12.6 — SHADOW TEST WINDOW
Shadows test CURRENT LEVEL ONLY — honest to path-dependence. Not all-history.

### D.12.7 — IN-FLIGHT SEARCH DURING A PROMOTION
The trainer's search does NOT pause for a promotion — it keeps searching against the OLD champion
until the level flips. The Hub PAUSE button is only for when CC is mid-CODE-change.

### D.12.8 — PROMOTIONS ARE ENTIRELY POST-BUILD
The build prompts come FIRST. Promotions begin only AFTER the build, per-level, once trading +
training are live. Ghost + CC decide promotion priority — NO auto-ranking by the trainer.

### D.12.9 — NO PRE-FLIGHT GATE; ACTIVE VIGILANCE INSTEAD
No automated pre-flight checklist. The safety model IS the paper period: recon + verification after
EVERY fix, cross-checked against THIS on-box snapshot. It stays paper until Ghost says otherwise;
Ghost actively fixes everything, constantly cross-checking the plan, till it works perfectly before
going live. Safety = active vigilance + continuous re-recon, not an automated gate.
