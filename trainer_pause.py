#!/usr/bin/env python3
"""trainer_pause.py — R13-P1: the trainer daemon's PAUSE poll (WSL-side, closes H5).

``trainer_loop.run_trainer_loop`` reads ``TRAINER_LOOP_ENABLED`` ONCE at entry — its
while-body never re-reads it — so a Hub pause flip against an already-running loop was a
LIE (the R12-B3 hazard, H5). R12-B3 shipped the durable pause REQUEST (a single-row VM
table ``trainer_pause_state``, written by the Hub button → gateway → set_trainer_pause.py)
but nothing polled it. This module is that poll: the trainer reads ``paused`` per-iteration
and actually stops.

═══════════════════════════════════════════════════════════════════════════════
 HOW IT READS (VM-side, read-only, HARD-UNKNOWN) — mirrors watcher_integrity._level_query
═══════════════════════════════════════════════════════════════════════════════
The trainer runs WSL-side; ``trainer_pause_state`` lives in the VM's ``trevor.db``. So
every read goes over the read-only ``ssh vm`` pipe, invoking a ``sudo -u trevor sqlite3
-readonly`` reader — with the SAME discipline as the watcher's level shim:

  * ``ssh -o BatchMode=yes -o ConnectTimeout=10`` + a HARD subprocess timeout (a dead
    host can outlive ssh's own ConnectTimeout; the subprocess timeout turns a hang into
    UNKNOWN). ``HOME=/home/ghost`` is reset in the child env so the ssh key/``~/.ssh/config``
    lookup resolves even if a parent forced ``HOME=/home/trevor`` (the R12-B2 gotcha).

  * READ-ONLY BY CONSTRUCTION: ``sqlite3 -readonly`` opens the VM db read-only (a write
    attempt fails ``attempt to write a readonly database``); the SQL is a fixed SELECT with
    NO caller input (injection-safe by having no variable at all).

  * TABLE-ABSENT = NOT-PAUSED (the pre-cutover empty state). The table is born on the
    FIRST Hub pause write, so pre-cutover it does not exist. SQLite resolves table names at
    PREPARE time, so a bare ``SELECT … FROM trainer_pause_state`` errors when the table is
    absent (indistinguishable from a real failure). A remote-shell guard (mirroring
    ``watcher_integrity._ssh_tail_jsonl``'s ``if [ -f … ]``) checks ``sqlite_master`` first
    and echoes ``0`` when the table is absent — so absence reads as NOT-paused, never
    UNKNOWN. Matches ``query_trainer_pause.py``'s ``_table_exists`` guard.

  * HARD-UNKNOWN, NEVER A GUESS. Any ssh/VM/parse failure — nonzero exit, timeout, empty
    stdout, output that is not exactly ``0``/``1``, spawn failure — returns the UNKNOWN
    sentinel. The CALLER treats UNKNOWN as NOT-paused (keep running) AND surfaces it
    (never swallowed): a transport blip must not silently halt a trainer that never trades
    — the phantom-halt failure class this project spent four roadmaps eliminating. Failing
    toward keep-running costs only "runs a little longer while Ghost sees a surfaced error."

═══════════════════════════════════════════════════════════════════════════════
 THE WATCHER STAYS ON — STRUCTURAL
═══════════════════════════════════════════════════════════════════════════════
The shim reads ONLY ``trainer_pause_state.paused`` (+ ``sqlite_master`` to guard absence).
It touches NO ``auto_config`` and references NO ``WATCHER_`` flag anywhere (grep-assertable:
``tests/test_watcher_independence`` + a P1 grep). The pause covers the trainer + the R8
loop only; the watcher is a separate daemon and keeps running through the pause — exactly
when you want it watching (mid code-change). This module also never imports/references
``watcher_db``/``watcher.db`` — R10/R11 independence denial-2 holds (UNKNOWN is surfaced to
the trainer's OWN stderr, never the watcher store).

Feature flag ``TRAINER_PAUSE_POLL_ENABLED`` (default OFF) is checked by the CALLER
(``trainer_loop``), so this module is a pure reader — importing it runs NOTHING.

Python 3, stdlib only. money_path=no. MAX(level) stays 0.
"""
from __future__ import annotations

import os
import shlex
import subprocess
import sys
import time
from typing import Any, Callable, Dict, Optional

