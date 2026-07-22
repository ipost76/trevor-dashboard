#!/usr/bin/env python3
"""watcher_surface.py — R10-B3 the surface-don't-swallow layer + malfunction router.

The watcher's antidote to the silent failures that nearly killed this project's
infra (v4: the Observatory died silently, the HMM went stale silently, for weeks).
This module SUBSCRIBES to the confirmed-live health signals each cycle and FIRES a
``watcher_errors`` row for each malfunction it finds — closing the "the data exists
but nothing alerts" gap A1 proved live on the box (``auto_trader_monitor_loop`` has
been ``is_dormant=0`` yet un-beating for days, and no alert fires).

It NEVER trades, NEVER auto-halts, and writes ``trevor.db`` NOWHERE (the only sanctioned
VM write is W7's OWN heartbeat row, which lives in ``watcher_health.py`` — this module
touches trevor.db read-only). Every check funnels through ``route_malfunction`` into
``watcher_errors`` (a NEW, WSL-local table via ``from lib.watcher_db import get_connection``).

  ┌ the five subscribe-layer checks (each edge-triggered, surface-once-until-resolved) ┐
  * check_loop_freshness  — class (b): ``loop_heartbeat`` rows (is_dormant=0, not in
                            REMOVED_LOOPS) stale beyond ``max(3600, cadence*2)`` — the
                            production formula. Reads the replica DIRECTLY, never via
                            08_service_health (which is itself down — monitor_center is
                            masked; check_critical_units surfaces THAT as its own finding).
  * check_stuck_testing   — ``shadow_lifecycle`` rows in a TESTING state older than 24h.
                            Absent table / 0 rows = EXPECTED pre-cutover (never a fault).
  * check_alerting_canary — class (c) swallowed-exception detector, the HMM-DIVERGENCE
                            form (Ghost-locked): a blanket ">4h silence" canary is an
                            alert-fatigue bug (``observability_alerts`` is event-driven,
                            normal gaps to 77h). Instead: HMM inference stale AND the
                            ``hmm_stale`` alerter produced nothing — the precise
                            downstream-silence a swallowed except causes (A1: 0 hmm_stale
                            rows despite a stale HMM).
  * check_critical_units  — class (a): the critical DAEMONS not ``active`` (masked /
                            inactive / failed / dead). Includes monitor_center itself.
  * check_cron_liveness   — class (d): FAILED ``trevor-*`` scheduled jobs (VM + WSL) —
                            e.g. the live ``trevor-regime-transitions.service`` failed run.

MALFUNCTION vs PERFORMANCE (W8): a bug routes here; normal performance NEVER does. A
losing trade / drawdown / rejected candidate / empty pre-cutover stream has NO path to
``watcher_errors`` — no check reads trade outcomes, and ``route_malfunction`` refuses any
source outside the infra-malfunction allowlist. NO AUTO-HALT: pause is always Ghost's Hub
button; this module has zero auto_trader/killswitch/gateway reach (B0 denial 3, enforced
by the globbed ``tests/test_watcher_independence.py`` which auto-scans this file).

Structurally inert on import — nothing runs until a cycle is invoked, and the daemon that
invokes it is gated OFF by default (``WATCHER_SURFACING_ENABLED`` in watcher_health.py).
Reads: the litestream replica (mode=ro, WSL-local) + read-only ``ssh vm`` systemctl.
Python 3, stdlib only.
"""
import json
import os
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional

from lib.watcher_db import get_connection, utc_now

