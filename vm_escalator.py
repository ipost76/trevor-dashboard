#!/usr/bin/env python3
"""
vm_escalator.py — persistent consecutive-failure escalator for the VM RPC surfaces.
RM-CUTOVER Wave C · C4 Phase 3. Wires B3's reference implementation
(`escalator_counter.sh`, handed over in SHADOW_SAFETY.md §5.2) into WSL.

🚨 NO NEVER-RAISE CONTRACT IS REMOVED OR WEAKENED BY THIS FILE.
   `watcher_health._vm_python` still returns {"ok": False, ...} and still never
   raises. `WatcherHeartbeat.emit` still logs and continues. `trainer_loop._post`
   still returns None. Each of those contracts is individually CORRECT — they exist
   because removing them reintroduced alert spam. This module sits strictly ON TOP,
   counting booleans those surfaces ALREADY produce. It never re-probes, never
   re-derives health, and never decides that a surface is unhealthy on its own.

🚨 WHY THE COUNTER IS ON DISK.
   The existing counters are in-process and DIE ON RESTART — which is exactly how a
   sustained outage escapes notice, because every restart zeroes the count. This
   counter lives under ~/.local/state/ and survives the process. B3 proved this
   property by escalating on failure #3 across a restart where an in-process counter
   would have reset to 1; C4 re-proves it here against a real process.

B3's three properties, preserved:
  (1) COUNT, DON'T SENSE — count the clean boolean each surface already returns.
  (2) THRESHOLD IN TIME, NOT ITERATIONS — the watcher runs every 900 s and the
      trainer every 3600 s, so "3 iterations" means 45 min for one and 3 h for the
      other. Threshold: 3 CONSECUTIVE FAILURES **OR** 2 HOURS WITHOUT A SUCCESS,
      whichever comes first.
  (3) LATCHED — one BROKEN on crossing, one RECOVERED on clearing, NOTHING in
      between. That is precisely the anti-spam shape the never-raise contract
      protects, which is why adding this does not reintroduce the spam.

🚨 THE ONE DELIBERATE DEVIATION FROM B3'S REFERENCE.
   B3's `emit()` calls `logger -t ghostbox-alert`, which is GHOSTBOX's spine and does
   not exist on WSL. Delivery here is left to the CALLER, so that
   `external_liveness_check` can post through WSL's own ladder
   (`alert_delivery.post_alert`: tier 1 HUB_QA webhook -> tier 2 bot-token REST to
   #qa-agent -> tier 3 #downloads). A module that named the wrong spine would look
   identical to a working one right up until the day it had to page someone.

🚨 NEVER USES `systemctl` STATE. `active (running)` with NRestarts=0 persisted
   through a real 17-hour total VM outage. Only the RPC booleans are counted.

USAGE (library)
    import vm_escalator
    vm_escalator.record_result("watcher_vm_rpc", ok_bool)   # from the daemon
    verdict = vm_escalator.evaluate("watcher_vm_rpc")       # from the liveness check
USAGE (cli, for proofs)
    python3 scripts/vm_escalator.py record <surface> <ok|fail>
    python3 scripts/vm_escalator.py evaluate <surface>
    python3 scripts/vm_escalator.py show <surface>
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

# WSL-local, outside the repo, survives a process restart by construction.
STATE_DIR = Path(
    os.environ.get("VM_ESCALATOR_STATE_DIR", str(Path.home() / ".local/state/trevor-vm-escalator"))
)

FAIL_THRESHOLD = int(os.environ.get("VM_ESCALATOR_FAIL_THRESHOLD", "3"))
TIME_THRESHOLD_S = int(os.environ.get("VM_ESCALATOR_TIME_THRESHOLD_S", "7200"))  # 2 hours

# The surfaces this escalator covers. Each is a VM RPC boundary that fails SILENT
# today (A7 §11 rows #12–#16, #29, #30; A7 §3.5's measured asymmetry table).
SURFACE_WATCHER = "watcher_vm_rpc"
SURFACE_TRAINER = "trainer_vm_rpc"


def _path(surface: str, kind: str) -> Path:
    safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in surface)
    return STATE_DIR / f"{safe}.{kind}"


def _read(surface: str) -> dict:
    p = _path(surface, "json")
    try:
        with open(p) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        # A corrupt state file must not be read as health. Treat as unknown and let
        # the next success rewrite it; never silently assume zero failures.
        return {}


def _write(surface: str, state: dict) -> bool:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        p = _path(surface, "json")
        tmp = str(p) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2, sort_keys=True)
        os.replace(tmp, p)
        return True
    except Exception:
        return False


def record_result(surface: str, ok: bool, *, now: float | None = None) -> dict:
    """(1) COUNT, DON'T SENSE. Feed the boolean the surface already returned.

    🚨 NEVER RAISES. This is called from inside never-raise transports; an exception
    here would break the very contract this module promises not to weaken.
    """
    try:
        now = time.time() if now is None else now
        st = _read(surface)
        if ok:
            st.update({
                "surface": surface, "consecutive_failures": 0,
                "last_ok_ts": now, "last_result": "ok", "last_update_ts": now,
                "last_error": None,
            })
        else:
            st.update({
                "surface": surface,
                "consecutive_failures": int(st.get("consecutive_failures", 0)) + 1,
                # 🚨 If we have never seen a success, seed last_ok_ts to NOW rather
                #    than 0. Seeding to 0 would make the 2-hour time arm fire on the
                #    very first failure after a fresh install — a false page, which
                #    is the spam the never-raise contracts exist to prevent.
                "last_ok_ts": st.get("last_ok_ts", now),
                "last_result": "fail", "last_update_ts": now,
            })
        # The latch is owned by evaluate(); preserve whatever it last set.
        st.setdefault("latch", "OK")
        _write(surface, st)
        return st
    except Exception:
        return {}


def evaluate(surface: str, *, now: float | None = None, latch: bool = True) -> dict:
    """(2) threshold in TIME or COUNT, whichever first · (3) LATCHED.

    Returns a verdict dict. `transition` is the ONLY field a caller should alert on:
      "BROKEN"     -> crossed just now; post ONE alert
      "RECOVERED"  -> cleared just now; post ONE alert
      None         -> nothing to say. Includes the case of a surface that has been
                      BROKEN for hours: silence there is the anti-spam contract
                      working, NOT evidence of health.
    """
    now = time.time() if now is None else now
    st = _read(surface)
    if not st:
        return {"surface": surface, "state": "UNKNOWN", "transition": None,
                "why": "no state file — the daemon has not recorded a result yet",
                "consecutive_failures": None, "seconds_since_ok": None}

    fails = int(st.get("consecutive_failures", 0))
    last_ok = float(st.get("last_ok_ts", now))
    age = max(0.0, now - last_ok)
    prev_latch = st.get("latch", "OK")

    count_arm = fails >= FAIL_THRESHOLD
    time_arm = fails > 0 and age >= TIME_THRESHOLD_S
    broken = count_arm or time_arm

    why_bits = []
    if count_arm:
        why_bits.append(f"{fails} consecutive failures")
    if time_arm:
        why_bits.append(f"{int(age)}s ({int(age // 60)}m) without a success")
    why = " and ".join(why_bits) if why_bits else "below threshold"

    new_latch = "BROKEN" if broken else "OK"
    transition = None
    if new_latch != prev_latch:
        transition = "BROKEN" if new_latch == "BROKEN" else "RECOVERED"
        if latch:
            st["latch"] = new_latch
            _write(surface, st)

    return {
        "surface": surface,
        "state": new_latch,
        "transition": transition,
        "why": why,
        "consecutive_failures": fails,
        "seconds_since_ok": int(age),
        "thresholds": {"fails": FAIL_THRESHOLD, "seconds": TIME_THRESHOLD_S},
        "latched_silent": broken and transition is None,
    }


def _cli(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: vm_escalator.py <record|evaluate|show> <surface> [ok|fail]",
              file=sys.stderr)
        return 2
    cmd = argv[0]
    surface = argv[1]
    if cmd == "record":
        if len(argv) < 3 or argv[2] not in ("ok", "fail"):
            print("usage: vm_escalator.py record <surface> <ok|fail>", file=sys.stderr)
            return 2
        print(json.dumps(record_result(surface, argv[2] == "ok"), indent=2, sort_keys=True))
        return 0
    if cmd == "evaluate":
        v = evaluate(surface)
        print(json.dumps(v, indent=2, sort_keys=True))
        return 1 if v.get("state") == "BROKEN" else 0
    if cmd == "show":
        print(json.dumps(_read(surface), indent=2, sort_keys=True))
        return 0
    print(f"unknown command {cmd!r}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
