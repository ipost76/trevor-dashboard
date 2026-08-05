#!/usr/bin/env python3
"""B3 / RM-WATCH — EXTERNAL liveness checks for the R10 watcher and the R9 trainer.

🚨 THE POINT: both components that are supposed to watch TREVOR for the paper window were
watched only BY THEMSELVES. This process is outside both of them.

  T-5  `scripts/watcher_arm_check.py` (W15) is the only cover for a watcher NON-START —
       `OnFailure=` fires only on a *started* unit that failed, never on one that never armed.
       W15 works, but it had ZERO invokers: no timer, no cron, no unit. Measured B3.
  T-6  the trainer's `loop_heartbeat` staleness was checked ONLY by
       `watcher_surface.py::check_loop_freshness()` — inside the watcher. The two VM-side
       checkers that could have caught it (`trevor-observatory`, `trevor-monitor-center`) are
       both masked -> /dev/null since 2026-07-19. If the watcher dies, its own liveness check
       dies with it.

🚨 WHY THIS READS THE VM AND NOT THE LOCAL REPLICA. `/home/trevor/trevor/trevor.db` as seen
   from WSL is a symlink to the 0444 litestream replica. Measured B3, same instant:
       replica watcher_loop age = 2036s        VM live watcher_loop age = 35s
   The replica is up to ~30 min behind, which is PAST the 1800s watcher threshold. A checker
   reading the replica pages on a perfectly healthy system, and then gets muted — which is
   worse than no checker. The heartbeat is written cross-box to the VM's live trevor.db over
   the ssh pipe (trainer_loop.py:585-609), so that is the store we read. READ-ONLY (mode=ro):
   this is a monitor, never a writer.

🚨 THE CLOCK. `loop_heartbeat.last_iteration_at` is offset-aware ISO **UTC**
   (`2026-08-05T13:02:14.055328+00:00`), NOT the naive-Eastern form used by
   `auto_trades.opened_at`. Age is computed IN the VM's own SQLite via strftime('%s',...),
   which honours the offset — so there is no 4h phantom-staleness/phantom-freshness trap.
   Proof recorded B3: the same query returns age=5s for `auto_trader_monitor_loop`, a
   seconds-cadence loop; a 4h clock error would have read +/-14400s.

🚨 THREE STATES, AND UNKNOWN NEVER READS AS OK. `ok` / `bad` / `unknown`. A checker that can
   only say "healthy" or nothing is the instrument class this campaign exists to eliminate.
   Distinct UNKNOWN causes — ssh down, DB unreachable, systemctl unusable, no heartbeat row at
   all — are reported as UNKNOWN and alerted on, never collapsed into "fine". A definite BAD
   outranks an UNKNOWN (if we KNOW the unit is dead, say so).

Edge-triggered with persisted dedup (mirrors scripts/hub_monitor_watchdog.py on the VM):
alerts fire on a TRANSITION only, and the stored status advances ONLY on confirmed delivery,
so a webhook blip retries next tick instead of dropping the alert. Recovery clears
symmetrically — a flag that can only turn on is its own false-success.

Fail-open toward the system, fail-loud toward the operator: this NEVER touches the trainer,
the watcher or trading. Exit 0 = the check ran (verdict went to Discord); exit 1 = the checker
itself is broken (-> OnFailure= -> trevor-alert@), so a dead monitor is not a silent one.

Run:
  external_liveness_check.py             one check + edge-triggered alert (the timer entry)
  external_liveness_check.py --status    print the verdict; no alert, no state write

Env overrides (all optional; the defaults are the live values):
  LIVENESS_TRAINER_STALE_SEC   trainer staleness threshold (default 7200 = 2x its 3600s cadence,
                               deliberately identical to check_loop_freshness's own
                               max(3600, cadence*2) so the external check AGREES with the
                               internal one instead of minting a second truth)
  LIVENESS_TRAINER_LOOP        loop_heartbeat.loop_name to read (default trainer_search_loop)
  LIVENESS_TRAINER_UNIT        trainer unit (default trevor-trainer-observe.service)
  LIVENESS_VM_HOST             ssh alias for the VM (default vm)
  LIVENESS_VM_DB               VM live DB path (default /home/trevor/trevor/trevor.db)
  LIVENESS_STATE_FILE          dedup state (default data/liveness-check-state.json)
  LIVENESS_DRY_RUN=1           build + print the alert, do NOT post (tests use this)
"""
from __future__ import annotations

import argparse
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

