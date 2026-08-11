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

🚨 FOUR STATES, AND NEITHER UNKNOWN NOR DEGRADED READS AS OK. `ok` / `degraded` / `bad` /
   `unknown`. A checker that can only say "healthy" or nothing is the instrument class this
   campaign exists to eliminate. Distinct UNKNOWN causes — ssh down, DB unreachable, systemctl
   unusable, no heartbeat row at all — are reported as UNKNOWN and alerted on, never collapsed
   into "fine". A definite BAD outranks an UNKNOWN (if we KNOW the unit is dead, say so), and
   DEGRADED outranks UNKNOWN by the same rule: the loop TOLD us it is impaired, which is
   knowledge, not doubt. Order: bad > degraded > unknown > ok.

🚨 DEGRADED — WHY THE FOURTH STATE HAD TO EXIST (RM-TRAINER-B1). Until this was added the
   probe read four fields off the heartbeat row and never `degraded_reason`, so its whole
   test for the trainer was "is it fresh?". Measured on the live row 2026-08-06: the trainer
   was reporting `degraded_reason='no_simulator'` with `error_count` climbing every iteration
   BY DESIGN, age 1310s — comfortably inside the 7200s threshold — and this checker had been
   reporting `ok` since 2026-08-05T15:55:32, ~19 hours, off the same row it was already
   reading. Fresh is not the same fact as working. A loop that is alive and telling us it
   cannot do its job is neither healthy nor dead, and rounding it to either is the eroded-
   defence pattern: a guard that runs on schedule, passes, and is structurally blind to the
   fault sitting in the row it just read.

   🚨 LEVEL-TRIGGERED ON `degraded_reason`, NEVER EDGE-TRIGGERED ON `error_count`. The count
   climbs once per iteration for as long as the fault holds, so "the count went up" would
   fire every hour forever and get the channel muted. The state is derived from
   `degraded_reason` being non-empty; `error_count` is carried as CONTEXT ONLY and never
   votes. NULL and empty string are the same thing (not degraded). An ABSENT
   `degraded_reason` COLUMN is UNKNOWN, never ok — a schema that drifts must not be able to
   mint a clean bill of health. This matches `query_loop_heartbeat.classify` on live data
   (measured: 13 `ok`, 1 `degraded`, 0 `unpopulated`), so the two instruments agree.

   🚨 DEGRADED IS NOT A BUG TO BE CLEARED. `TRAINER_BACKTEST_PROVIDER` is unset ON PURPOSE —
   the simulator is built but failed its own 10% accuracy bar at 37.6%. Wiring it would turn
   an honest red into a false green. The job of this state is to make the impairment VISIBLE,
   never to resolve it.

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

# `degraded` is spelled EXACTLY as query_loop_heartbeat.DEGRADED and ranked in the same
# order as its _RANK (stale/bad > degraded > unknown > ok). Two instruments read the same
# column on the same row for the same operator; minting a second name for one fact is how
# they end up disagreeing in public.
OK, DEGRADED, BAD, UNKNOWN = "ok", "degraded", "bad", "unknown"
# \ud83d\udea8 EVERY state MUST have an icon. `_ICON[status]` is indexed unguarded in both run() and
# main(); a missing key raises KeyError -> exit != 0 -> OnFailure= -> trevor-alert@ fires a
# SECOND alert about the checker while the real verdict never ships. Adding a state without
# adding its icon breaks the exit-code contract this whole unit rests on.
_ICON = {OK: "\u2705", DEGRADED: "\U0001F7E0", BAD: "\U0001F6A8", UNKNOWN: "\u2753"}


