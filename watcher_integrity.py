#!/usr/bin/env python3
"""watcher_integrity.py — TREVOR v5 Watcher (R10-B2) INTEGRITY sub-module.

The boring-but-critical half of the oversight agent. It knows what level CC
should be working on, confirms the level did not wrongly change during a fix,
owns declared-vs-detected reconciliation, and confirms an applied promotion
incremented the level correctly. It OBSERVES and REPORTS — it never trades,
never auto-halts, never resolves a mismatch by acting on the trading system.

═══════════════════════════════════════════════════════════════════════════════
 WHY THIS MODULE IS STRUCTURALLY SEPARATE (the depth note / the guarantee)
═══════════════════════════════════════════════════════════════════════════════
The review-brain (R10-B1) is an LLM and can drift; the integrity tracker must
NEVER drift. If they shared state, a review-brain failure could corrupt the
level/ID tracking — catastrophic. So:

  * B2 writes ONLY ``watcher_integrity.db`` through ``lib/watcher_integrity_db``.
  * B2 imports ONLY ``lib.watcher_integrity_db`` — it has ZERO import of
    ``lib/watcher_db.py`` and ZERO import of any B1 (review) / B3 (error) module.
  * B2 touches NO auto-halt lever and NO trading config — the CI AST-assert in
    ``tests/test_watcher_independence.py`` (denials 1 + 3) proves this and MUST
    keep passing. This module keeps ``integrity`` in its basename so it lands on
    the allowed side of that scan.

═══════════════════════════════════════════════════════════════════════════════
 HOW IT REACHES R2's INTEGRITY PRIMITIVES (VM-only, read-only, hard-UNKNOWN)
═══════════════════════════════════════════════════════════════════════════════
R2's ``level_query.py`` + ``rebuild_tracker.db`` live on the VM and are NOT
replicated. The watcher CANNOT import ``level_query`` (the auto_trader import
barrier holds). So every read goes over the read-only ``ssh vm`` pipe, invoking
ONLY the JSON CLI subcommands (``current`` / ``integrity`` / ``money-path-at`` /
``config-promoted-at`` / ``config-tested-at``). The exact invocation is:

    ssh vm 'cd /home/trevor/trevor && sudo -u trevor python3 \
            scripts/level/level_query.py <subcommand> [args]'

  * The ``sudo -u trevor`` only lets the CLI open its OWN ``mode=ro`` +
    ``PRAGMA query_only=ON`` handle — the shim NEVER runs a write subcommand,
    NEVER mutates a VM file. Read-only by construction (allowlist enforced).

  * HARD UNKNOWN, NEVER A FALSE PASS. Any ssh/VM/parse failure — non-zero exit,
    timeout, empty stdout, malformed JSON, ssh spawn failure, a non-object body
    — returns a distinct ``{"status": "unknown", "reason": ...}`` sentinel.
    Reporting "integrity ok" because the pipe was down is the WORST possible
    failure mode for this module; this is its single most important behavior.

  * VACUOUS ok ≠ verified. At L0 with 0 money_path rows R2's checks are
    trivially ``ok:true`` over an empty domain. This module records that as
    ``checks_ran_nothing_to_check`` (domain-empty marker in ``findings_json``),
    NEVER as a rich ``integrity_verified``. A pass is "verified" ONLY when a
    second ``current_level()`` call POSITIVELY confirms ``current_level >= 1``.

Feature flag ``WATCHER_INTEGRITY_ENABLED`` (default OFF) gates all autonomous
behavior — off means no polling, no ssh, no writes, no auto-start on import.
The pre-cutover EMPTY stream (absent JSONL, MAX(level)=0, 0 money_path rows,
scaffolded config_tested_at, absent promotion_candidates) is EXPECTED, never
BROKEN.

Python 3, stdlib only. Nothing runs on import.
"""
import json
import os
import shlex
import sqlite3
import subprocess
import sys
from typing import Optional

# Make ``lib.watcher_integrity_db`` importable regardless of CWD (this file
# lives at the repo root; lib/ is a sibling). Mirrors the test harness pattern.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# THE ONLY store this module writes — B0's independence guarantee. No import of
# lib/watcher_db.py and no B1/B3 module import anywhere in this file.
from lib.watcher_integrity_db import get_connection, utc_now  # noqa: E402

# ── feature flag (default OFF → byte-identical inert) ──────────────────────
_ENABLED_ENV = "WATCHER_INTEGRITY_ENABLED"


