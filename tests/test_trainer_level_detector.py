#!/usr/bin/env python3
"""RF2-B3 acceptance — the mid-run level-increment detector (W5-U5), the SL6 anti-lobotomy
sweep (W5) with REFUSE-OR-ALERT, and the caller-side teach wire (W3).

Run: ``python3 tests/test_trainer_level_detector.py`` (pytest is NOT in the WSL venv — the
``__main__`` self-runner is the live path, matching the trainer suite convention).

Isolation: NO ssh, NO :3941, NO live db. The detector's level read is an INJECTED fake
reader; the sweep runs against a FAKE R8 client (and, once, the REAL client pointed at the
dead :3941 to prove refuse-or-alert fires VISIBLY); the teach path mocks the VM transport
(``trainer_teach._vm_call``). Nothing here writes trevor.db, mints a level, or opens a pipe.
"""
from __future__ import annotations

import logging
import os
import sys
from contextlib import contextmanager
from io import StringIO

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import trainer_loop  # noqa: E402
from trainer_loop import LevelDetector, R8HandoffClient, _VM_TREVOR_DB_ABS  # noqa: E402

_PASS = 0
_FAIL = 0


def _check(cond: bool, label: str) -> None:
    global _PASS, _FAIL
    if cond:
        _PASS += 1
        print(f"  ✓ {label}")
    else:
        _FAIL += 1
        print(f"  ✗ FAIL: {label}")


@contextmanager
def _env(**kv):
    """Temporarily set env vars, restoring on exit."""
    old = {k: os.environ.get(k) for k in kv}
    os.environ.update({k: str(v) for k, v in kv.items()})
    try:
        yield
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@contextmanager
def _capture_stderr():
    buf = StringIO()
    old = sys.stderr
    sys.stderr = buf
    try:
        yield buf
    finally:
        sys.stderr = old


def _reader(seq):
    """A reader yielding (level, detail) pairs from ``seq``, repeating the LAST forever."""
    state = {"i": 0}

    def _r():
        i = state["i"]
        val = seq[i] if i < len(seq) else seq[-1]
        state["i"] = i + 1
        return val

    return _r


# ═══════════════════════════════════════════════════════════════════════════
# A) LevelDetector — flip detected, idempotent, unreachable-not-silent, monotonic
# ═══════════════════════════════════════════════════════════════════════════
def test_detector():
    print("A) LevelDetector (injectable reader):")

    # A1: a simulated flip N→N+1 IS DETECTED.
    det = LevelDetector(1, reader=_reader([(1, "ok"), (1, "ok"), (2, "ok"), (2, "ok")]))
    det.check()  # read 1 — no flip
    det.check()  # read 1 — no flip
    _check(det.current_level == 1 and det.flips_detected == 0 and not det.needs_sweep(),
           "pre-flip: held at start level 1, no sweep pending")
    r = det.check()  # read 2 — FLIP
    _check(r["flipped"] and det.current_level == 2 and det.flips_detected == 1,
           "flip 1→2 DETECTED (current_level adopts 2, flips_detected=1)")
    _check(det.needs_sweep(), "needs_sweep True after flip (current 2 > last_swept 1)")

    # A2: detected twice → fires once. A re-read of the SAME level does not re-detect; after a
    # successful sweep, needs_sweep stays False no matter how many times we re-check.
    _check(det.check()["flipped"] is False and det.flips_detected == 1,
           "re-read of 2 does NOT re-flip (flips_detected stays 1)")
    det.mark_swept()  # sweep landed
    _check(not det.needs_sweep(), "after mark_swept: needs_sweep False (fires once)")
    for _ in range(3):
        det.check()  # keeps reading 2
    _check(not det.needs_sweep() and det.flips_detected == 1,
           "repeated checks at the swept level → no re-fire (idempotent)")

    # A3: VM-unreachable mid-run → NOT a silent skip. Keep running at the current level +
    # surface to stderr + increment unknown_count; NO phantom flip, NO sweep.
    det2 = LevelDetector(3, reader=_reader([(None, "ssh_timeout")]))
    with _capture_stderr() as err:
        r2 = det2.check()
    _check(r2["unknown"] and det2.current_level == 3 and det2.unknown_count == 1,
           "unreachable: keep running at level 3, unknown_count=1, no flip")
    _check(not det2.needs_sweep(), "unreachable: no sweep pending (no flip observed)")
    _check("UNKNOWN" in err.getvalue() and "keep running" in err.getvalue(),
           "unreachable is SURFACED to stderr (NOT a silent skip)")

    # A4: monotonic violation (read BELOW held) → ignore, never lower the level.
    det3 = LevelDetector(5, reader=_reader([(4, "ok")]))
    with _capture_stderr() as err3:
        r3 = det3.check()
    _check(not r3["flipped"] and det3.current_level == 5,
           "monotonic violation (read 4 < held 5): ignored, stays at 5")
    _check("monotonic violation" in err3.getvalue(), "monotonic violation surfaced")

    # A5: a raising reader must not kill check().
    def _boom():
        raise RuntimeError("reader exploded")

    det4 = LevelDetector(2, reader=_boom)
    with _capture_stderr():
        r4 = det4.check()
    _check(r4["unknown"] and det4.current_level == 2 and det4.unknown_count == 1,
           "raising reader → unknown (non-fatal), level unchanged")


