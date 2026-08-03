# B6 — Hub Control Surface: all 4 gateway ops driven

**PROMPT_ID:** `B6-HUB-CONTROL-SURFACE` · **Roadmap:** RM-VERIFY v3 Wave B · **Gap:** D-W-05 (Rule 32)
**Box:** WSL `ghost@Ghost`, repo `/home/ghost/projects/trevor-dashboard`, branch `master`, HEAD `6641bec` (Law 0)
**Date:** 2026-08-03 · **money_path:** no

---

## Verdict

Rule 32 ("every control surface lives in the Hub") **does not hold, and the reason is not the flags.**
The Hub's live write surface is **3 controls** (killswitch, trainer pause/resume, promotion approve).
The 5 flag-disabled controls are dead at **three independent layers at once**, and no UI renders them.

## The real op set — 4, not 1

`gateway/ops.js` (WSL) and `vm_gateway.js` REGISTRY (VM) agree exactly:

| Op | Flag consulted | Live flag value | Audit class |
|---|---|---|---|
| `killswitch.set` | `null` (ungated by design) | — | `helper` (self-audits) |
| `promotion.approve` | `HUB_PROMOTION_WRITE_ENABLED` | **`true`** | `closed` |
| `trainer.pause` | `HUB_PAUSE_CONTROL_ENABLED` | **`true`** | `closed` |
| `trainer.resume` | `HUB_PAUSE_CONTROL_ENABLED` | **`true`** | `closed` |

⚠️ **`CLAUDE.md`'s "the ONE survivor is `killswitch.set`" is STALE** — R12-B1/B3 added three ops on
2026-07-22. Anyone reasoning from that line understates the live write surface by 3 ops.

## 🚨 The prompt's "write-free positive control" was not write-free

`gw_exec.process()` order is **1 idempotency → 2 flag gate (423) → 3 `audit_log()` → 4 dispatch**.
All three non-killswitch ops are `audit: 'closed'`, so **step 3 writes `change_log` BEFORE the helper runs.**

Worse, `set_promotion_approval.py` performs **no existence check** on `candidate_id`. Driving
`promotion.approve` with a bogus id live would have:

1. written a `change_log` audit row, then
2. **`CREATE TABLE promotion_approvals`** (the table is ABSENT on live), then
3. **`INSERT` a real approval record** (`applied=0`) and returned **HTTP 200 `recorded:true`**.

**It was not driven live.** A recorded approval for a nonexistent candidate, sitting at `applied=0`
awaiting a CC apply-prompt, is a persistent governance artifact — well beyond "one audit row".

## 🚨 Two live defects found

### 1. A client-supplied idempotency key MASKS the 423 lock (false success)

`gateway/server.js:263` passes a **client-supplied** `idempotency_key` straight through.
`gw_exec` step 1 looks it up **`WHERE key=?` — with no `op` match** — and returns the stored result
*before* the flag gate. Consequences, both **observed live**:

- A **flag-locked** op returns **HTTP 200 `ok:true`** instead of 423.
- The body is **another op's stored result**. Driven live: `op=promotion.approve` with a
  `reminders.set` key returned `{"ok":true,"op":"promotion.approve","idempotent_replay":true,"result":{"ok":true,"id":6}}`.

It cannot cause a write (it returns before dispatch), so this is a **false-success / lock-masking**
defect, not a write bypass. But a control surface that answers "200 OK" to a locked operation is
exactly the class this campaign exists to close. **Fix belongs VM-side** (`WHERE key=? AND op=?`)
and/or Hub-side (stop honouring a client-supplied key) — neither touched here, both out of scope.

### 2. `TREVOR_DB_PATH` does not fully isolate `gw_exec`

`audit_logger.DB_PATH` is a **hardcoded** `/home/trevor/trevor/trevor.db` and ignores
`$TREVOR_DB_PATH`; `gw_exec` calls `audit_log()` without passing `db_path`. So a clone run with
`TREVOR_DB_PATH` redirected **still writes the live `change_log`** the moment it reaches step 3.
Any future clone testing must stay on paths that return before step 3. (The module's own docstring
flags this hazard at `audit_logger.py:89-95`.)

## Ops driven — 3 of 4

`killswitch.set` **NOT driven** (safety envelope). Every failure NAMES a failure; none reads as success.

| # | Drive | Observed | Write-free proof |
|---|---|---|---|
| 1 | unauth POST `:3939` | `401 {"error":"unauthorized"}` | rejected at hop 1 |
| 2 | authed unknown op | `400 unknown_op` | rejected at hop 1 |
| 3 | `promotion.approve` bad `decision` | `400 validation` + detail | Hub-side `ops.js` validate |
| 4 | `promotion.approve` extra key | `400 validation: unexpected key(s): evil_key` | enumerated denial #1 |
| 5 | malformed JSON | `400 invalid_json` | rejected at hop 1 |
| 6 | authed unknown path | `404 not_found` | rejected at hop 1 |
| 7 | `trainer.pause` extra key | `400 validation: unexpected key(s): evil` | enumerated denial |
| 8 | **`promotion.approve` + existing idem key** | **`200 idempotent_replay`** | **returns at step 1**; `change_log` 21905/21916 → **21905/21916 identical** |
| 9 | `POST /api/watchlist` (op stripped) | `400` + B12 gloss, `error_code:unknown_op` | `unknown_op` at hop 1 |