def _enabled() -> bool:
    """Default OFF. Only an explicit truthy env value arms autonomous behavior.

    Gates the poll/orchestration entrypoints (Phase 3). When off: no polling,
    no ssh, no writes, no auto-start. Mirrors R2's detection_enabled() shape.
    """
    return os.environ.get(_ENABLED_ENV, "").strip().lower() in ("1", "true", "yes", "on")


# ── VM CLI shim configuration ──────────────────────────────────────────────
# Overridable ONLY for tests (bad-host / short-timeout failure-mode proofs).
# Defaults are the exact confirmed-live invocation.
_VM_HOST = os.environ.get("WATCHER_INTEGRITY_VM_HOST", "vm")
_VM_CWD = "/home/trevor/trevor"
_LEVEL_QUERY = "scripts/level/level_query.py"

# READ-ONLY BY CONSTRUCTION: the shim will build an ssh argv for ONLY these five
# subcommands — every one prints JSON and mutates nothing. A subcommand outside
# this set yields UNKNOWN (never an ssh call, never a VM write).
_READ_SUBCOMMANDS = frozenset(
    {"current", "integrity", "money-path-at", "config-promoted-at", "config-tested-at"}
)


def _shim_timeout() -> float:
    """Hard subprocess timeout (seconds). The ultimate guard against a hung ssh —
    a genuinely dead host can outlive ssh's own ConnectTimeout, so this is what
    turns a hang into UNKNOWN. Override via env for the timeout failure-mode test.
    """
    raw = os.environ.get("WATCHER_INTEGRITY_SSH_TIMEOUT", "").strip()
    try:
        val = float(raw)
        return val if val > 0 else 20.0
    except (ValueError, TypeError):
        return 20.0


def _unknown(reason: str) -> dict:
    """The single UNKNOWN sentinel. This is NEVER a pass — callers must treat it
    as: the pipe/VM/parse failed, nothing could be confirmed.
    """
    return {"status": "unknown", "reason": reason}


def is_unknown(d) -> bool:
    """True iff ``d`` is the UNKNOWN sentinel (used everywhere before trusting a
    shim result). A defensive isinstance guard so a malformed value can't slip
    through as a pass."""
    return isinstance(d, dict) and d.get("status") == "unknown"


def _build_argv(subcommand: str, args) -> Optional[list]:
    """Build the read-only ssh argv for an allowlisted subcommand, or None.

    Returns None for any subcommand outside ``_READ_SUBCOMMANDS`` — this is the
    grep-provable read-only guard: the shim can only ever run the JSON readers.
    User-influenced args are shlex-quoted into the remote command (injection-safe;
    the CLI still opens its own mode=ro handle regardless).
    """
    if subcommand not in _READ_SUBCOMMANDS:
        return None
    remote = "cd %s && sudo -u trevor python3 %s %s" % (
        shlex.quote(_VM_CWD),
        shlex.quote(_LEVEL_QUERY),
        subcommand,
    )
    for a in args:
        remote += " " + shlex.quote(str(a))
    return [
        "ssh",
        "-o", "BatchMode=yes",       # never hang on an auth prompt
        "-o", "ConnectTimeout=10",   # fail the TCP connect fast; subprocess timeout is the hard guard
        _VM_HOST,
        remote,
    ]


def _exec(argv: list, timeout: float) -> dict:
    """Run a subprocess, normalizing EVERY outcome to a plain dict — never raises.

    Kept separate from _classify so each failure branch (nonzero / timeout /
    malformed / spawn-error) is drivable with a real subprocess in tests.
    """
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return {
            "returncode": p.returncode,
            "stdout": p.stdout,
            "stderr": p.stderr,
            "timed_out": False,
            "spawn_error": None,
        }
    except subprocess.TimeoutExpired:
        return {"returncode": None, "stdout": "", "stderr": "", "timed_out": True, "spawn_error": None}
    except (OSError, ValueError) as e:  # ssh binary missing / bad argv
        return {"returncode": None, "stdout": "", "stderr": "", "timed_out": False, "spawn_error": str(e)}


def _classify(subcommand: str, r: dict) -> dict:
    """Map a normalized _exec result to the parsed JSON dict OR the UNKNOWN
    sentinel. HARD UNKNOWN on ANY failure mode — this is where "never a false
    pass" is enforced. Ordering: spawn → timeout → nonzero → empty → malformed →
    non-object → parsed dict.
    """
    if r["spawn_error"] is not None:
        return _unknown("ssh spawn failed (%s): %s" % (subcommand, r["spawn_error"]))
    if r["timed_out"]:
        return _unknown("timeout (%s) after %ss" % (subcommand, _shim_timeout()))
    if r["returncode"] != 0:
        stderr = (r.get("stderr") or "").strip()[:200]
        return _unknown("nonzero exit %s (%s): %s" % (r["returncode"], subcommand, stderr))
    out = (r.get("stdout") or "").strip()
    if not out:
        return _unknown("empty stdout (%s)" % subcommand)
    try:
        data = json.loads(out)
    except (ValueError, TypeError) as e:
        return _unknown("malformed json (%s): %s" % (subcommand, e))
    if not isinstance(data, dict):
        return _unknown("non-object json (%s): %s" % (subcommand, type(data).__name__))
    return data


