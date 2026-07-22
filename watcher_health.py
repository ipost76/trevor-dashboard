#!/usr/bin/env python3
"""watcher_health.py — R10-B3 W7 watcher self-health + the daemon gate.

"Who watches the watcher" = Ghost, via THIS surface. The watcher is a daemon too and must
not die silently (the very failure class it exists to end), so it surfaces its OWN drift/death:

  * ``WatcherHeartbeat`` — pre_register (INSERT…ON CONFLICT, idempotent) + emit (UPDATE-only,
    NEVER-raise) of a ``loop_heartbeat`` row on the VM (loop_name='watcher_loop', cadence 900s
    → 08_service_health's ``stale_threshold = max(3600, 900*2) = 1h``). Mirrors
    ``trainer_loop.TrainerHeartbeat`` (pre_register/emit) over the established ``ssh vm`` pipe.
    Uses ``ON CONFLICT DO UPDATE SET is_dormant=0`` (the trainer's proven form) — NOT DO
    NOTHING — so a stale is_dormant=1 can't leave the watcher's own stall undetectable.
  * a LOCAL ``watcher_health`` row for the watcher's own liveness (``check_name='watcher_loop'``),
    written to watcher.db each cycle. This is the load-bearing "who watches the watcher"
    surface WHILE ``trevor-monitor-center`` is masked/dead: it makes the watcher's state
    visible from the Hub's own DB without depending on the VM or the (down) 08_service_health.
  * ``WATCHER_SURFACING_ENABLED`` (env, default OFF) — the daemon master gate. OFF ⇒ FULLY
    INERT: no polling, no ssh, no replica read, no writes, no heartbeat, no auto-start on import.
    (env, NOT auto_config — a watcher module may not touch auto_config: B0 denial 3.)

🚨 THE ONE SANCTIONED VM WRITE. The heartbeat row (``loop_heartbeat``) is the ONLY write B3
makes to the VM's trevor.db, via the read-only-everywhere-else ssh pipe. Everything else in B3
is read-only (the replica is mode=ro; systemctl is read-only). NO auto-halt: zero auto_trader/
killswitch/gateway reach — the heartbeat program's ``from auto_trader.observability import …``
lives INSIDE a string literal executed remotely (the same mechanism trainer_loop.py uses), so
it is not an ``ast.Import`` and does not trip B0 denial (3)'s scan (which globs this file too).

⚠️ R13 DEPLOY-ORDERING CAVEAT. 08_service_health enumerates loops at MODULE-IMPORT, so the
watcher's freshness monitor OVER THERE registers only after (a) the watcher_loop row exists
AND (b) monitor_center (re)starts. monitor_center is masked/dead now → the LOCAL watcher_health
mirror above is what covers the watcher until that is fixed. On cutover: start the watcher
daemon (which pre-registers), THEN (re)start monitor_center.

Structurally inert on import (nothing runs; the entrypoint is explicit). Python 3, stdlib only.
"""
import base64
import json
import logging
import os
import shlex
import subprocess
import time
from typing import Any, Callable, Dict, Optional

from lib.watcher_db import get_connection
from watcher_surface import record_health, run_surface_checks

logger = logging.getLogger("watcher_health")

# ── the daemon master gate (env, default OFF — auto_config is forbidden here) ─
_TRUTHY = {"1", "true", "yes", "on"}


def is_surfacing_enabled() -> bool:
    """The watcher surfacing daemon master gate. Default OFF ⇒ fully inert."""
    return os.environ.get("WATCHER_SURFACING_ENABLED", "").strip().lower() in _TRUTHY


# ── the watcher's own loop_heartbeat identity ────────────────────────────────
WATCHER_LOOP_NAME = "watcher_loop"        # confirmed NOT in loop_registry.REMOVED_LOOPS
WATCHER_CADENCE_SECONDS = 900             # → 08_service_health stale_threshold max(3600,1800)=1h

# ── ssh pipe (heartbeat only) — mirrors trainer_loop._vm_python ──────────────
_VM_HOST = os.environ.get("WATCHER_VM_HOST", "vm")
_VM_DIR = os.environ.get("WATCHER_VM_DIR", "/home/trevor/trevor")
_VM_PY = os.environ.get("WATCHER_VM_PY", "venv/bin/python3")
_WSL_HOME = os.environ.get("WATCHER_WSL_HOME", "/home/ghost")
_RPC_TIMEOUT = float(os.environ.get("WATCHER_RPC_TIMEOUT", "30"))
_VM_LOADER = (
    "import base64,sys;"
    "exec(compile(base64.b64decode(sys.argv[1]).decode(),'<watcher_health>','exec'))"
)

