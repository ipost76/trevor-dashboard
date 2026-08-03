# R9/R10 Cold-Start Runbook — PROVEN, not reasoned

> **C2-COLDSTART-REHEARSAL · 2026-08-03 · WSL `ghost@Ghost` · repo HEAD `510ed16` · branch `master`**
> Every step below was rehearsed on isolated copies with both VM transports stubbed.
> **Nothing live was started, minted, enabled or flipped.** `MAX(level)` (VM) stayed `0`
> throughout; all five `data/*.db` are byte-identical before and after.

---

## 0. The hazard is NOT the one the campaign has been carrying

🚨 **The campaign record says: "`trainer_loop.main()` hardcodes `level=0`; never call `main()`."
That is INVERTED. Measured at `510ed16`:**

| | Measured behaviour |
|---|---|
| **`main()` — `trainer_loop.py:1232`** | ✅ **THE SAFE PATH.** Calls `_resolve_live_level()`, and on a level `< 1` (including the empty-chain `0`) prints a loud stderr refusal and returns **rc=1**. **There is no numeric default anywhere in it** (RF1-B2, `:1249-1262`). |
| **`run_trainer_loop(*, level: int = 0)` — `trainer_loop.py:803`** | 🚨 **THE CORRUPTION VECTOR.** `level` is a **keyword default of 0**, reachable by any caller that simply *omits* `level=`. |

> 🚨 **So the hazard is not "someone starts the daemon." It is "someone calls the loop
> function directly without `level=`."** That is a **different and much quieter** failure:
> starting the daemon is a deliberate, gated, visible act that *refuses* today, whereas
> calling `run_trainer_loop()` from a script, a notebook, a test, or a future orchestrator
> is a one-line mistake that **silently succeeds** and writes a corrupt corpus.
>
> **The daemon start-order is guarded. The function call is not.**

**Reproduced and measured** (§3): with `MAX(level)=1` on a scratch tracker, one iteration
calling `run_trainer_loop()` **without `level=`** wrote **6 rows across 2 tables, every one
tagged `level_id=0`**, and minted the shadow id `trainer_L0_3f7e3c648bc7` — the corruption
propagates into the shadow-id namespace that crosses to the VM, not just into DB rows.

**Irreversible, structurally:** `level_id` is part of the **PRIMARY KEY** of
`bandit_posteriors` (`PRIMARY KEY (arm_hash, level_id)`); the only two `UPDATE` statements
in `trainer_bandit.py` (`:571`, `:914`) touch `alpha/beta/n_obs` and the timestamps and
**never `level_id`**; there are **zero `DELETE FROM`** statements in the trainer store layer.
No existing code path can move a level-0 row to level 1. Append-only is the design.

---

## 1. Pre-flight — verify before you touch anything

| # | Command | Must pass before continuing |
|---|---|---|
| 1.1 | `whoami && hostname` | `ghost` @ `Ghost` |
| 1.2 | `ssh vm 'sudo -u trevor sqlite3 /home/trevor/trevor/rebuild_tracker.db "SELECT MAX(level) FROM levels;"'` | prints `0` — the chain is unminted |
| 1.3 | `ssh vm 'sudo -u trevor sqlite3 /home/trevor/trevor/trevor.db "SELECT COUNT(*) FROM loop_heartbeat WHERE loop_name IN (\"trainer_search_loop\",\"watcher_loop\");"'` | prints `0` — the daemon has never run |
| 1.4 | `sha256sum data/*.db` | record all **5** (`trainer`, `watcher`, `memory`, `watcher_integrity`, **`hub`**) |
| 1.5 | `systemctl show -p ActiveState -p UnitFileState trevor-trainer.service trevor-watcher.service` | both `inactive` / `disabled` |

⚠️ **1.3 must count the TARGETED loop names, not the total.** The total is `22`; a trainer
row appearing would leave a naive "still 22?" check **passing while the evidence is destroyed**.

---

## 2. The start order — DO NOT REORDER

Each step states the command **and the verification that must pass before the next step**.

### Step 1 — Mint L1 (the one place a level mints)

```
# VM, Ghost-approved, its own gated event — NOT part of any fix/verify prompt
ssh vm 'cd /home/trevor/trevor && sudo -u trevor venv/bin/python3 -m rebuild_tracker mint --level 1'
```
**✅ VERIFY before Step 2:**
```
ssh vm 'sudo -u trevor sqlite3 /home/trevor/trevor/rebuild_tracker.db "SELECT MAX(level) FROM levels;"'   # must print 1
ssh vm 'cd /home/trevor/trevor && sudo -u trevor python3 scripts/level/level_query.py current'            # must print {"current_level": 1, ...}
```
🚨 **`level_query.py current` is the authoritative reader the daemon itself uses.** Verify
*that*, not only the raw table — the daemon reads through the shim, so the shim is what
must agree. A `MAX(level)` of 1 that the shim cannot read is still a refusing daemon.