def _level_query(subcommand: str, *args) -> dict:
    """The shim: read-only ssh → R2's level_query JSON CLI → parsed dict, OR the
    UNKNOWN sentinel on ANY failure. Never raises, never mutates the VM.
    """
    argv = _build_argv(subcommand, args)
    if argv is None:
        return _unknown("refused non-read subcommand: %r" % subcommand)
    return _classify(subcommand, _exec(argv, _shim_timeout()))


# ── thin read wrappers (each returns the CLI dict or the UNKNOWN sentinel) ──
def current_level() -> dict:
    """R2 current_level() → {"current_level": N} or UNKNOWN."""
    return _level_query("current")


def run_all_integrity() -> dict:
    """R2 run_all_integrity() → {"ok": bool, "checks": [...]} or UNKNOWN."""
    return _level_query("integrity")


def money_path_at_level(n) -> dict:
    """R2 money_path_at_level(n) → the 8-col levels row (or {} / null-ish) or UNKNOWN."""
    return _level_query("money-path-at", int(n))


def config_promoted_at(ref: str) -> dict:
    """R2 config_promoted_at(ref) → {"promoted_at_levels": [...], "count": N} or UNKNOWN."""
    return _level_query("config-promoted-at", ref)


def config_tested_at(ref: str) -> dict:
    """R2 config_tested_at(ref) — SCAFFOLDED pre-R8 → {"populated": false, ...} or UNKNOWN."""
    return _level_query("config-tested-at", ref)


# ── integrity_findings writer + vacuous-ok classifier ──────────────────────
def _record_integrity_finding(check_name: str, ok, findings: dict, level_id, conn=None) -> int:
    """Insert ONE additive row into integrity_findings. ``ok`` is coerced to 0/1
    (the column is NOT NULL); the semantic status lives in ``findings_json`` so
    the vacuous/verified/failed/unknown distinction is always visible to R12.
    Returns the row id.
    """
    own = conn is None
    conn = conn or get_connection()
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO integrity_findings (check_name, ok, findings_json, level_id, ts) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    str(check_name),
                    1 if ok else 0,
                    json.dumps(findings, sort_keys=True),
                    int(level_id) if isinstance(level_id, int) else None,
                    utc_now(),
                ),
            )
            return cur.lastrowid
    finally:
        if own:
            conn.close()


# The four honest states a run_all_integrity() cycle can land in.
STATUS_VERIFIED = "integrity_verified"                 # ok AND domain substantive (level>=1)
STATUS_NOTHING_TO_CHECK = "checks_ran_nothing_to_check"  # ok BUT domain empty (L0 / 0 money_path)
STATUS_FAILED = "integrity_failed"                     # R2 reported ok:false
STATUS_UNKNOWN = "integrity_unknown"                   # shim UNKNOWN — could not confirm


def evaluate_integrity(conn=None) -> dict:
    """Run R2's integrity checks, classify vacuous-vs-substantive, record ONE
    integrity_findings row, and return the classification.

    THE VACUOUS-OK RULE (the whole point): a pass is ``integrity_verified`` ONLY
    when ``current_level()`` POSITIVELY confirms ``current_level >= 1``. In every
    other passing case — level 0, OR ``current_level`` itself UNKNOWN — it is
    ``checks_ran_nothing_to_check`` with a domain-empty marker. Never over-claim.
    A shim UNKNOWN on the integrity read is recorded ok=0 / status=unknown — we
    could NOT confirm, so it is never a pass.
    """
    integ = run_all_integrity()
    if is_unknown(integ):
        detail = {"status": STATUS_UNKNOWN, "domain": "unknown", "reason": integ.get("reason")}
        rowid = _record_integrity_finding("run_all_integrity", ok=False, findings=detail,
                                          level_id=None, conn=conn)
        return {"status": STATUS_UNKNOWN, "ok": False, "level": None, "finding_id": rowid}

    ok_flag = bool(integ.get("ok"))

    # Domain-empty determination: substantive ONLY on a POSITIVE current_level>=1.
    cur = current_level()
    level = None
    if not is_unknown(cur):
        maybe = cur.get("current_level")
        if isinstance(maybe, int):
            level = maybe
    substantive = isinstance(level, int) and level >= 1

    if not ok_flag:
        status, ok = STATUS_FAILED, False
    elif substantive:
        status, ok = STATUS_VERIFIED, True
    else:
        status, ok = STATUS_NOTHING_TO_CHECK, True  # vacuous — a pass, but NOT rich

    detail = {
        "status": status,
        "domain": "substantive" if substantive else "empty",
        "current_level": level,
        "checks": integ.get("checks"),
    }
    rowid = _record_integrity_finding("run_all_integrity", ok=ok, findings=detail,
                                      level_id=level, conn=conn)
    return {"status": status, "ok": ok, "level": level, "finding_id": rowid}


