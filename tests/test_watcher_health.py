#!/usr/bin/env python3
"""Tests for R10-B3 watcher_health.py — W7 self-health + the daemon gate.

Dependency-free (``python3 tests/test_watcher_health.py``, pytest-compatible). The VM ssh
pipe is injected as a fake (a tiny in-memory loop_heartbeat that applies the real INSERT…ON
CONFLICT / UPDATE SQL), so every proof is deterministic and touches neither the VM nor the
live replica.

Phase 3 gate coverage:
  * pre_register creates the watcher_loop row ONCE and is idempotent on a second run.
  * emit NEVER raises on a broken transport (injected raiser AND the real ssh pipe to a
    non-resolving host) — logs and continues.
  * watcher_loop is NOT in REMOVED_LOOPS (else the stall detector would ignore it).
  * the local watcher_health mirror records each internal check's status + the watcher's own
    self-health row — visible from watcher.db without monitor_center.
  * WATCHER_SURFACING_ENABLED off ⇒ FULLY INERT: run_cycle / run_watcher_loop do not open a
    connection, call ssh, run checks, or emit a heartbeat.
"""
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import watcher_health as wh  # noqa: E402
import watcher_surface as ws  # noqa: E402
from lib.watcher_db import get_connection  # noqa: E402

_TMPFILES = []


def _watcher():
    tmp = tempfile.NamedTemporaryFile(suffix=".watcher.db", delete=False)
    tmp.close()
    _TMPFILES.append(tmp.name)
    return get_connection(db_path=tmp.name)