### Step 2 — Bring up R8's executor on `:3941` + set the token

```
# VM: start the shadow executor serve() and export SHADOW_EXECUTOR_TOKEN
```
**✅ VERIFY before Step 3:** an authed no-op RPC returns `ok`, and `SHADOW_EXECUTOR_TOKEN`
is present in the WSL `.env.local`.

> 🚨 **MEASURED CORRECTION, 2026-08-03: `100.95.174.30:3941` is ALREADY LISTENING.**
> Both `CLAUDE.md` and the RP-C2 record state the executor is not serving until R13 —
> that is **stale**. **The only thing preventing a cross-box write today is the ABSENT
> `SHADOW_EXECUTOR_TOKEN`** (`R8HandoffClient._post` returns `None` with no bearer), **not
> a closed port.** Treat the token as a live arming switch, because it is one.

### Step 3 — Install + enable the trainer unit

The unit is **already installed and byte-identical to the tracked source**
(`deploy/systemd/wsl/trevor-trainer.service`, `ExecStart=/usr/bin/python3 trainer_loop.py`).
```
sudo systemctl enable --now trevor-trainer.service
```
**✅ VERIFY before Step 4:** `systemctl show -p ExecMainStartTimestamp trevor-trainer.service`
is **non-empty**, and `scripts/watcher_arm_check.py` posts a loud confirmation.
⚠️ **`OnFailure=` cannot fire for a unit that never started (gap F2).** Run the arm-check by
hand — it is the only cover for a non-start, and nothing invokes it automatically.

### Step 4 — `TRAINER_LOOP_ENABLED=true`

All **12** trainer/watcher flags are currently **absent** from `.env.local` (every one
defaults OFF). Add the master gate only.
**✅ VERIFY before Step 5:** the daemon logs a started iteration, and
```
ssh vm 'sudo -u trevor sqlite3 /home/trevor/trevor/trevor.db "SELECT loop_name, last_iteration_at, iteration_count FROM loop_heartbeat WHERE loop_name=\"trainer_search_loop\";"'
```
returns **one row** — `pre_register()` fires at `run_trainer_loop:854`, *before* iteration 1,
so the row appearing is the proof the loop body was reached.

### Step 5 — `SHADOW_LOOP_EXECUTOR_ENABLED=true` (the cross-box hop, LAST)

**✅ VERIFY:** a `shadow.route_proposal` lands a `promotion_candidates`/shadow row VM-side,
and no row anywhere carries `level_id=0`:
```
sqlite3 data/trainer.db "SELECT COUNT(*) FROM bandit_posteriors WHERE level_id=0;"   # must be 0
sqlite3 data/trainer.db "SELECT COUNT(*) FROM rejection_log     WHERE level_id=0;"   # must be 0
```
🚨 **This is the last point at which a level-0 row is cheap to notice and impossible to undo later.**

---

## 3. What the rehearsal actually measured

Bounded run: `run_trainer_loop(max_iterations=1, …)` with injected `client` / `heartbeat` /
`validate_fn` seams. **`main()` was never called. No daemon was started.**