# ═══════════════════════════════════════════════════════════════════════════
#  PHASE 2 — declared-vs-detected reconciliation (W3/W4) + the JSONL cursor
# ═══════════════════════════════════════════════════════════════════════════
# R2's classifier appends ONE JSON object per MISMATCH to this VM-only,
# NON-replicated append-only log. The watcher is where that mismatch SURFACES
# and (observationally) RESOLVES. It NEVER acts on the trading system.
_JSONL_PATH = "/home/trevor/trevor/logs/level_detection.jsonl"
_JSONL_SOURCE = "level_detection"

# Two mismatch kinds, ranked. undeclared_trading_change (a trading-surface change
# went UNDECLARED — the dangerous case) outranks declared_not_detected (a declared
# money-path change the tripwire simply missed — likely a tripwire gap).
_KIND_SEVERITY = {"undeclared_trading_change": 2, "declared_not_detected": 1}


def severity_for_kind(kind) -> int:
    """Rank a mismatch kind (2 = dangerous undeclared, 1 = declared-not-detected,
    0 = anything else). Derived from ``kind`` — reconciliation_log has no action
    or severity column; ranking is a pure read-time function of the stored kind."""
    return _KIND_SEVERITY.get(kind, 0)


def _ssh_tail_jsonl(start_line: int) -> dict:
    """Read-only SSH tail of the reconcile JSONL from ``start_line`` (1-indexed).

    Returns one of:
      * {"status": "absent"}          — file does not exist (EXPECTED pre-cutover;
                                         detection is OFF so no line was ever written).
                                         NEVER an error, NEVER an alarm.
      * {"status": "ok", "lines": [...]} — the new lines from start_line onward
                                         (possibly empty if the cursor is at EOF).
      * {"status": "unknown", ...}    — ssh/pipe failure; do NOT advance the cursor,
                                         retry next poll (no alarm, no false-empty).

    The remote command is read-only (test-for-existence then ``tail``). The
    ``__ABSENT__`` sentinel is emitted ONLY in the file-missing branch, so it can
    never collide with a real JSONL line (which is always a JSON object).
    """
    inner = "if [ -f {p} ]; then tail -n +{n} {p}; else echo __ABSENT__; fi".format(
        p=shlex.quote(_JSONL_PATH), n=int(start_line)
    )
    remote = "sudo -u trevor sh -c " + shlex.quote(inner)
    argv = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", _VM_HOST, remote]
    r = _exec(argv, _shim_timeout())
    if r["spawn_error"] is not None:
        return _unknown("ssh spawn failed (jsonl-tail): %s" % r["spawn_error"])
    if r["timed_out"]:
        return _unknown("timeout (jsonl-tail) after %ss" % _shim_timeout())
    if r["returncode"] != 0:
        return _unknown("nonzero exit %s (jsonl-tail): %s"
                        % (r["returncode"], (r.get("stderr") or "").strip()[:200]))
    out = r.get("stdout") or ""
    if out.strip() == "__ABSENT__":
        return {"status": "absent"}  # expected pre-cutover empty stream
    lines = [ln for ln in out.split("\n") if ln.strip() != ""]
    return {"status": "ok", "lines": lines}


def _get_cursor(conn, source: str) -> int:
    """The number of JSONL lines already consumed for ``source`` (0 if none)."""
    row = conn.execute("SELECT last_line FROM jsonl_cursor WHERE source=?", (source,)).fetchone()
    return int(row[0]) if row and isinstance(row[0], int) else 0


