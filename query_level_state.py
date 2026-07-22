#!/usr/bin/env python3
"""query_level_state.py — WATCHER page backend (level chain, VM-only, hard UNKNOWN).

Backs GET /api/watcher/level — the R12 WATCHER cockpit's `level` sub-tab (H6).
The minted level lives EXCLUSIVELY on the VM's level engine; `MAX(level_id)` in
any WSL table is a LAGGING PROXY, never the truth. So this reader is PURE-SSH:

  * It imports NO `sqlite3` and opens NO local DB — reading `MAX(level_id)` is
    therefore STRUCTURALLY UNREACHABLE, not merely avoided.
  * It reads the level chain ONLY via the VM CLI over the read-only `ssh vm`
    pipe: `scripts/level/level_query.py {current, money-path-at N, integrity,
    config-tested-at}` under `sudo -u trevor`.
  * `current` is the GATE: on ANY failure of that call (nonzero exit / ssh
    failure / timeout / empty stdout / malformed JSON) it returns a distinct
    {"status":"unknown","reason":...} — NEVER a guessed or proxied level.
    FAIL-FAST: a failed `current` short-circuits (the other calls are not fired),
    bounding worst-case latency to ~1x the ssh connect timeout.

The secondary enrichments (history / integrity / config-tested) are BEST-EFFORT
once `current` succeeds (the pipe is proven up) — a flaky secondary degrades that
one field to `unavailable`, it never fabricates or hides a KNOWN level.

VACUOUS-OK: at L0 with no money-path changes above the baseline, the level
engine's L10 integrity checks pass `ok:true` VACUOUSLY (nothing to check).
R10-B2 draws that distinction; so does this reader — it flags `vacuous:true`
so the tab renders "checks ran — nothing to check yet", NEVER a verified pass.

CONFIG-TESTED is scaffolded (`config-tested-at` always returns
`{populated:false, r8_dependency:"awaiting R8..."}`) — surfaced as expected-empty,
NOT a fault.

HOME reset: runPython spawns children with HOME=/home/trevor, which breaks the
ssh key lookup — the subprocess env resets HOME=/home/ghost (the proven
query_memory_daily.py / query_wedge_metrics.py discipline).

The route wraps this in safeJsonParse + a fallback so a Python error can never
become an HTTP 500; the component renders `status:"unknown"` as
"level: unknown (pipe unavailable)".

Test seams (env, default-inert in production — a dead host can outlive ssh's own
ConnectTimeout, so the hard subprocess timeout is the backstop):
  WATCHER_LEVEL_SSH_HOST         (default "vm")
  WATCHER_LEVEL_REMOTE_BASE      (default the level_query.py invocation)
  WATCHER_LEVEL_CONNECT_TIMEOUT  (default "10")
  WATCHER_LEVEL_TIMEOUT          (default "25", the hard subprocess timeout, secs)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any, Optional

_HOST = os.environ.get("WATCHER_LEVEL_SSH_HOST", "vm")
_REMOTE_BASE = os.environ.get(
    "WATCHER_LEVEL_REMOTE_BASE",
    "cd /home/trevor/trevor && sudo -u trevor python3 scripts/level/level_query.py",
)
_CONNECT_TIMEOUT = os.environ.get("WATCHER_LEVEL_CONNECT_TIMEOUT", "10")
try:
    _PROC_TIMEOUT = max(2, int(os.environ.get("WATCHER_LEVEL_TIMEOUT", "25")))
except ValueError:
    _PROC_TIMEOUT = 25

# The baseline (level 0) config ref — the config-tested-at scaffold takes a
# config_ref arg; ENV-0 is the L0 baseline prompt_id (from money-path-at 0).
_BASELINE_CONFIG_REF = "ENV-0"

_MAX_HISTORY = 64  # hard cap on the money-path-at fan-out (bounds latency)


def _run_level(cmd: str) -> tuple[Optional[Any], Optional[str]]:
    """Run one level_query.py sub-command over the ssh pipe. Returns (parsed, None)
    on success; (None, reason) on ANY failure mode. NEVER raises."""
    try:
        proc = subprocess.run(
            [
                "ssh", "-o", "BatchMode=yes",
                "-o", f"ConnectTimeout={_CONNECT_TIMEOUT}",
                _HOST, f"{_REMOTE_BASE} {cmd}",
            ],
            capture_output=True,
            text=True,
            timeout=_PROC_TIMEOUT,
            env={**os.environ, "HOME": "/home/ghost"},  # runPython sets HOME=/home/trevor
        )
    except subprocess.TimeoutExpired:
        return None, f"{cmd}: ssh/level_query timeout ({_PROC_TIMEOUT}s)"
    except Exception as exc:  # pragma: no cover — spawn failure
        return None, f"{cmd}: {type(exc).__name__}: {exc}"

    if proc.returncode != 0:
        # covers ssh failure (255, bad host / auth) AND a remote nonzero exit.
        stderr = (proc.stderr or "").strip()[:200] or "ssh failed"
        return None, f"{cmd}: nonzero exit {proc.returncode}: {stderr}"
    if not proc.stdout.strip():
        return None, f"{cmd}: empty output"
    try:
        return json.loads(proc.stdout.strip()), None
    except json.JSONDecodeError:
        return None, f"{cmd}: malformed JSON"


def _integrity_vacuous(current_level: int, integrity: Any) -> bool:
    """L0 + all checks ok + all findings empty => the checks ran but had nothing
    to check (vacuously true), NOT a verified pass."""
    if current_level != 0 or not isinstance(integrity, dict):
        return False
    if integrity.get("ok") is not True:
        return False
    checks = integrity.get("checks")
    if not isinstance(checks, list) or not checks:
        return False
    for c in checks:
        if not isinstance(c, dict) or c.get("ok") is not True:
            return False
        if c.get("findings"):  # any non-empty findings => a real check ran
            return False
    return True


def main() -> int:
    # ── GATE: current level. Any failure => hard UNKNOWN (never a proxied level).
    data, reason = _run_level("current")
    if data is None:
        print(json.dumps({"status": "unknown", "reason": reason}))
        return 0
    lvl = data.get("current_level") if isinstance(data, dict) else None
    # bool is an int subclass — reject it so `True`/`False` never reads as a level.
    if not isinstance(lvl, int) or isinstance(lvl, bool):
        print(json.dumps({"status": "unknown",
                          "reason": "current: missing/invalid current_level"}))
        return 0

    # ── best-effort enrichments (pipe is proven up; a flaky one degrades ONLY
    #    its own field — it never fabricates or hides the KNOWN level). ──────────
    history: list[dict[str, Any]] = []
    history_status = "ok"
    for n in range(0, min(lvl, _MAX_HISTORY) + 1):
        row, _ = _run_level(f"money-path-at {n}")
        if row is None or not isinstance(row, dict):
            history_status = "partial"
            break
        history.append({
            "level": row.get("level", n),
            "created_at": row.get("created_at"),
            "money_path_change": row.get("money_path_change"),
            "prompt_id": row.get("prompt_id"),
            "commit_hash": row.get("commit_hash"),
            "is_revert": bool(row.get("is_revert")),
            "notes": row.get("notes"),
        })

    integrity_raw, integ_reason = _run_level("integrity")
    if integrity_raw is None or not isinstance(integrity_raw, dict):
        integrity = {"status": "unavailable", "reason": integ_reason}
    else:
        integrity = {
            "status": "ok",
            "ok": bool(integrity_raw.get("ok")),
            "checks": integrity_raw.get("checks", []),
            "vacuous": _integrity_vacuous(lvl, integrity_raw),
        }

    cfg_raw, cfg_reason = _run_level(f"config-tested-at {_BASELINE_CONFIG_REF}")
    if cfg_raw is None or not isinstance(cfg_raw, dict):
        config_tested = {"status": "unavailable", "reason": cfg_reason}
    else:
        config_tested = {
            "status": "ok",
            "populated": bool(cfg_raw.get("populated")),
            "r8_dependency": cfg_raw.get("r8_dependency"),
            "tested_at_levels": cfg_raw.get("tested_at_levels", []),
        }

    print(json.dumps({
        "status": "ok",
        "current_level": lvl,
        "history": history,
        "history_status": history_status,
        "integrity": integrity,
        "config_tested": config_tested,
    }, default=str))
    return 0


if __name__ == "__main__":
    import traceback as _tb_wrap
    import sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        # On any unexpected crash: hard UNKNOWN, never a guessed level.
        print(json.dumps({"status": "unknown", "reason": "level reader crashed"}))
        _sys_wrap.exit(0)
