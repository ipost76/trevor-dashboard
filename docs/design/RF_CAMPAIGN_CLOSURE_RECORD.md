# RF Campaign — Closure Record

> **RF3T2-C1, 2026-07-24.** The last prompt of a seven-roadmap campaign (RF-0 · RF-0.5 · RF-1 ·
> RF-1.5 · RF-2 · RF-3 Tier 1 · RF-3 Tier 2). Its job was one question: **is every item
> GENUINELY CLOSED, or merely TOUCHED?**
>
> **Method:** every claim re-measured from scratch on the live boxes. Prior verifications —
> including CC's own from earlier prompts — were treated as hypotheses, not evidence.
> **Nothing was fixed.** A verification prompt that starts fixing has stopped verifying, and
> there is no independent check behind it. Every defect below is RECORDED, not repaired.
>
> **money_path=no · `MAX(level)` = 0 (VM chain) start and end · sacred 13/13 · zero code
> changes · no service restarted.**

---

## 1. Verdict

**Closure failures found: 3.** Two substantive, one minor-but-exactly-the-pattern.
**GO/NO-GO today: NO-GO**, on six blockers — a *different* set from the four RV named (all
five of those, plus the one found mid-campaign, are closed).

**The honest summary, and it is the important half:** every Tier-2 mechanism probed is
present, reachable and behaving; the tail cap binds; the ratchet is byte-preserved; the
sacred seam is intact; the three learning-loop proofs hold; the leak test still catches at
0.0% tolerance. **PENDING, not GO.**

---

## 2. Live state at close

| Check | Expected | Measured |
|---|---|---|
| `MAX(level)` — VM chain via pipe | 0 | **0** (`level_query.py current` → `{"current_level": 0}`) |
| Sacred manifest (VM) | 13/13 | **13/13 OK**, 0 FAILED |
| `trevor.service` | active | **active**, MainPID 1266343, NRestarts 0 |
| Independence suite | 5/5 | **5/5 PASS** |
| Zero-arg gate (RF2-B4) | PASS | **1/1 PASS**, 4 call sites all zero-arg |
| `active_trades` | 73 frozen | **73** |
| `RANGE_MODE_ENABLED` | false | **`false`** — RF-0's dedup-race proof is conditional on this and it holds |
| `bandit_posteriors` | 0 | **0** (compass_weights = 1 unlearned seed; rejection_log 0) |
| VM HEAD | ≥ B7 | **`b397917`** |
| WSL HEAD | ≥ B8, pushed | **`4ad5889`** == `origin/master` |
| `systemctl --failed` (VM) | — | **4**: 2 stray `run-*.scope`, `dailyaidecheck.service`, `trevor-regime-transitions.service` — all known, all Cloud-Shell-owned |

---

## 3. Tier-2 closure matrix — present / **reachable** / **behaves**

The middle column is the one that matters. Six times this campaign a mechanism was present
and invoked by nothing.

| Item | Present | Reachable | Behaves | Evidence |
|---|---|---|---|---|
| **B0** DP-1 ET-day breaker | ✅ `models.py:1973` | ✅ `risk_breakers.py:173` → Gate 0.5 (`manager.py:933`) | ✅ | armed breaker, live |
| **B0** DP-1b companion denominator | ✅ `models.py:2064` | ✅ same call | ✅ | forms differ — §4 |
| **B0** DP-1c visibility log | ✅ | ✅ **firing live** (2× since restart) | ❌ **BLIND** | **failure #2** |
| **B0** DP-2 canonical `get_equity()` | ✅ `:1866` partials-inclusive | ✅ `get_effective_equity` `:1913`/`:1936` | ✅ | `get_equity_display()` is a **one-line alias**, not a second implementation |
| **B0** DP-3 frozen judgment read | ✅ removed | n/a | ✅ | **0** `active_trades` SQL reads in `judgment.py`; all 4 hits are removal-documenting comments |
| **B0** sites 4+5 | ✅ `models.py:1742`, `manager.py:523` | dormant behind zero-valued caps | ✅ | ET-day form on both |
| **B3** bounded tie-break | ✅ | flag **OFF** → v1 | ✅ **tripwire fires on BOTH paths** | §5 |
| **B4** nine pre-commit guards | ✅ 9 enumerated | ✅ hook `:65`, **fail-CLOSED** | ⚠️ **8/9 effective** | **failure #3** |
| **B4** `backfill_regime` UPDATE guard | ✅ `:56 … AND regime_at_entry IS NULL` | ✅ | ✅ | |
| **B5** `open_exposure_usd` → `open_margin_usd` | ✅ 3 files | ✅ | ✅ `tsc` rc=0, `npm run build` rc=0 | 2 residual refs are provenance comments, not references |
| **B5** materiality doc | ✅ 17,350 B | — | ✅ **TWO reopening conditions** (§5, `:127`, `:314`) | |
| **B6** T2-k ownership assertion | ✅ `:80` / `:641` | 🚨 **ZERO INVOKERS** (crontab: 0) | ✅ | instance #6 stands |
| **B6** C2 backfill guards | ✅ IS NULL `:192`, dry-run default `:87`, `--allow-live-db` | ✅ | ✅ | false docstring corrected |
| **B6** C3/C4 guards | ✅ | ✅ | ✅ **5/5 cases exact** | §6 |
| **B6** C8 5× arm | ✅ `:2756` **PRESENT** | dead-by-design | ✅ | counter-regime arm `:3104` **untouched** |
| **B7** conftest guard | ✅ `_GuardedCursor(sqlite3.Cursor)` `:138` | ✅ autouse, session-wide | ✅ **0 `LiveStoreWriteError`** | §7 |
| **B7** C9 discriminator | ✅ | ✅ | ✅ **imports** `_PAPER_SYNTH_OID_FLOOR` (`watchdog.py:218`), never copies | single definition `live_executor.py:621` |
| **B8** ssh from a daemon child | ✅ | ✅ | ✅ `env -i ssh vm` → `trevor-prime-2` | foreign `HOME` also authenticates — UID/`getpwuid`, confirmed |
| **B8** NIT-1 / NIT-7 / 6th false claim | ✅ | ✅ | ✅ | canonical CLI `watcher_review.py:975`; HHI **LOWERS** `compass_metrics.py:470`; docstring corrected `trainer_validation.py:362` |
| **B9** F1 input guard | ✅ | ✅ | ✅ **independent 120-cell matrix: 0 raises** | §8 |
| **B9** F2 named-key WARNING | ✅ | ✅ | ✅ **all offending keys named**, sorted | |
| **B9** F3 docstring | ✅ `:622` | — | ✅ matches code | |
| **B9** F4 phantom READYs | ✅ | ✅ | ✅ **6/6 → NOT_READY** | framing survived — §8 |
| **B9** F5 `grade_shadow` log | ✅ stderr WARNING | ✅ | ✅ | no counter (as recorded) |
| **B9** F6 finiteness clamp | ✅ `gateway_shutdown_guard.py:122` | ⏳ **arms on next restart** | ✅ | correctly recorded — §9 |