def _consume_line_atomic(conn, abs_line: int, entry) -> bool:
    """Consume ONE JSONL line in a SINGLE transaction: record the mismatch (only
    when ``outcome == "mismatch"`` — asserted, not assumed) AND advance the cursor
    to ``abs_line``, atomically. Returns True iff a mismatch row was written.

    EXACTLY-ONCE: the reconciliation_log INSERT and the cursor advance commit
    together. A crash BEFORE the commit rolls back BOTH → the line is re-read next
    poll (re-processed, never skipped, never double-recorded). A malformed / non-
    mismatch line records nothing but still advances the cursor so the poll can
    never stall on it. The record is ACTION-FREE — it mirrors R2's own no-halt-key
    reconcile dict (prompt_id / outcome / kind / triggers / resolved / ts only).
    """
    is_mismatch = isinstance(entry, dict) and entry.get("outcome") == "mismatch"
    with conn:  # BEGIN … COMMIT (rolls back on any exception)
        if is_mismatch:
            conn.execute(
                "INSERT INTO reconciliation_log "
                "(prompt_id, outcome, kind, triggers_json, resolved, ts) "
                "VALUES (?, ?, ?, ?, 0, ?)",
                (
                    entry.get("prompt_id"),
                    entry.get("outcome"),
                    entry.get("kind"),
                    json.dumps(entry.get("triggers", []), sort_keys=True),
                    utc_now(),
                ),
            )
        conn.execute(
            "INSERT INTO jsonl_cursor (source, last_line, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(source) DO UPDATE SET last_line=excluded.last_line, "
            "updated_at=excluded.updated_at",
            (_JSONL_SOURCE, int(abs_line), utc_now()),
        )
    return is_mismatch


def poll_reconciliation(conn=None, *, tail_fn=None) -> dict:
    """Poll the reconcile JSONL from the cursor, record new mismatches exactly-once.

    Pre-cutover the JSONL is absent → status "absent", 0 recorded, NO alarm. A
    pipe failure → status "unknown", 0 recorded, retried next poll (never a
    false-empty, never an alarm). A per-line commit failure → status "partial";
    the cursor is NOT advanced past the failing line, so it is retried (never
    skipped). ``tail_fn`` is injectable for tests; defaults to the read-only shim.
    """
    own = conn is None
    conn = conn or get_connection()
    tail_fn = tail_fn or _ssh_tail_jsonl
    try:
        last = _get_cursor(conn, _JSONL_SOURCE)
        res = tail_fn(last + 1)
        status = res.get("status")
        if status == "absent":
            return {"status": "absent", "recorded": 0, "consumed": 0}
        if status == "unknown":
            return {"status": "unknown", "recorded": 0, "consumed": 0, "reason": res.get("reason")}
        lines = res.get("lines", [])
        recorded = 0
        consumed = 0
        for offset, raw in enumerate(lines):
            abs_line = last + 1 + offset
            try:
                parsed = json.loads(raw)
                entry = parsed if isinstance(parsed, dict) else None
            except (ValueError, TypeError):
                entry = None  # malformed → consume (advance), record nothing
            try:
                did_record = _consume_line_atomic(conn, abs_line, entry)
            except Exception as e:  # commit failed mid-write → stop; line retried next poll
                return {"status": "partial", "recorded": recorded, "consumed": consumed,
                        "reason": str(e)}
            consumed += 1
            if did_record:
                recorded += 1
        return {"status": "ok", "recorded": recorded, "consumed": consumed}
    finally:
        if own:
            conn.close()


def _applied_prompt_ids() -> Optional[set]:
    """The set of prompt_ids that carry a formally-minted money-path ``levels`` row,
    read from the level chain via the read-only CLI. Returns None when the chain
    cannot be FULLY + safely read (any UNKNOWN) — so resolution resolves nothing
    rather than acting on incomplete data. Read-only; touches no trading system."""
    cur = current_level()
    if is_unknown(cur):
        return None
    top = cur.get("current_level")
    if not isinstance(top, int) or top < 0:
        return None
    ids = set()
    for n in range(0, top + 1):
        row = money_path_at_level(n)
        if is_unknown(row):
            return None  # incomplete → refuse to resolve this cycle (conservative)
        pid = row.get("prompt_id")
        if pid:
            ids.add(pid)
    return ids


