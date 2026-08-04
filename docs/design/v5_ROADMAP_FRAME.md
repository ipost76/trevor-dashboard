# ─────────────────────────────────────────────────────────────
# LOCKED v5 CONTEXT — authoritative on-box copy · stamped 2026-07-18 (ENV-4)
# The chatbot-side context map mirrors this; reconcile deliberately if they diverge.
# Point-in-time LOCK, not an auto-generated doc. Payload below is byte-for-byte verbatim.
# ─────────────────────────────────────────────────────────────

# TREVOR v5 — THE 14-ROADMAP FRAME (locked 2026-07-18)
# The roadmap-of-roadmaps. Each roadmap is built exhaustively, one at a time, in its own chat.
# Each chat inherits: the CONTEXT INDEX + that roadmap's own .md. Nothing else.
# Principle: ONE system per roadmap. No system split across two; no two systems sharing one.

R0  — OPS SPINE           — infra survival (disk/pause/env DONE; Observatory, monitor-center,
                            HMM staleness, Hub 502, VM cost recon, disk pass remain)
R1  — UNIVERSE            — what to trade: HL listable set, correlation/effective-bets, breadth
                            hunt (anything off the crypto beta factor?), fee reconcile. RECON-heavy.
R2  — LEVEL MODEL         — the spine everything logs into: single global int, reopen-forward,
                            revert=new level, change classifier (self-declare + independent detect),
                            migrate the 30 false proven-negatives to reopenable.
R3  — VALIDATION MATH     — re-wire servant_gate.py's real PBO/DSR/walk-forward + ADD online-FDR/
                            alpha-budget. G1 (leakage whitelist) + G2 (canonical P&L) into live code.
R4  — SIGNAL MECHANISM    — the mechanical "what fires" layer. Retire the fossil (121c5f2). Strip
                            confidence (anti-predictive). Neutralize the LONG tie-break. Mechanical +
                            LLM reserved for judgment ($3/day total API ceiling; model delegation).
R5  — BOT-BRAIN           — the trainable execution intelligence (§D.6: the bot is its own LLM).
                            Judges execution within the config's playable space. brain/* REWRITTEN
                            (alert-bot era). ONE decision-maker, not sub-bots.
R6  — PORTFOLIO ENGINE    — the biggest job. Sleeves (named styles) built from zero. Multi-horizon
                            (LIVE min→24h, SHADOW days→week). Per-sleeve sizing + leverage ladders.
                            Hedging EMERGENT (both kinds). Portfolio layer decides capital deployed.
R7  — EXIT ENGINE         — repurposed to flow with the sleeves (keep what's needed). A strong
                            incumbent (beat 298) the trainer may challenge at a high bar, not protected.
R8  — SHADOW + LOOP       — self-creating/deploying shadows, level-aware. The autonomous lifecycle:
                            PROPOSED→DEPLOYED→TESTING→{PROMOTION_CANDIDATE|ARCHIVED_NULL|ARCHIVED_STALE}.
                            Matched-data champion/challenger (§D.12.5).
R9  — TRAINER             — the OPTIMIZER: bandit (no heredity), DSR + online-FDR alpha-budget, the
                            COMPASS (survival→consistency→magnitude, Sortino, net-of-cost, per-eff-bet),
                            explore-one-axis-then-broaden. Two queues (config vs capability).
R10 — WATCHER             — independent oversight (MUST be separate from what it watches). Reviews
                            the trainer after-the-fact (teacher/critic, its critiques train the trainer),
                            owns level/ID integrity, surfaces drift/errors. Observe-and-report only,
                            never auto-halts. Its own reasoning + learning + error subpage.
R11 — MEMORY STORE        — the 3-tier queryable reasoning brain BOTH agents use: HOT/WARM/COLD,
                            structured-at-write (tags + prose), "have we tested X" = a query not a scroll.
                            Logs reasoning + rejections. Rehydrate COLD→HOT (no level event).
R12 — HUB                 — repurpose the existing cockpit, built LAST. SHADOWS→TRAINER (promotions
                            tab), MEMORY→WATCHER (critique/error/level-ID subpages), DOCS→end before
                            HEALTH. Keep the plain-English design language.
R13 — CUTOVER             — replace v4, all ~$81, 25%-of-daily-starting kill switch, repremise docs.
                            Sequence: all complete → cutover → PAPER (24h min, extends till Ghost's
                            comfortable, watcher on, trainer sims+observes, NO leveling) → Ghost says go
                            → live, Level 1.

BUILD ORDER: R0 (prep mostly done) → R1 (first, alone, informs all) → R2 → R3 → R4 → R5 → R6 → R7
→ R8 → R9 → R10 → R11 → R12 (last) → R13 (cutover). Each its own chat. NOTHING ships until R13.
Every roadmap is fully specified — every prompt's scope detailed — so a drifting prompt is caught.