| Iteration | `level=` argument | Rows written | `level_id` on every row |
|---|---|---|---|
| 1 | `level=0` passed explicitly (today's state) | 2 `bandit_posteriors` + 2 `rejection_log` | `0` |
| 2 | **omitted** → the `:803` default, with scratch `MAX(level)=1` | 3 `bandit_posteriors` + 3 `rejection_log` | 🚨 **`0`** |

**Result: 6 rows across 2 tables tagged `level_id=0` while `MAX(level)=1`.** Shadow id minted
as `trainer_L0_…`. Irreversible per §0.

**Both design invariants held in the code that ran:**
- **Routes a request, never writes code** — ✅ `submit_proposal` sends
  `{shadow_id, proposal:{axes}, family, params_json, reason, trevor_db}`; zero code-writing
  primitives (`exec`/`eval`/file-write/`shutil`) exist anywhere in `trainer_loop.py`.
- **Surfaces, never ranks/promotes** — ✅ `surface_candidate`'s RPC payload carries **only**
  `{shadow_id, trevor_db}`; `config_diff`/`stats`/`reasoning` are accepted for local Hub
  display and are **not sent**. Ghost + CC decide priority.

---

## 4. Still missing for a real cold start

1. 🚨 **`backtest_fn` is UNWIRED, not missing — and that is worse.**
   `backtest_provider.backtest_fn(arm, level) -> dict` **exists on WSL** (1056 lines, exact
   socket signature). The earlier "absent on both boxes" finding **measured the wrong box**:
   the VM legitimately has no `trainer_loop.py` at all, so its absence there was never
   evidence. What is actually absent is `TRAINER_BACKTEST_PROVIDER` — one env line.
   > **A missing component is obvious; an unvalidated one looks ready.** Per RP-C3 this
   > provider is **BUILT-BUT-UNVALIDATED**: aggregate relative error **37.6%** against a
   > pre-stated 10% bar, because `trade_partials` holds **0 rows** while 427 of 1758
   > `auto_trades` carry a non-zero `partial_pnl_realized`. **The criterion cannot be met by
   > re-running; it needs the missing fill data.** Arming it makes the compass pre-score —
   > the only route to `REWARD_K` — run on numbers nobody has validated.
2. **The `level=0` default at `:803` is unfixed** (out of scope here, by instruction).
   Reproduced, measured, reported. A change to the trainer's level resolution is its own
   gated prompt.
3. **`monitor_center` is `masked`+`inactive`**, so the R9 silent-death backstop is dead; the
   Step-4 heartbeat check is currently the only liveness proof.
4. **F2 (non-start) is uncovered in practice** — `scripts/watcher_arm_check.py` has no timer
   and no cron. Step 3's manual run is the whole cover.

---

## 5. Why it never started — 6 causes, and the one that makes the rest moot

1. **No invocation.** 🚨 Both `trevor-trainer.service` and `trevor-watcher.service` **DO
   exist on WSL**, installed but `disabled`, `ExecMainStartTimestamp` **empty**. *(This
   refutes the record's "no systemd unit on either box" — the daemon has still never run,
   but the reason on file was wrong.)*
2. **`TRAINER_LOOP_ENABLED` absent** → `main()` early-returns at `:1242`.
3. **`MAX(level)=0`** → the below-L1 refusal, rc=1.
4. **`SHADOW_EXECUTOR_TOKEN` absent** → every RPC fail-closed at `_post`.
5. **`TRAINER_BACKTEST_PROVIDER` absent** → the compass pre-score branch is unreachable.
6. 🚨 **A deliberate DO-NOT-ENABLE-PENDING-L1 policy** — recorded in `CLAUDE.md`.

> **Cause 6 is the one that makes the other five moot.** Causes 1–5 are the *mechanism* of
> dormancy; cause 6 is the *reason*. The daemon is not broken, unfinished, or
> mis-deployed — **it is dormant by design, and every gate above is that decision being
> enforced in five independent places.** Anyone who "fixes" causes 1–5 without addressing
> cause 6 has defeated a control, not completed a deployment.

---

## 6. Rehearsal safety envelope (for whoever re-runs this)

Five independent layers; **zero escapes detected**, proven by positive controls.

1. **Two raising chokepoints** — `subprocess.run` (any `ssh`) and `urllib.request.urlopen`
   both raise `EscapeAttempt`. Covers all 8 cross-box sinks at 2 places. Positive controls
   confirmed both raise; a negative control confirmed non-ssh subprocesses still work.
2. **Injected seams** — stub `client` / `heartbeat` / `validate_fn` record calls, cross nothing.
3. **Unreachable destinations** — `TRAINER_VM_HOST=…invalid`, `TRAINER_EXECUTOR_URL=http://127.0.0.1:1`.
4. **Scratch redirect** — all four `*_DB_PATH` under `/home/ghost/tmp/`, asserted resolved.
5. **B11's `_under_test()` left ARMED** — the harness is named `test_c2_*` so
   `basename(argv[0]).startswith("test_")` holds and the live stores stay refused even if
   layer 4 failed.

🚨 **Sinks that MUST be stubbed (8):** `pre_register` + `emit` (ssh → VM `loop_heartbeat`);
`shadow.route_proposal`, `shadow.grade`, `shadow.surface_promotion_candidate`,
**`shadow.stale_candidates` + `shadow.requeue_stale`** (the SL6 sweep — **the design record
lists 3 ops; there are 5**); `trainer_teach` → **VM ChromaDB** (containment is SQLite-only
and structurally blind to it); `_default_validate_fn` → ssh.

**Acceptance bar, met:** all 5 `data/*.db` byte-identical (`sha256sum` + `cmp`); VM
`loop_heartbeat` total `22` **and targeted `0`**; VM `MAX(level)` `0`.