def reconcile_observed_resolutions(conn=None, *, applied_prompt_ids=None) -> dict:
    """OBSERVATIONAL resolution only. A mismatch is marked ``resolved=1`` ONLY when
    the watcher OBSERVES that its prompt_id now carries a formally-minted money-path
    ``levels`` row — i.e. the underlying record shows the money-path change was
    officially recognized (the reconciling signal available within the read-only
    CLI, for BOTH mismatch kinds). It NEVER resolves by acting on the trading
    system — it only reads the level chain and flips the watcher's OWN resolved
    flag. Anything not reconciled stays ``resolved=0`` and surfaces to the Hub.

    Pre-cutover: 0 unresolved rows AND MAX(level)=0 → resolves nothing (correct).
    ``applied_prompt_ids`` is injectable for tests; defaults to the live chain read.
    """
    own = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, prompt_id FROM reconciliation_log WHERE resolved=0"
        ).fetchall()
        if not rows:
            return {"status": "ok", "resolved": 0, "checked": 0}
        applied = applied_prompt_ids if applied_prompt_ids is not None else _applied_prompt_ids()
        if applied is None:
            # chain unreadable → resolve nothing (never falsely resolve); surface stays
            return {"status": "unknown", "resolved": 0, "checked": len(rows)}
        resolved = 0
        for rid, pid in rows:
            if pid and pid in applied:
                with conn:
                    conn.execute("UPDATE reconciliation_log SET resolved=1 WHERE id=?", (rid,))
                resolved += 1
        return {"status": "ok", "resolved": resolved, "checked": len(rows)}
    finally:
        if own:
            conn.close()


def surface_unresolved(conn=None) -> list:
    """Unresolved mismatches for the Hub (R12), ranked dangerous-first. Read-only —
    returns rows the watcher could NOT observationally resolve; Ghost acts, not the
    watcher. Dangerous ``undeclared_trading_change`` sorts above ``declared_not_detected``,
    then newest ts first."""
    own = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, prompt_id, outcome, kind, triggers_json, ts "
            "FROM reconciliation_log WHERE resolved=0"
        ).fetchall()
        out = [
            {"id": r[0], "prompt_id": r[1], "outcome": r[2], "kind": r[3],
             "triggers": json.loads(r[4]) if r[4] else [], "ts": r[5],
             "severity": severity_for_kind(r[3])}
            for r in rows
        ]
        # Two stable sorts: newest ts first, then dangerous severity first (stable
        # sort preserves the ts order within each severity band).
        out.sort(key=lambda d: d["ts"] or "", reverse=True)
        out.sort(key=lambda d: d["severity"], reverse=True)
        return out
    finally:
        if own:
            conn.close()


# ═══════════════════════════════════════════════════════════════════════════
#  PHASE 3 — promotion-application oversight (W9) + findings surface + flag gate
# ═══════════════════════════════════════════════════════════════════════════
# An "apply" is a CC prompt `--money-path yes` that INSERTs a new levels row +
# prompt_events row (via R2's rebuild_tracker). The watcher CANNOT observe the CC
# prompt, so it POLLS current_level() and, on MAX(level) > last_seen, verifies the
# new level incremented correctly. Any failure surfaces to the Hub; the watcher
# NEVER auto-halts, NEVER reverts, NEVER touches the level chain.

# last_seen_level persists in the watcher's OWN store via a tiny additive key-value
# table (CREATE ... IF NOT EXISTS — additive-DB law; created lazily, never on import).
_STATE_TABLE_DDL = (
    "CREATE TABLE IF NOT EXISTS watcher_state "
    "(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)"
)
_LAST_SEEN_LEVEL_KEY = "w9_last_seen_level"

# The read-only WSL replica of the VM's trevor.db — the ONLY place the config
# cross-check reads (mode=ro; the watcher never writes it). promotion_candidates
# is the authoritative cross-check table (shadow_lifecycle is a fallback); both
# ABSENT pre-cutover = EXPECTED, never a fault.
_REPLICA_TREVOR_DB = "/home/ghost/trevor-replica/trevor.db"


def _ensure_state(conn) -> None:
    conn.execute(_STATE_TABLE_DDL)


def _get_last_seen_level(conn) -> int:
    """The highest level the watcher has already EXAMINED (0 baseline = the L0
    seed; pre-cutover MAX(level)=0 <= 0 → no apply to verify)."""
    _ensure_state(conn)
    row = conn.execute("SELECT value FROM watcher_state WHERE key=?", (_LAST_SEEN_LEVEL_KEY,)).fetchone()
    if row is None:
        return 0
    try:
        return int(row[0])
    except (ValueError, TypeError):
        return 0


def _set_last_seen_level(conn, level: int) -> None:
    _ensure_state(conn)
    with conn:
        conn.execute(
            "INSERT INTO watcher_state (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (_LAST_SEEN_LEVEL_KEY, str(int(level)), utc_now()),
        )


