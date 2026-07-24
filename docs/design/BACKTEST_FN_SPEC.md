# `backtest_fn` — Specification (W18)

> **Status: SPEC ONLY. Do NOT build from a wiring roadmap.**
> Authored by **RF2-C2** (2026-07-24), the closing prompt of the RF-2 "Wiring Build" (BLOCK-4).
> The BUILD is out of scope by standing campaign decision **D-5**: it is its own project
> (working name **RF-BACKTEST**). This document is the durable home for the contract so it
> survives to whoever builds it — it is written to be read by someone with **no RF-2 context**.

---

## 0. Why this document exists

The R9 trainer loop (`trainer_loop.py`) has a seam for a cheap, WSL-side **compass pre-score**:
before spending a scarce VM shadow slot on a proposed config arm, run the arm through a local
simulator and let the two-gate "compass" (`compass_metrics.py`) reject obviously-unsurvivable
arms early. That simulator is `backtest_fn`. **Today it is `None`** (`_run_one_iteration`,
`trainer_loop.py:661`), so the pre-score is skipped and the loop relies entirely on the
authoritative VM matched-data verdict. The loop runs correctly without it — this is a
**cheap-pre-ranking optimization, not a correctness dependency.**

Two facts about the contract are **measured, non-obvious, and easy to get wrong**. If they are
lost, a future builder will ship a `backtest_fn` that makes the survival gates silently blind.
Preserving them is the entire reason this spec was written now, before the build exists.

D-5's reasoning, recorded for the next reader:
1. The loop runs without it (the authoritative VM verdict governs; `backtest_fn` only enables
   cheap WSL-side pre-ranking).
2. Building a backtester is not a line item in a wiring roadmap.
3. **We don't yet know what it needs to do** — once the loop runs against real candidates the
   requirements become concrete. Build it against real candidate arms, not against this spec alone.

---

## 1. Signature + contract

```python
backtest_fn(arm: dict, level: int) -> dict
```

- **`arm`** — a proposed config arm: a dict of `{axis_name: value}` over the trainer's
  sampleable config surface (e.g. `{"deployment_ceiling": 0.55, "leverage_cap": 7, ...}`).
- **`level`** — the minted campaign level (int ≥ 1) the arm is being evaluated at.
- **returns** — a dict with the **five keys** in §2. The consumer is
  `compass_metrics.evaluate_compass(bt, level)` (called at `trainer_loop.py:663` when the seam is
  wired). A missing/empty key degrades that key's gate conservatively (see §2), so an incomplete
  return is **fail-safe-toward-REJECT, never fail-open**.

The seam type in code (`trainer_loop.py:634`, and the `run_trainer_loop` parameter at
`trainer_loop.py:797`):

```python
backtest_fn: Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]] = None
```

`None` → the pre-score block is skipped and the trace records
`"skipped (no backtest_fn — VM verdict authoritative)"`.

---

## 2. The five required keys, field by field

Every key name and its consumer was verified firsthand in `compass_metrics.py` (constants
`_K_*` at `:377-380`; consumers cited below).

| Key | Type | Consumed by | Gate / role | Threshold |
|---|---|---|---|---|
| `equity_curve` | `Sequence[number]` | `_assess_dd(candidate["equity_curve"])` → `survival_gates`, `compass_metrics.py:421` | **Gate (a): survival WALL — fractional max-drawdown** (the slow bleed) | reject if `dd > SEED_DD_CEILING = 0.35` |
| `net_pnl_series` | `Sequence[number]` | `cvar_95(candidate["net_pnl_series"])` → `survival_gates`, `compass_metrics.py:422` | **Gate (b): survival WALL — worst-5% tail mean (CVaR-95)** (the one-day wick) | reject if `cvar < SEED_CVAR_FLOOR = -0.15` |
| `daily_returns` | `Sequence[number]` | `sortino(candidate["daily_returns"])`, `compass_metrics.py:538` | **Consistency** component of the blend score (only survivors are scored) | consistency can never be outranked by magnitude (`w_consistency ≥ w_magnitude`) |
| `trades` | `list[dict]` | `per_eff_bet_net(candidate["trades"])`, `compass_metrics.py:539` | **Magnitude** component of the blend score | must clear the **8.098 bps round-trip cost bar** |
| `deployment_ceiling` | `float` | `trainer_capital.propose_deployment_ceiling`, reads `candidate["deployment_ceiling"]` at `trainer_capital.py:109` | **W1 only** — the proposed capital-deployment posture for the ceiling path | domain `(0.0, 1.0]`; null default `DEPLOYMENT_CEILING_NULL = 0.45` |

