"""[B1] The trainer's degraded state must PERSIST, not be declared once and forgotten.

🚨 THE DEFECT THIS FILE EXISTS TO PREVENT, in one sentence: the ``no_simulator``
declaration fired ONCE, pre-loop, and then went silent, so the live VM row read
``error_count=3 @ 2026-08-04T14:00:16Z`` beside ``iteration_count=30 @
2026-08-05T13:02:14Z`` — twenty-three hours of "rough start, then clean iterations" for a
loop that never recovered and structurally could not. **A rising iteration count proves
liveness only, never learning**, and an operator about to leave this running unattended
for two weeks would have read the climb as progress.

Five causes were found and each has a case here:

  1. the degraded emit was PRE-LOOP only            -> test_degraded_rides_every_iteration
  2. the in-loop emit's only error source was a     -> test_degraded_rides_every_iteration
     raised exception, and a provider-less
     iteration raises nothing
  3. the only complete surface (``result["degraded"]``) sat AFTER the ``while``, so
     ``max_iterations=None`` made it unreachable    -> test_degraded_rides_every_iteration
     in the daemon                                     (state is proven mid-run, not at exit)
  4. ``last_error`` is ONE mutable slot that NOTHING -> test_symmetric_recovery_bad_good_bad
     ever clears, so a degraded string parked there
     latches FOREVER after a real recovery
  5. no Hub surface reads the trainer heartbeat      -> OUT OF SCOPE by decision; carried as
     at all                                             an open gap, not closed here.

🚨 [B3] / RM-TRAINER G5 ADDS THE OTHER HALF. [B1] made the declaration RIDE every iteration;
it left the declaration ITSELF still emitting pre-loop, which counted a run and an error
having done zero search work — once per process start, forever, unbounded across restarts.
The pre-loop ``emit`` is gone; ``set_degraded`` alone carries the start-up declaration.
  6. the pre-loop declaration counted as a run       -> test_declaration_does_not_count_as_a_run
     and as an error                                    (and the emit count above: 4 -> 3)

🚨 THE POSITIVE CONTROL IS LOAD-BEARING. Without it, "no degraded state" and "the check is
broken" are pixel-identical, and a fix that silently never fires would pass every other
case in this file.

Dependency-free: ``python3 tests/test_trainer_degraded_emit.py``. Never touches
``data/*.db`` (containment below), never reaches the VM (every seam is injected), and
never writes the real ``loop_heartbeat`` row — that row is live evidence about the running
daemon and a test must never move it.
"""
import base64
import contextlib
import io
import json
import os
import random
import sqlite3
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import _containment  # noqa: E402

_containment.activate()

for _f in ("TRAINER_LOOP_ENABLED", "TRAINER_OBSERVE_ONLY_ENABLED",
           "SHADOW_LOOP_EXECUTOR_ENABLED", "TRAINER_VALIDATION_ENABLED",
           "TRAINER_NARRATION_ENABLED", "TRAINER_TEACH_ENABLED",
           "TRAINER_LEVEL_DETECTOR_ENABLED", "TRAINER_PAUSE_POLL_ENABLED",
           "MEMORY_REASONING_ENABLED", "MEMORY_QUERY_ENABLED",
           "TRAINER_BACKTEST_PROVIDER", "SHADOW_EXECUTOR_TOKEN"):
    os.environ.pop(_f, None)
os.environ["TRAINER_BANDIT_ENABLED"] = "true"
os.environ["TRAINER_COMPASS_ENABLED"] = "true"
# Layer 3 (unreachable destinations) — belt to the injected seams' braces.
os.environ["TRAINER_VM_HOST"] = "b1-invalid-host.invalid"
os.environ["TRAINER_EXECUTOR_URL"] = "http://127.0.0.1:1"

import trainer_loop as tl  # noqa: E402


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


def _survivor():
    """A backtest candidate that clears the two-gate wall and scores positive."""
    return {"equity_curve": [100, 102, 99, 103, 101, 105],
            "net_pnl_series": [0.02] * 19 + [-0.10],
            "daily_returns": [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025],
            "trades": [{"ticker": t} for t in ("BTC", "ETH", "SOL", "PAXG", "XMR")],
            "original_notional_usd": 1000.0, "deployment_ceiling": 0.5}


def _validate_ok(**kw):
    return {"enabled": True, "ok": True, "leakage_reject": False,
            "verdict": {"verdict": "PROMOTE", "confidence": 0.9},
            "throttle": {"discovery": True}, "n_trials": 12}