def _cross_check_config(config_ref) -> dict:
    """Cross-check a levels row's ``config_snapshot_ref`` against the promoted
    shadow's config in the read-only replica. Returns a status dict:

      * "expected_empty" — null ref (pre-cutover / seed) OR promotion_candidates
                           absent. NEVER a fault.
      * "ok"             — the ref matched a promotion candidate.
      * "mismatch"       — the table is present AND the ref is cleanly absent from
                           it (the only status that becomes a W9 failure).
      * "deferred"       — table present but its schema can't be queried yet
                           (unknown columns pre-R8) → benign, NOT a fault.
      * "unknown"        — the replica could not be opened (retry; never a fault).

    Read-only (mode=ro + query_only). Touches no trading system.
    """
    if not config_ref:
        return {"status": "expected_empty", "reason": "no config_snapshot_ref (null pre-cutover / seed)"}
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % _REPLICA_TREVOR_DB, uri=True, timeout=5.0)
        conn.execute("PRAGMA query_only=ON;")
    except sqlite3.Error as e:
        return {"status": "unknown", "reason": "replica open failed: %s" % e}
    try:
        present = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='promotion_candidates'"
        ).fetchone()
        if present is None:
            return {"status": "expected_empty",
                    "reason": "promotion_candidates absent (expected pre-cutover)"}
        # Table present — best-effort match on config_snapshot_ref. Unknown schema
        # (pre-R8) is DEFERRED, never a false mismatch.
        try:
            hit = conn.execute(
                "SELECT 1 FROM promotion_candidates WHERE config_snapshot_ref = ? LIMIT 1",
                (config_ref,),
            ).fetchone()
        except sqlite3.Error:
            return {"status": "deferred",
                    "reason": "promotion_candidates present but config_snapshot_ref column not queryable yet"}
        if hit is None:
            return {"status": "mismatch",
                    "reason": "config_snapshot_ref %r not found in promotion_candidates" % config_ref}
        return {"status": "ok", "reason": "config_snapshot_ref matched a promotion candidate"}
    finally:
        conn.close()


def _verify_applied_level(conn, n: int) -> dict:
    """Verify one newly-applied level and record ONE apply_oversight finding.

    Checks (a failure of any BUT the expected-empty ones flips ok=0 + surfaces):
      1. R2 run_all_integrity clean — esp. check_increment_when_should (the
         level_after <= level_before / NULL flag). A failing R2 check IS the wrong-
         increment evidence.
      2. the levels row's own ``level`` == n.
      3. non-null ``prompt_id`` on the applied row.
      4. config_snapshot_ref cross-check — expected_empty/deferred/unknown are NOT
         faults; only a clean "mismatch" is.
      5. config_tested_at — R8-scaffolded (populated:false) → recorded expected-
         empty, NEVER a failure.

    Returns {"status": "unknown", ...} without recording a finding when the levels
    row itself can't be read (retry next poll — never a false pass).
    """
    row = money_path_at_level(n)
    if is_unknown(row):
        return {"status": "unknown", "level": n, "reason": row.get("reason")}

    failures = []  # each: {"check", "detail"[, "findings"]} — the specific check + evidence

    integ = run_all_integrity()
    if is_unknown(integ):
        failures.append({"check": "run_all_integrity", "detail": "shim UNKNOWN",
                         "reason": integ.get("reason")})
    elif not integ.get("ok"):
        for chk in (integ.get("checks") or []):
            if not chk.get("ok"):
                failures.append({"check": chk.get("check"), "detail": "R2 integrity check failed",
                                 "findings": chk.get("findings")})

    row_level = row.get("level")
    if row_level != n:
        failures.append({"check": "level_matches",
                         "detail": "levels row level %r != examined level %d" % (row_level, n)})

    prompt_id = row.get("prompt_id")
    if not prompt_id:
        failures.append({"check": "prompt_id_present",
                         "detail": "applied levels row has null/empty prompt_id"})

    config_ref = row.get("config_snapshot_ref")
    cross = _cross_check_config(config_ref)
    if cross["status"] == "mismatch":
        failures.append({"check": "config_snapshot_cross_check", "detail": cross["reason"]})

    if config_ref:
        tested = config_tested_at(config_ref)
        if is_unknown(tested):
            tested_note = {"status": "unknown", "reason": tested.get("reason")}
        elif tested.get("populated"):
            tested_note = {"status": "populated"}
        else:
            tested_note = {"status": "expected_empty_awaiting_r8",
                           "r8_dependency": tested.get("r8_dependency")}
    else:
        tested_note = {"status": "expected_empty", "reason": "no config_snapshot_ref"}

    ok = len(failures) == 0
    status = "apply_verified" if ok else "apply_integrity_failed"
    detail = {
        "status": status,
        "level": n,
        "prompt_id": prompt_id,
        "config_snapshot_ref": config_ref,
        "config_cross_check": cross,       # expected_empty is fine, not a fault
        "config_tested_at": tested_note,   # R8-scaffolded expected-empty, not a fault
        "failures": failures,              # the specific check(s) + evidence
        "integrity_ok": None if is_unknown(integ) else bool(integ.get("ok")),
    }
    rowid = _record_integrity_finding("apply_oversight", ok=ok, findings=detail, level_id=n, conn=conn)
    return {"status": status, "level": n, "ok": ok, "finding_id": rowid, "failures": failures}


