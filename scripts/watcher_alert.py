#!/usr/bin/env python3
"""RF2-C1 — WSL-local death-alert handler for the TREVOR oversight daemons.

Fired by systemd ``OnFailure=trevor-alert@%n.service`` when a monitored unit
reaches ``failed`` (a *sustained* crash — ``Restart=on-failure`` retries first,
so a single crash-and-recover fires NOTHING; only exhausting StartLimitBurst
gets here). Posts the failure to Discord and STATES which channel it landed in.

Why this file exists — the silent-lifecycle-failure class it kills:
  * WSL-LOCAL transport (WSL -> Discord over the internet), NOT WSL -> VM over the
    tailnet — which is exactly why it survives an unreachable-VM case. The VM-side
    RF3T1-B2 alert handler is VM-only with no VM->WSL path, so it cannot see these
    daemons; this handler can.
  * RATE-LIMIT: at most one post per unit per ALERT_INTERVAL_SEC (default 600s) via a
    marker file — a flapping unit cannot storm the channel. A rate-limited skip is
    LOGGED, never silent.
  * NO recursion: the ``trevor-alert@`` template carries NO ``OnFailure=`` of its own.
  * FAIL LOUD: any failure (import / resolve / non-2xx / exception) prints to stderr ->
    the handler's OWN journal, and does NOT record the marker (so the next failure of the
    same unit retries). A silent alert handler is the failure this file exists to end.

🚨 DELIVERY NOW LIVES IN ``scripts/alert_delivery.py`` (B6-ALERTS). The three-tier ladder
this file pioneered (B4-HUB-RESILIENCE) was MOVED there verbatim in behaviour so its three
sibling posters — external_liveness_check, watcher_arm_check, funnel_edge_watch — and the
budget alert reach #qa-agent through the SAME proven path instead of falling into the
artefact channel. Read that module for the ladder, the fail-open contract, the
three-valued double-post guard, and the 403 that makes tier 2 necessary. Nothing about
this handler's transport changed; it just stopped being the only one that had it.

🚨 EVERY QUOTED JOURNAL LINE IS SCRUBBED BEFORE IT LEAVES THE BOX. This box's journal
contains a leaked webhook URL (see alert_delivery.scrub), and this handler quotes the
journal into a Discord message — so an unscrubbed quote would re-publish the credential
to the very channel it protects. ``alert_delivery.scrub`` is applied to every line.

Honest blind spot: a total WSL->internet outage defeats any webhook. Stated, not hidden.

Usage:  watcher_alert.py <failed-unit-name>      (systemd passes %i = the failed unit)
Env (testing only):
  WATCHER_ALERT_DRY_RUN=1        build + resolve + print, do NOT post, do NOT mark
  WATCHER_ALERT_MARKER_DIR=DIR   override the rate-limit marker dir (keep the real one clean)
  WATCHER_ALERT_INTERVAL_SEC=N   override the rate-limit window
Exit: 0 posted / dry-run / rate-limited (deliberate)  |  1 post failed (loud)  |  2 usage
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# The scripts dir is on sys.path[0] when run as `python3 scripts/watcher_alert.py`,
# but pin it so `import alert_delivery` resolves regardless of cwd.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

REPO = _HERE.parent
DEFAULT_MARKER_DIR = REPO / "data" / ".alert_markers"
ALERT_INTERVAL_SEC = int(os.environ.get("WATCHER_ALERT_INTERVAL_SEC", "600"))

# M22 — was 15. The binding constraint is NOT taste: the house shape allows at most 4
# fact lines, one of which is the unit's own state, so 3 is what physically fits.
#
# 🚨 AND A BLIND TAIL AT ANY DEPTH IS A BAD INSTRUMENT — measured, not assumed. The last
# 15 lines of the real `trevor-tailsync.service` journal are ELEVEN lines of rsync byte
# counts; the last 5 are five of them. Depth was never the problem: a chronological tail
# shows whatever the unit said LAST, which on a chatty unit is progress noise, not the
# fault. So we scan a deeper window and SELECT the lines that look like a failure,
# falling back to the plain tail when nothing matches. Fewer lines, more signal.
JOURNAL_LINES = 3
JOURNAL_SCAN_LINES = 40
_ERR_RE = re.compile(
    r"\b(error|errno|fail(ed|ure)?|fatal|critical|traceback|exception|"
    r"refus\w*|denied|timed?[ -]?out|unreachable|cannot|could not|no such|"
    r"permission|abort\w*|killed|segfault)\b", re.I)


def _loud(msg: str) -> None:
    """Everything the handler says goes to stderr -> its own systemd journal."""
    print(f"[watcher_alert] {msg}", file=sys.stderr, flush=True)


def _marker_path(unit: str) -> Path:
    mdir = Path(os.environ.get("WATCHER_ALERT_MARKER_DIR", str(DEFAULT_MARKER_DIR)))
    safe = unit.replace("/", "_")
    return mdir / f"{safe}.ts"


def _rate_limited(unit: str, now: float) -> bool:
    """True if we posted for this unit within ALERT_INTERVAL_SEC. Fails OPEN (never
    suppresses a real alert on a marker read error).

    🚨 FAIL-OPEN IS LOAD-BEARING AND IS NOT SHARED. This limiter stays local to the
    death-alert handler and is deliberately NOT in alert_delivery: a rate limit sitting
    in the shared transport could silently swallow another poster's first-ever alert.
    """
    mp = _marker_path(unit)
    try:
        last = float(mp.read_text().strip())
    except (OSError, ValueError):
        return False
    return (now - last) < ALERT_INTERVAL_SEC


def _record_marker(unit: str, now: float) -> None:
    mp = _marker_path(unit)
    try:
        mp.parent.mkdir(parents=True, exist_ok=True)
        tmp = mp.with_suffix(".ts.tmp")
        tmp.write_text(f"{now}\n")
        tmp.replace(mp)
    except OSError as exc:  # a marker-write failure must not swallow a successful post
        _loud(f"WARNING: could not record rate-limit marker for {unit}: {exc}")


def _run(args: list[str], timeout: int) -> str:
    """Best-effort subprocess text; never raises (a diagnostic gatherer must not crash
    the alert). Returns '' on any failure."""
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return (p.stdout or "").strip()
    except Exception as exc:  # noqa: BLE001 - diagnostics are best-effort by design
        _loud(f"note: `{' '.join(args)}` failed: {exc}")
        return ""


def unit_state_fact(unit: str) -> str:
    """One plain-English line from `systemctl show` — never the raw KEY=value block.

    The old body pasted six machine properties into a code fence. That is the raw-dict
    shape the house rules forbid: it is longer, and it makes a reader parse `Result=`
    and `ExecMainStatus=` to learn 'it exited 1 after 3 restarts'.

    🚨 NEVER-STARTED AND RAN-AND-SUCCEEDED USED TO RENDER IDENTICALLY, AS `inactive/dead`.
      `Result` is suppressed below when it reads `success` and `ExecMainStatus` when it
      reads `0` — sensible, except that BOTH ARE THE INITIAL VALUES OF FIELDS THAT ARE
      NEVER POPULATED UNTIL A MAIN PROCESS RUNS. A unit that has never started in its
      life reports `Result=success, ExecMainStatus=0` and was therefore described here
      in exactly the same words as one that ran and exited cleanly.

      Measured [B9] 2026-08-11 across a four-unit control matrix on two boxes — the
      container's `trevor-vm-gateway` and WSL's `trevor-restore` (both never run) vs
      WSL's `trevor-tailsync` and the container's `trevor.service` (both run): the
      never-run pair reported `Result=success ExecMainStatus=0` with an EMPTY
      `ExecMainStartTimestamp` and `ConditionResult=no`, while the run pair reported the
      identical Result/status with a populated timestamp and `ConditionResult=yes`.
      `trevor-vm-gateway` carries no `Condition*`/`Assert*` directives at all, which is
      what proves `ConditionResult=no` there is a never-evaluated default rather than a
      failed check.

      So `ExecMainStartTimestamp` being empty is the discriminator, and it is stated
      rather than implied. This is the project's archetype — a green reading produced by
      a field nobody ever wrote — sitting in the death-alert path itself.
    """
    out = _run(["systemctl", "show", unit,
                "--property=ActiveState,SubState,Result,ExecMainStatus,ExecMainCode,"
                "NRestarts,ExecMainStartTimestamp,UnitFileState,LoadState",
                "--no-pager"], timeout=10)
    if not out:
        return "state: systemd could not be queried"
    props = dict(ln.split("=", 1) for ln in out.splitlines() if "=" in ln)
    bits = [f"{props.get('ActiveState', '?')}/{props.get('SubState', '?')}"]

    # 🚨 UNRESOLVABLE OUTRANKS NEVER-STARTED, and this ordering was found by driving it:
    #   `systemctl show` answers for a unit that DOES NOT EXIST with the same empty
    #   `ExecMainStartTimestamp`, so the never-started branch below claimed a nonexistent
    #   unit "has never run" — true, and misleading, because it implies the unit is there.
    #   Mirrors `external_liveness_check._unit_state`, which already treats an
    #   unresolvable unit as its own answer rather than folding it into a verdict.
    if props.get("LoadState", "") != "loaded":
        return ("state: UNRESOLVABLE — systemd has no such unit on this box "
                f"(LoadState={props.get('LoadState', '?')}). Check the unit name and the box.")

    # The discriminator comes FIRST and short-circuits: if no main process has ever run,
    # every other field below is an initial value and reporting them would be inventing
    # an outcome for something that never happened.
    if not props.get("ExecMainStartTimestamp", "").strip():
        bits.append("NEVER STARTED — no main process has ever run for this unit")
        unit_file = props.get("UnitFileState", "")
        if unit_file:
            bits.append(f"unit file is {unit_file}")
        bits.append("its `success`/exit-0 are unwritten defaults, not an outcome")
        return "state: " + " · ".join(bits)

    result = props.get("Result", "")
    if result and result != "success":
        bits.append(f"result {result}")
    code = props.get("ExecMainStatus", "")
    if code not in ("", "0"):
        bits.append(f"exit code {code}")
    restarts = props.get("NRestarts", "")
    if restarts not in ("", "0"):
        bits.append(f"{restarts} restart(s) before it gave up")
    return "state: " + " · ".join(bits)


def journal_facts(unit: str) -> list[str]:
    """Up to JOURNAL_LINES plain lines, error-preferring, SCRUBBED.

    🚨 The scrub is not hygiene here — the journal on this box demonstrably contains a
    full Discord webhook URL, and this function's output is posted to Discord.
    """
    from alert_delivery import scrub  # type: ignore

    raw = _run(["journalctl", "-u", unit, "-n", str(JOURNAL_SCAN_LINES),
                "--no-pager", "-o", "cat"], timeout=10)
    if not raw:
        return ["log: journal unavailable"]
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return ["log: journal empty"]
    hits = [ln for ln in lines if _ERR_RE.search(ln)]
    picked = (hits or lines)[-JOURNAL_LINES:]
    out = [f"log: {scrub(ln)}" for ln in picked]
    if not hits:
        # Say ONCE that these are the plain tail, not selected failure lines — repeating
        # the caveat per line burned ~120 chars of a 900-char budget to say it three times.
        out[0] = (f"log (no error line in the last {JOURNAL_SCAN_LINES}; plain tail follows): "
                  + out[0][5:])
    return out


def build_message(unit: str, channel_label: str, note: str | None,
                  state_fact: str, log_facts: list[str], stamp: str) -> str:
    """The house shape. Names the channel AND the mechanism (the RF2-C1 contract)."""
    from alert_delivery import SEV_BROKEN, house_alert  # type: ignore

    facts = [state_fact] + list(log_facts)
    if note:
        facts.append(note)
    return house_alert(
        SEV_BROKEN,
        f"`{unit}` died and systemd has stopped retrying it",
        facts,
        "This daemon is DOWN now and will not come back on its own — it needs a restart.",
        f"watcher_alert · sent to {channel_label}",
        stamp=stamp,
    )


def main(argv: list[str]) -> int:
    from alert_delivery import et_stamp, post_alert  # type: ignore

    if len(argv) < 2 or not argv[1].strip():
        _loud("USAGE: watcher_alert.py <failed-unit-name> (systemd passes %i). No unit given.")
        return 2
    unit = argv[1].strip()
    now = datetime.now().timestamp()
    dry = os.environ.get("WATCHER_ALERT_DRY_RUN") == "1"

    if _rate_limited(unit, now):
        _loud(f"RATE-LIMITED: an alert for {unit} posted <{ALERT_INTERVAL_SEC}s ago — skipping "
              f"(deliberate; a flapping unit must not storm the channel).")
        return 0

    stamp = et_stamp()
    state_fact = unit_state_fact(unit)
    log_facts = journal_facts(unit)

    def render(channel_label: str, note: str | None) -> dict:
        return {"content": build_message(unit, channel_label, note,
                                         state_fact, log_facts, stamp)}

    result = post_alert(render, source=f"{unit}'s death alert", dry_run=dry, log=_loud)
    if result.ok and not dry:
        _record_marker(unit, now)
    if not result.ok:
        _loud("Not recording a marker (will retry on the next failure).")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