class _RecordingClient:
    """Records which handoffs a path reaches. Crosses nothing."""

    def __init__(self):
        self.calls = []

    def submit_proposal(self, *a, **k):
        self.calls.append("submit_proposal")
        return {"submitted": True, "queue": "config", "reason": "stub"}

    def read_verdict(self, *a, **k):
        self.calls.append("read_verdict")
        return True

    def surface_candidate(self, *a, **k):
        self.calls.append("surface_candidate")
        return {"surfaced": True, "reason": "stub"}

    def sweep_stale_on_flip(self, *a, **k):
        self.calls.append("sweep_stale_on_flip")
        return {"ok": True, "reason": "stub"}


class _RecordingHeartbeat(tl.TrainerHeartbeat):
    """🚨 Stubs the TRANSPORT ONLY, never the methods.

    ``pre_register`` / ``emit`` / ``set_degraded`` are the REAL implementations; only the
    ssh pipe is replaced, and the program each method chose is recovered by identity. A
    stub that overrode ``set_degraded`` would be testing the stub, and a real
    ``pre_register`` would write a ``trainer_search_loop`` row to the live VM — that row is
    the evidence about the running daemon and a test must never mint or move it."""

    def __init__(self):
        super().__init__(emit_fn=self._record)
        self.emits = []      # every error string handed to emit (None == healthy)
        self.degraded = []   # every value handed to set_degraded (None == cleared)
        self.calls = []

    def _record(self, program, args_json):
        args = json.loads(args_json)
        if program is tl._HEARTBEAT_DEGRADED:
            self.degraded.append(args.get("degraded_reason"))
        elif program is tl._HEARTBEAT_EMIT:
            self.emits.append(args.get("error"))
        elif program is tl._HEARTBEAT_PREREGISTER:
            self.calls.append("pre_register")
        return {"ok": True}


def _fresh_store(tag):
    """A brand-new scratch store so runs start from identical posteriors."""
    base = os.path.dirname(os.environ["TRAINER_DB_PATH"])
    p = os.path.join(base, f"b1_degraded_{tag}.db")
    if os.path.exists(p):
        os.remove(p)
    os.environ["TRAINER_DB_PATH"] = p
    return p


def _run(tag, *, backtest_fn, iterations, observe_only=True, level=0):
    _fresh_store(tag)
    hb = _RecordingHeartbeat()
    res = tl.run_trainer_loop(
        level=level, max_iterations=iterations, observe_only=observe_only,
        client=_RecordingClient(), heartbeat=hb, backtest_fn=backtest_fn,
        validate_fn=_validate_ok, rng=random.Random(1234),
        sleep_fn=lambda s: None, level_reader=lambda: (level, "ok"))
    return res, hb


# ── the real VM program, driven against a scratch DB ────────────────────────
_REAL_SCHEMA = """
CREATE TABLE loop_heartbeat (
    loop_name TEXT PRIMARY KEY,
    cadence_seconds INTEGER NOT NULL,
    last_iteration_at TEXT NOT NULL,
    iteration_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_error_at TEXT,
    is_dormant INTEGER NOT NULL DEFAULT 0,
    is_time_based INTEGER NOT NULL DEFAULT 0,
    degraded_reason TEXT
);
"""


def _exec_degraded_program(db_path, loop_name, reason):
    """Execute the module's OWN ``_HEARTBEAT_DEGRADED`` text verbatim against a scratch DB.

    🚨 NOT a re-implementation. A hand-written copy of the UPDATE could reproduce the very
    bug it is meant to catch, so the program string itself is exec'd; only
    ``auto_trader.observability._connect`` (a VM-only module) is supplied locally."""
    pkg = types.ModuleType("auto_trader")
    obs = types.ModuleType("auto_trader.observability")
    obs._connect = lambda: sqlite3.connect(db_path)
    saved = {k: sys.modules.get(k) for k in ("auto_trader", "auto_trader.observability")}
    sys.modules["auto_trader"] = pkg
    sys.modules["auto_trader.observability"] = obs
    payload = base64.b64encode(json.dumps(
        {"loop_name": loop_name, "degraded_reason": reason}).encode()).decode()
    old_argv = sys.argv
    sys.argv = ["prog", "", payload]
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(tl._HEARTBEAT_DEGRADED, "<_HEARTBEAT_DEGRADED>", "exec"),
                 {"__name__": "__degraded__"})
    finally:
        sys.argv = old_argv
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    return json.loads(buf.getvalue().strip().splitlines()[-1])


def _column(db_path, loop_name):
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT degraded_reason FROM loop_heartbeat WHERE loop_name=?",
            (loop_name,)).fetchone()
    finally:
        conn.close()
    return row[0] if row else "<no row>"