# ── the three honest states (mirrors watcher_integrity's sentinel taxonomy) ──
PAUSED = "paused"
NOT_PAUSED = "not_paused"
UNKNOWN = "unknown"

# ── VM CLI shim config (overridable ONLY for tests: bad-host / short-timeout proofs) ──
_VM_HOST = os.environ.get("TRAINER_PAUSE_VM_HOST", "vm")
_VM_DB = os.environ.get("TRAINER_VM_TREVOR_DB_ABS", "/home/trevor/trevor/trevor.db")


def flag_enabled() -> bool:
    """``TRAINER_PAUSE_POLL_ENABLED`` — the R13-P1 arm (default OFF). The loop reads this
    to decide whether to construct a poll at all; when off the loop never polls and is
    byte-identical to R9-B6."""
    return os.environ.get("TRAINER_PAUSE_POLL_ENABLED", "").strip().lower() in (
        "1", "true", "yes", "on")


def default_ttl() -> float:
    """Cache TTL (seconds). Pause latency is bounded by this, NOT the loop cadence: the
    inter-iteration sleep is sliced by the TTL. Default 30s; override via env for tests."""
    raw = os.environ.get("TRAINER_PAUSE_POLL_TTL_SEC", "").strip()
    try:
        v = float(raw)
        return v if v > 0 else 30.0
    except (ValueError, TypeError):
        return 30.0


def _shim_timeout() -> float:
    """Hard subprocess timeout (seconds) — the ultimate guard against a hung ssh. Override
    via env for the timeout failure-mode test."""
    raw = os.environ.get("TRAINER_PAUSE_SSH_TIMEOUT", "").strip()
    try:
        v = float(raw)
        return v if v > 0 else 20.0
    except (ValueError, TypeError):
        return 20.0


def _build_argv() -> list:
    """The read-only ssh argv. A remote-shell guard checks ``sqlite_master`` first so an
    ABSENT table echoes ``0`` (NOT-paused) instead of erroring — the pre-cutover empty
    state. Two local ``sqlite3`` calls, ONE ssh round trip (the ssh is the only cost; the
    remote sqlite3 calls are microseconds, co-located with trevor.db). No caller input in
    the SQL — injection-safe by construction."""
    dbq = shlex.quote(_VM_DB)
    inner = (
        'if [ "$(sqlite3 -readonly %s "SELECT count(*) FROM sqlite_master '
        "WHERE type='table' AND name='trainer_pause_state'\")\" = \"1\" ]; then "
        'sqlite3 -readonly %s "SELECT COALESCE((SELECT paused FROM trainer_pause_state '
        'WHERE id=1),0)"; else echo 0; fi'
    ) % (dbq, dbq)
    remote = "sudo -u trevor sh -c " + shlex.quote(inner)
    return [
        "ssh",
        "-o", "BatchMode=yes",      # never hang on an auth prompt
        "-o", "ConnectTimeout=10",  # fail the TCP connect fast; subprocess timeout is the hard guard
        _VM_HOST,
        remote,
    ]


def _exec(argv: list, timeout: float) -> Dict[str, Any]:
    """Run the ssh subprocess, normalizing EVERY outcome to a plain dict — never raises.
    ``HOME=/home/ghost`` is set so the ssh key lookup resolves regardless of the parent's
    HOME (the runPython ``HOME=/home/trevor`` gotcha)."""
    env = dict(os.environ)
    env["HOME"] = "/home/ghost"
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env)
        return {"returncode": p.returncode, "stdout": p.stdout, "stderr": p.stderr,
                "timed_out": False, "spawn_error": None}
    except subprocess.TimeoutExpired:
        return {"returncode": None, "stdout": "", "stderr": "", "timed_out": True,
                "spawn_error": None}
    except (OSError, ValueError) as e:  # ssh binary missing / bad argv
        return {"returncode": None, "stdout": "", "stderr": "", "timed_out": False,
                "spawn_error": str(e)}