def _worst(states: list[str]) -> str:
    """bad > degraded > unknown > ok.

    A definite BAD outranks an UNKNOWN: if we KNOW something is broken, say so. DEGRADED sits
    between them by the SAME rule \u2014 the loop reported its own impairment, so that is knowledge
    and it outranks "could not tell" \u2014 while a dead loop still outranks a merely impaired one.
    """
    if BAD in states:
        return BAD
    if DEGRADED in states:
        return DEGRADED
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
# 🚨 `degraded_reason` was added to loop_heartbeat by ALTER TABLE, so it is NOT guaranteed to
# exist on every copy of this schema. The column list is read with PRAGMA first and the SELECT
# is built around what is actually there: a DB without the column yields degraded_column=False
# (-> UNKNOWN on the WSL side), never a crash and never a silent green. Same guard for
# error_count. `__DB__`/`__LOOP__` are substituted with .replace() rather than %-formatting
# because the program is full of `%s` strftime specifiers that would collide.
_VM_PROG_TEMPLATE = r"""
import json, sqlite3
out = {}
try:
    c = sqlite3.connect("file:__DB__?mode=ro", uri=True)
    cols = [r[1] for r in c.execute("PRAGMA table_info(loop_heartbeat)").fetchall()]
    if not cols:
        raise RuntimeError("loop_heartbeat table is absent")
    has_dr = "degraded_reason" in cols
    sql = (
        "SELECT last_iteration_at, "
        "CAST(strftime('%s','now')-strftime('%s',last_iteration_at) AS INTEGER), "
        "COALESCE(iteration_count,-1), COALESCE(is_dormant,0), "
        + ("degraded_reason" if has_dr else "NULL") + ", "
        + ("COALESCE(error_count,-1)" if "error_count" in cols else "-1")
        + " FROM loop_heartbeat WHERE loop_name='__LOOP__'"
    )
    r = c.execute(sql).fetchone()
    c.close()
    if r is None:
        out = {"present": False, "degraded_column": has_dr}
    else:
        out = {"present": True, "last_iteration_at": r[0], "age_sec": r[1],
               "iteration_count": r[2], "is_dormant": r[3],
               "degraded_reason": r[4], "error_count": r[5],
               "degraded_column": has_dr}
except Exception as e:
    out = {"error": str(e)}
print(json.dumps(out))
"""
_VM_PROG = _VM_PROG_TEMPLATE.replace("__DB__", VM_DB).replace("__LOOP__", TRAINER_LOOP)


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
    # error_count is CONTEXT, never a verdict input — see the module docstring. It climbs once
    # per iteration while the fault holds, so deriving state from it would alert forever.
    errors = data.get("error_count", -1)
    details.append(
        f"loop_heartbeat={'FRESH' if fresh else 'STALE'} (age={age}s, "
        f"threshold={TRAINER_STALE_SEC}s, iterations={iters}, errors={errors}, "
        f"last_iteration_at={data.get('last_iteration_at')})")
    if not fresh:
        # Stopped outranks impaired: if it is not running, that is the more urgent fact.
        # Identical to query_loop_heartbeat.classify's ordering.
        return _worst([unit_state, BAD]), details
    # A DB with no degraded_reason column cannot tell a healthy loop from an impaired one, so
    # its silence is not evidence of health. Unresolvable, never green.
    if data.get("degraded_column") is False:
        details.append("loop_heartbeat=UNKNOWN (this DB has NO degraded_reason column — an "
                       "impaired loop would look identical to a healthy one here)")
        return _worst([unit_state, UNKNOWN]), details
    # Level-triggered: the state is "there is a reason", not "the reason changed". NULL and
    # empty string are the same fact.
    reason = (data.get("degraded_reason") or "").strip()
    if reason:
        details.append(
            f"loop_heartbeat=DEGRADED — the loop is RUNNING and reporting that it cannot do "
            f"its job: \"{reason[:220]}\" (error_count={errors}). Fresh is not the same fact "
            f"as working; this is NOT ok.")
        return _worst([unit_state, DEGRADED]), details
    return _worst([unit_state, OK]), details


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


def _loud(msg: str) -> None:
    print(f"[liveness] {msg}", file=sys.stderr, flush=True)


def _post(build) -> bool:
    """Deliver via the ONE shared alert path — alert_delivery.post_alert (B6-ALERTS).

    🚨 The ladder is tier 1 HUB_QA webhook -> tier 2 bot-token REST to #qa-agent ->
    tier 3 #downloads. Before B6 this resolved a webhook itself, so with HUB_QA absent
    (403 on Manage Webhooks, open since 2026-07-14) EVERY liveness verdict landed in
    #downloads among report drops. The resolver was never wrong; it just cannot express
    a bot-token transport, which is why the fix is a delivery helper and not a resolver.
    """
    from alert_delivery import post_alert  # type: ignore

    res = post_alert(lambda label, note: {"content": build(label, note)},
                     source="external liveness alert",
                     dry_run=os.environ.get("LIVENESS_DRY_RUN") == "1",
                     log=_loud)
    return res.ok


# Transition -> headline PHRASE. The icon and SEVERITY word are supplied by the house
# shape (alert_delivery.house_alert), so these carry the TRANSITION wording only — the
# thing a bare state name cannot say. "RECOVERED" is deliberately never used for a move
# INTO degraded: the impairment is the headline, not a shade of fine.
_HEADLINE = {
    (OK, BAD): "DEAD / STALE",
    (OK, UNKNOWN): "UNVERIFIABLE",
    (BAD, OK): "RECOVERED",
    (UNKNOWN, OK): "RECOVERED (was unverifiable)",
    (BAD, UNKNOWN): "UNVERIFIABLE (was dead/stale)",
    (UNKNOWN, BAD): "DEAD / STALE (was unverifiable)",
    (OK, DEGRADED): "IMPAIRED",
    (DEGRADED, OK): "RECOVERED (was impaired)",
    (DEGRADED, BAD): "DEAD / STALE (was impaired)",
    (BAD, DEGRADED): "IMPAIRED (was dead/stale — running again, still impaired)",
    (DEGRADED, UNKNOWN): "UNVERIFIABLE (was impaired)",
    (UNKNOWN, DEGRADED): "IMPAIRED (was unverifiable)",
}