# ═══════════════════════════════════════════════════════════════════════════
# B) sweep_stale_on_flip — RPC shapes, refuse-or-alert, flag-off, :3941-absent
# ═══════════════════════════════════════════════════════════════════════════
class _FakeClient(R8HandoffClient):
    """A client whose ``_post`` is scripted (op → response or callable). Bypasses the real
    __init__ (no token / no _assert on a synthetic endpoint) but keeps the real trevor_db."""

    def __init__(self, script):
        self.endpoint = "http://fake"
        self.token = "x"
        self.timeout = 1.0
        self.trevor_db = _VM_TREVOR_DB_ABS
        self.posts = []
        self._script = script

    def _post(self, op, args):
        self.posts.append((op, dict(args)))
        r = self._script.get(op)
        return r(args) if callable(r) else r


def test_sweep():
    print("B) sweep_stale_on_flip (fake client):")

    with _env(SHADOW_LOOP_EXECUTOR_ENABLED="true"):
        # B1: full success — both RPCs fire with the CORRECT shapes.
        script = {
            "shadow.stale_candidates": {"ok": True, "result": [
                {"shadow_id": "s1", "state": "TESTING", "level_tested_at": 1, "queue": "config"},
                {"shadow_id": "s2", "state": "PROPOSED", "level_tested_at": 1, "queue": "config"},
            ]},
            "shadow.requeue_stale": {"ok": True, "result": {"shadow_id": "x", "state": "PROPOSED"}},
        }
        c = _FakeClient(script)
        out = c.sweep_stale_on_flip(2)
        _check(out["ok"] and out["swept"] == 2 and out["reachable"] is True,
               "full success: ok, swept=2, reachable")
        _check(c.posts[0] == ("shadow.stale_candidates",
                              {"current_level": 2, "trevor_db": _VM_TREVOR_DB_ABS}),
               "stale_candidates shape = {current_level: N+1, trevor_db}")
        _check(c.posts[1] == ("shadow.requeue_stale",
                              {"shadow_id": "s1", "trevor_db": _VM_TREVOR_DB_ABS})
               and c.posts[2][1]["shadow_id"] == "s2",
               "requeue_stale shape = {shadow_id, trevor_db} per stale row")

        # B2: VM-unreachable (stale_candidates _post → None) → REFUSE-OR-ALERT, NOT silent.
        c2 = _FakeClient({"shadow.stale_candidates": None})
        out2 = c2.sweep_stale_on_flip(2)
        _check(out2["ok"] is False and out2["reachable"] is False,
               "unreachable → ok=False, reachable=False (REFUSE-OR-ALERT, not a no-op)")
        _check("RETRYABLE" in out2["reason"] and "did NOT run" in out2["reason"],
               "unreachable reason names it did-NOT-run + RETRYABLE")

        # B3: partial failure mid-sweep (2nd requeue unreachable) → retryable (VM idempotent).
        calls = {"n": 0}

        def _requeue(_args):
            calls["n"] += 1
            return {"ok": True, "result": {}} if calls["n"] == 1 else None

        c3 = _FakeClient({
            "shadow.stale_candidates": {"ok": True, "result": [{"shadow_id": "a"}, {"shadow_id": "b"}]},
            "shadow.requeue_stale": _requeue,
        })
        out3 = c3.sweep_stale_on_flip(2)
        _check(out3["ok"] is False and out3["reachable"] is False and out3["swept"] == 1,
               "partial failure mid-sweep → ok=False, swept=1 (retry whole sweep)")

        # B4: VM flag OFF (stale_candidates result=None) → benign inert (advance, no alarm).
        c4 = _FakeClient({"shadow.stale_candidates": {"ok": True, "result": None}})
        out4 = c4.sweep_stale_on_flip(2)
        _check(out4["ok"] is True and out4["swept"] == 0 and "off on VM" in out4["reason"],
               "VM flag OFF (result None) → benign inert (ok, swept=0)")

    # B5: WSL flag OFF → benign inert, NO RPC attempted.
    with _env(SHADOW_LOOP_EXECUTOR_ENABLED="false"):
        c5 = _FakeClient({})
        out5 = c5.sweep_stale_on_flip(2)
        _check(out5["ok"] is True and c5.posts == [] and "off (WSL)" in out5["reason"],
               "WSL flag OFF → benign inert, zero RPC")

    # B6: THE :3941-ABSENT REAL PATH (honesty). A REAL client at the dead :3941 → _post's real
    # urlopen → connection refused → None → refuse-or-alert fires VISIBLY (degrades correctly,
    # NOT a silent success). This is how the real path is proven to fail-loud today.
    with _env(SHADOW_LOOP_EXECUTOR_ENABLED="true", SHADOW_EXECUTOR_TOKEN="dummy-transport-probe"):
        real = R8HandoffClient()  # default endpoint = the dead :3941
        out6 = real.sweep_stale_on_flip(2)
        _check(out6["ok"] is False and out6["reachable"] is False,
               ":3941-absent REAL path → refuse-or-alert (visible degrade, NOT silent-success)")


