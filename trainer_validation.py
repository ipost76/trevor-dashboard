#!/usr/bin/env python3
"""trainer_validation.py — the R9 trainer's per-candidate VALIDATION integration [R9-B3].

The single WSL-side surface through which the R9 trainer runs a candidate arm
through R3's validation engine and gets back a promote/reject verdict. It CALLS
R3's math — it never reimplements it (A1: "R9 CALLS R3's engine, doesn't reimplement").

═══════════════════════════════════════════════════════════════════════════════
 THE SEQUENCE (per candidate arm)
═══════════════════════════════════════════════════════════════════════════════
  1. rulers.assert_features_legal(feature_names)      — Layer 1 leakage gate
     (rulers.py:184, raises LeakageError → reject). Bans post-entry LEDGER columns.
  2. causal.assert_mask_causal(...) for each derived  — Layer 2 leakage gate
     label/mask (causal.py:157, raises LookaheadError → reject). Catches the
     DERIVED-feature full-sample-percentile look-ahead the column checker CANNOT
     see. 🚨 BOTH LAYERS RUN PER CANDIDATE — passing only Layer 1 is insufficient
     (the documented G5 blind spot; rulers' own docstring says so).
  3. Build shadow_stats with a NET-OF-COST edge_series (shadow_feeder, skip the
     un-nettable, count n_skipped, NEVER coerce to $0) + n_trials (family K).
  4. servant_gate.promotion_verdict(shadow_stats)     — THE chokepoint verdict
     (servant_gate.py:468) → {verdict READY/PROMISING/NOT_READY, failing,
     confidence, components, metrics}.
  5. alpha_budget.test(dsr=metrics['deflated_sharpe']) VIA B2's throttle adapter
     (trainer_budget_adapter.throttle_test) — the Layer-2 FDR discovery gate that
     spends/replenishes the alpha-budget wealth. NEVER called directly, NEVER with
     a reset path (A1 rec #2 — the anti-farming deny is B2's; B3 respects it).

═══════════════════════════════════════════════════════════════════════════════
 THE CALL PATH (A1 §5.6 — validated-verdict math runs VM-SIDE, verdict-only to WSL)
═══════════════════════════════════════════════════════════════════════════════
The pure R3 modules (rulers/causal/servant_gate/shadow_feeder/alpha_budget) can't
import on WSL (the auto_trader/__init__ barrier + no numpy). So steps 1-4 run on the
VM, where R3 imports cleanly AND champion+challenger sit in ONE un-lagged trevor.db.
The transport is the SAME thin ssh pipe B2 established: the VM-side program is a DATA
STRING carried in THIS module and run as trevor via
``ssh vm 'cd <bot> && sudo -u trevor venv/bin/python3 -c <loader> <b64_program> <b64_payload>'``
(base64 so the large program + arbitrary feature/mask payload never touch the remote
shell). It authors NO committed VM file — R9 stays clean-separate from R8's :3941
executor (which is R8-scoped dumb-hands and makes ZERO gate decisions; adding a
`validate` op there would break its test contract). Two thin round-trips per candidate:
  HOP 1  the VM program → the VERDICT dict (incl. metrics.deflated_sharpe).
  HOP 2  WSL → B2's throttle_test(dsr=...) → the FDR discovery decision.
Only the verdict dict crosses to WSL — the matched cohort data NEVER does, and the
0444 read-only replica is NEVER opened for a verdict (grep-clean: no "trevor-replica"
string in this module).

PBO NOTE (A1 rec #7 — kept + labeled): promotion_verdict's "pbo" is
``pbo_within_series`` (WITHIN-SERIES CSCV consistency), NOT canonical selection-
overfit PBO. Family multiplicity rides on DSR n_trials + BH-FDR. Downstream must
NOT read "pbo" as selection-overfit PBO.

FLAG: ``TRAINER_VALIDATION_ENABLED`` (default OFF). When off, validate_candidate is
inert — it runs no VM sequence, opens no pipe, and returns {"enabled": False, ...}.

money_path=no. MAX(level) stays 0. The trainer validates + proposes; nothing trades.
Python 3, stdlib only (numpy/R3 live VM-side).
"""
from __future__ import annotations

import base64
import json
import os
import shlex
import subprocess
from typing import Any, Dict, List, Optional, Sequence

# B2's Layer-2 throttle adapter — the ONLY path to alpha_budget (test() only, no reset).
from trainer_budget_adapter import throttle_test