def _classify(r: Dict[str, Any]) -> Dict[str, Any]:
    """Map a normalized ``_exec`` result to {state, reason}. HARD-UNKNOWN on ANY failure —
    ordering spawn → timeout → nonzero → not-0/1. Only an exact ``0``/``1`` is trusted."""
    if r["spawn_error"] is not None:
        return {"state": UNKNOWN, "reason": "ssh spawn failed: %s" % r["spawn_error"]}
    if r["timed_out"]:
        return {"state": UNKNOWN, "reason": "timeout after %ss" % _shim_timeout()}
    if r["returncode"] != 0:
        stderr = (r.get("stderr") or "").strip()[:200]
        return {"state": UNKNOWN, "reason": "nonzero exit %s: %s" % (r["returncode"], stderr)}
    out = (r.get("stdout") or "").strip()
    if out == "0":
        return {"state": NOT_PAUSED, "reason": "paused=0"}
    if out == "1":
        return {"state": PAUSED, "reason": "paused=1"}
    return {"state": UNKNOWN, "reason": "unparseable stdout: %r" % out[:80]}


def read_pause_state() -> Dict[str, Any]:
    """The raw (uncached) read: read-only ssh → parsed {state, reason}. Never raises,
    never mutates the VM. This is the default reader ``PausePoll`` wraps; tests inject a
    fake to drive the loop without a real ssh."""
    return _classify(_exec(_build_argv(), _shim_timeout()))


def _log_unknown(reason: str) -> None:
    """Surface an UNKNOWN read to the trainer's OWN stderr → the daemon journal. NEVER the
    watcher store (that would break R10/R11 independence denial-2). Surface, don't swallow."""
    try:
        sys.stderr.write("[TRAINER-PAUSE] pause read UNKNOWN — keeping running: %s\n" % reason)
        sys.stderr.flush()
    except Exception:
        pass


class PausePoll:
    """A short-TTL cached view of ``trainer_pause_state.paused`` for the trainer loop.

    ``is_paused()`` returns True ONLY on a confirmed PAUSED read; NOT_PAUSED and UNKNOWN
    both → False (keep running). The cache bounds the ssh rate to ~once per TTL no matter
    how often the loop checks (the sliced sleep may check many times per iteration), so the
    loop never pays an ssh round trip per check. UNKNOWN is cached too (so an ssh outage
    doesn't hammer a 10s-timeout ssh every slice) and surfaced on each fresh occurrence
    (``unknown_count`` + a stderr line) — never silently swallowed.

    ``reader`` / ``clock`` / ``ttl`` are injectable seams for tests (a fake reader drives
    the loop with no real ssh; an injected clock makes the cache deterministic)."""

    def __init__(self, *, reader: Optional[Callable[[], Dict[str, Any]]] = None,
                 ttl: Optional[float] = None,
                 clock: Optional[Callable[[], float]] = None) -> None:
        self._reader = reader or read_pause_state
        self.ttl = float(ttl) if ttl is not None else default_ttl()
        self._clock = clock or time.monotonic
        self._state: Optional[str] = None
        self._reason: str = ""
        self._expiry: float = 0.0
        self.reads = 0            # fresh reader invocations (cache misses) — call-count proof
        self.unknown_count = 0    # surfaced UNKNOWN reads — the returned diagnostic counter

    def check(self) -> str:
        """Return the effective state, refreshing via the reader only when the cache is
        stale. A fresh UNKNOWN is counted + surfaced (once per TTL, not per cache hit)."""
        now = self._clock()
        if self._state is None or now >= self._expiry:
            reading = self._reader()
            self.reads += 1
            state = reading.get("state", UNKNOWN)
            reason = reading.get("reason", "")
            if state not in (PAUSED, NOT_PAUSED, UNKNOWN):
                state, reason = UNKNOWN, "reader returned non-state: %r" % state
            self._state, self._reason = state, reason
            self._expiry = now + self.ttl
            if state == UNKNOWN:
                self.unknown_count += 1
                _log_unknown(reason)
        return self._state

    def is_paused(self) -> bool:
        """True ONLY on a confirmed PAUSED read. UNKNOWN / NOT_PAUSED → False (keep
        running) — the load-bearing failure semantics."""
        return self.check() == PAUSED

    def last_reason(self) -> str:
        return self._reason


if __name__ == "__main__":
    # Manual smoke ONLY — guarded, NEVER runs on import. Prints the live (pre-cutover:
    # table-absent → not_paused) reading + a cached second read (reads stays 1).
    _p = PausePoll()
    print("read_pause_state():", read_pause_state())
    print("is_paused() #1:", _p.is_paused(), "reads:", _p.reads)
    print("is_paused() #2 (cache):", _p.is_paused(), "reads:", _p.reads,
          "unknown_count:", _p.unknown_count)