# ═══════════════════════════════════════════════════════════════════════════
# C) run_trainer_loop wiring — detector triggers sweep in-loop; flag-off byte-identical
# ═══════════════════════════════════════════════════════════════════════════
class _HBStub:
    loop_name = "trainer_search_loop"

    def pre_register(self):
        pass

    def emit(self, error=None):
        pass


class _LoopClient(R8HandoffClient):
    """Stubs the iteration RPCs to no-ops and records sweep calls (so the loop wiring is tested
    without scripting _post)."""

    def __init__(self, sweep_results):
        self.trevor_db = _VM_TREVOR_DB_ABS
        self.sweep_calls = []
        self._sweep_results = sweep_results

    def submit_proposal(self, *a, **k):
        return {"submitted": False, "reason": "test-stub", "queue": None}

    def read_verdict(self, *a, **k):
        return None

    def surface_candidate(self, *a, **k):
        return {"surfaced": False, "reason": "test-stub"}

    def sweep_stale_on_flip(self, current_level):
        i = len(self.sweep_calls)
        self.sweep_calls.append(int(current_level))
        r = self._sweep_results[i] if i < len(self._sweep_results) else self._sweep_results[-1]
        return dict(r)


def _run_loop(client, level_detector, iters):
    return trainer_loop.run_trainer_loop(
        level=1, max_iterations=iters, client=client, heartbeat=_HBStub(),
        backtest_fn=None, validate_fn=lambda **k: {"enabled": False},
        sleep_fn=lambda _s: None, db_path=None, level_detector=level_detector)