# ── flag (default OFF → inert) ──
TRAINER_VALIDATION_ENABLED_ENV = "TRAINER_VALIDATION_ENABLED"

# RF3T2-B3 / T2-d — the SAME flag that gates the compass coherence fixes. Read
# here as a plain env var rather than importing compass_metrics: duplicating an
# env READ is not duplicating logic (the RF2-B4 precedent), and it keeps this
# module's import surface unchanged. OFF (default) -> family_k stays level-scoped.
COMPASS_COHERENCE_V2_ENV = "COMPASS_COHERENCE_V2_ENABLED"


def _coherence_v2_enabled() -> bool:
    """True iff COMPASS_COHERENCE_V2_ENABLED is truthy. OFF -> v1 (level-scoped)."""
    return os.environ.get(COMPASS_COHERENCE_V2_ENV, "").strip().lower() in (
        "1", "true", "yes", "on",
    )

# ── RPC target (env-overridable; defaults to the established `ssh vm` pipe, B2 parity) ──
_VM_HOST = os.environ.get("TRAINER_VM_HOST", "vm")
_VM_DIR = os.environ.get("TRAINER_VM_DIR", "/home/trevor/trevor")
_VM_PY = os.environ.get("TRAINER_VM_PY", "venv/bin/python3")
_VM_TREVOR_DB = os.environ.get("TRAINER_VM_TREVOR_DB", "trevor.db")  # relative to _VM_DIR
_DEFAULT_TIMEOUT = float(os.environ.get("TRAINER_RPC_TIMEOUT", "90"))

# The tiny fixed loader (shlex-quoted once). It decodes+execs the base64 program in
# argv[1]; the program then decodes the base64 payload in argv[2]. Keeping the big
# program out of the shell is what makes arbitrary feature/mask payloads safe.
_VM_LOADER = (
    "import base64,sys;"
    "exec(compile(base64.b64decode(sys.argv[1]).decode(),'<trainer_validate>','exec'))"
)

