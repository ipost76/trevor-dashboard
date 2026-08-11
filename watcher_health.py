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
from watcher_surface import _plain_join, record_health, run_surface_checks
import watcher_review        # the review-brain MODULE (NOT lib.watcher_integrity_db) — RF2-B4 W6 orchestration
import watcher_integrity     # the integrity MODULE — exact-dotted-component ≠ 'watcher_integrity_db' (denial-1a clean)

logger = logging.getLogger("watcher_health")

# ── the daemon master gate (env, default OFF — auto_config is forbidden here) ─
_TRUTHY = {"1", "true", "yes", "on"}


def is_surfacing_enabled() -> bool:
    """The watcher surfacing daemon master gate. Default OFF ⇒ fully inert."""
    return os.environ.get("WATCHER_SURFACING_ENABLED", "").strip().lower() in _TRUTHY


def is_review_enabled() -> bool:
    """The review cycle's env gate (WATCHER_REVIEW_ENABLED, default OFF). Read HERE at the
    orchestrator so run_cycle's gating is visible in one place — NOT via watcher_review's
    internal review_enabled() (which stays as defense-in-depth). Env only, NEVER auto_config
    (B0 denial 3). Duplicating an env READ is not duplicating logic — it makes the gate visible."""
    return os.environ.get("WATCHER_REVIEW_ENABLED", "").strip().lower() in _TRUTHY


def is_integrity_enabled() -> bool:
    """The integrity cycle's env gate (WATCHER_INTEGRITY_ENABLED, default OFF). Read HERE at
    the orchestrator (NOT via watcher_integrity's PRIVATE _enabled()) so the gate is visible and
    run_cycle is not coupled to a private implementation detail; the callee's own _enabled()
    stays as defense-in-depth. Env only, NEVER auto_config (B0 denial 3)."""
    return os.environ.get("WATCHER_INTEGRITY_ENABLED", "").strip().lower() in _TRUTHY


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
    """The VM RPC, with C4's persistent failure counter wrapped around it.

    🚨 BEHAVIOUR IS UNCHANGED. This is a pass-through: it returns `_vm_python_raw`'s
    dict verbatim, still never raises, and still surfaces transport faults as
    {"ok": False, ...}. The ONLY addition is that the boolean it already produced is
    counted on disk, so a sustained silent outage becomes visible to
    `trevor-liveness-check` (C4 Phase 3). Wrapping rather than editing the returns
    is deliberate — every one of the five return paths is covered, including the
    ones added later.
    """
    return _escalator_count(_vm_python_raw(program, args_json, timeout))


def _vm_python_raw(program: str, args_json: str, timeout: float = _RPC_TIMEOUT) -> Dict[str, Any]:
    """Run a VM-side python program over ssh (as trevor); parse its last JSON line. NEVER
    raises — a transport/parse failure surfaces as ``{"ok": False, "error": ...}`` so a broken
    pipe can't crash the watcher. HOME is set DEFENSIVELY ONLY — ssh resolves ~/.ssh from the
    process UID (getpwuid), NOT $HOME, so a foreign HOME does not break it (RF3T2-B8)."""
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


