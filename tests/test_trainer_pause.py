#!/usr/bin/env python3
"""Tests for R13-P1: the trainer daemon's PAUSE poll (trainer_pause.py + the
run_trainer_loop wiring in trainer_loop.py).

Proves the load-bearing invariants:
  • the classifier is HARD-UNKNOWN on EVERY failure mode (spawn / timeout / nonzero /
    unparseable) and trusts ONLY an exact 0/1.
  • is_paused() is True ONLY on a confirmed PAUSED read; NOT_PAUSED and UNKNOWN both →
    False (keep running) — the load-bearing failure semantics.
  • an UNKNOWN read is COUNTED + surfaced (never swallowed), and the loop keeps running.
  • the cached read collapses N checks → ~1 reader call per TTL (no ssh per check).
  • a running loop ACTUALLY STOPS when paused (0 R8 activity, 0 iteration bodies) while
    staying alive (heartbeat + paused_ticks), and RESUMES cleanly on paused→0 (0→1→0).
  • the sliced sleep wakes early on a mid-sleep state change (latency ≈ TTL, not cadence).
  • flag OFF / no injection → run_trainer_loop is BYTE-IDENTICAL to R9-B6 (original return
    keys, a single un-sliced sleep, no pause construction, no ssh).

Dependency-free + OFFLINE by default: ``python3 tests/test_trainer_pause.py`` — every VM
read is an INJECTED fake (never a real ssh). The one live-shim smoke is gated behind
``TRAINER_PAUSE_LIVE=1`` and SKIPS otherwise. pytest-compatible too.
"""
import os
import random
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Throwaway trainer.db so the loop's B0–B5 seams never touch data/trainer.db.
_TMPDIR = tempfile.mkdtemp(prefix="trainer_pause_test_")
os.environ["TRAINER_DB_PATH"] = os.path.join(_TMPDIR, "trainer_test.db")
for _f in ("TRAINER_LOOP_ENABLED", "SHADOW_LOOP_EXECUTOR_ENABLED", "TRAINER_BANDIT_ENABLED",
           "TRAINER_PAUSE_POLL_ENABLED"):
    os.environ.pop(_f, None)

import trainer_pause as tp  # noqa: E402
import trainer_loop as tl  # noqa: E402
# Import the loop fakes at MODULE level so test_trainer_loop's top-level env-pop runs ONCE
# at import (before any test arms a flag) — never mid-test where it would clear TRAINER_LOOP_ENABLED.
from tests.test_trainer_loop import (  # noqa: E402
    _client_with, _FakeExecutor, _survivor_scored,
)


# ── fakes ────────────────────────────────────────────────────────────────────
class _FakeClock:
    """A monotonic clock we control (advance() moves it forward)."""
    def __init__(self):
        self.t = 0.0
    def __call__(self):
        return self.t
    def advance(self, dt):
        self.t += dt


class _CountingReader:
    """A fake pause reader returning a fixed reading and counting its calls."""
    def __init__(self, state, reason="x"):
        self.state = state
        self.reason = reason
        self.calls = 0
    def __call__(self):
        self.calls += 1
        return {"state": self.state, "reason": self.reason}


class _ScriptedPausePoll:
    """A fake PausePoll for loop tests. is_paused() returns a scripted sequence (repeats the
    last value once exhausted). ttl=0.0 → the loop's _sliced_sleep does ONE full chunk and
    never sub-polls, so is_paused fires EXACTLY once per iteration (the top-of-loop check) —
    making the loop deterministic."""
    def __init__(self, script, ttl=0.0):
        self.ttl = ttl
        self._script = list(script)
        self._i = 0
        self.calls = 0
        self.unknown_count = 0
    def is_paused(self):
        self.calls += 1
        if self._i < len(self._script):
            v = self._script[self._i]
            self._i += 1
        else:
            v = self._script[-1] if self._script else False
        return bool(v)


def _noop_heartbeat():
    return tl.TrainerHeartbeat(emit_fn=lambda p, a: {"ok": True})


def _forbidden_client():
    """A client whose R8 ops raise — proves NO R8 activity crosses while paused."""
    ex = _FakeExecutor({"shadow.route_proposal": lambda a: (_ for _ in ()).throw(
        AssertionError("R8 must NOT be driven while paused"))})
    return _client_with(ex), ex