class _FakeVM:
    """A fake VM heartbeat store — applies the REAL INSERT…ON CONFLICT (pre_register) and
    UPDATE (emit) semantics against an in-memory loop_heartbeat, so idempotency is genuinely
    exercised rather than mocked-as-True."""

    def __init__(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute(
            "CREATE TABLE loop_heartbeat (loop_name TEXT PRIMARY KEY, cadence_seconds INT, "
            "last_iteration_at TEXT, iteration_count INT DEFAULT 0, error_count INT DEFAULT 0, "
            "is_dormant INT DEFAULT 1, is_time_based INT DEFAULT 0)")
        self.calls = []

    def emit_fn(self, program, args_json):
        import json
        args = json.loads(args_json)
        name = args.get("loop_name")
        self.calls.append(("pre_register" if "ON CONFLICT" in program else "emit", args))
        if "ON CONFLICT" in program:  # pre_register program
            self.conn.execute(
                "INSERT INTO loop_heartbeat (loop_name, cadence_seconds, last_iteration_at, "
                "iteration_count, error_count, is_dormant, is_time_based) "
                "VALUES (?, ?, '2026-07-22 00:00:00', 0, 0, 0, 0) "
                "ON CONFLICT(loop_name) DO UPDATE SET "
                "cadence_seconds=excluded.cadence_seconds, is_dormant=0",
                (name, int(args.get("cadence_seconds", 900))))
        else:  # emit program — UPDATE only (won't create the row)
            self.conn.execute(
                "UPDATE loop_heartbeat SET last_iteration_at='2026-07-22 01:00:00' WHERE loop_name=?",
                (name,))
        self.conn.commit()
        return {"ok": True, "loop_name": name}


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ── pre_register idempotency + is_dormant=0 ──────────────────────────────────
def test_pre_register_creates_once_idempotent():
    vm = _FakeVM()
    hb = wh.WatcherHeartbeat(emit_fn=vm.emit_fn)
    _assert(hb.pre_register() is True, "first pre_register should succeed")
    _assert(hb.pre_register() is True, "second pre_register should be idempotent-true")
    rows = vm.conn.execute("SELECT loop_name, cadence_seconds, is_dormant FROM loop_heartbeat").fetchall()
    _assert(rows == [("watcher_loop", 900, 0)], f"one active watcher_loop row: {rows}")
    print("  pre_register creates the watcher_loop row ONCE, idempotent, is_dormant=0: PASS")


def test_emit_updates_and_never_raises_on_broken_transport():
    vm = _FakeVM()
    hb = wh.WatcherHeartbeat(emit_fn=vm.emit_fn)
    hb.pre_register()
    _assert(hb.emit() is True, "emit over a working transport returns True")
    last = vm.conn.execute("SELECT last_iteration_at FROM loop_heartbeat").fetchone()[0]
    _assert(last == "2026-07-22 01:00:00", "emit must UPDATE the timestamp")

    # (a) an injected transport that RAISES → emit + pre_register must swallow it (never raise)
    def raiser(_prog, _args):
        raise RuntimeError("transport exploded")

    hb_bad = wh.WatcherHeartbeat(emit_fn=raiser)
    _assert(hb_bad.emit() is False and hb_bad.pre_register() is False,
            "a raising transport must be swallowed → False, never propagate")

    # (b) the REAL ssh pipe to a non-resolving host → surfaces ok=False, never raises
    orig_host = wh._VM_HOST
    wh._VM_HOST = "watcher-nonexistent-host.invalid"
    try:
        res = wh._vm_python("import sys", "{}", timeout=8)
        _assert(isinstance(res, dict) and res.get("ok") is False,
                f"real transport to a dead host must return ok=False, not raise: {res}")
    finally:
        wh._VM_HOST = orig_host
    print("  emit UPDATEs + NEVER raises on a broken transport (raiser AND real dead host): PASS")


def test_watcher_loop_not_in_removed_loops():
    _assert(wh.WATCHER_LOOP_NAME == "watcher_loop", "loop name")
    _assert(wh.WATCHER_LOOP_NAME not in ws._REMOVED_LOOPS_FALLBACK,
            "watcher_loop must NOT be in REMOVED_LOOPS (else the stall detector ignores it)")
    _assert(max(3600, wh.WATCHER_CADENCE_SECONDS * 2) == 3600,
            "cadence 900s → stale_threshold max(3600,1800) = 1h")
    print("  watcher_loop not in REMOVED_LOOPS; cadence 900s → 1h stale threshold: PASS")


# ── the gated cycle: mirror + self-health, flag-on ───────────────────────────
def test_run_cycle_mirrors_checks_and_self_health():
    os.environ["WATCHER_SURFACING_ENABLED"] = "1"
    try:
        w = _watcher()
        vm = _FakeVM()
        hb = wh.WatcherHeartbeat(emit_fn=vm.emit_fn)

        def fake_surface(*, watcher_conn, vm_run=None, local_run=None):
            _ = (vm_run, local_run)
            ws.record_health(watcher_conn, "loop_freshness", "ok", "0 stale")
            ws.record_health(watcher_conn, "critical_units", "degraded", "1 dead daemon")
            return {"loop_freshness": {"status": "ok", "fired": []},
                    "critical_units": {"status": "ok", "fired": ["trevor-observatory.service"]}}

        res = wh.run_cycle(watcher_conn=w, heartbeat=hb, surface_fn=fake_surface, register=True)
        _assert(res["enabled"] is True and res["heartbeat_emitted"] is True, f"cycle summary: {res}")
        _assert(res["surfaced"] == 1, f"one malfunction surfaced this cycle: {res}")
        rows = {r[0]: r[1] for r in w.execute("SELECT check_name, status FROM watcher_health").fetchall()}
        _assert(rows.get("loop_freshness") == "ok", "check status mirrored")
        _assert(rows.get("critical_units") == "degraded", "check status mirrored")
        _assert("watcher_loop" in rows, "the watcher's OWN self-health row must be recorded")
        # pre_register created the watcher_loop row on the (fake) VM, is_dormant=0
        dorm = vm.conn.execute(
            "SELECT is_dormant FROM loop_heartbeat WHERE loop_name='watcher_loop'").fetchone()[0]
        _assert(dorm == 0, "register=True must pre-register the VM heartbeat active")
        print("  run_cycle mirrors each check + the watcher's self-health, emits + registers: PASS")
    finally:
        os.environ.pop("WATCHER_SURFACING_ENABLED", None)


def test_run_watcher_loop_bounded_flag_on():
    os.environ["WATCHER_SURFACING_ENABLED"] = "1"
    try:
        vm = _FakeVM()
        hb = wh.WatcherHeartbeat(emit_fn=vm.emit_fn)
        slept = []

        def fake_surface(*, watcher_conn, vm_run=None, local_run=None):
            _ = (watcher_conn, vm_run, local_run)
            return {}

        # 🚨 THE STORE IS INJECTED, exactly like the surface and the heartbeat. Without this the
        # loop falls through to get_connection() -> resolve_db_path() -> the REAL
        # <repo>/data/watcher.db, and every suite run stamps a live `watcher_loop` row that
        # re-badges the whole WATCHER tab as fresh. A test must never write a production store.
        w = _watcher()

        res = wh.run_watcher_loop(max_cycles=3, sleep_fn=lambda s: slept.append(s),
                                  heartbeat=hb, surface_fn=fake_surface, watcher_conn=w)
        _assert(res == {"enabled": True, "cycles": 3}, f"bounded loop ran 3 cycles: {res}")
        pre = [c for c in vm.calls if c[0] == "pre_register"]
        _assert(len(pre) == 1, f"pre_register exactly once for the daemon lifetime: {vm.calls}")
        _assert(len(slept) == 2, "sleeps between cycles (3 cycles → 2 sleeps)")

        # POSITIVE control — the self-health row landed in the SCRATCH store, proving the handle
        # was honoured rather than silently ignored (an ignored kwarg would leave this empty and
        # write the live store instead).
        rows = w.execute(
            "SELECT check_name FROM watcher_health WHERE check_name = ?", (wh.WATCHER_LOOP_NAME,)
        ).fetchall()
        _assert(len(rows) == 1,
                f"self-health row must land in the INJECTED store, not the live one: {rows}")
        w.close()
        print("  run_watcher_loop (flag on) bounded: 3 cycles, ONE pre_register, sleeps between, "
              "self-health row in the INJECTED store: PASS")
    finally:
        os.environ.pop("WATCHER_SURFACING_ENABLED", None)


# ── flag OFF ⇒ fully inert ───────────────────────────────────────────────────
def test_flag_off_is_fully_inert():
    os.environ.pop("WATCHER_SURFACING_ENABLED", None)

    def boom_surface(**_kw):
        raise AssertionError("surface_fn must NOT be called while the flag is off")

    class _BoomHB:
        def emit(self, error=None):
            raise AssertionError("emit must NOT be called while off")

        def pre_register(self):
            raise AssertionError("pre_register must NOT be called while off")

    r1 = wh.run_cycle(surface_fn=boom_surface, heartbeat=_BoomHB(), register=True)
    _assert(r1 == {"enabled": False}, f"run_cycle must be inert when off: {r1}")
    r2 = wh.run_watcher_loop(surface_fn=boom_surface, heartbeat=_BoomHB(), max_cycles=5,
                             sleep_fn=lambda s: (_ for _ in ()).throw(AssertionError("no sleep")))
    _assert(r2 == {"enabled": False, "cycles": 0}, f"run_watcher_loop must be inert when off: {r2}")
    # various truthy/falsey env values
    for val, want in [("", False), ("0", False), ("false", False), ("no", False),
                      ("1", True), ("true", True), ("YES", True), ("On", True)]:
        os.environ["WATCHER_SURFACING_ENABLED"] = val
        _assert(wh.is_surfacing_enabled() is want, f"flag '{val}' → {want}")
    os.environ.pop("WATCHER_SURFACING_ENABLED", None)
    print("  flag OFF ⇒ fully inert (no surface, no heartbeat, no pre_register, no sleep): PASS")


_TESTS = [
    test_pre_register_creates_once_idempotent,
    test_emit_updates_and_never_raises_on_broken_transport,
    test_watcher_loop_not_in_removed_loops,
    test_run_cycle_mirrors_checks_and_self_health,
    test_run_watcher_loop_bounded_flag_on,
    test_flag_off_is_fully_inert,
]


def _cleanup():
    for p in _TMPFILES:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(p + suffix)
            except OSError:
                pass


if __name__ == "__main__":
    print("=== watcher_health tests (R10-B3) ===")
    try:
        for t in _TESTS:
            t()
    finally:
        _cleanup()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