# ═══════════════════════════════════════════════════════════════════════════
# the cases
# ═══════════════════════════════════════════════════════════════════════════
def test_degraded_rides_every_iteration():
    """Causes 1+2+3: the state must be on EVERY iteration, mid-run, not once at start-up.

    🚨 ONE ITERATION WOULD PROVE NOTHING — a pre-loop emit also produces exactly one
    degraded signal. Only the SECOND and THIRD tell the two apart."""
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    os.environ.pop("TRAINER_LOOP_ENABLED", None)

    res, hb = _run("everyiter", backtest_fn=None, iterations=3)

    _assert(res["simulating"] is False, res)
    _assert(res["degraded_reason"] == tl.DEGRADED_NO_SIMULATOR, res)
    # 🚨 [B3] THREE emits, not four — one per iteration and NONE for the pre-loop
    # declaration. This number was 4 and the 4th was a phantom: it counted a run and an
    # error having done zero search work (RECON-TRAINER-003 F4/R5).
    _assert(len(hb.emits) == 3, f"expected 3 emits (1 per iteration, 0 pre-loop): {hb.emits}")
    _assert(all(e and "no_simulator" in e for e in hb.emits),
            f"every emit must carry the degraded state, not just the first: {hb.emits}")
    # The column is written pre-loop AND on every iteration, always with the reason.
    # 🚨 [B3] 4 COLUMN WRITES vs 3 EMITS IS THE DISCRIMINATOR — the declaration still
    # happens, it just no longer counts. If these two ever read equal, the phantom is back.
    _assert(len(hb.degraded) == 4, f"expected 4 column writes: {hb.degraded}")
    _assert(len(hb.degraded) == len(hb.emits) + 1,
            f"the pre-loop declaration must write the column and emit NOTHING: "
            f"{len(hb.degraded)} column writes vs {len(hb.emits)} emits")
    _assert(all(d == tl.DEGRADED_NO_SIMULATOR for d in hb.degraded), hb.degraded)
    _assert(res["rewards_folded"] == 0, res)
    print(f"  degraded on ALL {len(hb.emits)} emits + {len(hb.degraded)} column writes "
          f"over 3 iterations (declared pre-loop, never counted): PASS")


def _counters(db_path, loop_name):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(
            "SELECT iteration_count, error_count, degraded_reason, last_error "
            "FROM loop_heartbeat WHERE loop_name=?", (loop_name,)).fetchone()
    finally:
        conn.close()


def test_declaration_does_not_count_as_a_run():
    """🚨 [B3] / G5 — THE PRE-LOOP DECLARATION MUST NOT BUMP THE COUNTERS.

    ``run_trainer_loop`` used to ``emit(error=_degraded_error(reason))`` once above the
    ``while``, which bumped ``iteration_count`` AND ``error_count`` having done zero search
    work. It fired once per process start, so **every restart banked another phantom run and
    another phantom error** — and ``apt-daily-upgrade.timer`` restarts TREVOR daemons
    unattended. RECON-TRAINER-003 (A1) reconstructed 44 emits as 3 phantoms + 41 real cycles;
    a 4th landed at the 2026-08-05 restart. The drift was unbounded.

    Two halves, and neither alone is sufficient:
      1. the start-up path issues ZERO emits — by PROGRAM IDENTITY, not by counting SQL;
      2. the program it DOES issue (``_HEARTBEAT_DEGRADED``) provably leaves both counters
         untouched — proven by exec'ing the module's own program text against a real row.

    ⚠️ STATED, NOT HIDDEN: ``last_error`` is NOT written pre-loop any more — it is stamped by
    the first iteration's emit. That is not a healthy-looking window: ``degraded_reason`` is
    on the row from start-up, and ``query_loop_heartbeat.classify`` returns DEGRADED on a
    non-empty reason (step 4) before it ever consults ``last_error`` (step 5)."""
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    os.environ.pop("TRAINER_LOOP_ENABLED", None)

    # ── half 1: a simulated start (max_iterations=0 runs the start-up path and NO loop body)
    res, hb = _run("declaration", backtest_fn=None, iterations=0)

    _assert(res["iterations"] == 0, f"the loop body must not have run: {res}")
    _assert(hb.calls == ["pre_register"], f"pre_register must still fire exactly once: {hb.calls}")
    _assert(hb.emits == [], f"🚨 a DECLARATION must emit NOTHING — it did no work: {hb.emits}")
    _assert(hb.degraded == [tl.DEGRADED_NO_SIMULATOR],
            f"the state must still be declared, via the column: {hb.degraded}")

    # ── half 2: the program it issued, run verbatim against a real row. THROWAWAY loop name —
    # never `trainer_search_loop`, which is live evidence about the running daemon.
    probe = "b3_declaration_probe"
    db = os.path.join(os.path.dirname(os.environ["TRAINER_DB_PATH"]), "b3_declaration.db")
    if os.path.exists(db):
        os.remove(db)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(_REAL_SCHEMA)
        conn.execute(
            "INSERT INTO loop_heartbeat (loop_name, cadence_seconds, last_iteration_at, "
            "iteration_count, error_count, last_error, is_dormant, is_time_based) "
            "VALUES (?, 3600, '2026-01-01T00:00:00+00:00', 7, 2, 'a prior fault', 0, 0)",
            (probe,))
        conn.commit()
    finally:
        conn.close()

    before = _counters(db, probe)
    out = _exec_degraded_program(db, probe, tl.DEGRADED_NO_SIMULATOR)
    _assert(out.get("ok") is True and out.get("updated") == 1, out)
    after = _counters(db, probe)

    _assert(after[0] == before[0] == 7, f"iteration_count must NOT move: {before} -> {after}")
    _assert(after[1] == before[1] == 2, f"error_count must NOT move: {before} -> {after}")
    _assert(after[2] == tl.DEGRADED_NO_SIMULATOR,
            f"the reason must be written: {before} -> {after}")
    _assert(after[3] == "a prior fault",
            f"the declaration must not touch last_error either: {before} -> {after}")
    os.remove(db)
    print(f"  declaration: 0 emits, 1 column write; counters {before[0]}/{before[1]} -> "
          f"{after[0]}/{after[1]} (UNCHANGED) with reason={after[2]!r}: PASS")