# ═══════════════════════════════════════════════════════════════════════════════
# THE VM-SIDE PROGRAM (runs steps 1-4 as trevor; returns the VERDICT dict ONLY).
# Carried as a data string so this module's own surface authors no VM file and
# cannot itself import R3 / touch numpy. It NEVER references alpha_budget (the FDR
# gate is hop 2, via B2's adapter) and NEVER references reset.
# ═══════════════════════════════════════════════════════════════════════════════
_VM_PROGRAM = r'''
import base64, json, sys

def _emit(obj):
    print(json.dumps(obj))
    sys.exit(0)

try:
    payload = json.loads(base64.b64decode(sys.argv[2]).decode())
except Exception as exc:                       # unparseable payload
    _emit({"vm_error": "payload_decode: %s" % exc})

feature_names = payload.get("feature_names")
masks = payload.get("masks") or []
shadow_key = payload.get("shadow_key")
inline_stats = payload.get("shadow_stats")
n_trials = int(payload.get("n_trials", 1) or 1)
min_n = payload.get("min_n")
bh_significant = bool(payload.get("bh_significant", False))
vm_db_path = payload.get("vm_db_path") or "trevor.db"

# ── LAYER 1 — banned/non-whitelisted LEDGER-COLUMN leakage gate ──
try:
    from auto_trader.validation import rulers
    rulers.assert_features_legal(feature_names)
except Exception as exc:
    kind = type(exc).__name__
    if kind == "LeakageError":                 # a clean reject, NOT a crash
        _emit({"leakage_reject": True, "reject_layer": 1,
               "error_kind": kind, "reason": str(exc), "verdict": "REJECTED_LEAKAGE"})
    _emit({"vm_error": "layer1_import_or_runtime: %s: %s" % (kind, exc)})

# ── LAYER 2 — DERIVED-feature look-ahead gate (the G5 blind spot Layer 1 misses) ──
# 🚨 BOTH layers run — passing Layer 1 alone is insufficient.
try:
    import numpy as np
    from auto_trader.validation import causal
except Exception as exc:
    _emit({"vm_error": "layer2_import: %s: %s" % (type(exc).__name__, exc)})
for m in masks:
    try:
        causal.assert_mask_causal(
            np.asarray(m["stat_series"], dtype=float),
            np.asarray(m["mask"]),
            quantile=float(m["quantile"]),
            comparison=str(m.get("comparison", ">")),
            min_history=int(m.get("min_history", 1)),
            tolerance=float(m.get("tolerance", 0.0)),
            name=str(m.get("name", "mask")),
        )
    except Exception as exc:
        kind = type(exc).__name__
        if kind == "LookaheadError":            # a clean reject, NOT a crash
            _emit({"leakage_reject": True, "reject_layer": 2, "mask_name": m.get("name"),
                   "error_kind": kind, "reason": str(exc), "verdict": "REJECTED_LEAKAGE"})
        _emit({"vm_error": "layer2_runtime[%s]: %s: %s" % (m.get("name"), kind, exc)})

# ── STEP 3 — build shadow_stats (NET-OF-COST edge_series; skip un-nettable, count) ──
try:
    if shadow_key:
        import sqlite3
        from auto_trader.validation import shadow_feeder
        conn = sqlite3.connect("file:%s?mode=ro" % vm_db_path, uri=True)
        try:
            cohort = shadow_feeder.compute_shadow_cohort(conn, shadow_key)
        finally:
            conn.close()
        shadow_stats = {
            "edge_series": cohort["edge_series"],
            "n_div": cohort["n_div"], "dead_div": cohort["dead_div"],
            "n_comp": cohort["n_comp"], "dead_comp": cohort["dead_comp"],
            "n_skipped": cohort.get("n_skipped_uncharged", 0),
        }
        stats_source = "shadow_feeder.compute_shadow_cohort"
    elif inline_stats is not None:              # precomputed / deterministic-test seam
        shadow_stats = dict(inline_stats)
        shadow_stats.setdefault("n_skipped", 0)
        stats_source = "inline"
    else:
        _emit({"vm_error": "no_edge_source: neither shadow_key nor shadow_stats given"})
except Exception as exc:
    _emit({"vm_error": "shadow_stats_build: %s: %s" % (type(exc).__name__, exc)})

# n_trials is the family K the trainer swept (the bar-rises lever) — injected from WSL.
shadow_stats["n_trials"] = n_trials
shadow_stats["bh_significant"] = bh_significant
if min_n is not None:
    shadow_stats["min_n"] = int(min_n)

# ── STEP 4 — THE chokepoint verdict (never raises; report-only, promotes nothing) ──
try:
    from observatory.tasks import servant_gate
    verdict = servant_gate.promotion_verdict(shadow_stats)
except Exception as exc:
    _emit({"vm_error": "promotion_verdict: %s: %s" % (type(exc).__name__, exc)})

# VERDICT-ONLY crosses to WSL — no matched cohort rows, no replica, no ledger.
verdict["leakage_reject"] = False
verdict["n_skipped"] = shadow_stats.get("n_skipped", 0)
verdict["stats_source"] = stats_source
verdict["n_trials"] = n_trials
_emit(verdict)
'''