# ── the shim classifier: HARD-UNKNOWN on every failure mode ──────────────────
def test_classify_hard_unknown_every_failure_and_exact_0_1():
    C = tp._classify
    assert C({"spawn_error": "ssh missing", "timed_out": False, "returncode": None,
              "stdout": "", "stderr": ""})["state"] == tp.UNKNOWN
    assert C({"spawn_error": None, "timed_out": True, "returncode": None,
              "stdout": "", "stderr": ""})["state"] == tp.UNKNOWN
    assert C({"spawn_error": None, "timed_out": False, "returncode": 255,
              "stdout": "", "stderr": "conn refused"})["state"] == tp.UNKNOWN
    assert C({"spawn_error": None, "timed_out": False, "returncode": 0,
              "stdout": "", "stderr": ""})["state"] == tp.UNKNOWN            # empty
    assert C({"spawn_error": None, "timed_out": False, "returncode": 0,
              "stdout": "garbage", "stderr": ""})["state"] == tp.UNKNOWN     # unparseable
    assert C({"spawn_error": None, "timed_out": False, "returncode": 0,
              "stdout": "0\n", "stderr": ""})["state"] == tp.NOT_PAUSED
    assert C({"spawn_error": None, "timed_out": False, "returncode": 0,
              "stdout": "  1 \n", "stderr": ""})["state"] == tp.PAUSED       # whitespace-tolerant
    print("OK classifier: hard-UNKNOWN on spawn/timeout/nonzero/empty/garbage; exact 0/1 only")


# ── is_paused() semantics: PAUSED only; NOT_PAUSED + UNKNOWN → keep running ───
def test_is_paused_only_on_confirmed_paused():
    assert tp.PausePoll(reader=_CountingReader(tp.PAUSED)).is_paused() is True
    assert tp.PausePoll(reader=_CountingReader(tp.NOT_PAUSED)).is_paused() is False
    assert tp.PausePoll(reader=_CountingReader(tp.UNKNOWN)).is_paused() is False  # UNKNOWN → keep running
    print("OK is_paused: True only on PAUSED; NOT_PAUSED + UNKNOWN both keep running")


# ── UNKNOWN is counted + surfaced (never swallowed) and the loop keeps running ──
def test_unknown_counted_and_surfaced_not_swallowed():
    clock = _FakeClock()
    r = _CountingReader(tp.UNKNOWN, reason="ssh down")
    p = tp.PausePoll(reader=r, ttl=30.0, clock=clock)
    assert p.is_paused() is False and p.unknown_count == 1  # counted on the fresh read
    p.is_paused()                                            # cache hit — not re-counted
    assert p.unknown_count == 1 and r.calls == 1
    clock.advance(31)                                        # past TTL → fresh read
    assert p.is_paused() is False and p.unknown_count == 2 and r.calls == 2
    print("OK UNKNOWN: counted once per fresh read (not per cache hit), surfaced, keep-running")


# ── the cache collapses N checks → ~1 reader call per TTL (no ssh per check) ──
def test_cache_bounds_reads_to_one_per_ttl():
    clock = _FakeClock()
    r = _CountingReader(tp.NOT_PAUSED)
    p = tp.PausePoll(reader=r, ttl=30.0, clock=clock)
    for _ in range(50):            # 50 checks inside one TTL window
        p.is_paused()
    assert r.calls == 1, r.calls                            # ONE read served all 50
    clock.advance(30)              # exactly at TTL boundary → refresh
    p.is_paused()
    assert r.calls == 2
    for _ in range(20):
        p.is_paused()              # 20 more within the new window
    assert r.calls == 2, r.calls
    print("OK cache: 50 checks → 1 read; ssh bounded to ~1 per TTL (no ssh per check)")


# ── a running loop ACTUALLY STOPS when paused (0 R8, 0 iteration bodies) ──────
def test_loop_stops_when_paused_no_r8_no_body():
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    try:
        client, ex = _forbidden_client()
        bodies = []
        pp = _ScriptedPausePoll(script=[True], ttl=0.0)  # paused every tick
        r = tl.run_trainer_loop(
            max_iterations=3, client=client, heartbeat=_noop_heartbeat(),
            sleep_fn=lambda s: None, on_iteration=lambda t: bodies.append(t),
            pause_poll=pp)
        assert r["enabled"] and r["iterations"] == 3, r
        assert r["paused_ticks"] == 3, r                      # every tick was paused
        assert bodies == [], "no iteration body ran while paused"
        assert ex.calls == [], "ZERO R8 activity while paused"
        assert pp.calls == 3, pp.calls                        # is_paused checked once per tick
    finally:
        os.environ.pop("TRAINER_LOOP_ENABLED", None)
    print("OK paused loop: 0 iteration bodies, 0 R8 calls, stays alive (paused_ticks=3)")