**Probe 8 is the two-hop proof**: only `gw_exec` mints `idempotent_replay`, so the
`:3939 → :3940 → gw_exec` chain is confirmed live — and it wrote nothing.

## Both 423 paths observed AT `gw_exec` (clone, `TREVOR_DB_PATH` → scratch)

No live flag was flipped; the clone carried the OFF values.

| Path | Mechanism | Observed |
|---|---|---|
| **A** pre-dispatch flag gate | `process()` step 2, `_flag_on` false | `(423, {ok:False, op:'promotion.approve', gate:'HUB_PROMOTION_WRITE_ENABLED'})`; same for `trainer.pause`/`trainer.resume` → `gate:'HUB_PAUSE_CONTROL_ENABLED'` |
| **B** helper-internal gate | `_map_helper_result` `rc==3` | `(423, {ok:False, gate:'HUB_PAUSE_CONTROL_ENABLED'})` |
| **B′** helper `gate_locked` | `rc==0` + `gate_locked` in stdout | `(423, {ok:False, gate:'HUB_X_ENABLED is false'})` |
| pos. control | idem replay, flag still OFF | `(200, idempotent_replay)` — 423 is not a blanket response |
| neg. control | `rc=0 {ok:true}` / `rc=1` | `(200, ok:True)` / `(400, 'bad input')` |

`_flag_on` fails closed: row absent **or** `NULL` **or** value not in `_TRUE` ⇒ locked.

## The 5 dead controls — no UI renders them at all

Live VM `auto_config` (not the replica):

| Flag | Value | UI component | Verdict |
|---|---|---|---|
| `HUB_AGGRESSIVE_TOGGLE_ENABLED` | `false` | **none** (tombstoned) | deliberate hold |
| `HUB_BRAIN_EDIT_ENABLED` | `false` | **none** (route is GET-only, PUT deleted → 405) | deliberate hold |
| `HUB_CAPITAL_WRITE_ENABLED` | `0` | **none** | deliberate hold |
| `HUB_LIST_WRITE_ENABLED` | `0` | **none** | deliberate hold |
| `HUB_TRADE_EDIT_ENABLED` | `0` | **none** | deliberate hold |

**Does any dead control render ENABLED and silently no-op? NO — none renders at all.**
Writer-side sweep of every mutating client `fetch` returns exactly six endpoints: `auth` ×4,
`trainer/promotion-approve`, `trainer/pause`, `intel/downloads/delete`, `docs/categories{,/reorder}`.
All 8 dead-control routes have **0 fetchers**. The 2026-06-28 lockdown deleted the **components**,
not just the flags. The false-success class is absent on this surface; it sits one layer down at the
config surface, as `[A′3]` found.

## 🚨 Causes found: 3 — layered, all true at once

1. **Op unregistered** — stripped from `ops.js` AND `vm_gateway.js` ⇒ `unknown_op` 400 at hop 1.
2. **UI deleted** — 0 fetchers; components removed in B1/B2.
3. **Flag off** — true for all 5, but **inoperative**: nothing consults 3 of the 5.

Ruled out by driving: route missing (routes exist) · gateway hop dropping (never reaches hop 2) ·
`gw_exec` rejecting (never reached) · permission layer (auth works).

> **Practical consequence: "flip the flag to restore it" is FALSE.** Cause 3 alone changes nothing —
> the op is gone from both registries and the UI is gone. Re-enabling any of the 5 is a
> multi-layer restoration (route + both registries + component), not a config edit. That is
> Ghost's decision (§5), and it is a bigger decision than the flag makes it look.

## Per-flag verdict — deliberate hold, all 5

`[A′3]` established a rationale exists for all five (4 = the deliberate 2026-06-28 read-only
lockdown, 1 = the `change_log` id 13745 tombstone). This prompt proves the **mechanism** matches
that rationale: the lockdown was executed in depth (registry + route + component), not merely
declared. **Deliberate safety hold, not defect, and not an undeclared decision.**

## Observation, not fixed (deliberately)

`trainer-pause-control.tsx:171` returns `null` when the flag reads off **or when the fetch fails** —
the control vanishes rather than saying why. The author documented this as intentional fail-soft
(`:93-95`, "the fallback state is UNKNOWN — a failed read is not a reading of 'not paused'"). It
never renders enabled, so it is not the false-success class. **Left untouched** — fixing it is
scope creep. Recorded so the next reader does not re-find it.

## State at close

- **`auto_config` UNCHANGED** — 477 rows + all 7 governance flag `(key, value, updated_at)` tuples
  byte-identical before and after. 🚨 `MAX(updated_at)` is **not** a valid invariant here: the live
  bot rewrites `LIVE_ACCOUNT_VALUE_USD` every ~5 min (measured `12:02:58` → `12:07:58`).
- `change_log` 21905 / max id 21916 — **identical** before and after. Zero new `gw:` audit rows.
- `promotion_approvals`, `trainer_pause_state`, `promotion_candidates` — **still ABSENT**.
- `gateway_idempotency` — 17 rows, unchanged.
- No flag flipped · no `auto_config` write · no VM code edited · `killswitch.set` never posted.
- `tsc --noEmit` exit 0 · Hub `/login` 200 · all 3 `.next` manifests present and non-empty.
- VM scratch clone removed.