def enabled() -> bool:
    """True iff TRAINER_VALIDATION_ENABLED is truthy. Off → validate_candidate inert."""
    return os.environ.get(TRAINER_VALIDATION_ENABLED_ENV, "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def family_k(level_id: int, *, db_path: Optional[str] = None) -> int:
    """n_trials = the family K the trainer's bandit has swept.

    = COUNT of arms with a posterior row (one row per arm tried). This is the
    "bar rises with trials" lever: a larger K raises the DSR selection-deflation
    bar. Floored at 1 (DSR needs n_trials >= 1). Reads the trainer's OWN
    trainer.db via B0's connection — NEVER the VM, NEVER the replica.

    🚨 RF3T2-B3 / T2-d — CUMULATIVE ACROSS ALL LEVELS (decision D-1).
    This COUNTed `WHERE level_id = ?`, so a fresh level RESET the selection-
    deflation family and the same search could be re-tried with the multiple-
    comparisons penalty wiped — the classic way to farm a false positive past a
    multiplicity correction. It now counts every arm ever tried, at any level.

    THE REASONING (D-1, preserved): the alpha budget already treats the search as
    CONTINUOUS — `alpha_budget.apply_level_increment` documents "NEVER a full
    reset", carries `wealth` across a level increment, adds only a bounded
    magnitude-proportional top-up (`top_up = magnitude*rho*w0` = 1.0*0.5*0.05 =
    exactly 0.025000, < w0), and carries its cumulative counters. Verified live
    on the VM this run. A PER-LEVEL DSR would contradict the alpha budget's own
    precedent inside the same promotion decision. Internal consistency was the
    tiebreaker: too strict costs a missed discovery, too loose costs a PROMOTED
    FALSE POSITIVE — and a promoted false positive is the one that spends money.

    DIRECTION (intended): cumulative -> LARGER n_trials -> MORE deflation ->
    FEWER promotions. Strictly more conservative than before.

    ``level_id`` is retained in the signature (callers pass it, and it stays in
    the returned verdict for provenance) but no longer scopes the count.
    """
    from lib.trainer_db import get_connection  # B0 — stdlib sqlite3, WSL-local
    conn = get_connection(db_path)
    try:
        if _coherence_v2_enabled():
            # T2-d: CUMULATIVE — every arm ever tried, at ANY level.
            row = conn.execute("SELECT COUNT(*) FROM bandit_posteriors").fetchone()
        else:
            # v1 (flag OFF): byte-identical level-scoped count.
            row = conn.execute(
                "SELECT COUNT(*) FROM bandit_posteriors WHERE level_id=?",
                (int(level_id),),
            ).fetchone()
    finally:
        conn.close()
    return max(1, int(row[0]) if row and row[0] is not None else 0)


def _vm_call(payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    """Run the VM-side validation program over ssh (as trevor); parse its JSON verdict.

    Never raises to the caller — a transport/parse failure surfaces as a
    ``{"adapter_error": ...}`` dict so a broken pipe can't crash the search (and is
    NEVER faked into a verdict).
    """
    b64_prog = base64.b64encode(_VM_PROGRAM.encode()).decode()
    b64_payload = base64.b64encode(json.dumps(payload).encode()).decode()
    remote = (
        f"cd {shlex.quote(_VM_DIR)} && sudo -u trevor {shlex.quote(_VM_PY)} "
        f"-c {shlex.quote(_VM_LOADER)} {shlex.quote(b64_prog)} {shlex.quote(b64_payload)}"
    )
    try:
        proc = subprocess.run(
            ["ssh", _VM_HOST, remote],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        return {"adapter_error": "rpc_timeout"}
    except Exception as exc:  # ssh missing / OS error
        return {"adapter_error": f"rpc_failed: {exc}"}
    out = (proc.stdout or "").strip()
    if not out:
        return {"adapter_error": f"rpc_no_output (rc={proc.returncode}): "
                f"{(proc.stderr or '').strip()[:400]}"}
    # Take the last non-empty JSON line (skip benign VM-side import chatter on stdout).
    for line in reversed(out.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    return {"adapter_error": f"rpc_unparseable: {out[:400]}"}


def validate_candidate(
    feature_names: Optional[Sequence[str]],
    *,
    masks: Optional[List[Dict[str, Any]]] = None,
    shadow_key: Optional[str] = None,
    shadow_stats: Optional[Dict[str, Any]] = None,
    level_id: int,
    n_trials: Optional[int] = None,
    min_n: Optional[int] = None,
    bh_significant: bool = False,
    db_path: Optional[str] = None,
    budget_db_path: Optional[str] = None,
    run_throttle: bool = True,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """Validate ONE candidate arm through R3's engine; return the promote/reject verdict.

    Runs the per-candidate sequence VM-side (both leakage layers → net-of-cost
    shadow_stats → promotion_verdict), then — unless the candidate was leakage-
    rejected — runs the FDR discovery throttle via B2's ``throttle_test`` (hop 2).

    Args
      feature_names  every predictor the candidate uses (Layer 1). REQUIRED by the
                     gate; pass ``[]`` only for a truly feature-free candidate.
      masks          derived-label/mask specs for Layer 2, each a dict:
                     {name, stat_series, mask, quantile, comparison?, min_history?,
                      tolerance?}. Both layers ALWAYS run (G5 closed).
      shadow_key     the candidate's registered shadow — its net-of-cost divergent
                     cohort is built VM-side via shadow_feeder.compute_shadow_cohort
                     over the un-lagged VM trevor.db (the real replay path).
      shadow_stats   OR a precomputed stats dict (edge_series + cohort counts) — the
                     deterministic-test / trainer-computed-its-own-series seam.
      level_id       used to derive n_trials from the bandit family when n_trials
                     is None.
      n_trials       family K override (else family_k(level_id)). The bar-rises lever.
      min_n / bh_significant  SERVANT floor + family-BH decision, injected into
                     shadow_stats.
      run_throttle   run hop 2 (the FDR spend). Set False to get the verdict only.
      budget_db_path passed to throttle_test as its db_path (e.g. a THROWAWAY ledger
                     so the real discovery wealth is never touched).

    Returns
      Off (flag)              → {"enabled": False, ...} (inert, no pipe opened).
      Transport/VM failure    → {"enabled": True, "ok": False, "adapter_error"|
                                 "vm_error": ...} (surfaced, never a faked verdict).
      Leakage reject          → {"enabled": True, "ok": True, "leakage_reject": True,
                                 "reject_layer": 1|2, ...} (throttle NOT spent).
      Otherwise               → {"enabled": True, "ok": True, "leakage_reject": False,
                                 "verdict": {...promotion_verdict...},
                                 "throttle": {...throttle_test...}|None, "n_trials": K}.
    Never raises.
    """
    if not enabled():
        return {"enabled": False, "ok": False,
                "reason": f"{TRAINER_VALIDATION_ENABLED_ENV} off"}

    if n_trials is None:
        try:
            n_trials = family_k(level_id, db_path=db_path)
        except Exception as exc:  # trainer.db unreadable — surface, don't guess
            return {"enabled": True, "ok": False, "family_k_error": str(exc)}

    if shadow_key is None and shadow_stats is None:
        return {"enabled": True, "ok": False,
                "usage_error": "provide shadow_key (real cohort) or shadow_stats"}

    payload: Dict[str, Any] = {
        "feature_names": list(feature_names) if feature_names is not None else None,
        "masks": masks or [],
        "shadow_key": shadow_key,
        "shadow_stats": shadow_stats,
        "n_trials": int(n_trials),
        "min_n": min_n,
        "bh_significant": bool(bh_significant),
        "vm_db_path": _VM_TREVOR_DB,
    }
    to = float(timeout if timeout is not None else _DEFAULT_TIMEOUT)

    # ── HOP 1 — VM-side verdict (leakage layers → shadow_stats → promotion_verdict) ──
    verdict = _vm_call(payload, to)
    if "adapter_error" in verdict:
        return {"enabled": True, "ok": False, "adapter_error": verdict["adapter_error"]}
    if "vm_error" in verdict:
        return {"enabled": True, "ok": False, "vm_error": verdict["vm_error"]}
    if verdict.get("leakage_reject"):
        # A leakage-rejected candidate must NOT spend from the alpha budget.
        return {"enabled": True, "ok": True, "leakage_reject": True,
                "reject_layer": verdict.get("reject_layer"),
                "reason": verdict.get("reason"), "verdict": verdict,
                "throttle": None, "n_trials": int(n_trials)}

    # ── HOP 2 — FDR discovery throttle via B2's adapter (dsr from the verdict) ──
    throttle: Optional[Dict[str, Any]] = None
    if run_throttle:
        metrics = verdict.get("metrics") or {}
        dsr = metrics.get("deflated_sharpe")
        pbo = metrics.get("pbo")  # within-series CSCV (passed through; LORD gates on p)
        if dsr is not None:
            throttle = throttle_test(dsr=float(dsr), pbo=pbo,
                                     db_path=budget_db_path, timeout=to)
        else:
            throttle = {"skipped": "no deflated_sharpe in verdict metrics"}

    return {"enabled": True, "ok": True, "leakage_reject": False,
            "verdict": verdict, "throttle": throttle, "n_trials": int(n_trials)}


__all__ = ["validate_candidate", "family_k", "enabled",
           "TRAINER_VALIDATION_ENABLED_ENV"]


if __name__ == "__main__":
    # Guarded smoke only — NEVER runs on import. Reports flag + family K; runs a
    # real validation round-trip ONLY if the flag is set (inert otherwise).
    print(f"{TRAINER_VALIDATION_ENABLED_ENV} enabled(): {enabled()}")
    try:
        print(f"family_k(level 0): {family_k(0)}")
    except Exception as _exc:  # noqa: BLE001
        print(f"family_k unavailable: {_exc}")
    if enabled():
        _r = validate_candidate(
            ["confidence", "atr_at_entry"],
            shadow_stats={"edge_series": [0.4, -0.1, 0.6, 0.3, -0.05, 0.5, 0.2, 0.35],
                          "n_div": 40, "dead_div": 8, "n_comp": 40, "dead_comp": 20},
            level_id=0, min_n=38, run_throttle=False,
        )
        print(json.dumps({"smoke": _r}, indent=2, default=str))
