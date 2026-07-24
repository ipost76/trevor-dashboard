#!/usr/bin/env python3
"""RF2-C1 / W15 — arm-time liveness check for the TREVOR watcher daemon.

🚨 THE ONLY COVER FOR A NON-START. `OnFailure=` fires on the failure of a *started* unit;
it NEVER fires on a unit that was never enabled or that refuses at startup. A daemon that is
CONFIGURED but never STARTS reads as expected-empty and nothing alarms — the campaign's
most-repeated defect class. This check is what makes that visible: run it right after
`enable --now` (and as a standing go-live-checklist step), and it POSTS the result — loud on
SUCCESS and loud on FAILURE — to Discord (#qa-agent once minted, else #downloads) so a human
sees it. "It logs to stderr" is not an answer; nothing reads the daemon's stderr on demand.

Asserts three things:
  (a) `systemctl is-active trevor-watcher.service` == active
  (b) a FRESH VM `loop_heartbeat` row for loop_name='watcher_loop' (proves pre_register ran) —
      age computed IN the VM's SQLite (strftime), so no naive-ET/UTC 4h-offset trap
  (c) a FRESH local `watcher_health` row (check_name='watcher_loop', data/watcher.db) — updated_at
      is ISO-8601-Z (UTC), parsed as UTC (no 4h trap)
Fresh = age < STALE_SEC (2× the 900s cadence = 1800s). ALL three must hold for PASS.

Run: watcher_arm_check.py            (posts the result to Discord; exit 0 PASS / 1 FAIL)
Env: WATCHER_ARM_DRY_RUN=1           build + print the verdict, do NOT post (for testing)
     WATCHER_ARM_UNIT=<unit>         override the unit name (default trevor-watcher.service)
Exit: 0 PASS (all fresh) | 1 FAIL (>=1 not fresh / unresolved) | 2 internal (post failed loud)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
REPO = _HERE.parent

UNIT = os.environ.get("WATCHER_ARM_UNIT", "trevor-watcher.service")
CADENCE_SEC = 900
STALE_SEC = 2 * CADENCE_SEC  # 1800
LOCAL_DB = REPO / "data" / "watcher.db"
VM_DB = "/home/trevor/trevor/trevor.db"
USER_AGENT = "trevor-watcher-arm-check/1 (RF2-C1)"

# VM program: read loop_heartbeat READ-ONLY and compute age in the VM's own SQLite clock.
_VM_PROG = (
    "import sqlite3, json\n"
    "try:\n"
    f"    c=sqlite3.connect('file:{VM_DB}?mode=ro', uri=True)\n"
    "    r=c.execute(\"SELECT last_iteration_at, "
    "CAST(strftime('%s','now')-strftime('%s',last_iteration_at) AS INTEGER) "
    "FROM loop_heartbeat WHERE loop_name='watcher_loop'\").fetchone()\n"
    "    c.close()\n"
    "    print(json.dumps({'present': False}) if r is None else "
    "json.dumps({'present': True, 'last_iteration_at': r[0], 'age_sec': r[1]}))\n"
    "except Exception as e:\n"
    "    print(json.dumps({'error': str(e)}))\n"
)


def check_active() -> tuple[bool, str]:
    try:
        p = subprocess.run(["systemctl", "is-active", UNIT],
                           capture_output=True, text=True, timeout=10)
        state = (p.stdout or "").strip() or "unknown"
        return state == "active", f"is-active={state}"
    except Exception as exc:  # noqa: BLE001
        return False, f"is-active=UNKNOWN ({exc})"


def check_vm_heartbeat() -> tuple[bool, str]:
    """Fresh watcher_loop loop_heartbeat on the VM. UNKNOWN (=> not-fresh) on any ssh failure —
    fail toward 'not verified', never a false green."""
    try:
        env = {**os.environ, "HOME": "/home/ghost"}
        p = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "vm",
             "sudo", "-n", "-u", "trevor", "python3", "-"],
            input=_VM_PROG, capture_output=True, text=True, timeout=30, env=env)
        if p.returncode != 0:
            return False, f"loop_heartbeat=UNKNOWN (ssh rc={p.returncode}: {(p.stderr or '').strip()[:120]})"
        data = json.loads((p.stdout or "").strip().splitlines()[-1])
    except Exception as exc:  # noqa: BLE001
        return False, f"loop_heartbeat=UNKNOWN ({exc})"
    if data.get("error"):
        return False, f"loop_heartbeat=UNKNOWN (vm: {data['error']})"
    if not data.get("present"):
        return False, "loop_heartbeat=ABSENT (no watcher_loop row — pre_register never ran)"
    age = data.get("age_sec")
    if age is None:
        return False, "loop_heartbeat=UNKNOWN (age uncomputable)"
    fresh = abs(int(age)) < STALE_SEC
    return fresh, (f"loop_heartbeat={'FRESH' if fresh else 'STALE'} "
                   f"(age={age}s, last_iteration_at={data.get('last_iteration_at')})")


def check_local_health() -> tuple[bool, str]:
    """Fresh local watcher_health row (check_name='watcher_loop'). updated_at is ISO-Z UTC."""
    try:
        import sqlite3
        if not LOCAL_DB.exists():
            return False, "watcher_health=ABSENT (data/watcher.db missing)"
        c = sqlite3.connect(f"file:{LOCAL_DB}?mode=ro", uri=True)
        row = c.execute(
            "SELECT updated_at FROM watcher_health WHERE check_name='watcher_loop'").fetchone()
        c.close()
    except Exception as exc:  # noqa: BLE001
        return False, f"watcher_health=UNKNOWN ({exc})"
    if row is None or not row[0]:
        return False, "watcher_health=ABSENT (no watcher_loop self-health row)"
    try:
        ts = datetime.fromisoformat(str(row[0]).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - ts).total_seconds()
    except Exception as exc:  # noqa: BLE001
        return False, f"watcher_health=UNKNOWN (bad updated_at {row[0]!r}: {exc})"
    fresh = abs(age) < STALE_SEC
    return fresh, f"watcher_health={'FRESH' if fresh else 'STALE'} (age={int(age)}s, updated_at={row[0]})"


def _post(msg: str) -> int:
    """Post the verdict loud-either-way. Fails LOUD to stderr; returns process exit code."""
    if os.environ.get("WATCHER_ARM_DRY_RUN") == "1":
        print(f"[watcher_arm_check] DRY_RUN — not posting:\n{msg}", file=sys.stderr)
        return 0
    try:
        from funnel_edge_watch import QA_ENV_VAR, resolve_webhook  # type: ignore
        url, varname = resolve_webhook()
        import requests  # type: ignore
        resp = requests.post(url, json={"content": msg},
                             headers={"User-Agent": USER_AGENT}, timeout=15)
    except Exception as exc:  # noqa: BLE001
        print(f"[watcher_arm_check] FAILED to post the arm-check verdict: {exc}. "
              f"A human must see this line.", file=sys.stderr)
        return 2
    channel = "#qa-agent" if varname == QA_ENV_VAR else "#downloads (fallback)"
    if resp.status_code in (200, 204):
        print(f"[watcher_arm_check] verdict posted to {channel} (HTTP {resp.status_code}).",
              file=sys.stderr)
        return 0
    print(f"[watcher_arm_check] FAILED to deliver verdict to {channel}: HTTP {resp.status_code}.",
          file=sys.stderr)
    return 2


def main() -> int:
    checks = [("systemd", check_active()),
              ("vm-heartbeat", check_vm_heartbeat()),
              ("local-health", check_local_health())]
    all_ok = all(ok for _, (ok, _) in checks)
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    head = ("\u2705 **W15 arm-check PASS**" if all_ok else "\U0001F6A8 **W15 arm-check FAIL**")
    lines = [f"{head} — `{UNIT}` @ `{stamp}`"]
    for name, (ok, detail) in checks:
        lines.append(f"{'\u2713' if ok else '\u2717'} {name}: {detail}")
    if not all_ok:
        lines.append("_A non-start / refuse is invisible to OnFailure= — this check is its only cover._")
    msg = "\n".join(lines)
    print(msg)
    post_rc = _post(msg)
    # The daemon-liveness verdict drives the exit code; a post failure is surfaced as rc=2 only
    # when the verdict itself passed (so a broken alert path is never mistaken for a healthy arm).
    if not all_ok:
        return 1
    return post_rc if post_rc != 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