# What the state MEANS for the operator — the house shape's "->" line. Every one of these
# says what is affected, never just a restatement of the state word.
_MEANING = {
    BAD: "This component is NOT running or has gone stale. Nothing else will raise it.",
    DEGRADED: ("DEGRADED is NOT ok — the loop is alive and reporting that it cannot do its "
               "job. It keeps ticking and keeps looking fresh, so nothing else will raise it."),
    UNKNOWN: ("UNKNOWN is NOT ok — the component could not be verified either way. "
              "Treat it as UNMONITORED until this clears."),
    OK: "The component is running and reporting normally again. No action needed.",
}


def _severity(status: str):
    """Map the four liveness states onto the four house severities.

    UNKNOWN folds into DEGRADED (⚠️) rather than BROKEN or INFO: 'could not verify' is
    not a clean bill of health and is not a confirmed death. The distinction between the
    two is preserved in the HEADLINE, which is where it belongs.
    """
    from alert_delivery import (SEV_BROKEN, SEV_DEGRADED,  # type: ignore
                                SEV_RECOVERED)
    return {BAD: SEV_BROKEN, DEGRADED: SEV_DEGRADED,
            UNKNOWN: SEV_DEGRADED, OK: SEV_RECOVERED}[status]


def build_alert(name: str, prev: str, status: str, details: list):
    """House-shaped alert builder: (channel_label, note) -> content string.

    🚨 The stamp is EASTERN (M27). This module computes everything else in UTC — the probe
    ages, the dedup state file — and that stays UTC because it is a machine record. The
    ALERT is read by a human on a phone, so it carries ET and names the box.
    """
    from alert_delivery import house_alert, scrub  # type: ignore

    def build(channel_label: str, note: str | None) -> str:
        facts = [f"transition: {prev} -> {status}"] + [scrub(d) for d in details]
        if note:
            facts.append(note)
        return house_alert(
            _severity(status),
            f"{_HEADLINE.get((prev, status), status.upper())}: {_WHAT.get(name, name)}",
            facts,
            _MEANING.get(status, ""),
            f"external_liveness_check · sent to {channel_label}",
        )

    return build


_WHAT = {
    "watcher_arm": "the R10 watcher (`trevor-watcher.service`) — T-5",
    "trainer_heartbeat": f"the R9 trainer heartbeat (`{TRAINER_LOOP}`) — T-6",
}


def probe_vm_rpc_escalator() -> tuple[str, list[str]]:
    """C4 Phase 3 (A7 §8.7) — surface the PERSISTENT consecutive-failure counter that
    `watcher_health._vm_python` feeds on every cycle.

    🚨 WHY THIS PROBE EXISTS. `trevor-watcher` is silent BOTH ways: it stayed
    `active (running)` with `NRestarts=0` through a real 17-hour total VM outage, and
    a restart with the VM absent is ALSO silent because it has no startup gate. Its
    never-raise contract is CORRECT and is not removed — this reads the boolean the
    watcher already produced and lets the existing liveness alerting say something.

    🚨 NO `systemctl` STATE IS CONSULTED. Unit state is not a liveness signal for
    this surface — that is the exact thing the 17-hour outage disproved. The
    assertion is on a real artifact: the on-disk counter and its timestamps.

    Latching: `vm_escalator.evaluate` owns the BROKEN/RECOVERED latch, and `run()`'s
    existing change-detection gates delivery, so a surface that has been broken for
    hours produces ONE alert, not one per tick. Silence after that is the anti-spam
    contract working — it is NOT evidence of health.
    """
    details: list[str] = []
    try:
        sys.path.insert(0, str(REPO))
        import vm_escalator  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        return UNKNOWN, [f"vm_escalator unavailable: {exc} — the counter cannot be read, "
                         f"which is NOT a clean bill of health"]

    v = vm_escalator.evaluate(vm_escalator.SURFACE_WATCHER)
    fails = v.get("consecutive_failures")
    age = v.get("seconds_since_ok")
    th = v.get("thresholds", {})

    if v.get("state") == "UNKNOWN":
        return UNKNOWN, [f"watcher VM-RPC escalator: {v.get('why')}. "
                         f"Absence of a counter is not evidence the RPC is healthy."]
    if v.get("state") == "BROKEN":
        details.append(
            f"watcher VM-RPC escalator BROKEN — {v.get('why')} "
            f"(thresholds: {th.get('fails')} consecutive failures OR {th.get('seconds')}s "
            f"without a success, whichever first). 🚨 trevor-watcher reports "
            f"`active (running)` throughout this condition and NRestarts stays 0 — unit "
            f"state is not a liveness signal here. The VM RPC has been failing silently.")
        if v.get("latched_silent"):
            details.append("(latched — already reported; repeats are suppressed by design)")
        return BAD, details
    details.append(
        f"watcher VM-RPC escalator ok — consecutive_failures={fails}, "
        f"last success {age}s ago")
    return OK, details


def run(alert: bool = True) -> tuple[int, dict]:
    probes = {"watcher_arm": probe_watcher_arm(),
              "trainer_heartbeat": probe_trainer_heartbeat(),
              "vm_rpc_escalator": probe_vm_rpc_escalator()}
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
                if not _post(build_alert(name, prev, status, details)):
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
