# ─────────────────────────────────────────────────────────────
# LOCKED v5 CONTEXT — authoritative on-box copy · stamped 2026-07-18 (ENV-4)
# The chatbot-side context map mirrors this; reconcile deliberately if they diverge.
# Point-in-time LOCK, not an auto-generated doc. Payload below is byte-for-byte verbatim.
# ─────────────────────────────────────────────────────────────

# TREVOR v5 — CONTEXT INDEX (the single entry point) — 2026-07-18
# Hand THIS to every new roadmap chat. It points at everything.

## THE VISION (one paragraph)
All trades work together each day to build the portfolio and gain together — no trade trades solo.
Growth, not single-trade edges. The edge is the working-together of everything, LEARNED by building +
training, not derived. Success = net-positive weeks, steady stacked gains. v5 REPLACES v4 in place,
~$81 capital, fully autonomous, CC the sole changer, shadows/training find edges, Ghost approves
promotions. The build's job is a CORRECTLY-SHAPED system that trades badly; profit is training's job.

## THE DOCS ON THIS BOX
- docs/design/v5_DESIGN_SNAPSHOT_v1.md — full base design (§D.0-D.11): six systems, level model,
  autonomous loop, memory tiers, bot/money-path, the compass, hub, cutover, topology, invariants.
- docs/design/v5_DESIGN_SNAPSHOT_v2.md — the §D.12 fine details (rounds 30-34).
- docs/design/v5_ROADMAP_FRAME.md — the 14-roadmap frame + build order.
- CLAUDE.md ## REBUILD ENVIRONMENT — the self-log rule + level rule every prompt follows.
- rebuild_tracker.db — every prompt logged, every level. `python3 -m rebuild_tracker status`.

## THE SIX SYSTEMS
1 BOT-BRAIN (trades, own trainable LLM) · 2 TRAINER (searches, optimizer) · 3 WATCHER (teaches
the trainer, owns level/ID integrity) · 4 LOOP ENGINE (runs the lifecycle) · 5 BUILD TRACKER (built) ·
6 HUB (shows it). A society of agents that train each other; Ghost is final arbiter via CC.

## THE INVARIANTS (bind v5 regardless — from RM-REBUILD + RECON-V5-001)
- Cost bar 8.098 bps RT, frequency-invariant, every trade pays it.
- Fees purely rate-based (~8.21 bps blended), NO floor (max fee ever $0.22 — the "$4 fee" was the
  notional trap). HL docs 2.5 vs ledger 4.5 bps/side UNRECONCILED — R1 closes it.
- Scale-invariance E[aX]=aE[X] (6 methods). One beta factor: PC1 69-81%, rho~0.655, ~1.4 effective
  bets — BUT measured on the 10 PERSONAL tickers; R1 reopens it (tickers were personal, not perf).
- Liquidation tail: 2025-10-10, -48% to -86% across 6 tickers in one day.
- Statistical proof unreachable in the runway — the bar is Ghost's (net-positive weeks).

## THE LAWS (never break)
- Additive-DB only (no DROP/DELETE/TRUNCATE/non-NULL-overwrite).
- Phantom-bleeder: DISTINCT trade_id before any sum.
- Canonical P&L: flat = SUM(pnl_usd + partial_pnl_realized); true = flat - SUM(fees_usd_true-fees_usd).
- Notional trap: notional_usd IS posted margin — use original_notional_usd.
- Clock truth: opened_at/closed_at = naive Eastern; created_at/equity ts = UTC; 4h offset to join.
- Leakage family (never a predictor): stop_price, notional_usd, mae_pnl_pct (leverage proxy),
  peak/trough/adverse prices, ratchet, breakeven flag, native oids, funding_paid, partial_pnl.
- Sacred files (need Ghost's approval to edit): brain/IDENTITY.md, brain/BRAIN.md, brain/SOUL.md,
  brain/AGENTS.md, swarms_brain.py, training_bridge.py, signal_guard.py, signal_cooldown.py,
  signal_cleanup.py. Manifest .sacred_manifest.sha256 = 13/13, never modified.

## THE STATE
v4 PAUSED (AUTO_TRADER_ENABLED=false, revert: config.set_enabled(True)). Level 0 = v4 baseline.
Equity ~$30.74, frozen. VM disk rescued (~60%, keep-5 snapshot_prune.sh cron). Boxes: VM
trevor@trevor-prime-2 (bot, live trevor.db, main); WSL ghost@Ghost (Hub :3000, replica, master).
Trainer/watcher/shadow will run on WSL (.wslconfig RAM 6→8-10GB pending). $3/day total API ceiling.

## THE RULES OF ENGAGEMENT
Every build prompt: box-check (2-part) · Phase 0 + Thoughts? Gate · per-file lock_acquire · sacred
manifest 13/13 · additive DB · flags default OFF · regression-pattern checks · Monitor-over-polling ·
ChromaDB-safe restart dance · honesty protocol · self-log to rebuild_tracker.db as the final step +
mint a level on money-path change. Every recon: archive-check + register, deliver to #downloads verified.
