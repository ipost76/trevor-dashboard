#!/usr/bin/env python3
"""Tests for the R9-B3 validation integration (trainer_validation.py).

Proves the per-candidate sequence + its load-bearing invariants:
  * VERDICT-ONLY law: the module has ZERO code reference to the read-only replica,
    to ``alpha_budget`` directly, or to ``reset`` — a tokenizer scan (strings +
    comments stripped, so the docstring that legitimately says those WORDS does
    not false-flag). The FDR gate is reached ONLY via B2's ``throttle_test``.
  * Flag-OFF inertness: validate_candidate is a no-op returning {"enabled": False}
    and opens no pipe.
  * family_k reads the bandit_posteriors count (the n_trials bar-rises lever).
  * LIVE (VM-gated, skipped if the pipe is down): both leakage layers reject
    (Layer 1 banned column, Layer 2 derived look-ahead — passing Layer 1 alone is
    insufficient); promotion_verdict returns a verdict; the DSR bar rises with K.

Dependency-free: ``python3 tests/test_trainer_validation.py``. pytest-compatible.
The live VM tests SKIP (never fail) when TRAINER_VM is unreachable.
"""
import atexit
import io
import os
import shutil
import subprocess
import sys
import tempfile
import tokenize

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── MODULE-LEVEL store protection (B11) ───────────────────────────────────────
# 🚨 THIS FILE REACHED THE LIVE data/trainer.db AND NOBODY KNEW — found by the B11
# guard, and NOT named in A1's escape census. It is the SAME INDIRECT SHAPE as the
# compass_metrics escape: `test_live_validation_sequence` calls `validate_candidate`
# without `n_trials`, which internally calls `family_k(level_id)` with `db_path=None`,
# which does a FUNCTION-LOCAL `from lib.trainer_db import get_connection` and opens the
# live store — running `PRAGMA journal_mode=WAL` and `init_schema()`'s 7 DDL statements
# inside a real COMMIT. Nothing on the test side named a database.
#
# It hid for two extra reasons worth recording: the call is behind a `_vm_up()` gate, so
# it only fired when the VM pipe was up; and `family_k` floors at 1, so with live
# `bandit_posteriors` empty (measured 0 rows at B11) it returned the same 1 a scratch
# store returns — correct by coincidence. Redirecting to scratch is therefore
# semantics-preserving, not a behaviour change.
_B11_SCRATCH = tempfile.mkdtemp(
    prefix="tvalid_module_", dir="/home/ghost/tmp" if os.path.isdir("/home/ghost/tmp") else None
)
os.environ["TRAINER_DB_PATH"] = os.path.join(_B11_SCRATCH, "trainer.db")
atexit.register(shutil.rmtree, _B11_SCRATCH, True)

import trainer_validation as tv  # noqa: E402

_MODULE = os.path.join(_REPO, "trainer_validation.py")

# A realistic net-of-cost divergent-cohort edge_series (positive-mean, >=8 for CSCV).
_EDGE = [0.42, -0.11, 0.63, 0.31, -0.05, 0.55, 0.22, 0.37, 0.48, -0.08, 0.51, 0.29,
         0.44, -0.02, 0.58, 0.33, 0.19, 0.41, -0.06, 0.47, 0.52, 0.24, 0.39, -0.09,
         0.56, 0.28, 0.43, 0.17, 0.49, -0.04, 0.61, 0.35, 0.21, 0.45, 0.53, 0.27,
         0.38, -0.07, 0.50, 0.30]
_STATS = {"edge_series": _EDGE, "n_div": 40, "dead_div": 8, "n_comp": 40, "dead_comp": 20}


def _code_tokens(path):
    """Return code token strings only (STRING/COMMENT/FSTRING_MIDDLE stripped)."""
    src = open(path).read()
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type in (tokenize.STRING, tokenize.COMMENT,
                        getattr(tokenize, "FSTRING_MIDDLE", -1)):
            continue
        if tok.string.strip():
            out.append(tok.string)
    return out


def _vm_up():
    """Cheap reachability probe for the VM pipe (skip live tests if down)."""
    host = os.environ.get("TRAINER_VM_HOST", "vm")
    try:
        p = subprocess.run(["ssh", "-o", "ConnectTimeout=6", "-o", "BatchMode=yes",
                            host, "true"], capture_output=True, timeout=12)
        return p.returncode == 0
    except Exception:
        return False


# ── 1. VERDICT-ONLY / no-direct-alpha_budget / no-reset (code tokens only) ──
def test_no_replica_no_alpha_budget_no_reset_in_code():
    toks = " ".join(_code_tokens(_MODULE))
    for needle in ("trevor-replica", "trevor_replica", "alpha_budget", "reset"):
        assert needle not in toks, f"code token '{needle}' present in trainer_validation.py"
    # The VM-side program must not touch alpha_budget/reset/replica either (hop 1
    # is leakage+verdict only; the FDR gate is strictly hop 2 via B2's adapter).
    prog = tv._VM_PROGRAM
    for needle in ("alpha_budget", "reset", "trevor-replica"):
        assert needle not in prog, f"_VM_PROGRAM references '{needle}'"
    # Positive: the ONLY FDR path is B2's throttle_test.
    assert "throttle_test" in toks
    print("  verdict-only / no-alpha_budget / no-reset / no-replica in code: PASS")