def _escalator_count(result: Dict[str, Any]) -> Dict[str, Any]:
    """C4 Phase 3 — feed the VM-RPC boolean to the PERSISTENT consecutive-failure
    counter, then return the result UNCHANGED.

    🚨 THIS REMOVES NO NEVER-RAISE CONTRACT. `_vm_python` still returns
    {"ok": False, ...} on every transport fault and still never raises; this only
    COUNTS the boolean it already produced (B3 property 1: count, don't sense).
    The alert decision is NOT made here — `trevor-liveness-check` reads the counter
    and latches, so the watcher stays exactly as quiet as it was designed to be.

    🚨 Swallows every exception ON PURPOSE. A counter that could raise would break
    the very never-raise contract this wave exists to preserve.
    """
    try:
        import vm_escalator  # local import: the watcher must start even if this is absent
        vm_escalator.record_result(
            vm_escalator.SURFACE_WATCHER,
            bool(isinstance(result, dict) and result.get("ok")),
        )
    except Exception:  # noqa: BLE001 - never let bookkeeping break the transport
        pass
    return result


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
    VM heartbeat path / monitor_center is unavailable.

    C4 Phase 3 (A7 §8.7): the row now also carries ``consecutive_vm_failures``, so the
    persistent counter is legible from watcher.db itself and not only from the state
    file. 🚨 This is an ADDITIVE suffix on an existing free-text column — no DDL, no
    schema change, and the row is written exactly as before when the counter is
    unavailable."""
    try:
        import vm_escalator
        st = vm_escalator.evaluate(vm_escalator.SURFACE_WATCHER, latch=False)
        n = st.get("consecutive_failures")
        if n is not None:
            detail = f"{detail} | consecutive_vm_failures={n}"
    except Exception:  # noqa: BLE001 - bookkeeping must never break self-health
        pass
    record_health(watcher_conn, WATCHER_LOOP_NAME, status, detail)


# ═══════════════════════════════════════════════════════════════════════════
# the gated daemon — flag-OFF ⇒ fully inert (no connections, no ssh, no writes)
# ═══════════════════════════════════════════════════════════════════════════
def run_cycle(*, watcher_conn=None, heartbeat: Optional[WatcherHeartbeat] = None,
              surface_fn: Optional[Callable[..., Dict[str, Any]]] = None,
              register: bool = False, vm_run: Optional[Callable[..., Dict[str, Any]]] = None,
              local_run: Optional[Callable[..., Dict[str, Any]]] = None) -> Dict[str, Any]:
    """One gated OVERSIGHT cycle (A2 shape #5 — sequential, NO shared store handle):
    (optionally pre_register) → surface checks (this box's watcher.db) → review cycle (opens its
    OWN watcher.db) → integrity cycle (opens its OWN integrity store) → emit the heartbeat →
    record self-health. Each of the THREE cycles runs in its OWN try/except so one cycle's fault
    is logged and skipped, never propagated (the outer run_watcher_loop catch is preserved). The
    orchestrator passes ONLY scalars/config — NEVER a store handle. Returns a summary.

    🚨 run_integrity_cycle() is called with ZERO ARGUMENTS. A handle would make the integrity
    module read/write the MAIN store at runtime while the AST independence suite stays green (a
    FALSE GREEN). The zero-arg call + tests/test_integrity_zero_arg_gate.py are what prevent it.

    FULLY INERT when WATCHER_SURFACING_ENABLED is OFF: returns immediately WITHOUT opening any
    connection, reading the replica, or touching ssh — byte-identical to pre-B4."""
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

        # ── (1) surface cycle — this box's watcher.db (same store, fine); isolated so a surface
        #        fault cannot skip the review/integrity siblings ──
        checks: Dict[str, Any] = {}
        n_fired = n_unknown = 0
        surface_ok = True
        try:
            results = surface_fn(watcher_conn=watcher_conn, vm_run=vm_run, local_run=local_run)
            checks = results if isinstance(results, dict) else {}
            n_fired = sum(len(r.get("fired", [])) for r in checks.values()
                          if isinstance(r, dict))
            n_unknown = sum(1 for r in checks.values()
                            if isinstance(r, dict) and r.get("status") in ("unknown", "error"))
        except Exception as exc:  # a surface fault must not skip its siblings or kill the cycle
            surface_ok = False
            logger.warning("watcher surface cycle raised (non-fatal): %s", exc)

        # ── (2) review cycle — opens its OWN watcher.db; gated WATCHER_REVIEW_ENABLED; NO conn ──
        n_critiques = 0
        review_ok = True
        if is_review_enabled():
            try:
                review_res = watcher_review.run_review_cycle()  # NO conn arg — own store
                n_critiques = sum(len(review_res[k]) for k in ("verdict", "promotion", "level_change")
                                  if isinstance(review_res.get(k), list))
            except Exception as exc:  # a fragile review-brain fault must not skip integrity
                review_ok = False
                logger.warning("watcher review cycle raised (non-fatal): %s", exc)

        # ── (3) integrity cycle — opens its OWN integrity store; gated WATCHER_INTEGRITY_ENABLED ──
        n_findings = 0
        integrity_ok = True
        if is_integrity_enabled():
            try:
                # 🚨 ZERO ARGUMENTS — never conn=, never a variable that could hold a handle.
                integ_res = watcher_integrity.run_integrity_cycle()
                integ = integ_res.get("integrity") if isinstance(integ_res, dict) else None
                if isinstance(integ, dict) and integ.get("ok") is False:
                    n_findings = 1  # the integrity evaluation surfaced a not-ok finding this cycle
            except Exception as exc:  # an integrity fault must not kill the cycle or the daemon
                integrity_ok = False
                logger.warning("watcher integrity cycle raised (non-fatal): %s", exc)

        emitted = heartbeat.emit()
        status = "ok" if (emitted and surface_ok and review_ok and integrity_ok) else "degraded"
        # 🚨 USER-FACING COPY (RM-HUB-CLEAN B2) — the Hub's WATCHER tab renders this
        # detail verbatim. Name the counts in words; never a raw log line.
        _parts = []
        if n_fired:
            _parts.append(f"found {n_fired} problem{'' if n_fired == 1 else 's'}")
        if n_unknown:
            _parts.append(f"couldn't complete {n_unknown} check{'' if n_unknown == 1 else 's'}")
        if n_critiques:
            _parts.append(f"raised {n_critiques} comment{'' if n_critiques == 1 else 's'} "
                          "on the trainer")
        if n_findings:
            _parts.append(f"flagged {n_findings} integrity "
                          f"{'issue' if n_findings == 1 else 'issues'}")
        if not _parts:
            _detail = "Last check found nothing wrong."
        else:
            _detail = "Last check " + _plain_join(_parts) + "."
        if not surface_ok:
            _detail += " Some checks could not run."
        if not emitted:
            _detail += " The watcher could not record that it ran."
        record_self_health(watcher_conn, status, _detail)
        return {"enabled": True, "checks": checks, "heartbeat_emitted": emitted,
                "surfaced": n_fired, "unknown_checks": n_unknown,
                "critiques": n_critiques, "integrity_findings": n_findings}
    finally:
        if own_conn:
            watcher_conn.close()


def run_watcher_loop(*, interval_seconds: Optional[int] = None, max_cycles: Optional[int] = None,
                     sleep_fn: Callable[[float], None] = time.sleep,
                     heartbeat: Optional[WatcherHeartbeat] = None,
                     surface_fn: Optional[Callable[..., Dict[str, Any]]] = None,
                     vm_run: Optional[Callable[..., Dict[str, Any]]] = None,
                     local_run: Optional[Callable[..., Dict[str, Any]]] = None,
                     watcher_conn=None) -> Dict[str, Any]:
    """The continuous surfacing daemon (explicit entrypoint — NEVER auto-started on import).
    Pre-registers the heartbeat once, then runs a gated cycle every ``interval_seconds`` (default
    the heartbeat cadence). ``max_cycles`` bounds it (tests). FULLY INERT if the flag is OFF.

    ``watcher_conn`` is an OPTIONAL caller-owned store handle threaded straight through to
    run_cycle. Default None ⇒ each cycle opens (and closes) its own via get_connection(), so the
    production path through main() is byte-identical to before this parameter existed. It exists
    so a TEST can hand in a scratch store: without it, run_cycle fell through to get_connection()
    → resolve_db_path() → the REAL data/watcher.db, and every suite run stamped a fresh
    ``watcher_loop`` self-health row into the live store — which then re-badged the whole WATCHER
    tab as "updated 1h ago" while every real detection was 8 days old. Injecting the surface and
    the heartbeat was not enough; the STORE has to be injectable too."""
    if not is_surfacing_enabled():
        logger.info("WATCHER_SURFACING_ENABLED off — watcher daemon inert, not starting.")
        return {"enabled": False, "cycles": 0}
    heartbeat = heartbeat or WatcherHeartbeat()
    interval = int(interval_seconds or heartbeat.cadence_seconds)
    heartbeat.pre_register()
    cycles = 0
    while max_cycles is None or cycles < max_cycles:
        try:
            run_cycle(watcher_conn=watcher_conn, heartbeat=heartbeat, surface_fn=surface_fn,
                      vm_run=vm_run, local_run=local_run)
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