def poll_apply_oversight(conn=None) -> dict:
    """W9: detect newly-applied level(s) and verify each increment.

    On MAX(level) > last_seen, verifies levels [last_seen+1 .. current], recording
    one apply_oversight finding per level and advancing last_seen ONLY after a
    level is examined. A level whose row can't be read (UNKNOWN) does NOT advance
    last_seen — it is retried next poll (never skipped). Pre-cutover current=0 <=
    last_seen=0 → status "no_new_level", zero findings, zero alarm.

    NEVER auto-halts, NEVER reverts, NEVER touches the level chain — it only reads
    (read-only CLI) and writes the watcher's OWN integrity_findings + state.
    """
    own = conn is None
    conn = conn or get_connection()
    try:
        cur = current_level()
        if is_unknown(cur):
            return {"status": "unknown", "checked": 0, "reason": cur.get("reason")}
        top = cur.get("current_level")
        if not isinstance(top, int):
            return {"status": "unknown", "checked": 0, "reason": "current_level not an int"}
        last_seen = _get_last_seen_level(conn)
        if top <= last_seen:
            return {"status": "no_new_level", "current_level": top, "last_seen": last_seen}
        verified = []
        for n in range(last_seen + 1, top + 1):
            v = _verify_applied_level(conn, n)
            verified.append(v)
            if v["status"] == "unknown":
                break  # couldn't examine — do NOT advance; retry next poll
            _set_last_seen_level(conn, n)
        return {"status": "ok", "current_level": top, "verified": verified}
    finally:
        if own:
            conn.close()


def surface_findings(conn=None, limit: int = 50) -> list:
    """Recent integrity_findings for the Hub (R12), newest first. Read-only — B2
    produces the DATA; it builds no Hub UI. Includes the un-ok (failing) findings
    that surface to Ghost."""
    own = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, check_name, ok, findings_json, level_id, ts "
            "FROM integrity_findings ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
        return [
            {"id": r[0], "check_name": r[1], "ok": bool(r[2]),
             "findings": json.loads(r[3]) if r[3] else None, "level_id": r[4], "ts": r[5]}
            for r in rows
        ]
    finally:
        if own:
            conn.close()


def run_integrity_cycle(conn=None) -> dict:
    """THE single autonomous entrypoint — GATED by WATCHER_INTEGRITY_ENABLED.

    When the flag is OFF this returns immediately with NO ssh, NO DB connection,
    NO writes, NO side effects (byte-identical inert). When ON it runs one cycle:
    reconciliation poll (W3/W4) → observational resolution → apply oversight (W9)
    → a baseline integrity evaluation. Observe-and-report only; never acts on the
    trading system. Nothing calls this on import.
    """
    if not _enabled():
        return {"status": "disabled"}  # inert: no ssh, no connection, no writes
    own = conn is None
    conn = conn or get_connection()
    try:
        return {
            "status": "ran",
            "reconciliation": poll_reconciliation(conn=conn),
            "resolutions": reconcile_observed_resolutions(conn=conn),
            "apply_oversight": poll_apply_oversight(conn=conn),
            "integrity": evaluate_integrity(conn=conn),
        }
    finally:
        if own:
            conn.close()


if __name__ == "__main__":
    # Manual smoke ONLY — guarded, NEVER runs on import. Prints the live shim
    # reads + the vacuous-ok classification + the reconciliation poll + the W9
    # apply oversight at the current (pre-cutover) state (JSONL absent, MAX
    # level 0 → everything expected-empty, zero findings, zero alarm).
    print("current_level():", current_level())
    print("run_all_integrity():", run_all_integrity())
    print("money_path_at_level(0):", money_path_at_level(0))
    print("evaluate_integrity():", evaluate_integrity())
    print("poll_reconciliation():", poll_reconciliation())
    print("poll_apply_oversight():", poll_apply_oversight())
    print("surface_unresolved():", surface_unresolved())
    print("surface_findings():", surface_findings(limit=5))
    print("run_integrity_cycle() [flag=%s]:" % _enabled(), run_integrity_cycle())