TRAINER_STALE_SEC = int(os.environ.get("LIVENESS_TRAINER_STALE_SEC", "7200"))
TRAINER_LOOP = os.environ.get("LIVENESS_TRAINER_LOOP", "trainer_search_loop")
TRAINER_UNIT = os.environ.get("LIVENESS_TRAINER_UNIT", "trevor-trainer-observe.service")
VM_HOST = os.environ.get("LIVENESS_VM_HOST", "vm")
VM_DB = os.environ.get("LIVENESS_VM_DB", "/home/trevor/trevor/trevor.db")
STATE_FILE = Path(os.environ.get(
    "LIVENESS_STATE_FILE", str(REPO / "data" / "liveness-check-state.json")))
ARM_CHECK = _HERE / "watcher_arm_check.py"
USER_AGENT = "trevor-external-liveness-check/1 (B3)"

OK, BAD, UNKNOWN = "ok", "bad", "unknown"
_ICON = {OK: "\u2705", BAD: "\U0001F6A8", UNKNOWN: "\u2753"}


def _worst(states: list[str]) -> str:
    """A definite BAD outranks an UNKNOWN: if we KNOW something is broken, say so."""
    if BAD in states:
        return BAD
    if UNKNOWN in states:
        return UNKNOWN
    return OK


# ── probe 1: the watcher's arm check (T-5) ───────────────────────────────────
# Runs the EXISTING W15 script unmodified, under WATCHER_ARM_DRY_RUN=1 so IT does not post —
# dedup is ours. The manual path (`python3 scripts/watcher_arm_check.py`) is untouched and
# still posts loud-either-way, which is the RF2-C1 go-live contract.
#
# 🚨 W15's EXIT CODE CANNOT SEPARATE UNKNOWN FROM BAD: check_vm_heartbeat() returns False for
#    both "STALE" and "ssh unreachable" (fail toward not-verified — correct, never a false
#    green, but lossy). Its MESSAGE TEXT does distinguish them, so we classify from the text.
def probe_watcher_arm() -> tuple[str, list[str]]:
    if not ARM_CHECK.exists():
        return UNKNOWN, [f"arm-check script MISSING at {ARM_CHECK}"]
    try:
        env = {**os.environ, "WATCHER_ARM_DRY_RUN": "1", "HOME": "/home/ghost"}
        p = subprocess.run([sys.executable or "/usr/bin/python3", str(ARM_CHECK)],
                           capture_output=True, text=True, timeout=90,
                           cwd=str(REPO), env=env)
    except subprocess.TimeoutExpired:
        return UNKNOWN, ["arm-check TIMED OUT after 90s (ssh pipe hung?)"]
    except Exception as exc:  # noqa: BLE001
        return UNKNOWN, [f"arm-check could not be run: {exc}"]

    # W15 prints the verdict block to stdout (and again to stderr under DRY_RUN).
    lines = [ln.strip() for ln in (p.stdout or "").splitlines() if ln.strip()]
    failed = [ln for ln in lines if ln.startswith("\u2717")]
    if not lines:
        return UNKNOWN, [f"arm-check produced no verdict (rc={p.returncode}); "
                         f"stderr: {(p.stderr or '').strip()[:160]}"]
    if p.returncode == 0 and not failed:
        detail = [ln for ln in lines if ln.startswith("\u2713")]
        return OK, detail or ["all three arm checks fresh"]
    if not failed:
        # Non-zero with nothing marked failed = W15 itself misbehaved (e.g. rc=2 post failure,
        # which DRY_RUN should make impossible). Do not guess it healthy.
        return UNKNOWN, [f"arm-check rc={p.returncode} with no failed check listed"]
    # ABSENT is an UNKNOWN by design: "no heartbeat row at all" is indistinguishable from a
    # store that was reset, and must never be rounded to a definite verdict either way.
    unresolved = [ln for ln in failed if "UNKNOWN" in ln or "ABSENT" in ln]
    return (UNKNOWN if unresolved else BAD), failed


# ── probe 2: the trainer's heartbeat (T-6) ───────────────────────────────────
_VM_PROG = (
    "import sqlite3, json\n"
    "try:\n"
    f"    c=sqlite3.connect('file:{VM_DB}?mode=ro', uri=True)\n"
    "    r=c.execute(\"SELECT last_iteration_at, "
    "CAST(strftime('%s','now')-strftime('%s',last_iteration_at) AS INTEGER), "
    "COALESCE(iteration_count,-1), COALESCE(is_dormant,0) "
    f"FROM loop_heartbeat WHERE loop_name='{TRAINER_LOOP}'\").fetchone()\n"
    "    c.close()\n"
    "    print(json.dumps({'present': False}) if r is None else "
    "json.dumps({'present': True, 'last_iteration_at': r[0], 'age_sec': r[1], "
    "'iteration_count': r[2], 'is_dormant': r[3]}))\n"
    "except Exception as e:\n"
    "    print(json.dumps({'error': str(e)}))\n"
)