# ── read sources (all read-only) ────────────────────────────────────────────
# The 0444 WSL litestream replica (~20–30 min lag). Read mode=ro ONLY — the watcher
# NEVER writes trevor.db (the one heartbeat write lives in watcher_health.py, VM-side).
_REPLICA_PATH = os.environ.get("WATCHER_REPLICA_PATH", "/home/ghost/trevor-replica/trevor.db")
_REPLICA_TIMEOUT = 15
# read-only ssh pipe to the VM (systemctl state). HOME is reset so ssh finds ~/.ssh/config
# even if the process was spawned with a foreign HOME (e.g. via runPython's HOME=/home/trevor).
_VM_HOST = os.environ.get("WATCHER_VM_HOST", "vm")
_WSL_HOME = os.environ.get("WATCHER_WSL_HOME", "/home/ghost")
_VM_TIMEOUT = float(os.environ.get("WATCHER_VM_TIMEOUT", "20"))
_LOCAL_TIMEOUT = float(os.environ.get("WATCHER_LOCAL_TIMEOUT", "10"))

# ── thresholds (design/threshold calls — see the wave summary) ───────────────
_STALE_FLOOR = 3600            # the max(3600, cadence*2) floor — the PRODUCTION formula
_STUCK_TESTING_SECONDS = 86400  # mirror shadow_lifecycle.stuck_testing(86400s)
_HMM_STALE_SECONDS = 21600      # 6h — HMM inference logs every scan cycle when active;
#                                 6h is well above a scan gap, far below the live ~8-day reality.

# The critical DAEMONS that must run continuously (class a). A timer-backed oneshot
# (e.g. trevor-regime-transitions) is INTENTIONALLY not here — between runs it is
# legitimately 'inactive'; only a FAILED run is a fault, caught by check_cron_liveness.
# monitor_center is included on purpose: it is masked/dead now, and the watcher reads the
# underlying signals directly rather than trusting the monitor — surfacing the monitor's
# own death as a finding (the "irony" A1 called out).
CRITICAL_DAEMONS = (
    "trevor.service",
    "trevor-monitor-center.service",
    "trevor-observatory.service",
)

# Mirror of loop_registry.REMOVED_LOOPS (VM) — a belt-and-suspenders ignore-set OVER the
# is_dormant filter (all 9 are is_dormant=1). fetch_removed_loops() refreshes it from the
# VM source of truth per cycle; this is the fallback if that ssh read fails. Re-sync if
# loop_registry.py changes and the VM read is unavailable.
_REMOVED_LOOPS_FALLBACK = frozenset({
    "auto_trader_discovery_loop",
    "stop_monitor_loop",
    "profit_target_loop",
    "sentinel_loop",
    "correlation_advisor_loop",
    "message_cleanup_loop",
    "lt_scan_loop",
    "hub_close_poll_loop",
    "optuna_theoretical_outcome_loop",
})

# W8 malfunction-source allowlist. route_malfunction REFUSES any source not here — the
# structural exclusion that keeps a losing trade / drawdown / rejected candidate out of
# watcher_errors (no check produces such a source; the guard is defence-in-depth).
_MALFUNCTION_SOURCES = frozenset({
    "loop_stall",        # class (b)
    "systemctl_failed",  # class (a)
    "swallowed_canary",  # class (c)
    "cron_dead",         # class (d)
    "stuck_testing",     # shadow lifecycle
})

# Severity so the Hub can order by what matters. Resolution stays observational (never an
# action); severity is display-only ranking.
SEVERITY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "warn": 0}


