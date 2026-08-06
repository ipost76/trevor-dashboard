# C1 — Reset of the Unattributable Pre-Daemon Fold

**PROMPT_ID:** `RM-TRAINER-C1` · **Roadmap:** RM-TRAINER Gap **G3** · **Box:** WSL `ghost@Ghost`
**HEAD at start:** `5f9af1d` · **Date:** 2026-08-06 · **money_path:** no
**Source:** `RECON-TRAINER-003` (A1) findings **F5 / R3** · **Decision D2** (ruled by Ghost) · Depends on **B2 `a898310`**

---

## 0. What was reset and why

One arm in `bandit_posteriors` (`data/trainer.db`) carried a Beta fold that **A1 could not attribute
to any run of the current daemon**. It predates it. Its provenance is one of A1's three permanent
UNKNOWNs.

Because Thompson sampling draws θ~Beta(α,β) per arm, an arm sitting at a posterior mean of `0.6667`
while every other arm sat at the `0.5` prior was **preferentially re-sampled** — it was the single
"best" arm in the pool. The trainer's search was being steered by one data point nobody can trace to
a measurement.

**Ghost's ruling (D2): reset it to Beta(1,1).** A fold nobody can attribute must not steer the
search. This is a **deliberate, backed-up, narrowly-scoped exception to the additive-DB law** — the
only RM-TRAINER prompt permitted to UPDATE existing rows, scoped to exactly one approved row.

## 1. The row

| field | pre-reset | post-reset |
|---|---|---|
| `rowid` | 4 | 4 |
| `arm_hash` | `09cf7f499b972a857bbd1da15a1cd4d6` | unchanged |
| `level_id` | 0 | unchanged |
| `axes_json` | `{"size.risk_fraction":0.126777}` | unchanged |
| `alpha` | **2.0** | **1.0** |
| `beta` | **1.0** | **1.0** |
| `n_obs` | **1** | **0** |
| posterior mean | **0.6667** | 0.5 (the untouched prior) |
| `last_sampled_at` | `2026-08-06T06:01:54Z` | **unchanged — deliberate, see §3** |
| `updated_at` | `2026-08-06T06:01:54Z` | **unchanged — deliberate, see §3** |

The statement, triple-keyed, `changes()` = **1**:

```sql
UPDATE bandit_posteriors SET alpha = 1.0, beta = 1.0, n_obs = 0
WHERE rowid = 4 AND arm_hash = '09cf7f499b972a857bbd1da15a1cd4d6' AND level_id = 0;
```

**Canonical prior values `1.0 / 1.0 / 0` are sourced from code**, not assumed —
`trainer_bandit._seed_arm`'s INSERT literal `(ahash, int(level), axes_json, 1.0, 1.0, 0, utc_now())`.