# ── 2. flag-OFF inertness (no pipe opened) ──
def test_flag_off_is_inert():
    old = os.environ.pop(tv.TRAINER_VALIDATION_ENABLED_ENV, None)
    # Guard: if validate_candidate tried to open the pipe it would call subprocess;
    # poison it so any pipe attempt raises loudly instead of silently passing.
    orig_run = subprocess.run

    def _poison(*_a, **_k):
        raise AssertionError("flag OFF must not open the ssh pipe")
    subprocess.run = _poison
    try:
        r = tv.validate_candidate(["confidence"], shadow_stats=_STATS, level_id=0)
        assert r == {"enabled": False, "ok": False,
                     "reason": f"{tv.TRAINER_VALIDATION_ENABLED_ENV} off"}, r
        assert tv.enabled() is False
    finally:
        subprocess.run = orig_run
        if old is not None:
            os.environ[tv.TRAINER_VALIDATION_ENABLED_ENV] = old
    print("  flag-OFF inert (no pipe, {enabled: False}): PASS")


# ── 3. family_k reads bandit_posteriors (the n_trials bar-rises lever) ──
def test_family_k_reads_bandit_posteriors():
    with tempfile.TemporaryDirectory() as d:
        db = os.path.join(d, "trainer.db")
        from lib.trainer_db import get_connection, utc_now
        conn = get_connection(db)
        # empty -> floored at 1
        assert tv.family_k(0, db_path=db) == 1
        for i in range(3):
            conn.execute(
                "INSERT INTO bandit_posteriors (arm_hash, level_id, axes_json, "
                "alpha, beta, n_obs, updated_at) VALUES (?,?,?,?,?,?,?)",
                (f"arm{i}", 0, "{}", 1.0, 1.0, 0, utc_now()))
        conn.execute(
            "INSERT INTO bandit_posteriors (arm_hash, level_id, axes_json, alpha, "
            "beta, n_obs, updated_at) VALUES (?,?,?,?,?,?,?)",
            ("armL1", 1, "{}", 1.0, 1.0, 0, utc_now()))
        conn.commit()
        conn.close()
        assert tv.family_k(0, db_path=db) == 3   # 3 arms at level 0
        assert tv.family_k(1, db_path=db) == 1   # 1 arm at level 1
    print("  family_k = COUNT(bandit_posteriors WHERE level_id): PASS")


# ── 4. LIVE (VM-gated): both leakage layers reject, verdict, bar-rise ──
def test_live_validation_sequence():
    if not _vm_up():
        print("  live VM sequence: SKIP (TRAINER_VM pipe unreachable)")
        return
    os.environ[tv.TRAINER_VALIDATION_ENABLED_ENV] = "true"
    try:
        # A) Layer 1 — a BANNED ledger column rejects.
        a = tv.validate_candidate(["adjusted_confidence"], shadow_stats=_STATS, level_id=0,
                                  min_n=38, run_throttle=False)
        assert a.get("leakage_reject") is True and a.get("reject_layer") == 1, a

        # B) Layer 2 — LEGAL features clear Layer 1, but a full-sample-percentile
        #    derived mask rejects (proves BOTH layers run — G5 closed).
        stat = [float(i) for i in range(1, 21)]
        thr = sorted(stat)[int(0.75 * (len(stat) - 1))]
        leaky = [1 if s > thr else 0 for s in stat]
        b = tv.validate_candidate(["confidence"], masks=[{
            "name": "fullsample_pctile", "stat_series": stat, "mask": leaky,
            "quantile": 0.75, "comparison": ">"}], shadow_stats=_STATS, level_id=0,
            min_n=38, run_throttle=False)
        assert b.get("leakage_reject") is True and b.get("reject_layer") == 2, b

        # C) both layers pass -> a verdict.
        c = tv.validate_candidate(["confidence", "atr_at_entry"], shadow_stats=_STATS, level_id=0,
                                  min_n=38, run_throttle=False)
        assert c.get("ok") and c.get("leakage_reject") is False, c
        assert c["verdict"]["verdict"] in ("READY", "PROMISING", "NOT_READY"), c
        assert "deflated_sharpe" in c["verdict"]["metrics"], c

        # D) bar rises with trials: K=1 DSR > K=5000 DSR.
        d1 = tv.validate_candidate(["confidence"], shadow_stats=_STATS, level_id=0, n_trials=1,
                                   min_n=38, run_throttle=False)
        d2 = tv.validate_candidate(["confidence"], shadow_stats=_STATS, level_id=0, n_trials=5000,
                                   min_n=38, run_throttle=False)
        dsr1 = d1["verdict"]["metrics"]["deflated_sharpe"]
        dsr2 = d2["verdict"]["metrics"]["deflated_sharpe"]
        assert dsr2 < dsr1, f"DSR bar must rise with K: {dsr1} -> {dsr2}"
        assert d1["n_trials"] == 1 and d2["n_trials"] == 5000
        print(f"  live: L1 reject, L2 reject (both layers), verdict={c['verdict']['verdict']}, "
              f"bar-rise DSR {dsr1}->{dsr2}: PASS")
    finally:
        os.environ.pop(tv.TRAINER_VALIDATION_ENABLED_ENV, None)


if __name__ == "__main__":
    fails = 0
    for name in sorted(n for n in dir() if n.startswith("test_")):
        try:
            globals()[name]()
        except AssertionError as e:
            fails += 1
            print(f"  {name}: FAIL — {e}")
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"  {name}: ERROR — {type(e).__name__}: {e}")
    print(f"\n{'ALL PASS' if not fails else f'{fails} FAILED'}")
    sys.exit(1 if fails else 0)