**Gate ordering (from `survival_gates`):** the survival WALL (gates a + b) short-circuits FIRST;
only survivors are scored on consistency + magnitude. So `equity_curve` and `net_pnl_series` are
the load-bearing fields — they decide whether the arm survives at all.

**Fail-safe on absent/degenerate input (verified, `compass_metrics.py:206-215`):** `_assess_dd`
returns `None` (→ gate (a) REJECT) when `equity_curve` is missing / empty / `None` / has fewer
than `_DD_MIN_N = 2` valid points / has no positive peak. A dd of `0.0` on a *valid* curve that
genuinely never declined still PASSES — "no drawdown" is distinct from "no data". `cvar_95`
likewise returns `None` (→ gate (b) REJECT) on an unusable tail. **An incomplete `backtest_fn`
return therefore rejects the arm — it never lets an unassessable arm through.**

---

## 3. 🚨 R-3's unit contract — BOTH halves (measured, load-bearing)

These two facts do not fall out of the type signature. Both are units/semantics traps that a
plausible implementation gets wrong, and both make the survival gates **silently blind** when
wrong. This is the highest-value content in this document.

### 3a. `net_pnl_series` is FRACTIONAL, not dollar

The floor is `SEED_CVAR_FLOOR = -0.15` — a **fraction** (−15% of the deployed basis), scale-
invariant, **not a dollar amount** (verified `compass_metrics.py:372`). `cvar_95(net_pnl_series)`
computes the mean of the worst-5% tail of the series entries and compares it to −0.15.

- If a builder populates `net_pnl_series` with **dollar** P&L per period instead of fractional
  returns, the CVaR is computed in the wrong scale. At a small account the dollar tail values are
  tiny in magnitude (e.g. `−$2.40`), so `mean(worst 5%) = −2.40` is compared to `−0.15` and — being
  more negative — would REJECT everything; but as the tail dollars shrink toward the floor's
  numeric value, **a genuinely-dangerous config silently flips from CVaR REJECT to PASS.** That
  crossover is **reachable at the ~$82 account scale** — i.e. it is not a theoretical edge, it is
  in the live operating range. A dollar series silently converts a CVaR REJECT into a PASS.
- **Contract:** `net_pnl_series[i]` = the per-period **fractional** net-of-cost return
  (period P&L ÷ deployed basis), so the CVaR is comparable to the −0.15 fractional floor.

### 3b. It MUST carry intraday-worst P&L, NOT close-only

The floor `−0.15` is **calibrated so the 2025-10-10 cascade FAILS it** (module docstring,
`compass_metrics.py:369`; the calibration test is `test_cascade_calibration`, recorded in the
RF3T1-B3 changelog). The cascade's **intraday-worst** CVaR-95 is **−32.70%** (`−0.327`) — well
below the −0.15 floor → gate (b) correctly **REJECTS** the cascade shape. (Its close-only
drawdown-average is only 13.68% → `0.1368 ≤ 0.35` → gate (a) PASSES; gate (b) is the one that
catches it.)

- A `net_pnl_series` built from **close-to-close** (daily-close) P&L understates the intraday
  wick. For the same 2025-10-10 shape, a close-only tail reads **≈ −0.026**, which is **> −0.15**
  → gate (b) **PASSES** the cascade. **Close-only data makes the cascade gate blind** to exactly
  the one-day-wick event it exists to catch.
- **Contract:** `net_pnl_series` (and, by extension, the tail that feeds CVaR) must reflect the
  **intraday worst-case** P&L within each period, not the close-only marks. The whole point of
  gate (b) is the intraday wick; feed it close-only data and it stops working.