**Backup (the fold's only surviving provenance besides this record):**
`/home/ghost/backups/trainer_db_pre_C1_20260806T125224Z.db` — a real `sqlite3 .backup`, not a file
copy of a live WAL database; taken **before any write**; `PRAGMA integrity_check` = `ok`; the target
row verified present in it at `alpha=2.0 beta=1.0 n_obs=1`. It is **outside the repo** by design, so
it can never become a stray `.db` or be committed.

## 2. Scope — what was NOT touched

- **The 12-char fixture row** (`rowid=6`, `e1d822a03c16`, `alpha=2.0 beta=1.0 n_obs=1`) stays on
  disk untouched. **B2 `a898310`** already filters malformed-hash rows out of `load_existing_arms`,
  `axis_stats_from_db` and `query_trainer_search._read_arms`, so it is unreachable by the search.
  It is the reason the whole-table `SUM(n_obs)` reads **1**, not 0, after this reset; over the
  in-scope 32-char rows `SUM(n_obs)` is **0**.
- `COUNT(*)` is **28 before and 28 after**. No DELETE, no DROP, no schema change.
- No flag, no service, no restart. `TRAINER_BACKTEST_PROVIDER` remains unset;
  `MEMORY_REASONING_ENABLED` untouched.

## 3. Why `last_sampled_at` and `updated_at` were left alone

Both read `2026-08-06T06:01:54Z` and both were **deliberately preserved**. Two reasons, both measured:

1. **`n_obs=0` with `last_sampled_at` set is the canonical post-selection state, not an
   inconsistency.** `trainer_bandit.run_search_step` stamps `last_sampled_at` on the arm it *chooses*,
   before any reward exists — so a sampled-but-never-folded arm looks exactly like this. All **27**
   32-char rows have `last_sampled_at` set and 26 of them already sat at the prior. After the reset
   row 4 is shape-identical to those 26.

2. **`updated_at` is a load-bearing sort key, not an audit field.** `load_existing_arms` builds the
   exploit pool with `ORDER BY n_obs DESC, updated_at DESC LIMIT ?`. Stamping it "now" would inject
   a false *"the trainer touched this arm at reset time"* and **promote row 4 from exploit-pool
   rank 5 to rank 1** — re-introducing the exact preference D2 exists to remove. Erasing the fold and
   then re-privileging the same row through a different column would be a self-defeating fix. Both
   orderings were measured before ruling.

## 4. 🚨 The honest caveat — uniform in POSTERIOR is not uniform in SELECTION ORDER

**"All arms at the prior" does not mean "all arms equally likely."** Nobody should later read C1 as
having made selection uniform. Two preference sources survive this reset **by design**, were ruled
**report-only** at the gate, and were deliberately **not** fixed here:

- **`trainer_bandit.load_existing_arms`** — `ORDER BY n_obs DESC, updated_at DESC LIMIT 8`. Once
  every `n_obs` is 0 the first key is inert, so the exploit pool is chosen **purely by sample
  recency**. Row 4 sits at rank 5 of that ordering.
- **`trainer_bandit.exploration_bonus`** — the staleness term ranks axes by `last_sampled_at` order
  (`axis_stats_from_db` assigns `last_step` by ascending sample time). With `total_obs = 0` the
  saturation term vanishes for every arm, but the staleness term still differentiates.

Both are intended exploration mechanics, not folds. They are recorded here so the distinction stays
visible.

## 5. Verification

- Zero 32-char rows carry a non-prior posterior; **27 of 27** sit at exactly `alpha=1.0 beta=1.0 n_obs=0`.
- `COUNT(*)` unchanged at 28.
- **The sampler handles an all-prior pool** — the `axis_stats_from_db → propose_depth → propose_arm →
  load_existing_arms → sample_arm` chain was exercised read-only (`mode=ro`) over the post-reset DB:
  `total_obs=0 n_events=27 depth_cap=1 pool_size=16`, **200 Thompson picks with no error**, and every
  posterior reachable through the exploit pool is `(1.0, 1.0, 0)`. The zero-observation guards hold —
  `exploration_bonus` floors with `max(1, total_obs)` / `max(1, n_events)`, `propose_depth(0, …)`
  returns 1, and `_thompson_theta(1.0, 1.0)` is a valid uniform draw.
- **Hub reads** `Settings being tested (27) · 27 not tried yet · all at level 0`, verified from the
  live `query_trainer_search.py` payload (`status=ok`, `arms=27`, `excluded_malformed=1`, tested=0)
  through `trainer-search-section.tsx`'s render logic. ⚠️ The prompt predicted
  *"27 settings · 0 with evidence"* — **that string cannot render**: the suffix is guarded by
  `tested.length > 0`, so at zero it disappears entirely rather than printing a zero.
- **No restart is needed for this to take effect.** `trainer_loop` calls `run_search_step` without a
  connection, so it opens a fresh `get_connection()` per cycle and closes it in `finally`;
  `get_posterior` reads the DB at call time. Nothing caches the posterior in memory.

## 6. The honest reading afterwards

Every arm now sits at the untouched prior, so the trainer's evidence is **zero trials** — which is
the truth. A1 proved the daemon has never completed a scoring cycle: the heartbeat's
`degraded_reason` is `no_simulator`, `TRAINER_BACKTEST_PROVIDER` is unset, `backtest_fn` is None, and
both `trainer_bandit.update_posterior` call sites in `trainer_loop` sit downstream of a
`compass_verdict` that can never be produced. **The trainer observes; it does not learn.**

A corollary worth keeping: with no simulator the daemon is **structurally unable to write
`alpha`/`beta`/`n_obs` at all** — a cycle landing mid-prompt could only stamp timestamps, never
re-create a fold.