---

## 4. B0's two clock expressions, side by side

```
numerator    closed_at            NAIVE ET  ->  date(closed_at)      = date('now','localtime')
denominator  equity_snapshots.ts  real UTC  ->  date(ts,'localtime') = date('now','localtime')
```

`'localtime'` sits on **`date('now')`** for the ET column and on the **COLUMN** for the UTC
one. Different column classes, deliberately asymmetric forms. Verified live at
`models.py:1973` and `:2064`. No hardcoded `+4h` anywhere. **Do not "simplify" them to match.**

---

## 5. §4 ANSWERED — `S`, the tie-break spread, and the ε band

The question RF3T2-B3 shipped without answering: **how is `S` derived, and is the tie-break
vestigial?** "0 inversions up to $1e12" does not answer it — a *saturated* `S` also shows
zero inversions, with the term pinned at ±ε/2, discriminating nothing.

**`S` = `MAGNITUDE_SCALE_USD` = 50.0 USD per effective bet** (`compass_metrics.py:683`).
**Derivation, documented in code at `:665-682`, not a magic number:** mirrored — not imported;
importing `auto_trader` trips the WSL barrier — from `LIVE_HARD_CAPITAL_CAP_USD = 50.0`, the
project's immutable hard capital cap. The largest plausible NET per effective bet in one
scoring window is bounded by the capital that can be at risk at all.

### Is `S` saturated? **No.** (measured independently, 2026-07-24)

| $/eff-bet | 0 | 1 | 10 | 20 | **36.90** | 82 | 132 | 500 |
|---|---|---|---|---|---|---|---|---|
| tie-break as % of half-band | 0.0 | 2.0 | 19.7 | 38.0 | **62.8** | 92.7 | 99.0 | 100 |

Spread over the deployable range $0–$36.90 (45% ceiling on an ~$82 book) = **62.8%** of the
available half-band, monotone throughout. Saturation (≥99%) only at $132 = 2.64·S = 3.6×
deployable capital — outside the realistic range by construction.

**Counter-tests confirm the trap is real and avoided:** `S = 1.0` → only **23.8%** spread
(saturated, magnitude effectively dead); `S = 1000` → **3.6%** (pinned near zero, also dead).
`S = 50` sits in the usable middle.

### Is magnitude DECORATIVE? **No — and the answer is three-part**

Band occupancy, 200,000 random pairs each, ε = 0.428571 at the seed weights:

| Population | Fraction of pairs where magnitude decides |
|---|---|
| sortino ~ U[30,550] *(the stated real range)* | **0.178%** |
| sortino ~ U[1,150] | 0.530% |
| sortino ~ lognormal(3,1) | 1.514% |
| 🚨 **sortino ~ U[0,3] (weak-edge cluster)** | **26.556%** |
| **exact ties** (all-up 99.0 sentinel; distribution-invariant config axes) | **100% by construction** |

- For **randomly-drawn realistic** pairs, magnitude decides **under 2%** of the time — rare,
  exactly as the design intends (consistency dominates).
- 🚨 **But for weak-edge candidates it decides more than one comparison in four** — and that
  is the population a cold search loop generates most of early on. **The existing record
  under-weights this**; "magnitude decides ~1% of the time" is true only of the random-pair
  framing.
- On **exact ties** magnitude is the sole decider, and it is **decisive, not pinned**: $2 vs
  $36.90 yields a blend gap of **0.125991**, nowhere near the ±ε/2 rail.

**Structural guarantee re-proven independently: 0 inversions in 200,000 pairs** (consistency
∈ [−50, 600], magnitude to ±$1e6).

**Verdict: `S` is not saturated and magnitude is not decorative.** B3's claim survives
contact — with the added finding that the tie-break is far more active in the weak-edge
region than the record suggests.

---

## 6. Prior-roadmap regression sweep — each with its measured result