# ── clean RESUME: 0 → 1 → 0 stops then resumes without a wedged state ─────────
def test_loop_resumes_cleanly_after_pause_clears():
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ["TRAINER_BANDIT_ENABLED"] = "true"
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    _prev_db = os.environ.get("TRAINER_DB_PATH")
    try:
        ex = _FakeExecutor({
            "shadow.route_proposal": lambda a: {"ok": True,
                "result": {"queue": "config", "result": {"shadow_id": a["shadow_id"]}}},
            "shadow.grade": lambda a: {"ok": True, "result": {"gate_passed": 0}},
        })
        client = _client_with(ex)
        bodies = []
        # run, run, PAUSE, PAUSE, run — over 5 iterations.
        pp = _ScriptedPausePoll(script=[False, False, True, True, False], ttl=0.0)
        # 🚨 THIS TEST WAS FLAKY AT ~38% (5 fails / 13 runs, measured B5 2026-08-02).
        # THREE causes composed; fixing any one alone still left it flaky, so BOTH lines
        # below are load-bearing — do not "simplify" either away:
        #   1. run_trainer_loop defaults to an UNSEEDED random.Random() (_new_rng), so the
        #      arm sampled per iteration varied run to run.
        #   2. rejection_log is READ BACK within the run: the first sighting of an arm logs
        #      a rejection (validate_fn returns NOT_READY below), and self_pushback ->
        #      is_known_dead_end then legitimately BLOCKS a repeat of that same arm_hash.
        #      Two of the three RUNNING iterations colliding => only 2 of 3 submits.
        #   3. 🚨 THE STORE IS SHARED ACROSS THE WHOLE TEST PROCESS. TRAINER_DB_PATH is set
        #      once at module level (and is in fact overwritten by test_trainer_loop's own
        #      module-level set, which we import). test_flag_off_is_byte_identical sorts
        #      BEFORE this test in ALL, runs 2 UNSEEDED iterations, and both its rejection
        #      rows AND its bandit_posteriors updates land in the same store. MEASURED: this
        #      test seeded-but-not-isolated passed 10/10 alone and still FAILED 1/10 when run
        #      after that sibling. Isolation is what makes the seed sufficient.
        # 🚨 ISOLATION MUST BE VIA TRAINER_DB_PATH, *NOT* run_trainer_loop's db_path= seam.
        # db_path= only reaches self_pushback/log_rejection. run_search_step and
        # update_posterior take NO db_path and always resolve TRAINER_DB_PATH, so with db_path
        # alone the bandit_posteriors rows stay shared — and because Thompson sampling draws
        # from the rng once per posterior row, a differing row count DESYNCS the seeded rng
        # and the sampled arms change anyway. MEASURED: db_path-only isolation still failed
        # 1/5, with iterations 1-2 stable and iteration 3's arm varying run to run.
        # resolve_db_path() reads the env AT CALL TIME, so scoping the var here is sufficient
        # and is restored in the finally below.
        # 🚨 THE PRODUCTION DEDUP IS CORRECT — the over-strict assertion was `submits == 3`,
        # which silently assumed 3 DISTINCT arms. We make the test deterministic instead of
        # weakening the assertion, so the pause/resume behaviour under test stays as strict.
        # ⚠️ A FIXED SEED IS ONLY STABLE WHILE propose_arm's rng CONSUMPTION IS UNCHANGED.
        # If you alter the arm schema, the sampling order, or how many draws propose_arm
        # makes, this seed may start colliding again and the failure will look like a NEW
        # flake. It is not — re-pick a seed that yields 3 distinct arms and update this note.
        rng = random.Random(1729)
        # Own store: no sibling's rejection rows or posterior rows can reach this loop.
        os.environ["TRAINER_DB_PATH"] = os.path.join(
            tempfile.mkdtemp(prefix="trainer_pause_resume_"), "trainer.db")
        r = tl.run_trainer_loop(
            max_iterations=5, client=client, heartbeat=_noop_heartbeat(),
            backtest_fn=lambda arm, lvl: _survivor_scored(),
            validate_fn=lambda **kw: {"enabled": True, "ok": True, "leakage_reject": False,
                                      "verdict": {"verdict": "NOT_READY", "failing": ["min_n"]}},
            rng=rng,
            sleep_fn=lambda s: None, on_iteration=lambda t: bodies.append(t), pause_poll=pp)
        assert r["iterations"] == 5 and r["paused_ticks"] == 2, r
        assert len(bodies) == 3, bodies                       # iters 1,2,5 ran; 3,4 paused
        submits = [op for (op, a) in ex.calls if op == "shadow.route_proposal"]
        assert len(submits) == 3, submits                     # R8 driven only on the 3 running iters
    finally:
        for f in ("TRAINER_LOOP_ENABLED", "TRAINER_BANDIT_ENABLED", "SHADOW_LOOP_EXECUTOR_ENABLED"):
            os.environ.pop(f, None)
        # Restore the module-level scratch store for the tests that follow — this test
        # borrows the env var, it must not keep it.
        if _prev_db is None:
            os.environ.pop("TRAINER_DB_PATH", None)
        else:
            os.environ["TRAINER_DB_PATH"] = _prev_db
    print("OK resume: 0→1→0 — work runs, stops during pause, resumes after (3 bodies, 3 submits)")


