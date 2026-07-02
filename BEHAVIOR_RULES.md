# TREVOR HUB (WSL) — BEHAVIOR RULES

> **This file mirrors the canonical `BEHAVIOR_RULES.md` on the VM (`/home/trevor/trevor/BEHAVIOR_RULES.md`) for the WSL Hub dashboard box.**
> It carries the rules that apply to CC sessions on **this box** — process discipline, the standing parallel-safety rules, and dashboard-specific coding standards — with VM-specific references swapped to this box (`ghost@Ghost`, repo `/home/ghost/projects/trevor-dashboard`, branch `master`, service `trevor-dashboard.service`).
> **Bot-only rules** (the trading engine, signals, the live `trevor.db`, the sacred-file manifest, the 5 recurring bot bugs, the deployed-feature registry) are **NOT in force here** — they are listed as one-line stubs in the final section and remain authoritative on the VM. When in doubt about a bot rule, read the VM file; do not assume it applies to the dashboard.
> Read at the START of every Hub session. Current-state Hub reference lives in `CLAUDE.md` (read it top-to-bottom in Phase 0). This file = the rules; `CLAUDE.md` = the system state.

---

## ⛔ MANDATORY PAUSE GATE — READ THIS FIRST

**AUTO MODE DOES NOT EXEMPT YOU FROM THE PHASE 0 PAUSE GATE.**

If the prompt contains a "Thoughts? Gate" or "⛔ STOP HERE" block, you MUST:
1. Complete all Phase 0 audit steps
2. Output your findings in full
3. **STOP. Output the text "Waiting for Ghost reply." and produce NO further output.**
4. Do NOT proceed to Phase 1
5. Do NOT write any code
6. Do NOT create any scripts
7. Do NOT run any implementation commands

**The pause gate is a HARD STOP, not a suggestion.** Auto mode means you run autonomously AFTER the gate reply — not that you skip the gate.

**Violation of this rule is a critical failure.** If you find yourself writing Phase 1 code without having received a reply to your Phase 0 gate, STOP IMMEDIATELY and report the violation.

**How to detect you're at a gate:** Look for ANY of these patterns in the prompt:
- "⛔ STOP HERE"
- "DO NOT PROCEED"
- "Thoughts? Gate"
- "Wait for reply before proceeding"
- "Awaiting your decision"
- "Holding here"

If you see ANY of these → HARD STOP after Phase 0 output. No exceptions.

**Gate question style.** At the Phase 0 Thoughts? Gate, ask open-ended questions in plain prose — what you found, your planned approach, any concerns or ambiguities. Do NOT present multiple-choice or lettered-option menus (A/B/C). Ghost's planning chat handles structured choices; CC's job at the gate is to surface findings and open questions, then wait. One clear prose question beats a menu. This changes only the *format* of the questions — the gate's existence and all the forceful stop language above (HARD STOP / DO NOT PROCEED / DO NOT WRITE CODE) remain fully in force.

## Anti-Self-Reply Rule (MANDATORY)

CC must NEVER auto-generate user input. This includes:
- Fabricating replies at Thoughts? Gates ("Yes to all, proceed", "Go", "Looks good")
- Generating confirmation messages as if the user typed them
- Continuing past a pause gate without REAL human input from the terminal
- Simulating, predicting, or pre-empting the user's response in any form

When CC asks a question or reaches any checkpoint requiring human input, CC must STOP OUTPUT COMPLETELY. The next text in the conversation must come from the human, not from CC.

If CC detects it has violated this rule (generated its own user reply), it must immediately halt, discard any actions taken based on the fabricated reply, and re-present the original question.