> **Provenance note on the exact figures.** The `−0.026` (close-only PASS) / `−0.327` (intraday-
> worst REJECT) framing and the `$82` CVaR-flip scale are stated in the RF2-C2 prompt (which
> carries R-3's measured contract) and are consistent with the firsthand `compass_metrics.py`
> constants (`SEED_CVAR_FLOOR = -0.15`) and the RF3T1-B3 record (2025-10-10 cascade CVaR-95
> = −32.70%). The originating recon, **`RECON-SIM-001`**, is flagged as **NOT FOUND on disk** —
> see §7. A builder should re-derive these numbers from a real 2025-10-10 candle window rather
> than trust them, and record the derivation next to this spec.

---

## 4. 🚨 The candidate is COUNTERFACTUAL — this is why it needs simulation

`backtest_fn` cannot be a query over historical trades. The trainer proposes a config arm — e.g.
`deployment_ceiling = 0.55` — and asks "how would the book have performed **under this config**?"
But the real closed trades in `trevor.db` ran under the **live** config, whose deployment ceiling
default is **`DEPLOYMENT_CEILING_NULL = 0.45`** (`trainer_capital.py:15`). **You cannot derive the
equity curve at ceiling = 0.55 from trades that were actually sized at 0.45.** The sizing, and
therefore the P&L, the drawdown, and the tail, are all different under the counterfactual config.

This is why the five keys must come from a **simulator** that re-runs the strategy under the
proposed arm — not from an aggregation of `auto_trades`. It is also why **W1 (capital) and W2
(hypotheses) are blocked** on this build (§6): they need the counterfactual equity/tail that only
simulation can produce.

---

## 5. What consumes it, end to end

When `backtest_fn` is wired (non-`None`), one loop iteration does:

```
arm sampled (trainer_bandit)
  → bt = backtest_fn(arm, level)                       # THIS spec
  → evaluate_compass(bt, level)                        # compass_metrics.py:663
        → survival_gates: gate (a) _assess_dd(bt["equity_curve"]) ≤ 0.35
                          gate (b) cvar_95(bt["net_pnl_series"]) ≥ -0.15
        → if survived: blend_score from sortino(bt["daily_returns"]) + per_eff_bet_net(bt["trades"])
  → survived == False → log the dead-end, fold reward, DO NOT submit to the VM shadow loop
  → survived == True  → proceed to submit / verdict / validate (the authoritative VM path)
```

The ceiling path additionally reads `bt`'s `deployment_ceiling` via
`trainer_capital.propose_deployment_ceiling` (W1).

---

## 6. Reusable VM infrastructure — and its contract MISMATCH

There is **real, reusable** simulation infrastructure on the VM at
`/home/trevor/trevor/backtest.py`. **Reuse its candle-fetch and single-trade simulation; do NOT
reuse its top-level contracts — they are different and emit the wrong shape.**

**Reusable building blocks (verified firsthand, read-only):**
- `fetch_candles_window(coin, interval, start_ms, end_ms, max_per_call=5000)` (`backtest.py:265`)
  — pulls **real Hyperliquid OHLCV candles** for a window. This is the real market-data source a
  `backtest_fn` simulator needs.
- `_simulate_one_trade(sig, coin, bars, entry_idx, flags, default_leverage, ...)`
  (`backtest.py:388`) — simulates a single trade through the **real `exit_helpers`** (the actual
  exit engine), so entry/exit behavior matches production.

**Contract mismatch — the two existing modes emit run SUMMARIES, not equity curves:**
- `gate_replay(candidate_fn, ...)` (`backtest.py:198`) — `candidate_fn(trade_row: dict) -> dict`
  (`backtest.py:38`). Replays a per-trade decision function over historical trade rows.
- `strat_sim(strat_fn, ...)` (`backtest.py:520`) — `strat_fn(bars: pandas.DataFrame, coin: str)
  -> None | dict` (`backtest.py:48`). Simulates a strategy over OHLCV bars.

Neither takes an `(arm, level)` config arm, and **neither emits `equity_curve` / `net_pnl_series`
/ `daily_returns` / `trades` / `deployment_ceiling`** — they return aggregate run summaries
(grep of `backtest.py` finds no `equity_curve`/`net_pnl_series`). So **RF-BACKTEST is a new
module** that:
1. Takes `(arm: dict, level: int)`.
2. Uses `fetch_candles_window` for real candles and `_simulate_one_trade` (driving the real
   `exit_helpers`) for per-trade outcomes, **under the proposed arm's config** (the counterfactual).
3. Assembles the **five keys** in the units §2/§3 require (fractional, intraday-worst
   `net_pnl_series`).

---

## 7. 🚨 Finding — `RECON-SIM-001` is registered but the report file is ABSENT

`recon_archive` (VM `trevor.db`) carries a row **`RECON-SIM-001`** → file_path
`docs/reports/recon/2026-07-23_RM-SIMHUNT/A3_counterfactual_space.md` ("the counterfactual space,
book-level"), the recon behind this spec's counterfactual + simulator reasoning. **That `.md`
file was NOT found on disk** (searched WSL `/home/ghost/docs`, the repo `downloads/`, and the VM;
the `2026-07-23_RM-SIMHUNT` directory does not exist on either box).

An archive row pointing at an absent report is the same class of defect as a wire pointing at
nothing — recorded here as a finding, not glossed. Consequence for the builder: the primary-source
recon for the R-3 numbers in §3 is unavailable, so those figures are sourced here from the RF2-C2
prompt + firsthand `compass_metrics.py` + the RF3T1-B3 record instead. **Re-derive them from a
real candle window and record the derivation** rather than trusting this document.

---

## 8. What unblocks when this lands

Both, together (A3 / RECON-WIRING-003, §9 roadmap impact):
- **W1 — capital (`trainer_capital.propose_deployment_ceiling`)** — needs the counterfactual
  equity/tail at the proposed ceiling; blocked until a simulator can produce it.
- **W2 — hypotheses (compass blend-delta over two `evaluate_compass` verdicts)** — needs two
  simulated verdict dicts to compute the blend delta; blocked on the same simulator.

Until then, W1/W2 stay **BLOCKED (out-of-scope, D-5)** and the loop runs on the authoritative VM
verdict alone, which is correct.

---

## 9. Provenance — so the next reader can verify, not trust

| Fact | Source (verify here) |
|---|---|
| Signature + `None`-default + skip behavior | `trainer_loop.py:634, 661, 679, 797` (firsthand) |
| Five keys + consumers + gate roles | `compass_metrics.py:377-380` (keys), `:421-422` (gates a/b), `:538-539` (consistency/magnitude); RECON-WIRING-003 §4a |
| `SEED_DD_CEILING=0.35`, `SEED_CVAR_FLOOR=-0.15`, `_DD_MIN_N=2` | `compass_metrics.py:371-372, 203` (firsthand) |
| `_assess_dd` None→REJECT (unassessable curve) | `compass_metrics.py:206-215`; RF3T1-B3 changelog (CLAUDE.md) |
| `net_pnl_series` FRACTIONAL; $82 CVaR flip | RF2-C2 prompt (R-3 contract) + `SEED_CVAR_FLOOR=-0.15` |
| Intraday-worst vs close-only; −0.026 PASS / −0.327 REJECT; 2025-10-10 | RF2-C2 prompt + `test_cascade_calibration` / RF3T1-B3 (CVaR-95 −32.70%) |
| Counterfactual (0.55 not derivable from 0.45) | `trainer_capital.py:15` (`DEPLOYMENT_CEILING_NULL=0.45`); RECON-SIM-001 (absent, §7) |
| VM `backtest.py` reusable infra + contract mismatch | VM `backtest.py:38, 48, 198, 265, 388, 520` (firsthand, read-only); RECON-WIRING-003 §4b |
| W1/W2 blocked on D-5 / RF-BACKTEST | RECON-WIRING-003 §9 |
| 8.098 bps round-trip cost bar | campaign standing data-law (RM-R1 / RM-REBUILD) |

---

*End of spec. Build RF-BACKTEST as its own project (D-5). Do not build it from a wiring prompt.*