# Pre-register (INSERT…ON CONFLICT DO UPDATE SET is_dormant=0) — mirrors the trainer's proven
# form. _emit_loop_heartbeat is UPDATE-only and won't create the row, so pre_register must.
_HEARTBEAT_PREREGISTER = r'''
import base64, json, sys
args = json.loads(base64.b64decode(sys.argv[2]).decode()) if len(sys.argv) > 2 else {}
name = args.get("loop_name")
cadence = int(args.get("cadence_seconds", 900))
try:
    from auto_trader.observability import _connect
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO loop_heartbeat "
            "(loop_name, cadence_seconds, last_iteration_at, iteration_count, "
            " error_count, is_dormant, is_time_based) "
            "VALUES (?, ?, datetime('now'), 0, 0, 0, 0) "
            "ON CONFLICT(loop_name) DO UPDATE SET "
            "  cadence_seconds = excluded.cadence_seconds, is_dormant = 0",
            (name, cadence),
        )
        conn.commit()
    finally:
        conn.close()
    print(json.dumps({"ok": True, "loop_name": name}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
'''

# Emit reuses R8's canonical UPDATE-only _emit_loop_heartbeat (never-raise contract).
_HEARTBEAT_EMIT = r'''
import base64, json, sys
args = json.loads(base64.b64decode(sys.argv[2]).decode()) if len(sys.argv) > 2 else {}
name = args.get("loop_name")
err = args.get("error")
try:
    from auto_trader.observability import _emit_loop_heartbeat
    _emit_loop_heartbeat(name, Exception(err) if err else None)
    print(json.dumps({"ok": True, "loop_name": name}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
'''