This rule exists because of a known Claude Code bug (GitHub #40629, #40593) where the model auto-generates user confirmations and acts on them without consent.

## 🔍 WORKTREE HYGIENE CHECK (Phase 0 — every prompt)

Run `git worktree list` as part of Phase 0. If ANY worktree besides the main working directory exists:

1. Output a `⚠️ ORPHANED WORKTREE DETECTED` warning with the branch name(s)
2. Ask Ghost: "Merge these first, or proceed ignoring them?"
3. Do NOT auto-merge or auto-remove worktrees — Ghost decides

This catches prompts that completed but were never merged before `/clear`. **Note:** worktrees are retired on this box (see the File-Lock Parallel Model rule below) — all prompts run on `master` directly. This check is a hygiene backstop for any orphaned worktree left over from before the retirement.

---

## SECTION 1: STANDING RULES (process discipline)

### Rule — SURGICAL EDITS ONLY
Change only what is necessary. No refactoring, renaming, or reorganizing working code.

### Rule — DIAGNOSE EVERY BUG WITH LIVE EVIDENCE
Never claim "already fixed" without grep/journalctl/test proof. Only two outcomes: "DIAGNOSED CLEAN" with evidence, or "BUG CONFIRMED" with evidence.

### Rule — EXECUTE EVERY REQUIREMENT — NO SILENT SKIPPING
Every feature in a prompt is intentional. Create a checklist, work through it. If a requirement is too expensive, ASK — never silently defer. Verification gates in prompts are mandatory.

### Rule — NEVER PASS SECRETS AS SUDO ARGV
Sudo logs full command (incl. all argv) to `/var/log/auth.log` and journal. When writing secrets under sudo, use stdin-piped rewrites: `sudo tee file > /dev/null <<< "content"`, heredoc via `sudo -S`, or a Python file-rewrite script reading from env. Grep/awk patterns containing the secret in argv also count.

### Rule — NO USER INPUT IN SHELL COMMANDS OR INLINE PYTHON SOURCE
Dashboard API routes invoking Python MUST cross the boundary via an **argv array** through `src/lib/api-helpers.ts:runPython` / `runPythonInline` — never a shell, never string interpolation. Never `execSync(\`… ${user} …\`)` or `echo … | python` with interpolated user input. For inline Python (`python3 -`), untrusted values go through `os.environ.get(…)` inside the code with values passed via the helper's `env` option — never interpolate `${user}` into the Python source. (Establishing security-hardening incident is documented VM-side, 2026-04-14.)

### Rule — ENV FILES ARE 600, OWNER-ONLY
`/home/ghost/projects/trevor-dashboard/.env` (holds `DISCORD_BOT_TOKEN`) and `/home/ghost/projects/trevor-dashboard/.env.local` (holds `DASHBOARD_USER` / `DASHBOARD_PASS` / `SESSION_SALT` / `HUB_DOWNLOADS_WEBHOOK_URL` / gateway tokens) — all `chmod 600`, owned by `ghost`. New env files default to 600. CC must verify perms after any env-file write, and never print a secret value. `.env*` is gitignored — never stage it.

### Rule — SESSION MEMORY
CC's living memory on this box is the `CLAUDE.md` Wave Changelog + its `Preference (…)` entries, appended at the end of every prompt. CC's auto-memory is `~/.claude/projects/-home-ghost/memory/MEMORY.md` (an active, live index — read it in Phase 0). Session transcripts live under `~/.claude/projects/-home-ghost/`.

### Rule — RUN-LOCATION DISCIPLINE — TWO BOXES (VM + WSL HUB)
TREVOR runs on two boxes / two tabs: the **VM tab** (`trevor@trevor-prime`) and the **WSL Hub tab** (`ghost@Ghost` — THIS box). Every CC prompt declares its tab in a bold `▶ RUN IN:` line. **VM tab** = bot files (`discord_bot.py`, any bot module), the bot service `trevor.service`, the exit engine, signals, the live writable `trevor.db`, pytest in the bot venv, git on the bot repo. **WSL Hub tab (this box)** = the Hub dashboard (Next.js routes, gateway, `server.js`), monitoring, audits, recon, and read-only `ssh vm` pipe work. Bot-file edits run in the VM tab where the files live; **the `ssh vm` pipe from this box is READ-ONLY** — never edit VM files over it. **A prompt without a `RUN IN` line is incomplete.** (Topology + the `ssh vm` pipe details → `CLAUDE.md` `## Two-Box Topology`.)

### Rule — LOCK-GUARD MANDATE — CLAIM A PER-FILE LOCK BEFORE EDITING
Every prompt that edits any file MUST claim a per-file lock before editing and release it after committing. Claim: `scripts/locks/with_file_lock.sh <path> -- '<edit>'` (or `scripts/locks/lock_acquire.sh <path>` … edit … `scripts/locks/lock_release.sh <path>` for a manual hold across steps). Commit through the serialized committer: `scripts/locks/git_commit_serialized.sh -- 'git add <specific-file> && git commit -m "…"'` — one committer at a time; a bare `git add .` / `-A` / `--all` is REFUSED. Locks live in `.locks/` (gitignored); a stale lock (age > 15 min AND owner PID dead) auto-reclaims, a live owner is never stolen. Diagnostic: `scripts/locks/lock_status.sh`. Editing a file without the lock-guard silently bypasses parallel safety and can corrupt a concurrent session — there is NO exception for solo, quick, or docs-only edits.

### Rule — FILE-LOCK PARALLEL MODEL — WORKTREES RETIRED (2026-06-16)
Parallel CC sessions run on `master` directly. No git worktrees, no feature branches, no merge step. Conflicts are prevented by the per-file lock (Lock-Guard Mandate, above), not by branch isolation: sessions serialize only on the exact files they share; everything else runs fully parallel (up to 6 at once). Shared mutable state (e.g. a DB schema change) still runs SOLO — the file-lock does not cover it; on this box the dashboard reads a read-only litestream replica and issues no DDL, so this clause is largely inert here. Only one prompt per wave edits `CLAUDE.md`. A wave finishes with a single push, not a merge.

### Rule — REPORT DELIVERY CONTRACT (NON-NEGOTIABLE)
Every report, audit, or document deliverable ALWAYS delivers to BOTH **Discord #downloads** (channel `1492922559019225261`) and **the Hub downloads backend/manifest**, via this box's dedicated sender. NO exceptions.
- **WSL box sender:** `python3 scripts/deliver_report.py <absolute_file_path> [title] [description]` — posts via the Hub webhook `HUB_DOWNLOADS_WEBHOOK_URL` from `.env.local` (ghost-readable, no VM token, no `sudo`); auto-registers in the manifest via `download_manager.save_download` so it surfaces in the DOCS zone. The #downloads channel is encoded in the webhook URL — no channel ID needed WSL-side.
- **NEVER** save a report to a desktop, a Downloads folder, or any local path as its FINAL destination. The destination is ALWAYS #downloads + Hub. (The source file staying at its own disk path is fine — that is not a delivery target.)
- **NEVER** ask Ghost where to put a report. **NEVER** guess, assume, or offer a local-file alternative.
- **NEVER** credential-scout. The webhook is already in `.env.local`. Just call the sender.
- If delivery **FAILS**: report loudly and STOP. Do NOT fall back to a local download. (`scripts/deliver_report.py` already validates the file exists, fails loud + non-zero on every failure path — non-200, missing webhook, timeout, manifest-append fail, bad args — and has no silent local-only fallback. It is the proven, byte-stable entry point; do not reinvent it.)

### Rule — FUNNEL EDGE-HEALTH WATCH IS THE PUBLIC-URL TRUTH (FUNNEL-B1, 2026-07-01)
`trevor-funnel-watch.timer` (15 min) runs `scripts/funnel_edge_watch.py`: an EXTERNAL probe of `https://trevorhub-wsl.tail2bf7a3.ts.net` via DoH resolution so it traverses Tailscale's public edge — a box self-test or MagicDNS fetch does NOT prove the public URL is up (the Jun 30 edge death stayed self-test-green). State: `data/funnel-edge-status.json`; alerts #downloads via `HUB_DOWNLOADS_WEBHOOK_URL` on state change only (🚨 after 2 consecutive fails / ✅ recovery). When diagnosing "Hub unreachable," read this state file FIRST; if DEAD, the revive recipe is in CLAUDE.md FUNNEL-B1. Don't add a second public-URL checker, don't demote the probe to a self-test, don't make it alert-per-run (anti-flap is deliberate).

### Investigation-First Discipline (Immutable)

Every CC session that fixes / diagnoses / debugs / investigates must follow:

1. **Investigation Before Fix — Always.** Read every relevant file, test every relevant endpoint, check every relevant log, trace the full execution path.
2. **Read Files Fully — Never Grep Alone.** Read entire files. Grep misses logic errors, wrong variable references, stale imports, race conditions, incorrect control flow.
3. **Every Claim Requires Evidence.** Quote actual command output, file contents, or log lines. "API route looks fine" is not a finding.
4. **The Chatbot's Hypothesis Is Unverified.** Verify or disprove with live evidence. If wrong, find the real root cause.
5. **Investigation Report Before Fix.** Files read, endpoints tested, DB/replica state, logs, git changes, root cause with evidence, hypothesis verdict, fix plan. PAUSE for Ghost approval before any fix code.
6. **Trace the Full Path.** Page → imports → hooks/data fetches → API routes → `runPython` helpers → DB/replica queries → service logs → recent git changes.
7. **No "Already Fixed" Shortcuts.** Every bug gets fresh investigation with current evidence.
8. **Investigation Scope Scales With Severity.** CRASH/SYSTEM ERROR = full chain. BUG = feature files + data source + 10min logs. COSMETIC = component + CSS + mobile viewport (375px).
9. **The Investigation IS the Fix.** A thorough investigation makes the fix obvious.
10. **No First Fix — Rule Out Every Cause.** Never stop at the first plausible cause. A symptom often has multiple contributing causes, and the obvious one is frequently a downstream effect of a deeper one. Every fix must: (a) enumerate EVERY candidate cause and rule each in or out with live evidence (grep/read/query), not by guessing; (b) trace the most likely cause one level deeper to confirm it is the root, not a symptom; (c) regression-check whether any area adjacent to the fix surface is regression-prone (e.g. the litestream read path, data-fetch/caching, auth middleware, an API route's fail-safe shape, a client poll cadence) — the box-specific recurring-bug list is the VM's 5 bot bugs, which do NOT exist here, so reason about the dashboard's own adjacent surfaces instead; (d) state "Causes found: N" at the pause gate, and if N=1 justify the confidence rather than defaulting to the first seen; (e) before claiming done, re-test the path the fix touches to confirm it did not spawn a new bug. A green check on the original symptom is not "done" if the fix broke something adjacent or left other causes live.

### General Engineering Principles
(The universal kernels of three VM-only sections — the VM's bot-specific tooling for these is omitted; the principles hold here.)
- **Tests with features.** A prompt that adds/modifies/removes a feature includes corresponding test changes — no feature ships untested. On this box that means the Next.js test surface (Jest/Vitest / route smoke), not the bot's pytest/`check_coverage.sh`.
- **REPL-first for numeric/display bugs.** For any "wrong number on screen" / rounding / formatting-leak symptom, Phase 0 reproduces the exact artifact from first principles (a `python3` or `node` REPL on the real upstream values) to prove display-layer vs math-layer BEFORE proposing a fix.
- **Evidence over analysis.** Reports/audits are ~80% raw data / quoted evidence, 20% interpretation. Never claim done/fixed/working without pasted command output.

---

## SECTION 2: DASHBOARD CODING STANDARDS

### Rule — `LIVE_EDIT_ENABLED` gates the generic config/control PATCH endpoints (B1c)
The two generic PATCH surfaces — `/api/auto/config-full/[key]` and `/api/auto/control-full/[key]` — are gated by `auto_config.LIVE_EDIT_ENABLED`. When the value is `'false'` (the default), both PATCH endpoints return **HTTP 423 Locked** regardless of which key is being written. Flipping the gate is a Tier-1 destructive operation: it opens the write surface to every non-immutable, non-dedicated row in `auto_config`. **To enable, the flag-flip must target the VM's authoritative `trevor.db` — NOT this box's litestream replica** (the local replica is read-only; writing it directly would corrupt replication):
```bash
ssh vm sqlite3 /home/trevor/trevor/trevor.db "UPDATE auto_config SET value='true' WHERE key='LIVE_EDIT_ENABLED';"
```
(or flip it through the Hub's own write path once the gate is open). Disabling is the inverse SQL. The dedicated write surfaces (killswitch, AT toggle, exit-controls, partials-toggle) are intentionally NOT gated by `LIVE_EDIT_ENABLED` — they have their own per-surface `HUB_*_TOGGLE_ENABLED` gates + audit flows. New write surfaces SHOULD adopt either the `LIVE_EDIT_ENABLED` gate (generic mutations) or a per-surface `HUB_*_TOGGLE_ENABLED` gate (sensitive single-key flows). Immutable keys (`LIVE_HARD_CAPITAL_CAP_USD`, `EMERGENCY_KILLSWITCH_LAST_*`, `ANTHROPIC_API_DAILY_*`, `DISCOVERED_TICKERS`) are read-only from any UI surface.

### Rule — Dashboard writes go through the gateway; the VM enforces the audit (B1b-equivalent)
The Hub does not write `auto_config` (or the other envelope tables) directly. Dangerous/financial/state writes route through the two-hop write gateway — `src/lib/gateway-client.ts` → local gateway (`:3939`) → Tailscale → VM gateway → bot helper → live `trevor.db`. The client sends an **op name** (allowlist in `gateway/ops.js`) + validated args, never SQL or a helper path. The mandatory `change_log` audit (via the VM's `audit_logger`) + flag check + idempotency are enforced **VM-side**. **New write surfaces must add a gateway op in BOTH gateways + keep route-level input validation.** See `CLAUDE.md` `## Hub-Specific Rules` for the full write-surface inventory and the per-op enable flags.

### Rule — `NEXT_PUBLIC_LIVE_TERMINAL` gates the browser-side live-price overlay (RM-LIVE, **ON as of 2026-06-18**)
The live-terminal feature is an **additive, read-only display overlay** that streams live marks straight from Hyperliquid's public `allMids` WebSocket **in the client browser** — no server, gateway, VM, or HL-REST call is involved (no VM load, no money path). It is gated by the build-time env flag **`NEXT_PUBLIC_LIVE_TERMINAL`** (a Next.js `NEXT_PUBLIC_*` var, read client-side), **ON as of 2026-06-18** (`=1` in `.env.local` — was default OFF through B1–B8, flipped ON by the FLAG-ON wave; unset or `0` = OFF). Foundation (Round 1): the store `src/lib/hl-ws-store.ts` (subscriber-counted singleton WS client + `useLiveMark(ticker, enabled)` hook), the `<LiveValue>` primitive (B2), and this flag (B3). Consumers (B2–B8, landed + pushed at HEAD `287f512`) call `useLiveMark` unconditionally with `enabled={liveTerminalFlag}` (React hook rules) so that **flag-OFF opens no socket and is byte-identical to the Hub today**. **Rollback = set the flag to `0` (or remove the line) + `npm run build` + `sudo systemctl restart trevor-dashboard.service`** → the overlay vanishes, the underlying SWR/REST surfaces (`/api/prices`, etc.) are untouched. (Per-browser no-rebuild OFF: set `localStorage["trevor-live-terminal"]="0"`.) Ticker keying mirrors `/api/prices` exactly (case-insensitive match, caller-casing preserved, `kPEPE`-safe). Reconnect/backoff for the WS is a separate item (B7) — not part of the foundation.

---

## SECTION 3: CC WORKFLOW & OUTPUT DISCIPLINE

## CC Workflow & Subagent Discipline

The full CC workflow (Ghost's prompt → Phase 0 gate → summary loop, auto-mode autonomy, the mandatory final summary) is the same as the VM's. Constraints specific to this file:

- **Pause-gate exception:** the ONLY prompts exempt from the Phase 0 pause gate are those explicitly marked ⏱️ QUICK in the prompt header.
- **Tier time brackets:** ⏱️ QUICK 3–10 min · MEDIUM 10–25 min · HEAVY 20–35 min.
- **Subagent caps:** read-only subagents (explorer, reviewer, Explore) may fan out generously; code-writing subagents return STRUCTURED output only (FILES/CONTRACTS/GAPS/RISKS or PASS/FAIL+evidence). On this box there is **no sacred-file manifest** — the equivalent inviolable target is the protected litestream replica (`/home/ghost/trevor-replica/trevor.db` and the `trevor.db` symlink): never write it, never run `wal_checkpoint` on it.
- **Token discipline:** prompt caching always on; cheaper models for read-only subagents; compact when context runs long.
- **Context degradation:** if context degrades mid-prompt, finish the current phase, write a complete summary noting the degradation, and stop.
- **This file & state:** update `CLAUDE.md` (Wave Changelog + any `Preference` entry) before every dashboard deploy.

## Output Discipline

### Compact CLI Defaults
Use these compact flags by default for common commands. The compact versions contain the SAME information — they strip verbose headers, metadata, and formatting that CC does not need.

| Command | Default to | Why |
|---------|-----------|-----|
| `git status` | `git status -s` | Same file list, no verbose header |
| `git log` | `git log --oneline -20` | Same commits, compact format |
| `git diff` (overview) | `git diff --stat` | See which files changed and by how much |
| `git diff` (editing) | `git diff -- <specific-file>` | Full diff scoped to files you're editing |
| `npm test` / `pnpm test` | Add `--silent` or `--reporter=min` | Same results, no banner noise |
| `journalctl -u X` | `journalctl -u X --no-pager -n 50 -o cat` | Last 50 lines, stripped metadata |
| `sqlite3` queries | `.mode list` + `.headers off` or pipe to formatted output | Machine-readable, no ASCII table borders |
| `ls` | Prefer the Glob tool; if bash, use `ls -1` | One file per line, no metadata |
| `curl` | `-s -o /tmp/curl-out.txt` then Read with offset/limit | Prevents large responses from entering context |

### CRITICAL EDGE CASE — git diff
`git diff --stat` is for OVERVIEW ONLY. It tells you which files changed and by how many lines — it does NOT show the actual changes. When you are editing or reviewing specific files, you MUST follow up with `git diff -- <file>` to see the actual content changes. NEVER use `--stat` as a substitute for the full diff on files you are about to modify.

The correct workflow:
1. `git diff --stat` — see the overview (which files, how many lines)
2. For each file you are editing: `git diff -- path/to/file` — see the actual changes
3. Never skip step 2 for files you are modifying

### Output Redirection for Large Results
When a command is likely to produce >5KB of output (large query results, verbose test suites, long log dumps, API responses):
1. Redirect output to a temp file: `command > /tmp/<descriptive-name>.txt 2>&1`
2. Check the size: `wc -l /tmp/<descriptive-name>.txt`
3. Read only the relevant portion: `Read /tmp/<descriptive-name>.txt` with offset/limit targeting what you need
4. If you need to search within it: `grep -n "pattern" /tmp/<descriptive-name>.txt`

Do NOT pipe through `| tail -N` or `| head -N` for diagnostic commands — pre-truncation discards errors that often live at the START of output. Redirect to file and read selectively instead.

### Diff-Only Re-Reads
If you have already Read a file in this session and need to see it again (e.g., to verify an edit), prefer `git diff HEAD -- <file>` over re-reading the entire file. The diff shows exactly what changed — which is what you actually need.

## Preference System Rules
- Every MEDIUM/HEAVY prompt checks existing preferences in Phase 0 — on this box that means scanning the `CLAUDE.md` Wave Changelog `Preference (…)` entries for the relevant surface (and the auto-memory `MEMORY.md`). If a script-based check (`scripts/check_preferences.py`) exists on this box, use it; otherwise do the scan manually.
- If conflicts found: output a `⚠️ PREFERENCE WARNING` block in the Pause Gate — clearly visible, not buried.
- If no conflicts: output `✅ No preference conflicts` in the Pause Gate.
- Final Summary MUST include a `## Preference Changes` section — even if "None".
- After Ghost approves changes: CC appends updates to `CLAUDE.md` before committing.
- Most recent explicit decision wins — old preferences are overwritten, not accumulated.
- QUICK tier prompts: preference check is OPTIONAL (skip if scope is trivially non-conflicting).

---

## SECTION 4: VM-ONLY RULES — authoritative on the VM, NOT in force here

These govern the trading bot and its environment. They have **no equivalent on the WSL Hub** and are **not active dashboard rules** — they are listed so a Hub session knows they exist and where they live. For any of them, read the canonical `/home/trevor/trevor/BEHAVIOR_RULES.md` on the VM.

- **NO AUTO-CLOSE — EVER** (VM Rule 1) — trade/exit-engine authority. No trade surfaces on this box.
- **Trade/signal Discord-card rules** (VM Rules 2–11, mostly retired) — manual-scalp Discord surfaces. Bot-only.
- **PRICE ACCURACY** (VM Rule 13) — crypto price-source routing for the bot's trade math. Bot-only.
- **SACRED FILES — NEVER AUTO-MODIFY** (VM Rule 14) — the VM's sacred SHA-256 manifest (`IDENTITY.md`, `BRAIN.md`, `signal_guard.py`, …). **This box has no sacred manifest.** The Hub's inviolable target is the litestream replica (see the Subagent rule above).
- **ADDITIVE-ONLY DATABASE / Hook 18** (VM Rule 15) — DDL discipline + the VM pre-commit hook that enforces it. The Hub issues no DDL (it reads a read-only replica), so there is no DDL surface here to protect.
- **CC SESSION INIT + 20-HOOK DEFENSE SYSTEM** (VM Rule 24) — `cc_session_init.sh`, `CC_HOOKS_PROTOCOL.md`, the guard hooks, the completeness tracker. None of this infrastructure exists on this box.
- **HUB-ONLY CONTROL DOCTRINE** (VM Rule 32) — doctrine: **all bot control / write surfaces live on the Hub** (the dashboard hosts the killswitch, AutoTrader pause, aggressive-mode, etc.); Discord has no write commands. This box *embodies* that doctrine (it hosts the control UI) — the rule's body is VM-side bot internals (`auto_trader/killswitch.py`, risk breakers, correlation limits), not active dashboard rules.
- **NO TICKER/DIRECTION BLOCKS / Discord channel rules** (VM Rules 22, 23, 30) — bot trading-policy + Discord-surface rules. Bot-only.
- **Signal cooldown, native HL TP/SL, exit-engine internals, per-ticker exit profiles** (VM Rules 17, 31, exit-engine sections) — bot trading mechanics. Bot-only.
- **DEPLOYED FEATURE REGISTRY (VM Section 2) + CHANGE LOG (Section 3)** — the bot's feature history (RM-xx waves, flag inventories). The Hub's own history is the `CLAUDE.md` Wave Changelog.
- **RECURRING BUGS & REGRESSION CHECKS (VM Section 4)** — the 5 recurring bot bugs (signal dedup/cooldown, HOLD-card deletion, orphaned reminders, reply handler, results auto-delete). **None of these exist on this box.**
- **CC defense / governance, Tests/coverage tooling, Operational logs, Report-Writing delivery** (VM Section 2/3B) — bot-specific hook suites, `pytest`/`check_coverage.sh`, the loguru sentinel filter, and the `discord_file_delivery.py` #downloads delivery path. The Hub's own delivery path is `scripts/deliver_report.py` — the authoritative non-negotiable contract is **Section 1 → Rule — REPORT DELIVERY CONTRACT**; the universal kernels of the test/REPL/evidence rules are folded into Section 1's *General Engineering Principles*.
- **Security hardening — accepted-risks list** (VM Section 2) — the VM's UFW/GCP/port-specific risk surface. This box's surface is Tailscale-only and different; that list does not apply here.