| Item | Result |
|---|---|
| Tail cap binds | ✅ **all 10 sacred tickers, 0 survival-invariant violations**; BTC wall 2.9250× → 2×; every input (2, 5, 21, 31)× → ≤2×; **idempotent: True** |
| Tail cap unconditional | ✅ `live_executor.py:`**`3173`**, function-body indent, no enclosing `if`; comment `:3162` "Wired unconditionally — no flag" ⚠️ **line drifted — §12** |
| Exit ratchet byte-preserved | ✅ **0 diff lines** (`exit_helpers.py` + `exit_engine.py` vs `067b030`) |
| Sacred cooldown/dedup seam | ✅ `signal_guard.py` / `signal_cooldown.py` / `signal_cleanup.py` all **OK** in the manifest |
| **BLOCK-2** refuses on hard-UNKNOWN | ✅ level **0 → rc=1** (TRAP A), `None` → rc=1, `−1` → rc=1, loop **never called**; level 1 → rc=0 with **level=1 threaded**. Loud stderr refusal every time. ⚠️ The refusal is gated behind `TRAINER_LOOP_ENABLED` — flag-off returns rc=0 *before* the resolver. Correct (a flag-off daemon should not start) but it means **the refusal is only armed when the flag is armed** — an R13 ordering note |
| **BLOCK-3** bounded timeout + fallback ON TIMEOUT (TRAP C) | ✅ `bot_brain_judgment.py:163` reads the per-tier timeout (default 8.0s), `:178` `fut.result(timeout=…)`, `:179` `except TimeoutError`. **Empirically reproduced: `nan` → `TimeoutError` instantly; `inf` → `OverflowError` instantly** — bounded on both, caught upstream → mechanical SKIP. **TRAP C does not materialise here.** |
| **BLOCK-5** `insert_trade` carries `paper_window` | ✅ present in **both** the column list (`models.py:1545`) and the value binding (`:1593`) — the RF15-B2 trap (a fixed column list silently dropping it) is closed |
| **Tier 1** compass gate-(a) fail-CLOSED | ✅ **6/6 degenerate shapes REJECT** (missing / empty / `None` / len-1 / all-zero / all-NaN → `dd=None`, `failing=['dd_ceiling(insufficient_curve)']` + 🚨 log); 🚨 **a VALID zero-drawdown curve still PASSES** — the crux is preserved, this is not "dd==0 → reject" |
| **Learning-loop proof 1 — anti-farming** | ✅ top-up **exactly `0.025000`**; wealth 0.05 → 0.075 (**carries**, never a reset). Structural half: `trainer_budget_adapter` has **no `reset`** (`hasattr → False`) |
| **Learning-loop proof 2 — anti-lobotomy** | ⚠️ **unexercised by construction** — `MAX(level)` = 0, nothing minted. Structural half verified; the archive→reopen-at-N+1 behaviour was simulated by RV-B6 on an isolated copy and has not run live |
| **Learning-loop proof 3 — matched-data promotion** | ✅ **zero replica reads in `compass_metrics.py`**; `lib/trainer_db.py` hard-REFUSES the 0444 replica path. 🚨 **B3's conservative correlation default (`n_eff = 1.0` fallback) did NOT introduce a decision-path replica read** — the guarantee it was designed to protect is intact |
| **The leak test** | ✅ `assert_mask_causal` — `test_validation_harness_b4.py` **13/13**, mask/causal subset **6/6**. Still catches the full-sample-percentile mask at 0.0% tolerance |
| `RANGE_MODE_ENABLED` | ✅ `false` |
| Mint idempotency | ⚠️ **unexercised** — no level has been minted; `MAX(level)` = 0 |

---

## 7. B7's real acceptance test — no test writes a live store

Full `tests/` suite run against the live box, with a deterministic canary captured before
and after:

- **`LiveStoreWriteError` count: 0.** The guard raises **before** any write executes, so
  zero guard-induced reds ⇒ **zero live-store write attempts**.
- **`partial_trigger_shadow` max_rowid: 28482 → 28482** (count 14910 → 14910). **A full
  suite consumed zero live rowids.**
- Result: **120 failed / 2928 passed / 1 skipped** in 207s.

**On WAL — stated plainly rather than dressed up.** `trevor.db-wal` was 27,582,464 B before
the run, but **a raw WAL delta cannot serve as this measurement**: the live bot scans
concurrently, and B7's own idle control (zero tests running) advanced 10 tables on its own.
The structural proof (0 guard reds ⇒ 0 writes) plus the deterministic canary is the sound
form of the test, and both are clean.