def test_loop_wiring():
    print("C) run_trainer_loop wiring:")
    with _env(TRAINER_LOOP_ENABLED="true", SHADOW_LOOP_EXECUTOR_ENABLED="false",
              MEMORY_REASONING_ENABLED="false", MEMORY_QUERY_ENABLED="false",
              TRAINER_LEVEL_DETECTOR_ENABLED="false", TRAINER_TEACH_ENABLED="false"):

        # C1: a flip on iteration 3 triggers ONE successful sweep, at the new level.
        det = LevelDetector(1, reader=_reader([(1, "ok"), (1, "ok"), (2, "ok"), (2, "ok")]))
        c = _LoopClient([{"ok": True, "swept": 1, "reachable": True, "reason": "swept"}])
        with _capture_stderr():
            res = _run_loop(c, det, iters=4)
        _check(c.sweep_calls == [2], "sweep fired ONCE, at level 2 (the flip) — not on quiet iters")
        _check(res.get("level_flips_detected") == 1 and res.get("final_level") == 2,
               "result: level_flips_detected=1, final_level=2")
        _check(res.get("sl6_sweep_pending") is False and res.get("sl6_sweep_unreachable_count") == 0,
               "result: sweep landed → not pending, 0 unreachable")

        # C2: a flip whose sweep keeps FAILING → retried every iteration + pending + counter.
        det2 = LevelDetector(1, reader=_reader([(1, "ok"), (1, "ok"), (2, "ok"), (2, "ok"), (2, "ok")]))
        c2 = _LoopClient([{"ok": False, "reachable": False,
                           "reason": "executor unreachable — SL6 sweep did NOT run (RETRYABLE)"}])
        with _capture_stderr() as err:
            res2 = _run_loop(c2, det2, iters=5)
        _check(c2.sweep_calls == [2, 2, 2],
               "failed sweep RETRIES every iteration (calls at iters 3,4,5) — never forgotten")
        _check(res2.get("sl6_sweep_pending") is True and res2.get("sl6_sweep_unreachable_count") == 3,
               "result: sweep_pending True, unreachable_count=3")
        _check("SL6 ANTI-LOBOTOMY SWEEP DID NOT RUN" in err.getvalue(),
               "loud 🚨 refuse-or-alert surfaced to stderr (NOT silent)")

        # C3: detector flag OFF + not injected → byte-identical to R9-B6 (no detector keys, no sweep).
        c3 = _LoopClient([{"ok": True}])
        res3 = _run_loop(c3, None, iters=3)
        _check(c3.sweep_calls == [], "flag OFF → sweep NEVER called")
        _check(all(k not in res3 for k in
                   ("final_level", "level_flips_detected", "sl6_sweep_pending",
                    "sl6_sweep_unreachable_count", "level_read_unknown_count")),
               "flag OFF → result carries NO detector diagnostics (byte-identical)")


# ═══════════════════════════════════════════════════════════════════════════
# D) W3 teach wire — string reaches dispatch (text-only), malformed skip, error surfaced,
#    flag-off inert. Mocks trainer_teach._vm_call (the VM transport boundary).
# ═══════════════════════════════════════════════════════════════════════════
def _drive_iteration(teach_flag: str, validation: dict, gate_passed):
    """Drive ONE _run_one_iteration with the bandit/reasoning pieces monkeypatched, returning
    the trace. The teach block reads teach_enabled() (env) + gate_passed + validation.ok."""
    import trainer_bandit
    import trainer_reasoning
    saved = {}

    def _patch(mod, name, fn):
        saved[(mod, name)] = getattr(mod, name)
        setattr(mod, name, fn)

    _patch(trainer_bandit, "run_search_step",
           lambda schema, level, rng: {"enabled": True, "arm": {"k": "v"},
                                       "arm_hash": "h1", "axes_json": "{}"})
    _patch(trainer_bandit, "update_posterior", lambda *a, **k: (0.5, 0.5, 1))
    _patch(trainer_bandit, "compass_reward", lambda v: 0.0)
    _patch(trainer_reasoning, "self_pushback", lambda cand, db_path=None: {"proceed": True, "source": "test"})
    _patch(trainer_reasoning, "narrate_verdict", lambda *a, **k: "validated lesson: tighten X in RANGING")
    _patch(trainer_reasoning, "log_rejection", lambda *a, **k: None)
    _patch(trainer_loop, "arm_to_proposal", lambda arm: {"p": 1})
    _patch(trainer_loop, "family_of", lambda arm: "fam")
    _patch(trainer_loop, "mint_shadow_id", lambda h, l: "shadow-test")

    class _C(R8HandoffClient):
        def __init__(self):
            self.trevor_db = _VM_TREVOR_DB_ABS

        def submit_proposal(self, *a, **k):
            return {"submitted": True, "queue": "config", "reason": "ok"}

        def read_verdict(self, *a, **k):
            return gate_passed

        def surface_candidate(self, *a, **k):
            return {"surfaced": True, "reason": "ok"}

    try:
        with _env(TRAINER_TEACH_ENABLED=teach_flag, MEMORY_QUERY_ENABLED="false"):
            return trainer_loop._run_one_iteration(
                schema={}, level=7, client=_C(), rng=None, backtest_fn=None,
                validate_fn=lambda **k: validation, db_path=None, epoch=None)
    finally:
        for (mod, name), fn in saved.items():
            setattr(mod, name, fn)