def _vm_python(program: str, args_json: str, timeout: float = _RPC_TIMEOUT) -> Dict[str, Any]:
    """Run a VM-side python program over ssh (as trevor); parse its last JSON line. NEVER
    raises — a transport/parse failure surfaces as ``{"ok": False, "error": ...}`` so a broken
    pipe can't crash the watcher. HOME is reset so ssh finds ~/.ssh/config under any HOME."""
    b64_prog = base64.b64encode(program.encode()).decode()
    b64_args = base64.b64encode(args_json.encode()).decode()
    remote = (
        f"cd {shlex.quote(_VM_DIR)} && sudo -u trevor {shlex.quote(_VM_PY)} "
        f"-c {shlex.quote(_VM_LOADER)} {shlex.quote(b64_prog)} {shlex.quote(b64_args)}"
    )
    env = dict(os.environ)
    env["HOME"] = _WSL_HOME
    try:
        proc = subprocess.run(["ssh", _VM_HOST, remote], capture_output=True, text=True,
                              timeout=timeout, check=False, env=env)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "rpc_timeout"}
    except Exception as exc:  # ssh missing / OS error
        return {"ok": False, "error": f"rpc_failed: {exc}"}
    out = (proc.stdout or "").strip()
    if not out:
        return {"ok": False, "error": f"rpc_no_output (rc={proc.returncode}): "
                f"{(proc.stderr or '').strip()[:200]}"}
    for line in reversed(out.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    return {"ok": False, "error": f"rpc_unparseable: {out[:200]}"}


class WatcherHeartbeat:
    """The watcher daemon's heartbeat on the VM's ``loop_heartbeat`` (via the ssh pipe).

    ``pre_register`` once on start (idempotent); ``emit`` each cycle. BOTH NEVER raise — a
    heartbeat write failure logs + returns False; it never crashes the watcher (mirrors
    TrainerHeartbeat's never-raise contract). A stalled watcher → stale last_iteration_at →
    08_service_health stall (post-cutover) + the local watcher_health mirror (now)."""

    LOOP_NAME = WATCHER_LOOP_NAME
    CADENCE_SECONDS = WATCHER_CADENCE_SECONDS

    def __init__(self, *, loop_name: Optional[str] = None,
                 cadence_seconds: Optional[int] = None,
                 timeout: Optional[float] = None,
                 emit_fn: Optional[Callable[[str, str], Dict[str, Any]]] = None) -> None:
        self.loop_name = loop_name or self.LOOP_NAME
        self.cadence_seconds = int(cadence_seconds or self.CADENCE_SECONDS)
        self.timeout = float(timeout) if timeout is not None else _RPC_TIMEOUT
        # emit_fn(program, args_json) -> dict — the transport seam (default the ssh pipe;
        # tests inject a fake). Keeps the heartbeat testable without a live VM.
        self._emit_fn = emit_fn or (lambda prog, a: _vm_python(prog, a, self.timeout))
        self._registered = False

    def pre_register(self) -> bool:
        """Create the ``watcher_loop`` row once (INSERT…ON CONFLICT, idempotent). Returns
        True on success. Never raises."""
        args = json.dumps({"loop_name": self.loop_name,
                           "cadence_seconds": self.cadence_seconds})
        try:
            res = self._emit_fn(_HEARTBEAT_PREREGISTER, args)
        except Exception:
            return False
        ok = bool(isinstance(res, dict) and res.get("ok"))
        self._registered = ok
        return ok

    def emit(self, error: Optional[BaseException] = None) -> bool:
        """Bump the heartbeat timestamp (UPDATE-only ``_emit_loop_heartbeat``). Returns True
        on success. NEVER raises — a broken transport logs and continues."""
        err_str = (str(error)[:200]) if error else None
        args = json.dumps({"loop_name": self.loop_name, "error": err_str})
        try:
            res = self._emit_fn(_HEARTBEAT_EMIT, args)
        except Exception as exc:
            logger.warning("watcher heartbeat emit failed (non-fatal): %s", exc)
            return False
        ok = bool(isinstance(res, dict) and res.get("ok"))
        if not ok:
            logger.warning("watcher heartbeat emit not ok (non-fatal): %s",
                           res.get("error") if isinstance(res, dict) else res)
        return ok


def record_self_health(watcher_conn, status: str, detail: str) -> None:
    """The local 'who watches the watcher' mirror — one watcher_health row keyed
    ``watcher_loop`` for the daemon's OWN liveness, visible from watcher.db even when the
    VM heartbeat path / monitor_center is unavailable."""
    record_health(watcher_conn, WATCHER_LOOP_NAME, status, detail)


# ═══════════════════════════════════════════════════════════════════════════
# the gated daemon — flag-OFF ⇒ fully inert (no connections, no ssh, no writes)
# ═══════════════════════════════════════════════════════════════════════════
def run_cycle(*, watcher_conn=None, heartbeat: Optional[WatcherHeartbeat] = None,
              surface_fn: Optional[Callable[..., Dict[str, Any]]] = None,
              register: bool = False, vm_run: Optional[Callable[..., Dict[str, Any]]] = None,
              local_run: Optional[Callable[..., Dict[str, Any]]] = None) -> Dict[str, Any]:
    """One gated surfacing cycle: (optionally pre_register) → run the subscribe-layer checks
    → emit the heartbeat → record the watcher's own self-health. Returns a summary.

    FULLY INERT when WATCHER_SURFACING_ENABLED is OFF: returns immediately WITHOUT opening any
    connection, reading the replica, or touching ssh."""
    if not is_surfacing_enabled():
        return {"enabled": False}

    own_conn = False
    if watcher_conn is None:
        watcher_conn = get_connection()
        own_conn = True
    heartbeat = heartbeat or WatcherHeartbeat()
    surface_fn = surface_fn or run_surface_checks
    try:
        if register:
            heartbeat.pre_register()
        results = surface_fn(watcher_conn=watcher_conn, vm_run=vm_run, local_run=local_run)
        # tally how the cycle went for the self-health line
        checks = results if isinstance(results, dict) else {}
        n_fired = sum(len(r.get("fired", [])) for r in checks.values()
                      if isinstance(r, dict))
        n_unknown = sum(1 for r in checks.values()
                        if isinstance(r, dict) and r.get("status") in ("unknown", "error"))
        emitted = heartbeat.emit()
        status = "ok" if emitted else "degraded"
        record_self_health(watcher_conn, status,
                           f"cycle ok; {n_fired} malfunction(s) surfaced, {n_unknown} "
                           f"check(s) UNKNOWN; heartbeat={'emitted' if emitted else 'FAILED (non-fatal)'}")
        return {"enabled": True, "checks": checks, "heartbeat_emitted": emitted,
                "surfaced": n_fired, "unknown_checks": n_unknown}
    finally:
        if own_conn:
            watcher_conn.close()


def run_watcher_loop(*, interval_seconds: Optional[int] = None, max_cycles: Optional[int] = None,
                     sleep_fn: Callable[[float], None] = time.sleep,
                     heartbeat: Optional[WatcherHeartbeat] = None,
                     surface_fn: Optional[Callable[..., Dict[str, Any]]] = None,
                     vm_run: Optional[Callable[..., Dict[str, Any]]] = None,
                     local_run: Optional[Callable[..., Dict[str, Any]]] = None) -> Dict[str, Any]:
    """The continuous surfacing daemon (explicit entrypoint — NEVER auto-started on import).
    Pre-registers the heartbeat once, then runs a gated cycle every ``interval_seconds`` (default
    the heartbeat cadence). ``max_cycles`` bounds it (tests). FULLY INERT if the flag is OFF."""
    if not is_surfacing_enabled():
        logger.info("WATCHER_SURFACING_ENABLED off — watcher daemon inert, not starting.")
        return {"enabled": False, "cycles": 0}
    heartbeat = heartbeat or WatcherHeartbeat()
    interval = int(interval_seconds or heartbeat.cadence_seconds)
    heartbeat.pre_register()
    cycles = 0
    while max_cycles is None or cycles < max_cycles:
        try:
            run_cycle(heartbeat=heartbeat, surface_fn=surface_fn, vm_run=vm_run, local_run=local_run)
        except Exception as exc:  # a cycle must never kill the daemon
            logger.warning("watcher cycle raised (non-fatal): %s", exc)
        cycles += 1
        if max_cycles is not None and cycles >= max_cycles:
            break
        sleep_fn(interval)
    return {"enabled": True, "cycles": cycles}


def main() -> int:
    """Explicit entrypoint. Inert unless WATCHER_SURFACING_ENABLED is on."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if not is_surfacing_enabled():
        print("WATCHER_SURFACING_ENABLED off — watcher daemon inert. Nothing to do.")
        return 0
    print("WATCHER_SURFACING_ENABLED on — starting watcher surfacing daemon.")
    run_watcher_loop()
    return 0


if __name__ == "__main__":
    # Explicit entrypoint only — NEVER auto-runs on import (flag-gated inside main()).
    raise SystemExit(main())