# ═══════════════════════════════════════════════════════════════════════════
# time + timestamp helpers (loop_heartbeat is offset-aware ISO; observability_alerts
# is naive-UTC; both are UTC — normalize everything to naive UTC for comparison)
# ═══════════════════════════════════════════════════════════════════════════
def _now() -> datetime:
    """Now as a naive-UTC datetime (to compare against parsed naive-UTC timestamps)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _now_epoch() -> int:
    return int(time.time())


def _parse_utc(s: Any) -> Optional[datetime]:
    """Parse a trevor.db timestamp to naive UTC. Handles BOTH offset-aware ISO
    (``2026-07-18T19:32:49.179452+00:00``, loop_heartbeat) and naive space-separated
    (``2026-07-21 12:32:04``, observability_alerts). Returns None on anything unparseable
    (the caller then declines to judge staleness rather than fire a false alarm)."""
    if not s or not isinstance(s, str):
        return None
    txt = s.strip()
    dt: Optional[datetime] = None
    try:
        dt = datetime.fromisoformat(txt)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S",
                    "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(txt, fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ═══════════════════════════════════════════════════════════════════════════
# transports (read-only) — the replica (mode=ro) + the read-only ssh/local pipes
# ═══════════════════════════════════════════════════════════════════════════
def _replica_connect() -> sqlite3.Connection:
    """Open the litestream replica READ-ONLY. mode=ro makes a trevor.db write structurally
    impossible from here. Raises sqlite3.Error on failure (caller records UNKNOWN)."""
    return sqlite3.connect(f"file:{_REPLICA_PATH}?mode=ro", uri=True, timeout=_REPLICA_TIMEOUT)


def _default_vm_run(cmd: str, timeout: float = _VM_TIMEOUT) -> Dict[str, Any]:
    """Run a READ-ONLY command on the VM over ssh. Never raises — a transport failure
    surfaces as ``ok=False`` with an empty ``out`` so the caller records UNKNOWN (never a
    false all-clear). Only read commands are ever passed (systemctl is-active/list-units)."""
    env = dict(os.environ)
    env["HOME"] = _WSL_HOME
    try:
        proc = subprocess.run(["ssh", _VM_HOST, cmd], capture_output=True, text=True,
                              timeout=timeout, check=False, env=env)
    except subprocess.TimeoutExpired:
        return {"ok": False, "rc": -1, "out": "", "err": "ssh_timeout"}
    except Exception as exc:  # ssh missing / OS error
        return {"ok": False, "rc": -1, "out": "", "err": f"ssh_failed: {exc}"}
    return {"ok": proc.returncode == 0, "rc": proc.returncode,
            "out": (proc.stdout or "").strip(), "err": (proc.stderr or "").strip()}


def _default_local_run(argv: List[str], timeout: float = _LOCAL_TIMEOUT) -> Dict[str, Any]:
    """Run a READ-ONLY local command (WSL systemctl). Never raises."""
    try:
        proc = subprocess.run(list(argv), capture_output=True, text=True,
                              timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return {"ok": False, "rc": -1, "out": "", "err": "local_timeout"}
    except Exception as exc:
        return {"ok": False, "rc": -1, "out": "", "err": f"local_failed: {exc}"}
    return {"ok": proc.returncode == 0, "rc": proc.returncode,
            "out": (proc.stdout or "").strip(), "err": (proc.stderr or "").strip()}


def fetch_removed_loops(*, run: Optional[Callable[..., Dict[str, Any]]] = None) -> frozenset:
    """Read loop_registry.REMOVED_LOOPS from the VM (source of truth), read-only; fall back
    to the mirrored constant on ANY failure. The consequence of a stale set is minor (the
    is_dormant filter already covers removed loops), so a fallback is safe."""
    run = run or _default_vm_run
    prog = ("cd /home/trevor/trevor && sudo -u trevor venv/bin/python3 -c "
            "'import json,loop_registry; print(json.dumps(sorted(loop_registry.REMOVED_LOOPS)))'")
    res = run(prog, timeout=_VM_TIMEOUT)
    out = res.get("out", "")
    if res.get("ok") and out:
        try:
            names = json.loads(out.splitlines()[-1])
            if isinstance(names, list) and names:
                return frozenset(str(n) for n in names)
        except (json.JSONDecodeError, IndexError, ValueError, TypeError):
            pass
    return _REMOVED_LOOPS_FALLBACK


def _parse_failed_units(out: str, prefix: str = "trevor-") -> List[str]:
    """From ``systemctl list-units --state=failed --plain --no-legend`` output, the
    ``.service`` unit names starting with ``prefix``. (--plain strips the ● bullet.)"""
    names: List[str] = []
    for line in (out or "").splitlines():
        parts = line.split()
        if not parts:
            continue
        unit = parts[0]
        if unit.startswith(prefix) and unit.endswith(".service"):
            names.append(unit)
    return names


# ═══════════════════════════════════════════════════════════════════════════
# W8 — the malfunction router (the SINGLE funnel) + observational resolution +
# the local watcher_health mirror ("who watches the watcher")
# ═══════════════════════════════════════════════════════════════════════════
def route_malfunction(watcher_conn: sqlite3.Connection, source: str, key: str,
                      detail: Dict[str, Any], *, severity: str = "warn") -> bool:
    """The SINGLE entry point every check funnels through. Upserts ONE watcher_errors row
    per (source, key): edge-triggered + surface-once-until-resolved — if an UNRESOLVED row
    for (source, key) exists, advance last_seen_ts (and refresh detail); else INSERT a fresh
    row with first_seen_ts == last_seen_ts, resolved=0. Alert fatigue is the failure mode; a
    stale condition every cycle therefore produces ONE row, not one per cycle.

    Returns False (no write) for any source outside the infra-malfunction allowlist — the
    structural W8 exclusion: a losing trade / drawdown / rejected candidate can NEVER land
    in watcher_errors (no check reads trade outcomes, and this guard refuses the source)."""
    if source not in _MALFUNCTION_SOURCES:
        return False
    ts = utc_now()
    payload = json.dumps({**dict(detail), "key": str(key), "severity": severity},
                         sort_keys=True, default=str)
    with watcher_conn:
        existing = watcher_conn.execute(
            "SELECT id FROM watcher_errors WHERE source=? "
            "AND json_extract(detail_json,'$.key')=? AND resolved=0",
            (source, str(key))).fetchone()
        if existing:
            watcher_conn.execute(
                "UPDATE watcher_errors SET last_seen_ts=?, detail_json=? WHERE id=?",
                (ts, payload, existing[0]))
        else:
            watcher_conn.execute(
                "INSERT INTO watcher_errors "
                "(source, detail_json, first_seen_ts, last_seen_ts, resolved) "
                "VALUES (?, ?, ?, ?, 0)", (source, payload, ts, ts))
    return True


def resolve_cleared(watcher_conn: sqlite3.Connection, source: str,
                    active_keys: Iterable[str]) -> int:
    """Observational resolution: flip resolved=1 on any UNRESOLVED (source, *) row whose key
    is no longer firing. NEVER an action — it only records that the underlying condition
    cleared. MUST only be called by a check that read DEFINITIVELY this cycle (a check that
    couldn't read the source declines to resolve, so a transient replica/ssh outage can't
    falsely clear a real malfunction). A recurrence after resolution → a fresh row."""
    active = {str(k) for k in active_keys}
    ts = utc_now()
    resolved = 0
    with watcher_conn:
        rows = watcher_conn.execute(
            "SELECT id, json_extract(detail_json,'$.key') FROM watcher_errors "
            "WHERE source=? AND resolved=0", (source,)).fetchall()
        for rid, k in rows:
            if k not in active:
                watcher_conn.execute(
                    "UPDATE watcher_errors SET resolved=1, last_seen_ts=? WHERE id=?", (ts, rid))
                resolved += 1
    return resolved


def record_health(watcher_conn: sqlite3.Connection, check_name: str, status: str,
                  detail: str = "") -> None:
    """Upsert one watcher_health row per internal check — the local "who watches the watcher"
    mirror. Load-bearing WHILE monitor_center is dead: it makes the watcher's own state
    visible from watcher.db without depending on the VM or the (down) 08_service_health."""
    ts = utc_now()
    with watcher_conn:
        watcher_conn.execute(
            "INSERT INTO watcher_health (check_name, status, detail, updated_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(check_name) DO UPDATE SET status=excluded.status, "
            "detail=excluded.detail, updated_at=excluded.updated_at",
            (check_name, status, str(detail)[:500], ts))


# ═══════════════════════════════════════════════════════════════════════════
# the five subscribe-layer checks
# Each: read the signal → route each firing key → resolve the rest (only if the read was
# definitive) → mirror a watcher_health row → return a summary. A read failure returns
# status="unknown" and NEVER routes or resolves (surface UNKNOWN, never a false all-clear).
# ═══════════════════════════════════════════════════════════════════════════
def check_loop_freshness(watcher_conn: sqlite3.Connection, trevor_conn: sqlite3.Connection,
                         *, now: Optional[datetime] = None,
                         removed_loops: Optional[frozenset] = None) -> Dict[str, Any]:
    """class (b): fire per loop_heartbeat row that (is_dormant=0, not in REMOVED_LOOPS) is
    stale beyond max(3600, cadence*2). This alone would have caught auto_trader_monitor_loop
    days ago. Reads loop_heartbeat DIRECTLY (never via the down 08_service_health)."""
    check = "loop_freshness"
    now = now or _now()
    removed = removed_loops if removed_loops is not None else _REMOVED_LOOPS_FALLBACK
    try:
        rows = trevor_conn.execute(
            "SELECT loop_name, cadence_seconds, last_iteration_at, is_dormant, error_count "
            "FROM loop_heartbeat").fetchall()
    except sqlite3.Error as exc:
        record_health(watcher_conn, check, "unknown", f"loop_heartbeat unreadable: {exc}")
        return {"status": "unknown", "error": str(exc)}
    fired: List[str] = []
    unparsed = 0
    for name, cadence, last_it, is_dormant, err_count in rows:
        if is_dormant:                 # is_dormant honored — never fire a dormant loop
            continue
        if name in removed:            # REMOVED_LOOPS honored (belt over is_dormant)
            continue
        ts = _parse_utc(last_it)
        if ts is None:
            unparsed += 1              # can't judge staleness → decline (no false alarm)
            continue
        age = (now - ts).total_seconds()
        threshold = max(_STALE_FLOOR, int(cadence or 0) * 2)
        if age > threshold:
            route_malfunction(watcher_conn, "loop_stall", name, {
                "loop_name": name, "age_seconds": int(age), "threshold_seconds": threshold,
                "cadence_seconds": cadence, "last_iteration_at": last_it,
                "error_count": err_count,
            }, severity="high")
            fired.append(name)
    resolve_cleared(watcher_conn, "loop_stall", set(fired))
    record_health(watcher_conn, check, "degraded" if fired else "ok",
                  f"{len(fired)} stale of {len(rows)} loops"
                  + (f"; {unparsed} unparseable ts" if unparsed else ""))
    return {"status": "ok", "fired": fired, "scanned": len(rows), "unparsed": unparsed}


def check_stuck_testing(watcher_conn: sqlite3.Connection, trevor_conn: sqlite3.Connection,
                        *, now: Optional[datetime] = None,
                        max_age_seconds: int = _STUCK_TESTING_SECONDS) -> Dict[str, Any]:
    """shadow_lifecycle rows in a TESTING state older than 24h. Absent table / 0 rows =
    EXPECTED pre-cutover — treated as 'definitively nothing testing' (ok + resolve), never
    a fault."""
    check = "stuck_testing"
    now = now or _now()
    try:
        rows = trevor_conn.execute(
            "SELECT shadow_id, state, state_changed_at FROM shadow_lifecycle "
            "WHERE UPPER(COALESCE(state,'')) LIKE '%TEST%'").fetchall()
    except sqlite3.Error as exc:
        if "no such table" in str(exc).lower():
            resolve_cleared(watcher_conn, "stuck_testing", set())  # definitive: nothing testing
            record_health(watcher_conn, check, "ok", "shadow_lifecycle absent — expected pre-cutover")
            return {"status": "ok", "fired": [], "note": "table absent (expected)"}
        record_health(watcher_conn, check, "unknown", f"shadow_lifecycle unreadable: {exc}")
        return {"status": "unknown", "error": str(exc)}
    fired: List[str] = []
    for shadow_id, state, changed_at in rows:
        ts = _parse_utc(changed_at)
        if ts is None:
            continue
        age = (now - ts).total_seconds()
        if age > max_age_seconds:
            route_malfunction(watcher_conn, "stuck_testing", str(shadow_id), {
                "shadow_id": shadow_id, "state": state, "age_seconds": int(age),
                "threshold_seconds": max_age_seconds, "state_changed_at": changed_at,
            }, severity="medium")
            fired.append(str(shadow_id))
    resolve_cleared(watcher_conn, "stuck_testing", set(fired))
    record_health(watcher_conn, check, "degraded" if fired else "ok",
                  f"{len(fired)} stuck TESTING of {len(rows)} testing rows")
    return {"status": "ok", "fired": fired, "scanned": len(rows)}


def check_alerting_canary(watcher_conn: sqlite3.Connection, trevor_conn: sqlite3.Connection,
                          *, now: Optional[datetime] = None, now_epoch: Optional[int] = None,
                          hmm_stale_seconds: int = _HMM_STALE_SECONDS) -> Dict[str, Any]:
    """class (c) swallowed-exception detector — the HMM-DIVERGENCE form (a blanket
    ">Nh silence" canary is an alert-fatigue bug: observability_alerts is event-driven with
    normal gaps to 77h). Fire iff HMM inference is stale beyond threshold AND the hmm_stale
    alerter produced NO row since staleness began — the precise downstream silence a
    swallowed except causes (A1: 0 hmm_stale rows despite a stale HMM). Absent/empty HMM =
    expected, never fires."""
    check = "alerting_canary"
    now = now or _now()
    now_epoch = now_epoch if now_epoch is not None else _now_epoch()
    try:
        row = trevor_conn.execute("SELECT max(ts) FROM hmm_inference_log").fetchone()
    except sqlite3.Error as exc:
        if "no such table" in str(exc).lower():
            resolve_cleared(watcher_conn, "swallowed_canary", set())
            record_health(watcher_conn, check, "ok", "hmm_inference_log absent — expected-empty")
            return {"status": "ok", "fired": [], "note": "hmm table absent"}
        record_health(watcher_conn, check, "unknown", f"hmm_inference_log unreadable: {exc}")
        return {"status": "unknown", "error": str(exc)}
    hmm_last = row[0] if row else None
    if hmm_last is None:
        resolve_cleared(watcher_conn, "swallowed_canary", set())
        record_health(watcher_conn, check, "ok", "no hmm_inference rows — expected-empty")
        return {"status": "ok", "fired": [], "note": "hmm empty"}
    try:
        hmm_last = int(hmm_last)
    except (TypeError, ValueError):
        record_health(watcher_conn, check, "unknown", f"hmm ts unparseable: {hmm_last!r}")
        return {"status": "unknown", "error": "hmm ts unparseable"}
    hmm_age = now_epoch - hmm_last
    fired: List[str] = []
    if hmm_age > hmm_stale_seconds:
        # HMM stale → the hmm_stale alerter SHOULD have fired since staleness began.
        window_start = (now - timedelta(seconds=hmm_age)).strftime("%Y-%m-%d %H:%M:%S")
        try:
            n_alerts = trevor_conn.execute(
                "SELECT count(*) FROM observability_alerts "
                "WHERE alert_type='hmm_stale' AND created_at > ?", (window_start,)).fetchone()[0]
        except sqlite3.Error as exc:
            record_health(watcher_conn, check, "unknown", f"observability_alerts unreadable: {exc}")
            return {"status": "unknown", "error": str(exc)}
        if n_alerts == 0:
            route_malfunction(watcher_conn, "swallowed_canary", "hmm_stale_alerter", {
                "signal": "hmm_stale_alerter", "hmm_age_seconds": hmm_age,
                "hmm_stale_threshold_seconds": hmm_stale_seconds,
                "hmm_stale_alerts_since_stale": 0,
                "note": "HMM inference is stale but the staleness alerter produced nothing "
                        "— the swallowed-except signature (class c)",
            }, severity="high")
            fired.append("hmm_stale_alerter")
    resolve_cleared(watcher_conn, "swallowed_canary", set(fired))
    record_health(watcher_conn, check, "degraded" if fired else "ok",
                  f"hmm_age={hmm_age}s (threshold {hmm_stale_seconds}s); fired={len(fired)}")
    return {"status": "ok", "fired": fired, "hmm_age_seconds": hmm_age}


def check_critical_units(watcher_conn: sqlite3.Connection, *,
                         run: Optional[Callable[..., Dict[str, Any]]] = None,
                         units: Iterable[str] = CRITICAL_DAEMONS) -> Dict[str, Any]:
    """class (a): fire per critical DAEMON that is not ``active`` (masked/inactive/failed/
    dead). ``systemctl is-active`` returns rc!=0 when a unit is down — that is a normal
    'found a dead daemon', NOT an ssh failure; only an EMPTY reply (ssh genuinely down) is
    UNKNOWN. Edge-triggered: a second run over the same dead unit does not duplicate the row."""
    check = "critical_units"
    run = run or _default_vm_run
    units = list(units)
    res = run("systemctl is-active " + " ".join(units))
    out = res.get("out", "")
    if not out:  # empty reply => ssh genuinely failed => UNKNOWN (never a false all-clear)
        record_health(watcher_conn, check, "unknown", f"ssh vm returned no output: {res.get('err')}")
        return {"status": "unknown", "error": res.get("err") or "no output"}
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    if len(lines) != len(units):  # ambiguous mapping — decline rather than mis-attribute
        record_health(watcher_conn, check, "unknown",
                      f"is-active returned {len(lines)} states for {len(units)} units")
        return {"status": "unknown", "error": "state count mismatch", "out": out}
    fired: List[str] = []
    states: Dict[str, str] = {}
    for unit, state in zip(units, lines):
        states[unit] = state
        if state != "active":
            route_malfunction(watcher_conn, "systemctl_failed", unit, {
                "unit": unit, "state": state,
                "note": "critical daemon not active (masked/inactive/failed/dead)",
            }, severity=("critical" if unit == "trevor.service" else "high"))
            fired.append(unit)
    resolve_cleared(watcher_conn, "systemctl_failed", set(fired))
    record_health(watcher_conn, check, "degraded" if fired else "ok",
                  f"{len(fired)} critical daemon(s) not active: {states}")
    return {"status": "ok", "fired": fired, "states": states}


def check_cron_liveness(watcher_conn: sqlite3.Connection, *,
                        run_vm: Optional[Callable[..., Dict[str, Any]]] = None,
                        run_local: Optional[Callable[..., Dict[str, Any]]] = None) -> Dict[str, Any]:
    """class (d): fire per FAILED ``trevor-*`` scheduled job on the VM and on WSL — generic
    (no hardcoded job list), catching the live ``trevor-regime-transitions.service`` failed
    run and any future failed timer job. Resolution only runs when BOTH reads succeed (a
    partial read declines to resolve, so an ssh outage never clears a real VM failure)."""
    check = "cron_liveness"
    run_vm = run_vm or _default_vm_run
    run_local = run_local or _default_local_run
    list_cmd = "systemctl list-units --type=service --state=failed --no-legend --plain --all"
    fired: List[str] = []
    definitive = True

    vres = run_vm(list_cmd)
    if vres.get("ok"):  # a failed-state listing exits 0; ssh-down is ok=False
        for name in _parse_failed_units(vres.get("out", "")):
            key = f"vm:{name}"
            route_malfunction(watcher_conn, "cron_dead", key, {
                "unit": name, "location": "vm", "state": "failed",
                "note": "scheduled trevor-* job failed on its last run",
            }, severity="high")
            fired.append(key)
    else:
        definitive = False

    lres = run_local(list_cmd.split())
    if lres.get("ok"):
        for name in _parse_failed_units(lres.get("out", "")):
            key = f"wsl:{name}"
            route_malfunction(watcher_conn, "cron_dead", key, {
                "unit": name, "location": "wsl", "state": "failed",
                "note": "scheduled trevor-* job failed on its last run",
            }, severity="high")
            fired.append(key)
    else:
        definitive = False

    if definitive:
        resolve_cleared(watcher_conn, "cron_dead", set(fired))
        record_health(watcher_conn, check, "degraded" if fired else "ok",
                      f"{len(fired)} failed trevor-* job(s)")
        return {"status": "ok", "fired": fired}
    record_health(watcher_conn, check, "unknown",
                  f"scheduled-job read incomplete (fired {len(fired)}; resolution deferred)")
    return {"status": "partial", "fired": fired}


# ═══════════════════════════════════════════════════════════════════════════
# one cycle of the subscribe layer (invoked by watcher_health.py's gated daemon —
# NOT auto-run on import). Each check is independently guarded so one failure never
# aborts the cycle.
# ═══════════════════════════════════════════════════════════════════════════
def _guard(fn: Callable[..., Dict[str, Any]], *args: Any, **kwargs: Any) -> Dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # a defensive net over each check's own error handling
        return {"status": "error", "error": f"{getattr(fn, '__name__', 'check')}: {exc}"}


def run_surface_checks(*, watcher_conn: Optional[sqlite3.Connection] = None,
                       trevor_conn: Optional[sqlite3.Connection] = None,
                       removed_loops: Optional[frozenset] = None,
                       vm_run: Optional[Callable[..., Dict[str, Any]]] = None,
                       local_run: Optional[Callable[..., Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Run one cycle of all five checks. Opens its own connections if not injected
    (watcher.db rw via get_connection; the replica mode=ro). Never raises."""
    own_watcher = own_trevor = False
    if watcher_conn is None:
        watcher_conn = get_connection()
        own_watcher = True
    results: Dict[str, Any] = {}
    try:
        if trevor_conn is None:
            try:
                trevor_conn = _replica_connect()
                own_trevor = True
            except sqlite3.Error as exc:
                trevor_conn = None
                for chk in ("loop_freshness", "stuck_testing", "alerting_canary"):
                    record_health(watcher_conn, chk, "unknown", f"replica unreadable: {exc}")
        if removed_loops is None:
            removed_loops = fetch_removed_loops(run=vm_run)
        if trevor_conn is not None:
            results["loop_freshness"] = _guard(
                check_loop_freshness, watcher_conn, trevor_conn, removed_loops=removed_loops)
            results["stuck_testing"] = _guard(check_stuck_testing, watcher_conn, trevor_conn)
            results["alerting_canary"] = _guard(check_alerting_canary, watcher_conn, trevor_conn)
        else:
            results["loop_freshness"] = results["stuck_testing"] = \
                results["alerting_canary"] = {"status": "unknown", "error": "replica unreadable"}
        results["critical_units"] = _guard(check_critical_units, watcher_conn, run=vm_run)
        results["cron_liveness"] = _guard(
            check_cron_liveness, watcher_conn, run_vm=vm_run, run_local=local_run)
    finally:
        if own_trevor and trevor_conn is not None:
            trevor_conn.close()
        if own_watcher:
            watcher_conn.close()
    return results


if __name__ == "__main__":
    # Manual smoke ONLY (guarded, NEVER runs on import). Runs one real cycle against the
    # live replica + ssh vm and prints the per-check summary + any newly-surfaced rows.
    _res = run_surface_checks()
    print("=== watcher_surface one-cycle smoke ===")
    for _name, _r in _res.items():
        print(f"  {_name:<16} {_r.get('status'):<8} fired={_r.get('fired', _r.get('error', ''))}")
    _c = get_connection()
    _open = _c.execute(
        "SELECT source, json_extract(detail_json,'$.key'), first_seen_ts, last_seen_ts "
        "FROM watcher_errors WHERE resolved=0 ORDER BY last_seen_ts DESC").fetchall()
    print(f"  open watcher_errors rows = {len(_open)}")
    for _row in _open:
        print("   ", _row)
    _c.close()