def _unit_state(unit: str) -> tuple[str, str]:
    """(state, detail). systemctl unusable -> UNKNOWN; a definite inactive/failed -> BAD."""
    try:
        p = subprocess.run(["systemctl", "is-active", unit],
                           capture_output=True, text=True, timeout=15)
    except Exception as exc:  # noqa: BLE001
        return UNKNOWN, f"unit={unit} is-active=UNKNOWN ({exc})"
    state = (p.stdout or "").strip()
    if not state:
        return UNKNOWN, f"unit={unit} is-active=UNKNOWN (no output, rc={p.returncode})"
    if state == "active":
        return OK, f"unit={unit} active"
    # `unknown` is systemd's answer for a unit it cannot resolve (no such unit file) — that is
    # a different fact from "the daemon is dead", so it stays UNKNOWN.
    if state == "unknown":
        return UNKNOWN, f"unit={unit} UNRESOLVABLE (no such unit file on this box)"
    return BAD, f"unit={unit} is-active={state}"


def probe_trainer_heartbeat() -> tuple[str, list[str]]:
    unit_state, unit_detail = _unit_state(TRAINER_UNIT)
    details = [unit_detail]

    try:
        env = {**os.environ, "HOME": "/home/ghost"}
        p = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", VM_HOST,
             "sudo", "-n", "-u", "trevor", "python3", "-"],
            input=_VM_PROG, capture_output=True, text=True, timeout=45, env=env)
        if p.returncode != 0:
            details.append(f"loop_heartbeat={UNKNOWN.upper()} (ssh rc={p.returncode}: "
                           f"{(p.stderr or '').strip()[:120]})")
            return _worst([unit_state, UNKNOWN]), details
        data = json.loads((p.stdout or "").strip().splitlines()[-1])
    except Exception as exc:  # noqa: BLE001
        details.append(f"loop_heartbeat=UNKNOWN ({exc})")
        return _worst([unit_state, UNKNOWN]), details

    if data.get("error"):
        details.append(f"loop_heartbeat=UNKNOWN (vm sqlite: {data['error']})")
        return _worst([unit_state, UNKNOWN]), details
    if not data.get("present"):
        details.append(f"loop_heartbeat=ABSENT (no '{TRAINER_LOOP}' row — pre_register never ran)")
        return _worst([unit_state, UNKNOWN]), details
    age = data.get("age_sec")
    if age is None:
        details.append("loop_heartbeat=UNKNOWN (age uncomputable from last_iteration_at)")
        return _worst([unit_state, UNKNOWN]), details

    age = int(age)
    iters = data.get("iteration_count", -1)
    if data.get("is_dormant"):
        details.append(f"loop_heartbeat=DORMANT (is_dormant=1, age={age}s) — "
                       f"deliberately parked, not a failure")
        return _worst([unit_state, OK]), details
    # A NEGATIVE age means the row is in the future — clock skew between the boxes. Not fresh,
    # not stale: unresolved.
    if age < 0:
        details.append(f"loop_heartbeat=UNKNOWN (age={age}s is NEGATIVE — cross-box clock skew)")
        return _worst([unit_state, UNKNOWN]), details
    fresh = age < TRAINER_STALE_SEC
    details.append(
        f"loop_heartbeat={'FRESH' if fresh else 'STALE'} (age={age}s, "
        f"threshold={TRAINER_STALE_SEC}s, iterations={iters}, "
        f"last_iteration_at={data.get('last_iteration_at')})")
    return _worst([unit_state, OK if fresh else BAD]), details


# ── persisted dedup state ────────────────────────────────────────────────────
def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def _save_state(state: dict) -> bool:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = str(STATE_FILE) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2, sort_keys=True)
        os.replace(tmp, STATE_FILE)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[liveness] FAILED to persist dedup state to {STATE_FILE}: {exc}. "
              f"Dedup is not durable until this is fixed.", file=sys.stderr)
        return False