def test_positive_control_provider_clears_degraded():
    """🚨 THE LOAD-BEARING CONTROL. With a real simulator the surface must be ABSENT.

    Without this, a fix that never fires at all looks identical to a fix that works."""
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    res, hb = _run("control", backtest_fn=lambda a, l: _survivor(), iterations=3)

    _assert(res["simulating"] is True, res)
    _assert(res["degraded_reason"] is None, res)
    _assert("degraded" not in res, f"a healthy run must carry no degraded prose: {res}")
    _assert(hb.emits == [None, None, None],
            f"a healthy run must emit NO error on any iteration: {hb.emits}")
    _assert(hb.degraded == [None, None, None, None],
            f"the column must be actively CLEARED, pre-loop and each iteration: "
            f"{hb.degraded}")
    _assert(res["rewards_folded"] == 3, f"the control must actually learn: {res}")
    print(f"  positive control: simulating=True, 0/3 degraded emits, column cleared "
          f"{len(hb.degraded)}x, rewards_folded={res['rewards_folded']}: PASS")


def test_unknown_third_state_is_reachable():
    """Requirement 5: UNKNOWN is a real reachable state, not a documented-but-dead branch.

    ``TRAINER_BACKTEST_PROVIDER`` names a provider while this loop holds ``backtest_fn=None``
    — intent and broken wiring are indistinguishable from here, so it is neither True nor
    False. ``_resolve_backtest_fn`` RAISES on an unresolvable spec, so ``main``/
    ``observe_main`` cannot produce this shape; the public ``run_trainer_loop`` seam can."""
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    os.environ["TRAINER_BACKTEST_PROVIDER"] = "some_module:backtest_fn"
    try:
        res, hb = _run("unknown", backtest_fn=None, iterations=2)
    finally:
        os.environ.pop("TRAINER_BACKTEST_PROVIDER", None)

    _assert(res["simulating"] is None,
            f"UNKNOWN must be None — never a default to False: {res}")
    _assert(res["degraded_reason"] == tl.DEGRADED_SIMULATOR_UNKNOWN, res)
    _assert(all(d == tl.DEGRADED_SIMULATOR_UNKNOWN for d in hb.degraded), hb.degraded)
    _assert(all(e and "simulator_unknown" in e for e in hb.emits), hb.emits)
    print(f"  third state reachable: simulating={res['simulating']!r}, "
          f"reason={res['degraded_reason']!r} on all {len(hb.degraded)} writes: PASS")