**The red delta (120 vs B7's recorded 110)** — sampled
`TestPersistenceAndDeltaMath::test_liquid_entry_row_delta`: it writes to and reads back from
a **temp DB successfully** (isolation working) and fails on `modeled_bps 4.7 != 1.0`, a
**stale calibration expectation**, not guard-induced. This run used `-p no:randomly`; **no
clean-HEAD baseline was run, so all 10 cannot be attributed.** Flagged, not glossed.

---

## 8. B9 — verified independently, not re-read

**My own matrix**, built from scratch with my own bad-value set (nan, +inf, −inf, None,
str, negative, list-of-nan, list-of-str): **15 inputs × 8 values = 120 cells → 0 raises,
0 READY, 120/120 NOT_READY.** The cell count matches B9's exactly; the finding matches.

**F4 — the five phantom READYs (a removed fake gate, not a changed decision).** All six
probes → `NOT_READY` with the offending key named: `t_stat_threshold=-inf`,
`beat_rate_threshold=-inf`, `dsr_threshold=-inf`, `bh_significant=nan`, `min_n=0`,
`min_n=-5`. **The framing survived into the record** and is the correct one:

> *a READY produced by a threshold that was silently disabled is not a promotion outcome —
> it is the ABSENCE of a gate wearing a gate's name. Removing it does not change a decision;
> it removes a fake one.*

**F2 — multi-bad-input.** The WARNING names **every** offending key, sorted, never the
first: `['edge_series', 'min_n', 'n_div', 't_stat_threshold']`, with the "this is an
UPSTREAM defect" framing intact.

**The 5-shadow family** grades all five, with the two previously-healthy-but-ungraded
returning READY and the NaN member NOT_READY and unpromoted.

**🚨 B9's proof method — endorse as the house standard.** B9 proved *no outcome changed* by
**byte-identity against HEAD's actual loaded function**, not against a re-implementation:
*"10/10 healthy inputs BYTE-IDENTICAL to the original function loaded from git HEAD."* That
is strictly stronger than a re-test — a re-implementation can reproduce a bug — and it
should be the default way this project proves a fix did not move the correct case.

**Addendum F — the purity-test touch.** The diff shows **only** the stdlib `allowed` set
gaining `logging`, plus five explanatory comment lines. The **`banned` list is
byte-identical** (it does not appear in the diff at all). Documented at both sites. Loosening
a purity guard to let a fix compile is exactly the move that needs an independent check;
this one survives it.

*(Counting note, not a discrepancy: `pytest` reports `test_servant_gate.py` as 14 passed;
B9's "57/57" counts individual `_check` assertions inside those 14 test functions.)*

---

## 9. F6's arming gap — recorded, correct

`gateway_shutdown_guard.py:122` is finiteness-aware:
`if not math.isfinite(_timeout) or _timeout <= 0: _timeout = 5.0`. Before the fix,
`inf <= 0` and `nan <= 0` are both False, so **both sailed through** — `+inf` →
`wait_for` never fires → the TLS-shutdown guard silently disabled while still appearing armed.

**The arming gap is real and correctly recorded:** `main.py:210-211` imports and installs
the guard at bot startup, and RC2 freezes `_timeout` **once at install**. B9 committed at
22:00:43, **after** the 17:39:04 restart — so the running `trevor.service` holds the **OLD**
clamp. **Safe today**, verified live: `GATEWAY_SHUTDOWN_TIMEOUT_SEC = 5.0` (finite). It arms
on the next natural restart. **The single exposure is setting that key non-finite before
that restart** — it belongs on the C2live checklist.

**And the correction landed:** the earlier claim that `GATEWAY_SHUTDOWN_TIMEOUT_ENABLED`
"ships dormant / default OFF" is **STALE** — it is live `true` (verified). A stale doc about
a guard's arming state is itself a false claim, and it is on the ledger.

---

## 10. The corrected record — audited

**All six refutations present and correctly stated.** A correction that got lost would be
worse than never having made it; none were lost.

| # | Original claim | Correction | Where |
|---|---|---|---|
| 1 | RV: *"every DECISION path obeys the data laws"* | **REFUTED** — 5 sites + 1 companion; three roadmaps cited the parent, treat it as void | VM `CLAUDE.md:648` |
| 2 | Two audits: *"`circuit_breaker.py` is dead code"* | **REFUTED** — live via `discord_bot.py:2288`, blocking trades as recently as 2026-07-22. **The parent's error was MODULE CONFLATION**, not auditing dead code | `:649` |
| 3 | RV: *"the bandit converges (87%)"* | **REFUTED AT REAL SCALE** — `0.6 + tanh(0.5·blend)·0.4`; real blends 30–550 → every scored survivor gets reward exactly 1.0. Measured on synthetic O(1) blends | WSL `CLAUDE.md` |
| 4 | *"T2-i is LATENT (`SHADOW_FEEDER_ENABLED` OFF)"* | **REFUTED** — `promotion_verdict` has **five** callers; the flag gates only the feeder; **two live crons** consume it today (`loop_edge_sweep` `0 */6`, `shadow_readiness_gate` `0 4`). Latent on today's DATA, never by flag | `:588` |
| 5 | B8: *"a non-finite timeout never fires"* | **CORRECTED to primitive-specific.** `subprocess.run`: nan and inf both never fire. `asyncio.wait_for`: **nan fires INSTANTLY** (the opposite failure), inf never. `futures.result`: nan instantly, inf `OverflowError`. **The table is recorded, not the slogan** | `:589` |
| 6 | B8: *"the batch returns looking successful"* | **CORRECTED** — two paths fused into one story. The FEEDER path dies **LOUD** (`try` at `:262` has only a `finally`, no `except`) and discards both computed verdicts → **0 usable results, not 2**. The **NIGHTLY CRON** path is where the genuinely silent partial grading lives. Both real, separately | `:590` |

**The DP-1 framing correction** — `:650`, both facts together and neither absorbed by the
other: the breaker was **DISARMED** 20:00–23:59 ET every day, on **56 of 75 trading days**
(308/1748 closes, 17.6%) — real and armed — **but the −25% threshold was never reached
during a disarmed window** (worst realized intraday drawdown −20.74%, 2026-06-17). It never
cost a halt. *"An ARMING pass, not a live-bleed repair."*

**Instance #6 with its inverted sign** — `:634`, verbatim: *"the previous five were SAFETY
code that never ran; this one is a DEFECT that never ran. Same question, opposite sign."*

**BLOCK-3's relief** — `:602`, recorded as a relief with evidence, and independently
reproduced here (§6). The worry was wrong; the evidence is clean.

### The git-index collision — independently confirmed LOSSLESS

Not taken on trust. `git log -- CLAUDE.md` shows RF3T2-B6's doc block landing inside
RF3T2-B7's commit `e404a25`. Reading the surviving content directly:

- **Every B6 item present:** T2-k `:633` · instance #6 `:634` · T2-j refutation `:635` ·
  C2 `:636` · C3 `:637` · C4 `:638` · guard verification `:639` · C5 refutation `:640` ·
  C6 `:641` · C7 `:642` · C8 `:643` · the 4 new findings `:644`.
- **Every B7 item present:** F-TST-1 `:608` · the 13-file / 160-write sweep `:609` ·
  the conftest guard `:610` · the refusal `:611` · the stale assertion `:612` · the residue
  row `:613` · the 3 import-time DDL writes `:614` · C9 `:615` · C10 `:616` · the NIT triage
  `:617-622` · E1–E5 `:623-628` · the self-reported cursor-subclass defect `:629`.

**Nothing was lost.** CC verified string-by-string and correctly REFUSED to revert —
reverting would have destroyed B7's work.

**The lesson is recorded** (`:645`), verbatim: *"`git_commit_serialized.sh` serializes the
COMMIT, not the window between your `git add` and it — quote `add && commit` as ONE
argument."*

**The root cause is recorded honestly** (`:645`): two prompts on the same box in the same
wave both wrote `CLAUDE.md`, violating the one-writer-per-wave rule. **That is a
PROMPT-AUTHORING error, not a CC error**, and it is recorded that way.

---

## 11. 🚨 Closure failures found: 3

### ❌ #1 — The SECOND live epoch boundary is UNRECORDED, and five "PENDING restart" claims are STALE

`trevor.service` restarted **2026-07-24 17:39:04 EDT** (MainPID **1266343**, process start
17:38:58) — **12 minutes after RF3T2-B0's commit `a0d0239` (17:27:10 EDT)**.

**Consequence, not just the fact:** B0's decision-path fixes — the ET-day breaker, canonical
`get_equity()`, the removed frozen judgment read, sites 4/5 — **ARE LIVE**. And so are the
other four waves committed before that restart. Yet every one of those records still reads
*"PENDING Ghost"* / *"RESTART REQUIRED — NOT taken here."* **Any future reader of those
records would conclude the fixes are NOT live.** That is a records defect with a real failure
mode: someone re-applies or re-restarts on a false premise.

| Wave | Commit | Committed (EDT) | Record still says |
|---|---|---|---|
| RF3T2-B0 | `a0d0239` | 2026-07-24 17:27:10 | "Loads on the next restart — PENDING Ghost" / "RESTART REQUIRED — NOT taken here" |
| RF2-B5 | `08b35be` | 2026-07-24 12:47:17 | "Loads/arms on the next restart — PENDING Ghost" |
| RF15-B2 | `7f0d509` | 2026-07-24 00:06:21 | pending-restart bundle |
| RF3T1-B2 | `fdf5763` | 2026-07-24 07:56:34 | pending-restart bundle |
| RF1-B1 / RF1-B3 | `41f3104` + | 2026-07-23 19:58:10 | pending-restart bundle |

**The boundary itself is unrecorded anywhere:** zero references to `17:39`, `1266343`, or a
second boundary in either `CLAUDE.md`. **`docs/PAPER_WINDOW_LEVERAGE_EPOCH.md` has mtime
2026-07-24 00:05:57** — written *before* the restart — and documents only boundary #1.

**🚨 The split-key consequence, stated explicitly:**

| | Boundary #1 | Boundary #2 |
|---|---|---|
| Code | `41f3104` @ 2026-07-23 19:58:10 EDT | `a0d0239` @ 2026-07-24 17:27:10 EDT |
| Live behaviour | restart @ **20:33:53 EDT** (PID 1087578) | restart @ **17:39:04 EDT** (PID 1266343) |
| Split key | **trade id `101733`** (last UNCAPPED) | 🚨 **NONE — no trade has opened since** |

`MAX(id) = 101733`, opened **2026-07-23 20:22:23**. Boundary #1's first *CAPPED* id is still
PENDING, and **boundary #2 has no split key at all**. **Any future analysis across boundary
#2 must establish one first.** Note also that `paper_window` is not the split key for either
boundary — pre-fix rows are all stamped 0, and #101733 is additionally stamped
`trade_mode='live'`; both columns lie for that era.

*Recorded, not repaired. Correcting those five records is not this prompt's work.*

### ❌ #2 — DP-1c's visibility log is BLIND: present · reachable · firing · conveying nothing

Live journal output, verbatim:

```
[RISK-BREAKER] daily_loss window evaluated: et_day=%s realized=%s basis=%s loss_pct=%s limit_pct=%s active=%s reason=%s
```

**Mechanism, precisely:** `risk_breakers.py:122` passes **`%s` printf-style placeholders with
positional args to loguru**. Loguru formats via `str.format()` (brace style), not `%`-style,
so the message is emitted **unchanged, with literal `%s`**.

**Reproduced directly on the box:**

```
logger.warning("pctstyle a=%s b=%s", 1, 2)   ->  pctstyle a=%s b=%s
logger.warning("bracestyle a={} b={}", 1, 2) ->  bracestyle a=1 b=2
```

RF3T2-B0 added this line *"so a future silent failure is detectable."* **It is not
detectable.** The armed daily-loss breaker's only rate-limited observability emits no data.

**🚨 This is a CLASS, not a site.** `risk_breakers.py:122` and `:100` (the trip-webhook-failure
error) are two of roughly **53 `%s`-carrying `logger.*` calls across `auto_trader/`** sharing
the shape. A full sweep is its own prompt.

**Both mitigations found, recorded so the severity is not overstated:**
- ✅ The **one-shot Discord TRIP alert** uses an f-string and is **unaffected** — the breaker
  still ALERTS on an actual trip.
- ✅ **B3's compass tripwire uses stdlib `logging`**, where `%s` with positional args is
  correct — verified interpolating (`[COMPASS] blend_version=v1 level=1 verdict=… blend_score=…`).

**What is blind is exactly the rate-limited window summary B0 added to make a future silent
failure detectable.**

**🚨 INSTANCE #7 OF THE CAMPAIGN'S DEFINING PATTERN, WITH A THIRD SIGN.** The first five were
safety code that never ran. Instance #6 inverted the sign: a defect that never ran. This one
is a third sign again — **not "invoked by nothing," but INVOKED AND REPORTING NOTHING.**

### ⚠️ #3 — "All 9 guard hooks passed" is a FALSE CLAIM emitted by the verification machinery itself

Live run of `hooks/run_guards.sh`, rc=0:

```
[PASS] All 9 guard hooks passed (8 effective — guard_import_safety is dead, see header)
```

**8 effective, 9 reported.** `guard_import_safety` scans `autotrader/` (no underscore); the
live package is `auto_trader/` (103 tracked files; `autotrader/` does not exist). It cannot
fire.

**🚨 Added to the false-claim ledger as its own site — and it is the most dangerous kind in
the set: a false claim emitted by the verification machinery itself, on every single commit,
to everyone who reads it.** B4's header documents the deadness honestly, but the suite's own
success line is what a committer actually sees, and it reads as nine working guards.

**It was already on the deferred ledger as its own prompt**, correctly scoped: *"a one-word
repoint would arm a guard that has never run against 103 live files — dry-run sweep FIRST,
then repoint."*

**🚨 Same bug, two files, one fixed.** RF3T2-B6's C3 fixed the **identical** stale-path bug
(`^autotrader/` vs `auto_trader/`) in `guard_autoclose_scanner.sh` — reproduced before
fixing, scoped to Checks 2 and 3 only. It was not fixed here. **Why: C3 was scoped to the
file the recon named.** A recon that names one instance of a class gets one instance fixed.

---

## 12. The tail-cap line drift — G9 landing on the campaign's own paperwork

`_apply_tail_cap` is called at **`auto_trader/live_executor.py:3173`**, at function-body
indentation with no enclosing `if` (unconditional, confirmed; comment at `:3162` reads
"Wired unconditionally — no flag"). It drifted when RF2-B5 added the sleeve `lmax_fraction`
argument.

**Three documents carry a stale line number:**

1. The **RF3T2-C1 prompt** — `:3121`
2. The **RF3T2-B0 record** (VM `CLAUDE.md`) — `:3132`
3. The **RF3T2-B7 record** (VM `CLAUDE.md`) — `:3132`

**Named, not edited**, so a follow-up can correct them. This is gotcha **G9** — *every hinted
line number drifts* — landing on the campaign's own paperwork rather than on the code it
audits.

---

## 13. G11 — CLOSED. Its third hop ends here.

**Case (a): it exists.** Found on WSL, exactly where RF3T2-B9 predicted it would be:
WSL `CLAUDE.md:362` (RF3T2-B8's record) and a code comment at
`src/app/api/trainer/pause/route.ts:35`.

**What it is:** a **NIT-4 sub-item of RECON-GIGANTIC-001** — *not* a G-numbered VM finding.
🚨 **That is exactly why B9's exhaustive repo-wide `grep "G11"` on the VM was correctly
empty.** The G-numbers are the recon's internal sub-item labels for one Hub cluster; they
were never VM identifiers.

**Definition:** `ENTRY_STOP_DISTANCE_SHADOW` + `EXTERNAL_CLOSE_OUTCOME_SHADOW` "firing by
config-key absence."

**Triage, live on the VM:**

| Site | Idiom | State |
|---|---|---|
| `auto_trader/manager.py:2317` | `if cfg_str("ENTRY_STOP_DISTANCE_SHADOW_ENABLED").strip().lower() not in ("false","0","no","off")` | key **absent** from `auto_config` → fires |
| `auto_trader/live_executor.py:6576` | same idiom for `EXTERNAL_CLOSE_OUTCOME_SHADOW_ENABLED` | key **absent** → fires |

**Verdict: NOT A DEFECT.** Both are by-design **default-ON observability with a documented
15-second rollback** (`KEY=false`). Both are wrapped in `try/except` (non-fatal), both use
off-loop `log_shadow_async`, and both sit **after** the decision:

- the entry shadow is logged *after the entry already fired live* — `"Observer only — the
  entry already fired live above and is byte-identical (Rule 30-safe)"`
- the close shadow is logged *after the sanctioned reconciliation close* — `"Rule 1
  detection, NOT an auto-close"`

**Zero decision-path reach.**

**🚨 THE ROOT CAUSE OF THE THREE-HOP CHASE — the transferable lesson.** The recon's phrase
**"firing by config-key absence" IMPLIED ACCIDENT.** The mechanism is **DELIBERATE**. A
description that smuggles a verdict into its wording cost three prompts (B7 routed it to
WSL, B8 found it mis-routed and handed it back, B9 searched the VM exhaustively and found
nothing under that name). **Describe the mechanism; let the verdict be a separate finding.**

**🚨 And B9 stopping rather than guessing was the right call** — it explicitly refused to map
"D1 all-up sortino 99.0 sentinel" onto "G11" because that would have been invention. That
refusal is the reason this resolved cleanly instead of entering the record as a fabricated
finding.

**G11 is closed and must not be re-raised.**

---

## 14. The rebuilt deferred ledger

Rebuilt from what could be verified this prompt, not copied forward.

### Go-live blockers

| # | Item | Owner | What blocks it |
|---|---|---|---|
| 1 | 🚨 `:3941` shadow executor **NOT LISTENING** | Ghost / root (Cloud Shell) | FORTRESS-C4 blocks `trevor` from `/etc` writes + `daemon-reload`. **Cutover ordering step 2 ("verify `:3941` up") would FAIL today.** Code + token + bind + auth are proven; only the unit install is missing |
| 2 | 🚨 Alerting spine `OnFailure=` **NOT WIRED** | Ghost / root (Cloud Shell) | same wall. Handler built + proven 204; until the drop-ins land, **a unit death is invisible** |
| 3 | 🚨 **Bandit reward saturation** | its own prompt | `compass_reward` = `0.6 + tanh(0.5·blend)·0.4`, `REWARD_K = 0.5` tuned for O(1); real blends 30–550 → reward exactly 1.0. **A bandit that cannot rank its own survivors is filtering, not learning** |
| 4 | 🚨 **DP-1c blind log** (new, this prompt) | one-line fix prompt | the armed daily-loss breaker's only rate-limited observability emits no data |
| 5 | 🚨 **Zero paper-window fills AND zero signals** | Ghost | the money path is unexercised and the signal path is **undiagnosed** — §15 |
| 6 | `cutover_flip.py --revert` absent + WSL `v5-cutover-pre` tag missing | R13-B1 / Ghost (WSL) | two rollback layers incomplete; both are C1cut gate items |

### Open, non-blocking

**Money-path / escalated (RF3T2-B7's five):**
- 🚨 **E1** — the legacy `exit_engine` confidence multiplier on the **LIVE** TP path
  (`monitor.py:2297` → `:2305-2311` → `exit_engine.py:39-45`, `conf_mult` 1.3/1.0/0.7,
  ±30% swing on where the first tranche banks). `ATR_TP_RUNG1_ENABLED` is live `true`.
  **Never measured.** Escalated, not fixed.
- **E2** `PER_SLEEVE_STOP_ENABLED` is `true` with **zero readers** · **E3** unguarded
  `CASCADE_LMAX[ticker]` in `sleeves.effective_lev()` (the survival wall) · **E4** lock-free
  read-then-act in the Gate-6 dedup · **E5** a `DROP` inside a sacred file
  (`training_bridge.rollback_training_data`, CLI-only, zero importing callers) —
  **REPORT ONLY, no sacred-file change implied or requested**

**Non-finite / false-claim class:**
- 🚨 **`cfg_float` has NO finiteness check** (`auto_trader/config.py`) — **the systemic
  enabler**: `float("nan")`/`float("inf")` parse cleanly and are returned, so any
  `cfg_float`-driven bound is one `auto_config` row from non-finite. ✅ `cfg_int` is safe
  (`int(nan)` raises)
- 🚨 **539 "never raises"-class claims repo-wide** — a full false-claim audit is its own
  prompt. Ledger now **8 families / 28 sites** (the 7/25 base marked unverified-inherited,
  correctly), **plus the two added here**: the `%s` logger class and
  `run_guards.sh`'s "All 9 guard hooks passed"
- `_standardized_cost` (`shadow_feeder.py:102`) — `if not (n > 0.0)` catches NaN/0/negatives
  but **`+inf` sails through** → `cost=inf` → edge `+inf`. Reported, not fixed
- 🚨 **`shadow_feeder` adjacent-loop asymmetry** — the cohort loop `:270-278` **is** guarded;
  the verdict loop `:297-310` directly below it is **not**. Two adjacent loops over the same
  family, one guarded. Record the shape
- `grade_shadow` silent-drop **counter** — F5 added the log only, no counter
- **`guard_import_safety` dead** (new, this prompt — §11 #3) · **tail-cap line drift**
  (new — §12)

**Data / DB:**
- **3 import-time DDL writes** — `circuit_breaker.py:136` (idempotent DDL, but on a
  **CONFIRMED LIVE money-path module**), `circuit_breaker_utils.py:66` (idempotent),
  `cost_tracker.py:74` (**not** idempotent — a real row write)
- **`perf_baseline` residue row** — id=1, `metric_type='_b5_phase1_selftest'`,
  `ticker='TEST'`. **Reported, NOT deleted.** The additive law holds even for garbage;
  removal is Ghost's decision
- `recon_archive` 41 rows / 16 unresolved — a **cross-box indexing gap**, not a resolver bug
  (the prune SQL is correct and self-corrects on the next `index_report`); the WSL half is
  unverifiable from the VM
- **Correlation matrix source — PENDING / UNSOLVED**, not merely unimplemented. No clean
  source exists on either box; `backtest_fn` is the intended provider. 🚨 **Never point it at
  the replica** — that would violate matched-data promotion

**Ops / arming:**
- 2 masks (`trevor-regime-transitions`, `dailyaidecheck`) + 2 `reset-failed` (the stray
  `run-*.scope` units) — Cloud Shell
- Observatory heartbeat restore — precondition: re-verify `open_margin_usd`'s source first
- `CAPITAL_USD` vs live-HL gap **~$25.70** (corrected fallback $56.35 vs live $82.05;
  conservative direction, acceptable, **not closed**)
- `cmd_log:211` auto-mint (a `--money-path yes` self-log auto-mints L1)
- `COMPASS_COHERENCE_V2_ENABLED` arming · `SLEEVE_TAGGING_ENABLED` arming ·
  **`HUB_QA_WEBHOOK_URL` still absent** → alerts land in `#downloads`
- 🚨 **R13 arming step must flip ONLY `PORTFOLIO_INTEGRATION_ENABLED`** —
  `BOTBRAIN_JUDGMENT_ENABLED` is already `true`

**Wiring:**
- **W1/W2** deferred (need the compass simulator, D-5) · **W8** deferred (no
  oversight-reflection step exists) · **W11** not-a-wire
- The portfolio order wire + its 4 constraints. 🚨 **The 45% deployment ceiling is guarded by
  NOTHING today** — `would_exceed_ceiling` is correct and callable but no live path consults
  it, because nothing commits against it. **That is an R13 PRECONDITION, not a closed item**;
  whoever wires the order path owns the atomicity
- BEHAVIOR_RULES.md **Rule 1 predates full autonomy** (2026-05-29) — flagged for Ghost's
  ruling, not resolved; `BEHAVIOR_RULES.md` is the 13th sacred manifest entry and was not
  edited
- Test-hygiene roadmap (3 prompts) · VM disk

### 🚨 UNVERIFIABLE FROM THIS BOX — named, not dropped

- Anything requiring **root on the VM**: the `:3941` unit install, the `OnFailure=` drop-ins,
  the two service masks, the two `reset-failed`. `ssh vm` is **WSL→VM only** and `trevor` is
  FORTRESS-C4-restricted.
- **There is no VM→WSL path.** Any check that would need the VM to observe WSL cannot be run
  from either side.
- Live DOM rendering of Hub surfaces (no headless browser on this box) — `tsc` rc=0 and
  `npm run build` rc=0 are the gates that were run.
- The VM half of the 16 `recon_archive` rows pointing at WSL-only files.
- A clean-HEAD baseline for the suite red count (§7) — not run, so the +10 delta is not
  fully attributed.

---

## 15. 🚨 The zero-signal question — framed correctly, and NOT diagnosed here

**Blocker #5 must not be written as "zero paper-window fills." That understates it, and the
distinction is the whole point:**

| | What happened | Diagnosis |
|---|---|---|
| **BLOCK-5** (RF-0.5) | **30 SIGNALS, 0 FILLS** | diagnosed — `PaperExchange.order()` returned a *resting* order, never a fill; ALO maker-first aborted at timeout → routed to the existing `market_open` fallback. Second half: a sim fill was reaped by reconcile at NULL P&L because `insert_trade` silently dropped `paper_window` |
| **TODAY** | **0 SIGNALS in ~5.1h across 935 SCAN-STEP** | 🚨 **NOT DIAGNOSED AT ALL** |

**These are DIFFERENT failures with different causes.** The fill path was broken; today
nothing is even *proposing* a trade. Do not let "zero fills" absorb both.

### What can be established read-only (measured, 2026-07-24, since the 17:39:04 restart)

| Signal | Value |
|---|---|
| `scalp_scan` cycles | **169** |
| `[SCAN-STEP]` lines | **935** (10 tickers per cycle) |
| Last scan line | `[SCAN-DUR] 10 tickers in 12574ms \| **0 posted**` |
| `ACCEPT` lines | **0** |
| `REJECT` lines | **3** |
| `regime_blocked` occurrences | **0** |
| `blocked` occurrences | **0** |
| `signal_ab_results` rows written since the restart | **8** (total 4223; last `2026-07-25 02:03:23` UTC) |
| `auto_trades` opened since the restart | **0** |
| Last trade opened | **#101733, 2026-07-23 20:22:23** |

So: **the scanner is running, the scorer is producing rows, and zero signals are being
posted.**

### 🚨 THE TRAP, stated explicitly

**This campaign's instance #1 was reading 30 signals / 0 fills as "a quiet market" for a full
day.** The identical reading is available right now for 0 signals, and it is **equally
unearned.**

**WE DO NOT KNOW** whether 0 signals in ~5.1h is:
- market conditions,
- the `regime_blocked` dominance RF-0 measured (**694 / 31.8%**) — though note **0
  `regime_blocked` occurrences appear in this window**, which is itself a fact requiring
  explanation rather than an answer,
- or a new defect.

**It is UNDIAGNOSED, not explained.** Diagnosing it is its own recon, and it is the first
thing after this prompt.

---

## 16. GO/NO-GO — **NO-GO**

RV returned GO/NO-GO = NO with 4 blockers; a 5th was found mid-campaign; **all five are
closed.** The answer today is still **NO-GO**, on a different set:

1. **`:3941` not listening** — cutover step 2 fails as written. *(Ghost / root)*
2. **Alert spine not wired** — a unit death is invisible during an unattended paper window.
   *(Ghost / root)*
3. **Bandit reward saturated** — the learning loop cannot rank its own survivors.
   *(its own prompt)*
4. **DP-1c blind** — the armed daily-loss breaker has no working observability.
   *(one-line fix prompt)*
5. **Zero paper-window fills AND zero signals — the money path is unexercised and the signal
   path is undiagnosed.** *(Ghost; recon first)*
6. **`cutover_flip.py --revert` absent + WSL `v5-cutover-pre` tag missing** — two rollback
   layers incomplete. *(R13-B1 / Ghost)*

> **The campaign's engineering is in good shape: every Tier-2 mechanism probed is present,
> reachable and behaving; the tail cap binds; the ratchet is byte-preserved; the sacred seam
> is intact; the three learning-loop proofs hold; the leak test still catches at 0.0%
> tolerance. PENDING, not GO.**

---

## 17. What this prompt did NOT do

**FIX NOTHING was the instruction and it was followed.** The `%s` logger bug, the dead
`guard_import_safety`, the five stale "PENDING restart" claims, and the tail-cap line drift
in three documents are **all recorded, none repaired.** Zero code changes; the diff is docs
only.

`BEHAVIOR_RULES.md` untouched. Sacred files untouched, manifest 13/13 before and after.
`MAX(level)` 0 at start and end, read from the VM chain. Nothing restarted — the paper window
was not disturbed, and there are already two boundaries.