def _post(msg: str) -> bool:
    """Deliver via the ONE shared alert path (resolve_webhook: HUB_QA -> HUB_DOWNLOADS)."""
    if os.environ.get("LIVENESS_DRY_RUN") == "1":
        print(f"[liveness] DRY_RUN — not posting:\n{msg}", file=sys.stderr)
        return True
    try:
        from funnel_edge_watch import QA_ENV_VAR, resolve_webhook  # type: ignore
        url, varname = resolve_webhook()
        import requests  # type: ignore
        resp = requests.post(url, json={"content": msg},
                             headers={"User-Agent": USER_AGENT}, timeout=15)
    except Exception as exc:  # noqa: BLE001
        print(f"[liveness] FAILED to post the liveness alert: {exc}. "
              f"A human must see this line.", file=sys.stderr)
        return False
    channel = "#qa-agent" if varname == QA_ENV_VAR else "#downloads (fallback)"
    if resp.status_code in (200, 204):
        print(f"[liveness] alert posted to {channel} (HTTP {resp.status_code}).", file=sys.stderr)
        return True
    print(f"[liveness] FAILED to deliver to {channel}: HTTP {resp.status_code}.", file=sys.stderr)
    return False


_HEADLINE = {
    (OK, BAD): "\U0001F534 **DEAD / STALE**",
    (OK, UNKNOWN): "\u26A0\uFE0F **UNVERIFIABLE**",
    (BAD, OK): "\U0001F7E2 **RECOVERED**",
    (UNKNOWN, OK): "\U0001F7E2 **RECOVERED** (was unverifiable)",
    (BAD, UNKNOWN): "\u26A0\uFE0F **UNVERIFIABLE** (was dead/stale)",
    (UNKNOWN, BAD): "\U0001F534 **DEAD / STALE** (was unverifiable)",
}

_WHAT = {
    "watcher_arm": "the R10 watcher (`trevor-watcher.service`) — T-5",
    "trainer_heartbeat": f"the R9 trainer heartbeat (`{TRAINER_LOOP}`) — T-6",
}


def run(alert: bool = True) -> tuple[int, dict]:
    probes = {"watcher_arm": probe_watcher_arm(),
              "trainer_heartbeat": probe_trainer_heartbeat()}
    state = _load_state()
    prev_all = state.get("probes", {}) if isinstance(state.get("probes"), dict) else {}
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    internal_error = 0
    new_probes: dict = {}

    for name, (status, details) in probes.items():
        _raw = prev_all.get(name)
        prev_entry: dict = _raw if isinstance(_raw, dict) else {}
        prev = prev_entry.get("status", OK)
        entry = {"status": status, "last_checked": stamp,
                 "detail": details, "since": prev_entry.get("since", stamp)}
        if status != prev:
            entry["since"] = stamp
            if alert:
                head = _HEADLINE.get((prev, status), f"{_ICON[status]} **{status.upper()}**")
                body = [f"{head} — {_WHAT.get(name, name)}",
                        f"_external check, {prev} \u2192 {status}, @ `{stamp}`_"]
                body += [f"\u2022 {d}" for d in details]
                if status == UNKNOWN:
                    body.append("_UNKNOWN is NOT ok — the component could not be verified "
                                "either way. Treat as unmonitored until this clears._")
                if not _post("\n".join(body)):
                    # Delivery failed -> keep the PREVIOUS status so the next tick retries.
                    # An alert is never silently dropped.
                    entry["status"] = prev
                    entry["since"] = prev_entry.get("since", stamp)
                    entry["undelivered"] = status
                    internal_error = 1
        else:
            entry.pop("undelivered", None)
        new_probes[name] = entry

    state["probes"] = new_probes
    state["last_run"] = stamp
    if alert and not _save_state(state):
        internal_error = 1
    return internal_error, {n: probes[n] for n in probes}


def main() -> int:
    ap = argparse.ArgumentParser(description="External liveness checks for the watcher + trainer")
    ap.add_argument("--status", action="store_true",
                    help="print the verdict only — no alert, no state write")
    args = ap.parse_args()
    rc, probes = run(alert=not args.status)

    overall = _worst([s for s, _ in probes.values()])
    for name, (status, details) in probes.items():
        print(f"{_ICON[status]} {name}: {status.upper()}")
        for d in details:
            print(f"    {d}")
    print(f"overall: {overall.upper()}")
    # Exit 0 whenever the CHECK completed, whatever the verdict — the verdict travels by
    # Discord, and a bad verdict must not mark this unit `failed` (that would double-alert
    # through OnFailure=). Exit 1 means the CHECKER is broken, which is what OnFailure= is for.
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