def test_symmetric_recovery_bad_good_bad():
    """🚨 CAUSE 4, PROVEN HARDEST — a full bad -> good -> bad cycle on the REAL column.

    ``last_error`` is one mutable slot and NOTHING in the codebase ever clears it (measured
    VM-wide), so a degraded string parked there survives a genuine recovery forever. A flag
    that can only turn ON is its own false-success. bad -> good alone would not catch a
    surface that clears once and can never re-arm, so the cycle returns to bad."""
    db = os.path.join(os.path.dirname(os.environ["TRAINER_DB_PATH"]), "b1_hb_cycle.db")
    if os.path.exists(db):
        os.remove(db)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(_REAL_SCHEMA)
        conn.execute(
            "INSERT INTO loop_heartbeat (loop_name, cadence_seconds, last_iteration_at, "
            "iteration_count, error_count, is_dormant, is_time_based) "
            "VALUES ('trainer_search_loop', 3600, '2026-01-01T00:00:00+00:00', 0, 0, 0, 0)")
        conn.commit()
    finally:
        conn.close()

    seen = [("start", _column(db, "trainer_search_loop"))]
    for label, reason in (("bad", tl.DEGRADED_NO_SIMULATOR),
                          ("good", None),
                          ("bad-again", tl.DEGRADED_NO_SIMULATOR)):
        out = _exec_degraded_program(db, "trainer_search_loop", reason)
        _assert(out.get("ok") is True, f"{label}: the real program failed: {out}")
        _assert(out.get("updated") == 1, f"{label}: expected 1 row updated: {out}")
        seen.append((label, _column(db, "trainer_search_loop")))

    _assert([v for _, v in seen] == [None, tl.DEGRADED_NO_SIMULATOR, None,
                                     tl.DEGRADED_NO_SIMULATOR],
            f"the cycle must be NULL -> reason -> NULL -> reason: {seen}")
    print(f"  bad->good->bad on the live column shape: "
          f"{' -> '.join(repr(v) for _, v in seen)}: PASS")


def test_propose_path_is_byte_identical():
    """The propose path (``observe_only=False``) must gain NO degraded surface at all.

    ``_resolve_sim_state`` returns ``(False, None)`` there, so ``_degraded_error`` yields
    ``None``, ``emit(error=err or None)`` collapses to ``emit(error=err)``, and
    ``set_degraded`` is never called. Anything else would change a live-armed path."""
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ.pop("TRAINER_OBSERVE_ONLY_ENABLED", None)
    try:
        res, hb = _run("propose", backtest_fn=None, iterations=2,
                       observe_only=False, level=1)
    finally:
        os.environ.pop("TRAINER_LOOP_ENABLED", None)

    _assert("degraded" not in res and "degraded_reason" not in res,
            f"the propose path must carry no degraded keys: {sorted(res)}")
    _assert("simulating" not in res, f"simulating is observe-only: {sorted(res)}")
    _assert(hb.degraded == [], f"set_degraded must NEVER fire off observe mode: {hb.degraded}")
    _assert(hb.emits == [None, None], f"no error folded into the propose path: {hb.emits}")
    print("  propose path unchanged: no degraded keys, 0 set_degraded calls: PASS")


def test_observe_only_still_cannot_propose():
    """The T1 structural guarantee must be untouched by this change.

    ``observe_only=True`` REPLACES the client with ``ObserveOnlyClient``, which raises on
    every handoff. This asserts the substitution still happens and that the injected
    recording client is never reached."""
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    client = _RecordingClient()
    _fresh_store("cannotpropose")
    hb = _RecordingHeartbeat()
    res = tl.run_trainer_loop(
        level=0, max_iterations=2, observe_only=True, client=client, heartbeat=hb,
        backtest_fn=None, validate_fn=_validate_ok, rng=random.Random(1234),
        sleep_fn=lambda s: None, level_reader=lambda: (0, "ok"))

    _assert(client.calls == [], f"observe mode must reach NO handoff: {client.calls}")
    _assert(res["proposed"] is False and res["promoted"] is False, res)
    for meth in ("submit_proposal", "read_verdict", "surface_candidate"):
        raised = False
        try:
            getattr(tl.ObserveOnlyClient(), meth)()
        except Exception:
            raised = True
        _assert(raised, f"ObserveOnlyClient.{meth} must still raise")
    print("  observe-only refusal intact: 0 handoffs, all 3 ops still raise: PASS")


if __name__ == "__main__":
    print("=== [B1] trainer degraded-state persistence + [B3] phantom-run removal ===")
    failures = []
    cases = (test_degraded_rides_every_iteration,
             test_declaration_does_not_count_as_a_run,
             test_positive_control_provider_clears_degraded,
             test_unknown_third_state_is_reachable,
             test_symmetric_recovery_bad_good_bad,
             test_propose_path_is_byte_identical,
             test_observe_only_still_cannot_propose)
    for t in cases:
        try:
            t()
        except Exception as exc:
            failures.append(f"{t.__name__}: {exc}")
            print(f"  {t.__name__}: FAIL — {exc}")
    total = len(cases)
    print(f"=== {total - len(failures)}/{total} PASS ===")
    raise SystemExit(1 if failures else 0)