def test_teach():
    print("D) W3 teach wire (mock VM transport):")
    import trainer_teach

    # D1: teach fires on gate_passed=True + validation.ok=True → a TEXT payload reaches _vm_call.
    captured = {}
    orig_vm_call = trainer_teach._vm_call
    trainer_teach._vm_call = lambda payload, timeout: (captured.update(payload) or
                                                       {"wrote": True, "count_before": 0, "count_after": 1})
    try:
        trace = _drive_iteration("true", {"enabled": True, "ok": True}, True)
        _check(trace.get("taught") is True, "validated+gate_passed → taught=True")
        _check(isinstance(captured.get("text"), str) and captured["text"].startswith("validated lesson"),
               "a teaching STRING (narrate_verdict rationale) reached the dispatch")
        _check("embeddings" not in captured and "weight" not in captured
               and not any(k == "weight" for k in (captured.get("metadata") or {})),
               "TEXT-ONLY: no embeddings=, no numeric weight anywhere in the payload")
        _check((captured.get("metadata") or {}).get("level_id") == 7,
               "metadata carries level_id=7 (scoped)")
        _check((captured.get("metadata") or {}).get("source") == trainer_teach.TEACH_SOURCE_TAG,
               "tagged source=r9_trainer_teach")

        # D5: flag OFF → teach block inert, _vm_call NEVER called.
        captured.clear()
        trace_off = _drive_iteration("false", {"enabled": True, "ok": True}, True)
        _check("taught" not in trace_off and not captured,
               "TRAINER_TEACH_ENABLED off → teach inert (no dispatch, no 'taught' key)")

        # D1b: gate_passed None (un-gradeable) → excluded even with flag on + validation.ok.
        captured.clear()
        trace_none = _drive_iteration("true", {"enabled": True, "ok": True}, None)
        _check("taught" not in trace_none and not captured,
               "gate_passed None (un-gradeable) → excluded (no teach)")

        # D1c: validation.ok False → excluded even with gate_passed True.
        captured.clear()
        trace_notok = _drive_iteration("true", {"enabled": True, "ok": False}, True)
        _check("taught" not in trace_notok and not captured,
               "validation.ok False → excluded (no teach)")
    finally:
        trainer_teach._vm_call = orig_vm_call

    # D2: malformed pattern (no text) → skipped+logged, dispatch NEVER called, never faked.
    called = {"n": 0}
    orig = trainer_teach._vm_call
    trainer_teach._vm_call = lambda p, t: (called.__setitem__("n", called["n"] + 1) or {"wrote": True})
    try:
        rv = trainer_teach.recommend_execution_guidance({"no_text_here": 1})
        _check(rv is None and called["n"] == 0, "malformed pattern → skipped (no dispatch), returns None")
    finally:
        trainer_teach._vm_call = orig

    # D3: VM transport error → surfaced via log.warning, returns None (never faked as success).
    orig = trainer_teach._vm_call
    trainer_teach._vm_call = lambda p, t: {"vm_error": "chromadb_write: boom", "wrote": False}
    rec = []

    class _Cap(logging.Handler):
        def emit(self, record):
            rec.append(record.getMessage())

    cap = _Cap()
    trainer_teach._log.addHandler(cap)
    trainer_teach._log.setLevel(logging.INFO)
    try:
        rv = trainer_teach.recommend_execution_guidance("a real teaching string")
        _check(rv is None, "VM transport error → returns None (never raises)")
        _check(any("not confirmed" in m or "boom" in m for m in rec),
               "VM error is SURFACED to the log (never swallowed / never faked as success)")
    finally:
        trainer_teach._log.removeHandler(cap)
        trainer_teach._vm_call = orig


def main():
    print("=== RF2-B3 acceptance: level detector + SL6 sweep + teach wire ===")
    test_detector()
    test_sweep()
    test_loop_wiring()
    test_teach()
    print(f"\n=== {_PASS} PASS / {_FAIL} FAIL ===")
    return 0 if _FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