# ── the sliced sleep wakes early on a mid-sleep state change (latency ≈ TTL) ──
def test_sliced_sleep_wakes_early_on_mid_sleep_pause():
    slept = []
    # ttl=10 → 6 slices over a 60s sleep. is_paused goes True on the 3rd slice check.
    pp = _ScriptedPausePoll(script=[False, False, True], ttl=10.0)
    tl._sliced_sleep(lambda s: slept.append(s), 60.0, pp, wake_when_paused=True)
    assert slept == [10.0, 10.0, 10.0], slept                 # woke after 30s, not the full 60s
    print("OK sliced sleep: woke early on a mid-sleep pause (30s of 60 — latency ≈ TTL, not cadence)")


def test_sliced_sleep_full_when_no_state_change():
    slept = []
    pp = _ScriptedPausePoll(script=[False], ttl=10.0)          # never changes
    tl._sliced_sleep(lambda s: slept.append(s), 60.0, pp, wake_when_paused=True)
    assert slept == [10.0] * 6 and abs(sum(slept) - 60.0) < 1e-6, slept
    print("OK sliced sleep: sleeps the full duration when no state change (6×10s = 60s)")


# ── flag OFF / no injection → run_trainer_loop is BYTE-IDENTICAL to R9-B6 ─────
def test_flag_off_is_byte_identical():
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ.pop("TRAINER_PAUSE_POLL_ENABLED", None)        # armed OFF
    try:
        ex = _FakeExecutor({"shadow.route_proposal": lambda a: {"ok": True,
            "result": {"queue": "config", "result": {}}},
            "shadow.grade": lambda a: {"ok": True, "result": {"gate_passed": 0}}})
        os.environ["TRAINER_BANDIT_ENABLED"] = "true"
        os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
        slept = []
        # NO pause_poll injected + flag OFF → the loop must never construct one.
        r = tl.run_trainer_loop(
            max_iterations=2, client=_client_with(ex), heartbeat=_noop_heartbeat(),
            backtest_fn=lambda arm, lvl: _survivor_scored(),
            validate_fn=lambda **kw: {"enabled": True, "ok": True, "leakage_reject": False,
                                      "verdict": {"verdict": "NOT_READY", "failing": ["min_n"]}},
            sleep_fn=lambda s: slept.append(s))
        # return has EXACTLY the original R9-B6 keys — no pause diagnostics leaked in.
        assert set(r.keys()) == {"enabled", "iterations", "loop_name"}, r
        assert r["enabled"] and r["iterations"] == 2, r
        # ONE un-sliced sleep of the full duration (not TTL-sliced chunks).
        assert len(slept) == 1 and slept[0] == float(
            os.environ.get("TRAINER_LOOP_SLEEP_SECONDS", "60")), slept
    finally:
        for f in ("TRAINER_LOOP_ENABLED", "TRAINER_BANDIT_ENABLED",
                  "SHADOW_LOOP_EXECUTOR_ENABLED"):
            os.environ.pop(f, None)
    print("OK flag OFF: original return keys, one un-sliced full sleep, no pause construction")


# ── OPTIONAL live-shim smoke against the real VM (gated; SKIPS by default) ────
def test_live_shim_smoke_optional():
    if os.environ.get("TRAINER_PAUSE_LIVE", "").strip() not in ("1", "true", "yes", "on"):
        print("SKIP live-shim smoke (set TRAINER_PAUSE_LIVE=1 to run against the real VM)")
        return
    reading = tp.read_pause_state()
    assert reading["state"] in (tp.PAUSED, tp.NOT_PAUSED, tp.UNKNOWN), reading
    p = tp.PausePoll()
    assert isinstance(p.is_paused(), bool)
    assert p.is_paused() and p.reads == 1 or (not p.is_paused() and p.reads == 1)  # 2nd = cache
    print("OK live-shim smoke:", reading["state"], "(reads:", p.reads, ")")


ALL = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]

if __name__ == "__main__":
    failed = 0
    for t in ALL:
        try:
            t()
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(ALL) - failed}/{len(ALL)} passed")
    sys.exit(1 if failed else 0)
