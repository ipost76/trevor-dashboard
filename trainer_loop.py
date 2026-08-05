#!/usr/bin/env python3
"""trainer_loop.py — the R9-B6 proposal→loop handoff + trainer heartbeat + daemon.

Three pieces, one module (one lock, one continuous daemon):

  1. ``R8HandoffClient`` — the clean interface to R8's VM-side shadow executor
     (`serve()` on the tailnet `:3941`, bearer ``SHADOW_EXECUTOR_TOKEN``). Three ops
     the WSL trainer hands over:
       • ``submit_proposal``   → ``shadow.route_proposal`` — the executor CLASSIFIES
         (pure, live-surface) and ROUTES: a *config* proposal (every axis+param in the
         live surface) self-creates an observe-only shadow tested in R8's loop; a
         *capability* proposal (any axis/param out of surface) writes a
         ``capability_requests`` Hub row Ghost turns into a CC build prompt. 🚨 The loop
         routes a REQUEST — it NEVER writes or applies code.
       • ``read_verdict``      → ``shadow.grade`` — the matched-data promote/reject
         signal. Reads ONLY ``gate_passed``. The math runs VM-side over the SAME
         un-lagged trevor.db (champion realized + challenger counterfactual, `mode=ro`);
         only the verdict bytes cross the tailnet. 🚨 NEVER the lagged GCS replica.
       • ``surface_candidate`` → ``shadow.surface_promotion_candidate`` — writes a
         ``promotion_candidates`` row for the R12 Hub. 🚨 SURFACES, NEVER RANKS/PROMOTES
         (§D.12.8): Ghost+CC decide priority. The client may sort-by-evidence for Hub
         DISPLAY only; the RPC payload carries just ``shadow_id``.

  2. ``TrainerHeartbeat`` — the silent-lifecycle-failure surface (A1 rec #6). The trainer
     is a continuous daemon (decision 4); a dead daemon stops discovery INVISIBLY. So it
     pre-registers a ``loop_heartbeat`` row (INSERT…ON CONFLICT — the pattern at
     scripts/shadow_readiness_gate.py:576, because ``_emit_loop_heartbeat`` is UPDATE-only)
     and bumps it each iteration. The row lives on the VM (trevor.db) so R8's existing
     ``08_service_health`` freshness monitor (``stale_threshold = max(3600, cadence×2)``)
     surfaces a stall for free. The loop_name is NOT in ``loop_registry.REMOVED_LOOPS``.

  3. ``run_trainer_loop`` — the continuous always-on search tying B1–B5 together:
       sample arm (B2) → pre-score on compass (B1) → self-pushback (B4, skip dead-ends)
       → submit to loop (1) → read verdict (1) → validate (B3) → narrate+log (B4)
       → update posteriors (B2) → surface promotions (1) → emit heartbeat (2).
     Self-throttled: the alpha-budget (B2/B3, inside ``validate_candidate``) throttles
     DISCOVERY; the $0.25/day API budget (B4, inside ``narrate_verdict``/``self_pushback``)
     throttles NARRATION. Always-on is safe because both throttles are enforced by the
     callees. The daemon NEVER auto-starts and is byte-identical inert with the flags off.

═══════════════════════════════════════════════════════════════════════════════
 THE TWO TRANSPORTS (R9-B6 design decision, Ghost-confirmed)
═══════════════════════════════════════════════════════════════════════════════
The three handoff ops go over R8's HTTP executor RPC (`:3941` + bearer) — that is
R8's surface, and R9 stays clean-separate from it (we do NOT add a heartbeat op to
R8's executor to unify transports). The heartbeat has no `:3941` op, so it reuses the
established WSL→VM ``ssh vm '… sudo -u trevor venv/bin/python3 …'`` pipe (mirrors the
other trainer modules' ``_vm_call``). Both transports are flag-OFF-safe and NEVER crash.

═══════════════════════════════════════════════════════════════════════════════
 FLAG-OFF-SAFE + NO AUTO-START
═══════════════════════════════════════════════════════════════════════════════
  • ``TRAINER_LOOP_ENABLED`` (default OFF) — the daemon master gate. Off → the loop does
    not run; import does NOTHING (no execution at import time; the entrypoint is explicit).
  • ``SHADOW_LOOP_EXECUTOR_ENABLED`` (default OFF) — the cross-box submission gate. As a
    WSL-side hint it short-circuits the HTTP entirely (nothing crosses); the VM executor
    is ALSO flag-gated (a running-but-OFF executor returns ``result: None``) and is not
    even started until R13. Either way the client no-ops cleanly and the loop keeps
    searching + logging locally. Both flags OFF = fully inert, nothing crosses.

The R8 executor's ``serve()`` is NOT auto-started (an R13 deploy step); a submission to a
down endpoint is caught and treated as a clean no-op (queued locally). A1 ⚠️#10.

money_path=no. Python 3, stdlib only. Reads/writes ``trainer.db`` via B0's connection;
uses B1–B5's modules. The trainer PROPOSES; Ghost APPROVES; nothing trades until R13.
"""
from __future__ import annotations

import base64
import json
import os
import shlex
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

# B0–B5 modules (import-safe on WSL; each gates its own live behavior behind a flag).
import trainer_bandit
import trainer_reasoning
import trainer_budget
import compass_metrics
from lib.trainer_db import get_connection, utc_now

# ── flags ───────────────────────────────────────────────────────────────────
LOOP_FLAG = "TRAINER_LOOP_ENABLED"                 # the daemon master gate (default OFF)
EXECUTOR_FLAG = "SHADOW_LOOP_EXECUTOR_ENABLED"     # the cross-box submission gate (default OFF)
PAUSE_POLL_FLAG = "TRAINER_PAUSE_POLL_ENABLED"     # R13-P1: the pause-poll arm (default OFF)
MEMORY_REASONING_FLAG = "MEMORY_REASONING_ENABLED"  # RF2-B2/W4: drive the memory projection (default OFF)
MEMORY_QUERY_FLAG = "MEMORY_QUERY_ENABLED"          # RF2-B2/W9: have_we_tested superset read (default OFF)
# RF2-B3: ONE flag gates BOTH the mid-run level-increment detector (W5-U5) AND the SL6
# anti-lobotomy sweep it enables. They are INSEPARABLE by construction (a detector with the
# sweep off silently detects flips and does nothing = the campaign's most-repeated defect
# class wearing a config file; a sweep with no detector is unreachable — the loop re-resolves
# the level only at main() start). One flag makes the detect-but-don't-sweep state UNREACHABLE.
LEVEL_DETECTOR_FLAG = "TRAINER_LEVEL_DETECTOR_ENABLED"  # RF2-B3/W5: detector + SL6 sweep (default OFF)
TEACH_FLAG = "TRAINER_TEACH_ENABLED"               # RF2-B3/W3: WSL-side teach arm (default OFF)
# T1: the OBSERVE-ONLY (paper-window) master gate — DELIBERATELY ITS OWN FLAG, never LOOP_FLAG.
# §D.9 step 3 opens a window where the trainer OBSERVES + SIMULATES but does NOT propose or
# promote. If observing reused LOOP_FLAG, one flip would arm BOTH observing and the propose
# path — defeating the DO-NOT-ENABLE-PENDING-L1 control rather than satisfying it. Two flags
# keep the propose gate OFF while the observe window runs. Default OFF; off → inert.
OBSERVE_FLAG = "TRAINER_OBSERVE_ONLY_ENABLED"      # T1: the paper-window observe gate (default OFF)
# RP-C2: names the optional compass pre-score simulator as "module:attr" (default ABSENT).
# 🚨 THIS IS THE SOCKET, NOT THE SIMULATOR — see `_resolve_backtest_fn`.
BACKTEST_PROVIDER_ENV = "TRAINER_BACKTEST_PROVIDER"


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def loop_enabled() -> bool:
    """The daemon master gate (default OFF). Off → ``run_trainer_loop`` is inert."""
    return _truthy(LOOP_FLAG)


def submissions_enabled() -> bool:
    """WSL-side hint for the cross-box submission gate (default OFF). Off → the client
    short-circuits every RPC to a local no-op (nothing crosses to the VM)."""
    return _truthy(EXECUTOR_FLAG)


def pause_poll_enabled() -> bool:
    """R13-P1 pause-poll arm (default OFF). Read ONCE at loop entry (a deploy-time arm, not
    a hot-flip) to decide whether ``run_trainer_loop`` constructs a pause poll; the pause
    STATE (``trainer_pause_state.paused``) is what's polled per-iteration. Off → the loop
    never polls and is byte-identical to R9-B6."""
    return _truthy(PAUSE_POLL_FLAG)


def memory_reasoning_enabled() -> bool:
    """RF2-B2/W4 arm (default OFF). Off → the loop never drives the memory projection and is
    byte-identical to R9-B6 (no import, no sweep). The projection wrapper is also flag-gated."""
    return _truthy(MEMORY_REASONING_FLAG)


def memory_query_enabled() -> bool:
    """RF2-B2/W9 arm (default OFF). Off → the self-pushback phase never calls have_we_tested
    (no import, no db) — the loop decision (is_known_dead_end via self_pushback) is unchanged."""
    return _truthy(MEMORY_QUERY_FLAG)


def level_detector_enabled() -> bool:
    """RF2-B3/W5 arm (default OFF). Off → ``run_trainer_loop`` constructs NO detector, never
    ssh-reads the level mid-run, never sweeps — the loop tags at the loop-START level and is
    byte-identical to R9-B6 (the U5 gap remains, dormant). Read ONCE at loop entry (a deploy-
    time arm). ONE flag = detector + sweep together (detect-but-don't-sweep is unreachable)."""
    return _truthy(LEVEL_DETECTOR_FLAG)


def observe_only_enabled() -> bool:
    """T1 paper-window observe gate (default OFF). Off → ``observe_main`` is inert and the
    observe path never runs. 🚨 SEPARATE from ``LOOP_FLAG`` on purpose: this arms OBSERVING
    without arming PROPOSING, so the below-L1 propose gate stays enforced during paper."""
    return _truthy(OBSERVE_FLAG)


def teach_enabled() -> bool:
    """RF2-B3/W3 WSL-side teach arm (default OFF). Off → the loop never calls
    ``recommend_execution_guidance`` (no import, nothing crosses). SEPARATE from the VM-side
    ``BOTBRAIN_TEACH_ENABLED`` fail-closed gate — BOTH must be on for a teach entry to land."""
    return _truthy(TEACH_FLAG)


# ── RPC / VM targets (env-overridable) ──────────────────────────────────────
_EXECUTOR_URL = os.environ.get("TRAINER_EXECUTOR_URL", "http://100.95.174.30:3941")
_EXECUTOR_TOKEN_ENV = "SHADOW_EXECUTOR_TOKEN"
_RPC_TIMEOUT = float(os.environ.get("TRAINER_RPC_TIMEOUT", "90"))
# The verdict is graded VM-side over the VM's OWN trevor.db. This is an ABSOLUTE VM path;
# it is NEVER a WSL/replica path (the matched-data + never-replica law — see _assert_vm_db).
_VM_TREVOR_DB_ABS = os.environ.get("TRAINER_VM_TREVOR_DB_ABS", "/home/trevor/trevor/trevor.db")
# A verdict DB path that looks like a lagged replica is REFUSED (belt-and-suspenders on
# top of grade() already opening no replica): a promote/reject must never read stale data.
_VERDICT_DB_FORBIDDEN = ("replica", "/home/ghost")

# ── ssh pipe (heartbeat only) — mirrors trainer_validation._vm_call ──────────
_VM_HOST = os.environ.get("TRAINER_VM_HOST", "vm")
_VM_DIR = os.environ.get("TRAINER_VM_DIR", "/home/trevor/trevor")
_VM_PY = os.environ.get("TRAINER_VM_PY", "venv/bin/python3")
_VM_LOADER = (
    "import base64,sys;"
    "exec(compile(base64.b64decode(sys.argv[1]).decode(),'<trainer_loop>','exec'))"
)


def _vm_python(program: str, args_json: str, timeout: float) -> Dict[str, Any]:
    """Run a VM-side python program over ssh (as trevor); parse its last JSON line.

    Never raises to the caller — a transport/parse failure surfaces as a
    ``{"vm_error": ...}`` dict so a broken pipe can't crash the daemon.
    """
    b64_prog = base64.b64encode(program.encode()).decode()
    b64_args = base64.b64encode(args_json.encode()).decode()
    remote = (
        f"cd {shlex.quote(_VM_DIR)} && sudo -u trevor {shlex.quote(_VM_PY)} "
        f"-c {shlex.quote(_VM_LOADER)} {shlex.quote(b64_prog)} {shlex.quote(b64_args)}"
    )
    try:
        proc = subprocess.run(
            ["ssh", _VM_HOST, remote],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        return {"vm_error": "rpc_timeout"}
    except Exception as exc:  # ssh missing / OS error
        return {"vm_error": f"rpc_failed: {exc}"}
    out = (proc.stdout or "").strip()
    if not out:
        return {"vm_error": f"rpc_no_output (rc={proc.returncode}): "
                f"{(proc.stderr or '').strip()[:400]}"}
    for line in reversed(out.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    return {"vm_error": f"rpc_unparseable: {out[:400]}"}


# ═══════════════════════════════════════════════════════════════════════════
# arm → proposal helpers (bandit arm is flat {axis.param: value}; the executor
# classifies over the nested {"axes": {axis: {param: value}}} shape)
# ═══════════════════════════════════════════════════════════════════════════
def arm_to_proposal(arm: Dict[str, Any]) -> Dict[str, Any]:
    """Flat bandit arm ``{axis.param: value}`` → executor proposal ``{"axes": {...}}``.

    Splits each knob key on the FIRST dot (matching the bandit's ``_axes_of_arm``):
    ``entry.entry_quality.min_group_scores`` → axis ``entry`` / param
    ``entry_quality.min_group_scores``. A dotless key contributes an axis-level entry.
    """
    axes: Dict[str, Dict[str, Any]] = {}
    for knob_key, value in (arm or {}).items():
        axis, sep, param = str(knob_key).partition(".")
        bucket = axes.setdefault(axis, {})
        if sep:  # has a param name
            bucket[param] = value
    return {"axes": axes}


def _axes_of(arm: Dict[str, Any]) -> List[str]:
    return sorted({str(k).split(".", 1)[0] for k in (arm or {})})


def family_of(arm: Dict[str, Any]) -> str:
    """A stable shadow-family label from the arm's axes (config-tuning family)."""
    axes = _axes_of(arm)
    return "trainer_" + ("-".join(axes) if axes else "empty")


def mint_shadow_id(arm_hash: str, level: int) -> str:
    """A deterministic shadow id for an (arm, level): resubmitting the same arm reuses it."""
    return f"trainer_L{int(level)}_{str(arm_hash)[:12]}"


def _assert_vm_db(db_path: str) -> None:
    """Refuse a verdict DB path that looks like the lagged replica (never-replica law)."""
    low = str(db_path).lower()
    for bad in _VERDICT_DB_FORBIDDEN:
        if bad in low:
            raise ValueError(
                f"verdict DB {db_path!r} looks like a lagged replica ({bad!r}); "
                "a promote/reject verdict is matched-data VM-only — refused"
            )


# ═══════════════════════════════════════════════════════════════════════════
# 1. The R8 handoff RPC client (HTTP → :3941, bearer, flag-OFF-safe)
# ═══════════════════════════════════════════════════════════════════════════
class R8HandoffClient:
    """The clean interface to R8's two queues + the verdict read + the promotion
    surface. Every method is flag-OFF-safe: with the submission gate off (or the
    executor down/unreachable) it no-ops cleanly and NEVER raises — the loop keeps
    searching. The client has NO code-writing surface (it routes requests only)."""

    def __init__(self, *, endpoint: Optional[str] = None, token: Optional[str] = None,
                 timeout: Optional[float] = None, trevor_db: Optional[str] = None) -> None:
        self.endpoint = endpoint or _EXECUTOR_URL
        self.token = token if token is not None else os.environ.get(_EXECUTOR_TOKEN_ENV, "")
        self.timeout = float(timeout) if timeout is not None else _RPC_TIMEOUT
        self.trevor_db = trevor_db or _VM_TREVOR_DB_ABS
        _assert_vm_db(self.trevor_db)  # never a replica, ever

    # ── low-level POST ──────────────────────────────────────────────────────
    def _post(self, op: str, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """POST one op to the executor. Returns the executor's ``{ok, result|error}``
        dict, or ``None`` when the executor is unreachable/down (the no-op signal).
        Never raises."""
        if not self.token:
            return None  # fail-closed: no bearer → the endpoint would 401 anyway
        body = json.dumps({"op": op, "args": args}).encode()
        req = urllib.request.Request(
            self.endpoint, data=body, method="POST",
            headers={"Authorization": f"Bearer {self.token}",
                     "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as exc:  # 400/401 — the body carries {ok:false,...}
            try:
                return json.loads(exc.read().decode() or "{}")
            except Exception:
                return {"ok": False, "error": f"http {exc.code}"}
        except (urllib.error.URLError, socket.timeout, ConnectionError, OSError):
            return None  # executor down / not started (R13) / tailnet blip → no-op
        except Exception:
            return None

    # ── submit (SL7 two-queue route) ────────────────────────────────────────
    def submit_proposal(self, proposal: Dict[str, Any], family: Optional[str],
                        params_json: Optional[str], reason: Optional[str], *,
                        shadow_id: str, display_name: Optional[str] = None,
                        category: Optional[str] = None) -> Dict[str, Any]:
        """Hand a proposal to R8's ``route_proposal`` — the executor CLASSIFIES (config
        vs capability, over the LIVE surface) and ROUTES. A config route self-creates an
        observe-only shadow; a capability route writes a ``capability_requests`` Hub row.
        🚨 The loop routes a REQUEST — it never writes code. ``family``/``params_json`` are
        always supplied so a config route never hits ``ConfigRouteIncomplete`` (they are
        ignored on the capability branch).

        Flag-OFF-safe: with the submission gate off, or the executor down/OFF, returns
        ``submitted=False`` (queued locally, nothing crossed) — never crashes."""
        out: Dict[str, Any] = {"submitted": False, "shadow_id": shadow_id,
                               "queue": None, "reason": None}
        if not submissions_enabled():
            out["reason"] = f"{EXECUTOR_FLAG} off (WSL hint) — queued locally, nothing crossed"
            return out
        args: Dict[str, Any] = {
            "shadow_id": shadow_id,
            "proposal": proposal,
            "family": family,
            "params_json": params_json,
            "reason": reason,
            "trevor_db": self.trevor_db,
        }
        if display_name is not None:
            args["display_name"] = display_name
        if category is not None:
            args["category"] = category
        resp = self._post("shadow.route_proposal", args)
        if resp is None:
            out["reason"] = "executor down/unreachable — queued locally, nothing crossed"
            return out
        if not resp.get("ok"):
            out["reason"] = f"executor error: {resp.get('error')}"
            return out
        inner = resp.get("result")
        if inner is None:  # executor flag OFF (dispatch returns {ok:True, result:None})
            out["reason"] = f"{EXECUTOR_FLAG} off on VM (result None) — nothing crossed"
            return out
        out["submitted"] = True
        out["queue"] = inner.get("queue")           # 'config' → shadow; 'capability' → Hub row
        out["result"] = inner.get("result")
        out["reason"] = f"routed to '{out['queue']}' queue"
        return out

    # ── verdict read (SL5 — gate_passed only, VM-only, never replica) ────────
    def read_verdict(self, shadow_id: str, epoch: Optional[str] = None) -> Optional[bool]:
        """Read ONLY the matched-data ``gate_passed`` (the promote/reject signal) for one
        challenger. The math runs VM-side over the SAME un-lagged trevor.db; only the
        verdict crosses. 🚨 NEVER the lagged replica (``_assert_vm_db`` on the path).

        Returns ``True``/``False`` (gate passed / not), or ``None`` when not gradeable yet
        / executor off / down (no signal — the loop simply hasn't a verdict yet)."""
        if not submissions_enabled():
            return None
        _assert_vm_db(self.trevor_db)
        args: Dict[str, Any] = {"shadow_id": shadow_id, "trevor_db": self.trevor_db}
        if epoch is not None:
            args["epoch"] = epoch
        resp = self._post("shadow.grade", args)
        if resp is None or not resp.get("ok"):
            return None
        verdict = resp.get("result")
        if not isinstance(verdict, dict):
            return None  # flag OFF (None) or a malformed verdict → no signal
        gp = verdict.get("gate_passed")
        return None if gp is None else bool(gp)

    # ── surface (SL8 — SURFACES, never ranks/promotes) ──────────────────────
    def surface_candidate(self, shadow_id: str, *, config_diff: Any = None,
                         stats: Any = None, reasoning: Any = None) -> Dict[str, Any]:
        """Surface a promotion-ready shadow to the R12 Hub. 🚨 SURFACES, NEVER
        RANKS/PROMOTES (§D.12.8): the executor writes a ``promotion_candidates`` row and
        makes NO priority/promotion decision. ``config_diff``/``stats``/``reasoning`` are
        accepted for LOCAL sort-by-evidence Hub display ONLY — they are NOT sent (the
        executor reads config/stats/reasoning itself from trevor.db); the RPC payload
        carries just ``shadow_id``.

        Flag-OFF-safe: returns ``surfaced=False`` when the gate is off / executor down."""
        out: Dict[str, Any] = {"surfaced": False, "shadow_id": shadow_id, "reason": None}
        if not submissions_enabled():
            out["reason"] = f"{EXECUTOR_FLAG} off — not surfaced"
            return out
        resp = self._post("shadow.surface_promotion_candidate",
                          {"shadow_id": shadow_id, "trevor_db": self.trevor_db})
        if resp is None:
            out["reason"] = "executor down/unreachable — not surfaced"
            return out
        if not resp.get("ok"):
            out["reason"] = f"executor error: {resp.get('error')}"
            return out
        inner = resp.get("result")
        if inner is None:
            out["reason"] = f"{EXECUTOR_FLAG} off on VM (result None) — not surfaced"
            return out
        out["surfaced"] = True
        out["candidate"] = inner
        out["reason"] = "surfaced to promotion_candidates (Ghost+CC decide priority)"
        return out

    # ── SL6 anti-lobotomy sweep on a level flip (RF2-B3/W5) ──────────────────
    def sweep_stale_on_flip(self, current_level: int) -> Dict[str, Any]:
        """On a level increment N→N+1, R8's ``stale_candidates(N+1)`` names the in-flight
        level-N rows and ``requeue_stale`` reopens each FORWARD at N+1 (ARCHIVED_STALE →
        PROPOSED; superseded-not-dead — NO ledger append, NO death-cert). This is the
        anti-lobotomy guarantee: a null result is archived-not-deleted and reopens at N+1.

        🚨 REFUSE-OR-ALERT — NEVER A SILENT NO-OP. Submit/verdict/surface treat a ``_post``
        ``None`` as a benign 'queued locally' no-op; HERE that is FORBIDDEN. An unreachable
        executor means the anti-lobotomy sweep DID NOT RUN — in-flight level-N shadows stay
        un-archived and un-reopened — so this returns ``ok=False`` on unreachable and the
        caller surfaces it LOUD + RETRIES (does not advance ``last_swept_level``). The failure
        is never swallowed. This is the campaign's most-repeated defect class (three prior
        instances); the sweep must not be the fourth.

        Returns ``{ok, reachable, swept, current_level, reason, requeue_failures}``:
          • WSL/VM flag OFF → ``ok=True`` (benign inert: submissions were no-ops too, so
            nothing crossed to be in-flight → nothing to sweep → advance, no alarm).
          • executor unreachable → ``ok=False, reachable=False`` (RETRYABLE — THE alarm).
          • executor error / partial requeue failure → ``ok=False, reachable=True`` (RETRYABLE;
            VM ``requeue_stale`` is idempotent, so re-running the whole sweep is safe).
          • full success → ``ok=True, reachable=True, swept=N``.
        Never raises."""
        out: Dict[str, Any] = {"ok": False, "reachable": None, "swept": 0,
                               "current_level": int(current_level), "reason": None,
                               "requeue_failures": 0}
        if not submissions_enabled():
            # EXECUTOR_FLAG off on WSL: the loop's submissions never crossed, so there is
            # nothing in-flight to sweep. Benign inert (NOT the anti-lobotomy alarm) → advance.
            out.update(ok=True, reason=f"{EXECUTOR_FLAG} off (WSL) — nothing crossed to sweep")
            return out
        read = self._post("shadow.stale_candidates",
                          {"current_level": int(current_level), "trevor_db": self.trevor_db})
        if read is None:  # 🚨 UNREACHABLE — the anti-lobotomy sweep DID NOT RUN.
            out.update(reachable=False,
                       reason="executor unreachable — SL6 sweep did NOT run (RETRYABLE): "
                              "in-flight level-N shadows NOT archived/reopened")
            return out
        if not read.get("ok"):
            out.update(reachable=True,
                       reason=f"executor error on stale_candidates: {read.get('error')}")
            return out
        candidates = read.get("result")
        if candidates is None:  # VM flag OFF → dispatch returns {ok:True, result:None}. Benign.
            out.update(ok=True, reachable=True,
                       reason=f"{EXECUTOR_FLAG} off on VM (result None) — nothing to sweep")
            return out
        if not isinstance(candidates, list):
            out.update(reachable=True,
                       reason=f"malformed stale_candidates result: {type(candidates).__name__}")
            return out
        # requeue each stale row forward at N+1. VM requeue_stale is idempotent (no-ops an
        # already-ARCHIVED_STALE row) → a partial failure safely retries the WHOLE sweep.
        swept = 0
        failures = 0
        for cand in candidates:
            sid = cand.get("shadow_id") if isinstance(cand, dict) else None
            if not sid:
                failures += 1
                continue
            resp = self._post("shadow.requeue_stale",
                              {"shadow_id": sid, "trevor_db": self.trevor_db})
            if resp is None:  # unreachable mid-sweep → partial → retry the whole sweep.
                out.update(reachable=False, swept=swept, requeue_failures=failures + 1,
                           reason=f"executor went unreachable mid-sweep after {swept} requeued "
                                  f"(RETRYABLE): remaining level-N shadows NOT reopened")
                return out
            if not resp.get("ok") or resp.get("result") is None:
                failures += 1
                continue
            swept += 1
        if failures:
            out.update(reachable=True, swept=swept, requeue_failures=failures,
                       reason=f"{swept} requeued, {failures} failed (RETRYABLE — VM requeue "
                              f"is idempotent)")
            return out
        out.update(ok=True, reachable=True, swept=swept,
                   reason=f"SL6 sweep complete — {swept} stale level-N shadow(s) "
                          f"archived+reopened at N+1")
        return out


class ObserveOnlyViolation(RuntimeError):
    """T1: the observe path attempted a handoff that observing must never perform."""


class ObserveOnlyClient:
    """A structural stand-in for ``R8HandoffClient`` used ONLY in observe-only mode.

    🚨 THIS IS THE SECOND LAYER, AND IT EXISTS BECAUSE THE FIRST ONE CAN BE EDITED.
    ``_run_one_iteration`` skips the propose/promote steps under ``observe_only``; that is
    the primary control, and it is a set of branches in a SHARED function body. A future
    edit that adds a sink, or reorders a branch, would silently start crossing to the VM —
    the exact silent-crossing class this campaign exists to close. So observe mode does not
    merely decline to call the handoff client: it is handed a client that CANNOT perform
    one. Every handoff method RAISES ``ObserveOnlyViolation`` and prints a loud stderr line
    at raise time, so a missed branch fails LOUDLY instead of writing to the VM.

    ⚠️ The raise is caught by ``run_trainer_loop``'s per-iteration ``except Exception`` (one
    bad iteration must never kill the daemon) and folded into an error heartbeat — hence the
    stderr print HERE, at the raise, which no caller can swallow.

    It deliberately mirrors the real client's method NAMES and nothing else: it holds no
    endpoint, no token, no socket, and no ``trevor_db`` — there is no transport to misuse."""

    def __init__(self) -> None:
        self.violations: List[str] = []

    def _refuse(self, op: str) -> None:
        self.violations.append(op)
        print(
            f"[trainer_loop] 🚨🚨 OBSERVE-ONLY VIOLATION — {op!r} was called on the observe "
            f"path. Observing must NEVER propose, promote or route a write (§D.9 step 3: "
            f"'NO leveling · NO promotions'). NOTHING crossed to the VM; the iteration is "
            f"being failed deliberately.",
            file=sys.stderr,
        )
        raise ObserveOnlyViolation(
            f"{op} is forbidden in observe-only mode (§D.9 step 3)")

    # The five handoff surfaces — every one a propose/promote/write op.
    def submit_proposal(self, *a: Any, **k: Any) -> Dict[str, Any]:
        self._refuse("submit_proposal")
        raise AssertionError("unreachable")  # pragma: no cover

    def read_verdict(self, *a: Any, **k: Any) -> Optional[bool]:
        self._refuse("read_verdict")
        raise AssertionError("unreachable")  # pragma: no cover

    def surface_candidate(self, *a: Any, **k: Any) -> Dict[str, Any]:
        self._refuse("surface_candidate")
        raise AssertionError("unreachable")  # pragma: no cover

    def sweep_stale_on_flip(self, *a: Any, **k: Any) -> Dict[str, Any]:
        self._refuse("sweep_stale_on_flip")
        raise AssertionError("unreachable")  # pragma: no cover


def sort_candidates_for_display(candidates: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sort surfaced candidates by EVIDENCE for the Hub's one-glance display ONLY.

    🚨 This is presentation, NOT a promotion decision — it issues no promotion and
    reorders no queue; Ghost+CC decide priority (§D.12.8). Ordering key: matched-data
    net_usd desc, then win_rate desc, then n desc — a stable, evidence-first display.

    📋 RF3T2-B8 (NIT-2, DOCUMENT — do NOT wire): ZERO production callers today
    (only tests/test_trainer_loop.py references it). RECON-GIGANTIC-001's own verdict
    is "keep it unwired" — it exists so a Hub display has a canonical evidence order
    the moment one is built, and wiring it to anything that RANKS would cross the
    surfaces-never-promotes line (§D.12.8). Confirmed the sole zero-caller "canonical"
    function on this box; leave it.
    """
    def _key(c: Dict[str, Any]):
        s = c.get("stats") or (c.get("candidate") or {}).get("stats") or {}
        try:
            s = s if isinstance(s, dict) else json.loads(s)
        except Exception:
            s = {}
        return (float(s.get("net_usd") or 0.0), float(s.get("win_rate") or 0.0),
                float(s.get("n") or 0.0))
    return sorted(list(candidates), key=_key, reverse=True)


# ═══════════════════════════════════════════════════════════════════════════
# 2. The trainer heartbeat (silent-lifecycle-failure surface — A1 rec #6)
# ═══════════════════════════════════════════════════════════════════════════
# Pre-register the row (INSERT…ON CONFLICT — mirrors scripts/shadow_readiness_gate.py:576)
# on the VM's trevor.db, because ``_emit_loop_heartbeat`` (observability.py:583) is
# UPDATE-only and won't create it. is_dormant=0 so 08_service_health's freshness monitor
# (stale_threshold = max(3600, cadence×2)) auto-registers for it — a stall surfaces free.
_HEARTBEAT_PREREGISTER = r'''
import base64, json, sys
args = json.loads(base64.b64decode(sys.argv[2]).decode()) if len(sys.argv) > 2 else {}
name = args.get("loop_name")
cadence = int(args.get("cadence_seconds", 3600))
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

# Emit reuses R8's canonical UPDATE-only ``_emit_loop_heartbeat`` (never-raise contract).
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

# [B1] The degraded-state column write. SEPARATE from the emit on purpose: the emit above
# reuses R8's canonical UPDATE-only ``_emit_loop_heartbeat``, which knows nothing about this
# column, and editing a VM file from a Hub prompt is forbidden. So this is a second,
# trainer-owned UPDATE of ONE additive column and it touches nothing else.
# 🚨 IT WRITES NULL AS READILY AS IT WRITES A REASON. That is the whole point: ``last_error``
# is a single mutable slot that NOTHING in the codebase ever clears (measured VM-wide), so a
# degraded string parked there latches FOREVER after a real recovery — a one-way flag is its
# own false-success. This column is set AND cleared by the same call every iteration.
_HEARTBEAT_DEGRADED = r'''
import base64, json, sys
args = json.loads(base64.b64decode(sys.argv[2]).decode()) if len(sys.argv) > 2 else {}
name = args.get("loop_name")
reason = args.get("degraded_reason")  # None => clear the column
try:
    from auto_trader.observability import _connect
    conn = _connect()
    try:
        cur = conn.execute(
            "UPDATE loop_heartbeat SET degraded_reason = ? WHERE loop_name = ?",
            (reason, name),
        )
        conn.commit()
        updated = cur.rowcount
    finally:
        conn.close()
    print(json.dumps({"ok": True, "loop_name": name, "degraded_reason": reason,
                      "updated": updated}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
'''


class TrainerHeartbeat:
    """The trainer daemon's heartbeat on the VM's ``loop_heartbeat`` (via the ssh pipe).

    ``pre_register`` once on daemon start (idempotent); ``emit`` each iteration. Both
    NEVER raise (a heartbeat write failure logs + returns False; it never crashes the
    loop). A stalled daemon → stale ``last_iteration_at`` → 08_service_health CRIT."""

    # NOT in loop_registry.REMOVED_LOOPS (confirmed) — else the stall detector ignores it.
    LOOP_NAME = "trainer_search_loop"
    # 3600s cadence → stale_threshold = max(3600, 7200) = 2h. Conservative: a budget-
    # throttled daemon can legitimately be slow between iterations, so a false CRIT on a
    # healthy-but-idle trainer is worse than a ~2h detection lag on a dead one. Tighten
    # post-cutover once real iteration timing is observed (R13).
    CADENCE_SECONDS = 3600

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
        """Create the ``loop_heartbeat`` row once (INSERT…ON CONFLICT — idempotent).
        Returns True on success. Never raises."""
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
        """Bump the heartbeat's timestamp (UPDATE-only ``_emit_loop_heartbeat``).
        Returns True on success. Never raises (mirrors the emit's never-raise contract)."""
        err_str = (str(error)[:200]) if error else None
        args = json.dumps({"loop_name": self.loop_name, "error": err_str})
        try:
            res = self._emit_fn(_HEARTBEAT_EMIT, args)
        except Exception:
            return False
        return bool(isinstance(res, dict) and res.get("ok"))

    def set_degraded(self, reason: Optional[str]) -> bool:
        """[B1] Set (or CLEAR, on ``None``) ``loop_heartbeat.degraded_reason``.

        🚨 SYMMETRIC BY CONSTRUCTION — this is the same call in both directions, so the
        surface physically cannot become a one-way latch. Passing ``None`` writes SQL NULL,
        which is how a recovery clears a stale degraded state that ``last_error`` would keep
        forever. Returns True on success. Never raises (mirrors ``emit``'s contract): a
        heartbeat write failure must never take down the daemon it is reporting on."""
        args = json.dumps({"loop_name": self.loop_name, "degraded_reason": reason})
        try:
            res = self._emit_fn(_HEARTBEAT_DEGRADED, args)
        except Exception:
            return False
        return bool(isinstance(res, dict) and res.get("ok"))


# ═══════════════════════════════════════════════════════════════════════════
# 3. The daemon assembly (continuous, self-throttled, flag-OFF-safe, no auto-start)
# ═══════════════════════════════════════════════════════════════════════════
def _reward_from(compass_verdict: Optional[Dict[str, Any]],
                 gate_passed: Optional[bool],
                 validation: Optional[Dict[str, Any]]) -> Optional[float]:
    """The single Beta-posterior reward for one arm trial.

    Prefer the COMPASS reward (B2's ``compass_reward`` — the bandit's objective) when a
    compass verdict exists. Otherwise fall back to the authoritative VM outcome:
    gate passed → 1.0; a clean-but-not-ready validation → 0.4; a leakage/hard reject →
    0.0. Returns ``None`` when there is no signal at all (nothing to fold this trial)."""
    if isinstance(compass_verdict, dict) and compass_verdict.get("verdict") is not None:
        return trainer_bandit.compass_reward(compass_verdict)
    if gate_passed is True:
        return 1.0
    if isinstance(validation, dict) and validation.get("ok"):
        if validation.get("leakage_reject"):
            return 0.0
        v = validation.get("verdict")
        if isinstance(v, dict):
            label = str(v.get("verdict") or "").upper()
            if label in ("PROMOTE", "READY", "PROMOTION_READY"):
                return 1.0
            return 0.4  # ran clean, not (yet) promotable
    if gate_passed is False:
        return 0.0
    return None  # executor down / not gradeable yet → no fold this trial


def _run_one_iteration(
    *, schema: Dict[str, Any], level: int, client: R8HandoffClient,
    rng: Any, backtest_fn: Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]],
    validate_fn: Callable[..., Dict[str, Any]], db_path: Optional[str],
    epoch: Optional[str], observe_only: bool = False,
) -> Dict[str, Any]:
    """One full search step: sample → compass pre-score → self-pushback → submit →
    verdict → validate → narrate+log → update posteriors → surface. Returns a diagnostics
    dict. Raising is the caller's concern (it emits an error heartbeat + continues).

    🚨 ``observe_only`` (T1, default False → byte-identical to R9-B6) is §D.9 step 3's paper
    window: steps 4/5/6/9/10 — submit, grade, validate, surface, teach — are SKIPPED, because
    every one of them either proposes, promotes, or routes a cross-box write. What remains is
    exactly what §D.9 asks for: sample, SIMULATE on the compass, push back against its own
    history, narrate, and fold what it learned into its own local stores. Each skip is
    RECORDED IN THE TRACE with its reason rather than silently not happening — a mode that
    quietly does less is indistinguishable from one that is broken."""
    trace: Dict[str, Any] = {"level": int(level)}
    if observe_only:
        trace["mode"] = "observe_only"
        trace["skipped_in_observe"] = []

    # 1) sample arm (B2) — inert {enabled:False} when TRAINER_BANDIT_ENABLED is off.
    step = trainer_bandit.run_search_step(schema, level=int(level), rng=rng)
    trace["sample"] = {"enabled": step.get("enabled"), "arm_hash": step.get("arm_hash")}
    if not step.get("enabled") or not step.get("arm"):
        trace["skipped"] = step.get("reason", "no arm")
        return trace
    arm = step["arm"]
    ahash = step["arm_hash"]
    axes_json = step.get("axes_json") or trainer_bandit.canonicalize_arm(arm)
    candidate = {"axes": arm, "level_id": int(level)}

    compass_verdict: Optional[Dict[str, Any]] = None
    reward: Optional[float] = None

    # 2) pre-score on compass (B1) — a CHEAP local FILTER before spending a shadow slot.
    #    Needs a simulated backtest candidate (arm → outcome); that simulator is an
    #    injected seam (not a B0–B5 piece). Absent → skip the pre-score and rely on the
    #    authoritative VM verdict. Present → a compass-rejected arm never reaches the loop.
    if backtest_fn is not None:
        bt = backtest_fn(arm, int(level))
        compass_verdict = compass_metrics.evaluate_compass(bt, int(level))
        trace["compass"] = {"verdict": compass_verdict.get("verdict"),
                            "survived": compass_verdict.get("survived"),
                            "blend_score": compass_verdict.get("blend_score")}
        if not compass_verdict.get("survived"):
            # rejected at the survival wall → log the dead-end, fold reward, don't submit.
            rationale = trainer_reasoning.narrate_verdict(candidate, None, compass_verdict,
                                                          db_path=db_path)
            trainer_reasoning.log_rejection(candidate, None, rationale,
                                            compass_result=compass_verdict, db_path=db_path)
            trainer_bandit.update_posterior(ahash, int(level),
                                            trainer_bandit.compass_reward(compass_verdict),
                                            axes_json=axes_json)
            trace["reward_folded"] = True  # T1: the honest discriminator — see run_trainer_loop
            trace["outcome"] = "compass_rejected"
            return trace
    else:
        trace["compass"] = "skipped (no backtest_fn — VM verdict authoritative)"

    # 3) self-pushback (B4) — skip known dead-ends + the optional advisory LLM sanity.
    pushback = trainer_reasoning.self_pushback(candidate, db_path=db_path)
    trace["pushback"] = {"proceed": pushback.get("proceed"), "source": pushback.get("source")}
    # W9 (RF2-B2): cross-tier "have we tested X?" SUPERSET, alongside self_pushback's exact
    # is_known_dead_end (which stays trainer-owned + UNCHANGED — this NEVER replaces it).
    # 🚨 agent="trainer" is a MANDATORY LITERAL: the default agent=None is the FORBIDDEN
    # cross-agent span that reads watcher_memory (the AST guard cannot catch a runtime None).
    # Flag OFF → [] (no db opened) → the loop decision is byte-identical. ADVISORY (surfaced
    # in the trace); it does NOT gate the proceed decision — is_known_dead_end remains the gate.
    if memory_query_enabled():
        try:
            import memory_query
            prior = memory_query.have_we_tested(
                {"arm_hash": ahash, "config": arm}, level=int(level), agent="trainer")
            trace["have_we_tested"] = len(prior)
        except Exception as exc:  # an advisory read must never kill an iteration
            print(f"[trainer_loop] have_we_tested failed (non-fatal): {exc}", file=sys.stderr)
    if not pushback.get("proceed"):
        # a proven dead-end / not-sensible → don't spend a slot. It was folded when first
        # rejected (rejection_log); nothing more to learn this trial.
        trace["outcome"] = f"pushback_block: {pushback.get('reason')}"
        return trace

    shadow_id = mint_shadow_id(ahash, int(level))

    if observe_only:
        # 🚨 T1 / §D.9 step 3 — the propose+grade+validate block is SKIPPED WHOLESALE.
        # Every one of these three crosses to the VM and every one of them is a step in
        # PROPOSING: submit routes a proposal (a write), grade reads a verdict on a shadow
        # that was never submitted, and validate additionally SPENDS the alpha budget
        # VM-side through trainer_budget_adapter.throttle_test. Observing spends nothing
        # and asks for nothing. The shadow id is minted locally (a pure string) and kept in
        # the trace so the observation is attributable, but it is handed to no one.
        submission = None
        gate_passed = None
        validation: Dict[str, Any] = {}
        trace["shadow_id_not_submitted"] = shadow_id
        trace["skipped_in_observe"].extend([
            "submit_proposal (routes a proposal — a cross-box WRITE)",
            "read_verdict (grades a shadow that was never submitted)",
            "validate_candidate (VM R3 gate + SPENDS the alpha budget)",
        ])
        trace["gate_passed"] = None
        trace["validation"] = {"enabled": False, "reason": "observe_only"}
    else:
        # 4) submit to the loop (Phase 1) — config→self-create shadow / capability→Hub row.
        #    Flag-OFF-safe: a no-op when the gate is off / executor down (queued locally).
        proposal = arm_to_proposal(arm)
        submission = client.submit_proposal(
            proposal, family_of(arm), axes_json, pushback.get("reason"), shadow_id=shadow_id)
        trace["submit"] = {"submitted": submission.get("submitted"),
                           "queue": submission.get("queue"), "reason": submission.get("reason")}

        # 5) read verdict (Phase 1) — gate_passed only, VM-only, never replica. (In production
        #    the grade is "later"; the assembly attempts it — None = not gradeable yet / off.)
        gate_passed = client.read_verdict(shadow_id, epoch)
        trace["gate_passed"] = gate_passed

        # 6) validate (B3) — the VM-side R3 gate (both leakage layers → net-of-cost →
        #    promotion_verdict → FDR discovery throttle). Config arm = feature-free (tunes
        #    existing knobs) → feature_names=[]; the real divergent cohort is the self-created
        #    shadow. Inert {enabled:False} when TRAINER_VALIDATION_ENABLED is off.
        validation = validate_fn(feature_names=[], shadow_key=shadow_id, level_id=int(level),
                                 db_path=db_path)
        trace["validation"] = {"enabled": validation.get("enabled"), "ok": validation.get("ok"),
                              "leakage_reject": validation.get("leakage_reject")}

    # 7) narrate + log (B4) — one-line rationale (budget-gated Haiku or template); log a
    #    rejection so a dead-end is never reconsidered. narrate NEVER flips the verdict.
    rationale = trainer_reasoning.narrate_verdict(candidate, validation, compass_verdict,
                                                  db_path=db_path)
    trace["rationale"] = rationale
    if gate_passed is False or (isinstance(validation, dict) and validation.get("leakage_reject")):
        trainer_reasoning.log_rejection(candidate, validation, rationale,
                                        compass_result=compass_verdict, db_path=db_path)
        trace["logged_rejection"] = True

    # 8) update posteriors (B2) — fold the single reward for this trial (compass objective
    #    preferred; else the authoritative VM outcome). None → no signal, no fold.
    reward = _reward_from(compass_verdict, gate_passed, validation)
    if reward is not None:
        post = trainer_bandit.update_posterior(ahash, int(level), reward, axes_json=axes_json)
        trace["reward_folded"] = True  # T1: the honest discriminator — see run_trainer_loop
        trace["posterior"] = {"reward": round(reward, 4), "alpha": round(post[0], 4),
                             "beta": round(post[1], 4), "n_obs": post[2]}

    # 9) surface promotions (Phase 1) — SURFACE, never rank/promote (§D.12.8). Only a
    #    gate-passed shadow. Flag-OFF-safe.
    # 🚨 T1: in observe mode this is unreachable anyway (gate_passed is pinned None because
    # nothing was submitted or graded), but the guard is EXPLICIT rather than incidental.
    # §D.9 step 3 says "NO promotions" — that must be a stated property of the mode, not a
    # side-effect of an upstream variable that a later edit could set.
    if observe_only:
        trace["skipped_in_observe"].append(
            "surface_candidate (writes promotion_candidates — §D.9: NO promotions)")
        trace["skipped_in_observe"].append(
            "trainer_teach (writes the VM ChromaDB)")
    elif gate_passed is True:
        surfaced = client.surface_candidate(shadow_id, config_diff=axes_json,
                                            stats=(validation or {}).get("verdict"),
                                            reasoning=rationale)
        trace["surface"] = {"surfaced": surfaced.get("surfaced"), "reason": surfaced.get("reason")}

    # 10) teach (RF2-B3/W3) — recommend how the R5 bot-brain EXECUTES better, by handing the
    #     loop's REAL validated outcome to trainer_teach as ONE natural-language string. NO
    #     simulator: the ``rationale`` is narrate_verdict's output over the real VM verdict,
    #     REUSED (not re-narrated — W3 adds ZERO new Anthropic cost; the ChromaDB write embeds
    #     with the collection's default LOCAL sentence-transformer, no API → $0/day). 🚨 TEXT
    #     ONLY, never a numeric weight — the coupling deliberately torn out of training_bridge
    #     stays torn out; the wire is 100% caller-side, training_bridge.py is byte-untouched.
    #
    #     🚨 DECISION (NOT a design finding — v1/v2/RECON-TRAINER-001 are SILENT on the teach
    #     trigger; A3 §7-U3 offered this as a labelled proposal): teach on a VALIDATED, PROMOTABLE
    #     learning — ``gate_passed is True AND validation.ok is True``. EXCLUDES compass-rejected,
    #     pushback-blocked, gate-FAILED (gate_passed is False), leakage-rejected, and UN-GRADEABLE
    #     (gate_passed is None) arms — only a clean validated promotable outcome teaches. HONEST
    #     NOTE: production grading is ASYNC, so gate_passed being True in the SAME iteration as
    #     submission is RARE → teaching is rare + high-signal (the intended cadence, NOT a bug).
    #
    #     TWO gates, both required: TRAINER_TEACH_ENABLED (WSL arm, default OFF) AND the VM-side
    #     BOTBRAIN_TEACH_ENABLED (fail-closed). recommend_execution_guidance NEVER raises
    #     (malformed → skip+log; transport error → surfaced, never faked as success); the
    #     try/except is belt-and-suspenders so a teach hiccup can never kill the iteration.
    if (not observe_only and teach_enabled() and gate_passed is True
            and isinstance(validation, dict) and validation.get("ok") is True):
        try:
            import trainer_teach
            trainer_teach.recommend_execution_guidance({
                "text": rationale,
                "level_id": int(level),
                "metadata": {"arm_hash": ahash, "stage": "r9_validated_config",
                             "shadow_id": shadow_id},
            })
            trace["taught"] = True
        except Exception as exc:  # a teach hiccup must never kill an iteration
            print(f"[trainer_loop] teach failed (non-fatal): {exc!r}", file=sys.stderr)
            trace["taught"] = False

    trace["outcome"] = "completed"
    return trace


# ── [B1] the degraded-state surface (§D.0: surfaces its own failure, never swallows it) ──
# 🚨 THE DEFECT THIS CLOSES: the no_simulator declaration fired ONCE, PRE-LOOP, and then
# went silent forever. Measured on the live VM row before this fix: last_error_at
# 2026-08-04T14:00:16Z (10s after ExecMainStartTimestamp) sitting beside last_iteration_at
# 2026-08-05T13:02:14Z and iteration_count 30 — 23 hours of "rough start, then clean
# iterations" for a loop that never recovered and never could. A RISING ITERATION COUNT
# PROVES LIVENESS ONLY, NEVER LEARNING.
DEGRADED_NO_SIMULATOR = "no_simulator"
DEGRADED_SIMULATOR_UNKNOWN = "simulator_unknown"

_DEGRADED_MESSAGES = {
    DEGRADED_NO_SIMULATOR: (
        f"no_simulator: observing without a backtest_fn ({BACKTEST_PROVIDER_ENV} unset) — "
        f"NO compass pre-score, NO reward, NO posterior fold. Observing, NOT learning"),
    DEGRADED_SIMULATOR_UNKNOWN: (
        f"simulator_unknown: {BACKTEST_PROVIDER_ENV} names a provider but this loop was "
        f"handed backtest_fn=None — cannot tell operator INTENT from broken WIRING"),
}


def _resolve_sim_state(observe_only: bool,
                       backtest_fn: Optional[Callable[..., Any]],
                       ) -> Tuple[Optional[bool], Optional[str]]:
    """Resolve simulation state as THREE values, never a default to False.

    Returns ``(simulating, degraded_reason)``:
      * ``(True, None)``  — a simulator is in hand; the loop can actually learn.
      * ``(False, "no_simulator")`` — definitively no simulator, and nobody asked for one.
      * ``(None, "simulator_unknown")`` — 🚨 THE THIRD STATE. ``BACKTEST_PROVIDER_ENV`` names
        a provider, yet this loop was handed ``backtest_fn=None``. ``_resolve_backtest_fn``
        RAISES on a set-but-unresolvable spec, so ``main``/``observe_main`` can never
        produce this shape — but ``run_trainer_loop`` is a public function with an
        injectable ``backtest_fn`` seam, so any other caller can. We genuinely cannot tell
        whether the operator's intent was simulation and the wiring failed, or whether the
        env is stale. Calling that ``False`` would be a guess and calling it ``True`` would
        be a false green, so it is neither.

    ⚠️ ``observe_only=False`` returns ``(False, None)`` — the propose path keeps its
    pre-[B1] value and gets NO degraded surface, so its behaviour is byte-identical."""
    if not observe_only:
        return False, None
    if backtest_fn is not None:
        return True, None
    if os.environ.get(BACKTEST_PROVIDER_ENV, "").strip():
        return None, DEGRADED_SIMULATOR_UNKNOWN
    return False, DEGRADED_NO_SIMULATOR


def _degraded_error(reason: Optional[str]) -> Optional[BaseException]:
    """The per-iteration ``error=`` payload for a degraded reason (``None`` when healthy).

    🚨 This is what makes ``error_count`` keep INCREMENTING while the fault holds, instead
    of freezing at the start-up count and reading as "recovered". Every provider-less
    iteration genuinely IS an iteration that failed to learn, so counting it is honest."""
    if not reason:
        return None
    return RuntimeError(_DEGRADED_MESSAGES.get(reason, reason))


def run_trainer_loop(
    *, schema: Optional[Dict[str, Any]] = None, level: int,
    max_iterations: Optional[int] = None,
    client: Optional[R8HandoffClient] = None,
    heartbeat: Optional[TrainerHeartbeat] = None,
    backtest_fn: Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]] = None,
    validate_fn: Optional[Callable[..., Dict[str, Any]]] = None,
    rng: Any = None, sleep_seconds: Optional[float] = None,
    sleep_fn: Optional[Callable[[float], None]] = None,
    db_path: Optional[str] = None, epoch: Optional[str] = None,
    on_iteration: Optional[Callable[[Dict[str, Any]], None]] = None,
    pause_poll: Optional[Any] = None,
    level_detector: Optional[Any] = None,
    observe_only: bool = False,
    level_reader: Optional[Callable[[], Tuple[Optional[int], str]]] = None,
) -> Dict[str, Any]:
    """The continuous always-on trainer search (decision 4), tying B1–B5 together.

    DORMANT unless ``TRAINER_LOOP_ENABLED`` — returns ``{enabled: False}`` and does NOT
    run (no auto-start; the caller is an explicit R13 entrypoint). Self-throttled by the
    alpha-budget (discovery, inside ``validate_candidate``) and the API budget (narration,
    inside ``narrate_verdict``/``self_pushback``) — always-on is safe.

    A single bad iteration NEVER kills the daemon: the iteration is wrapped, an error
    heartbeat is emitted, and the loop continues. ``max_iterations`` bounds the run for
    tests/one-shots (None = forever). ``backtest_fn``/``validate_fn``/``client``/
    ``heartbeat``/``sleep_fn`` are injectable seams (defaults are the real wirings).

    🚨 ``level`` is a REQUIRED keyword — it deliberately has NO default. It used to
    default to ``0``, which is the corruption ``main()`` already refuses at ``:1249``:
    every row an iteration writes is tagged ``level_id=<level>`` (``bandit_posteriors``,
    ``rejection_log``) and ``mint_shadow_id`` bakes it into the shadow-id NAMESPACE, so an
    omitted level silently tagged a whole corpus at level 0. ``level_id`` is in the PRIMARY
    KEY and there are no ``DELETE`` statements, so under the append-only discipline that is
    UNRECOVERABLE. Omitting it now raises ``TypeError`` at the call site — loud and
    immediate, per §D.0 (*surfaces its own failure, never swallows it*). 🚨 Do NOT give it
    a default again, and do NOT resolve one here: ``main()`` owns level resolution via
    ``_resolve_live_level`` and REFUSES below L1; a resolver here would let an omitted
    level SOMETIMES succeed, which is the same silent-wrong-answer defect in disguise.
    Matches ``_run_one_iteration``, which already takes ``level: int`` with no default.

    🚨 ``observe_only`` (T1) is §D.9 step 3. It changes THREE things and nothing else:
    (1) the master gate becomes ``OBSERVE_FLAG`` instead of ``LOOP_FLAG`` — so observing can
    be armed while the propose path stays OFF; (2) the handoff client is REPLACED by an
    ``ObserveOnlyClient`` that raises on every handoff, so a missed branch fails loudly
    instead of crossing; (3) the level detector is not constructed — its only ACTION is the
    SL6 sweep, which is a cross-box write — and is replaced by a read-only per-iteration
    level re-read that STOPS the loop if the level moves. ``level_reader`` is that reader's
    injectable seam (mirrors ``main``'s ``reader``); production passes nothing.
    ⚠️ With ``observe_only=False`` — every existing caller — the gate expression below is
    exactly ``if not loop_enabled()`` and the body is byte-identical to R9-B6."""
    if observe_only:
        if not observe_only_enabled():
            return {"enabled": False, "mode": "observe_only",
                    "reason": f"{OBSERVE_FLAG} off (inert; not auto-started)",
                    "iterations": 0}
    elif not loop_enabled():
        return {"enabled": False, "reason": f"{LOOP_FLAG} off (inert; not auto-started)",
                "iterations": 0}

    schema = schema or trainer_bandit.default_axis_schema()
    # 🚨 T1: observing is handed a client that CANNOT hand anything off. This is the
    # structural half of "provably cannot propose or promote" — the branch skips are the
    # primary control, this is what makes a missed skip loud instead of silent.
    if observe_only:
        client = ObserveOnlyClient()  # type: ignore[assignment]
    client = client or R8HandoffClient()
    heartbeat = heartbeat or TrainerHeartbeat()
    validate_fn = validate_fn or _default_validate_fn
    rng = rng if rng is not None else _new_rng()
    sleep_fn = sleep_fn or time.sleep
    sleep_seconds = float(sleep_seconds) if sleep_seconds is not None else float(
        os.environ.get("TRAINER_LOOP_SLEEP_SECONDS", "60"))

    # R13-P1: construct the pause poll iff armed (or use an injected one for tests). None →
    # the loop never checks pause and is byte-identical to R9-B6. Import is lazy so flag-OFF
    # touches nothing (no ssh, no cache) and the module stays import-safe.
    if pause_poll is None and pause_poll_enabled():
        import trainer_pause
        pause_poll = trainer_pause.PausePoll()

    # RF2-B3/W5: construct the mid-run level detector iff armed (or use an injected one for
    # tests). None → the loop never re-reads the level, tags every row at the loop-START level,
    # and is byte-identical to R9-B6 (the U5 gap stays dormant). The detector reuses the
    # existing read-only ssh shim (_read_vm_level); it READS the level, NEVER mints one.
    # 🚨 T1: observing NEVER constructs a level detector. The detector's only ACTION on a
    # flip is client.sweep_stale_on_flip — a cross-box WRITE — so in observe mode it would
    # be a mechanism whose whole purpose is forbidden. The level-move hazard it covers is
    # real and is covered instead by the read-only guard below.
    if not observe_only and level_detector is None and level_detector_enabled():
        level_detector = LevelDetector(int(level))
    elif observe_only:
        level_detector = None

    # 🚨 T1 / §D.9 + §D.1 — DECLARE THE DEGRADED CASE BEFORE DOING ANYTHING.
    # §D.9 step 3 asks for two things: "runs SIMULATIONS to learn + OBSERVES". The simulator
    # is `backtest_fn`, and with no provider it is None — so there is NO compass pre-score
    # and therefore NO reward to fold.
    #
    # 🚨 MEASURED, AND IT IS SHARPER THAN "IT WRITES NOTHING" (T1 proof run):
    # sampling ITSELF writes a `bandit_posteriors` row — `trainer_bandit.run_search_step`
    # does INSERT OR IGNORE + UPDATE last_sampled_at before any reward exists. So a
    # provider-less observe iteration leaves behind a row that LOOKS like learning and
    # contains none: `alpha=1.0, beta=1.0, n_obs=0` — the untouched uniform prior, stamped
    # with a sampling time. A row COUNT is therefore NOT evidence of discovery, and anyone
    # reading `SELECT COUNT(*) FROM bandit_posteriors` as progress will be wrong.
    # The honest discriminator is `rewards_folded` (below) / `n_obs`, never COUNT(*).
    #
    # That is the false-success class one level deeper than a silent no-op: not an absence
    # of evidence, but evidence-shaped residue. So the mode says so, loudly, at start-up AND
    # in its heartbeat AND in its result — it does not refuse (§D.1's "first live action is
    # UNDERSTANDING" does not require a simulator), but it never lets "it sampled" be
    # mistaken for "it learned".
    # [B1] THREE states, not two — see ``_resolve_sim_state``. ``simulating`` may be None.
    simulating, degraded_reason = _resolve_sim_state(observe_only, backtest_fn)
    if degraded_reason == DEGRADED_NO_SIMULATOR:
        print(
            f"[trainer_loop] 🚨 OBSERVE MODE HAS NO SIMULATOR — {BACKTEST_PROVIDER_ENV} is "
            f"unset, so backtest_fn is None: there is NO compass pre-score, NO reward and NO "
            f"posterior fold. This loop will OBSERVE but it will NOT LEARN. ⚠️ It will still "
            f"write a bandit_posteriors ROW per sampled arm (sampling writes it) carrying an "
            f"UNTOUCHED Beta(1,1) prior and n_obs=0 — do NOT read a row count as discovery. "
            f"The heartbeat below proves liveness ONLY.",
            file=sys.stderr,
        )
    elif degraded_reason == DEGRADED_SIMULATOR_UNKNOWN:
        print(
            f"[trainer_loop] 🚨 OBSERVE MODE CANNOT DETERMINE WHETHER IT IS SIMULATING — "
            f"{BACKTEST_PROVIDER_ENV} names a provider, but this loop was handed "
            f"backtest_fn=None. Operator INTENT and broken WIRING are indistinguishable from "
            f"here, so the state is reported UNKNOWN rather than guessed in either direction. "
            f"Treat this loop as NOT LEARNING until the discrepancy is resolved.",
            file=sys.stderr,
        )

    heartbeat.pre_register()  # create the loop_heartbeat row once (idempotent)
    # 🚨 T1 + [B1]: carry the degraded state into the VM-side liveness surface itself, so the
    # 08_service_health row reads DEGRADED rather than healthy while nothing is being learned.
    # 🚨 THE UNCONDITIONAL set_degraded IS LOAD-BEARING, INCLUDING WHEN HEALTHY. A start-up
    # that only ever WRITES a reason can never clear one left behind by a previous degraded
    # run, and a stale reason on a now-healthy loop is the same false report wearing the
    # opposite sign. Clearing is a first-class start-up action, not an afterthought.
    if observe_only:
        heartbeat.set_degraded(degraded_reason)
    if degraded_reason:
        heartbeat.emit(error=_degraded_error(degraded_reason))

    iterations = 0
    paused_ticks = 0
    current_level = int(level)  # the live tag-level; the detector adopts N+1 on a flip.
    sl6_sweep_unreachable_count = 0
    observe_stopped_reason: Optional[str] = None
    # 🚨 T1: the ONE number that separates observing from learning. A bandit_posteriors row
    # is written by SAMPLING; only a fold moves alpha/beta and raises n_obs. Report the fold
    # count, never a row count — see the degraded-case note above.
    rewards_folded = 0
    while max_iterations is None or iterations < max_iterations:
        iterations += 1

        # ── R13-P1: pause poll at the TOP of the iteration (before any search work).
        # 🚨 ONE check covers the trainer search AND the R8 loop: _run_one_iteration is the
        # SOLE driver of all R8 activity (its client.submit_proposal / read_verdict /
        # surface_candidate calls), and the VM R8 executor (auto_trader/shadow_executor.py)
        # is a PASSIVE write endpoint with no self-drive — so pausing here halts scope
        # 'trainer+r8_loop' in full, with no separate R8-side attachment point (do NOT go
        # hunting for a second one; there is none — R13-P1 finding). Continue-
        # NOT-break: the daemon stays alive (emits a heartbeat so the silent-death monitor
        # never alarms) and resumes cleanly when paused flips to 0 — no wedged state, no lost
        # cursor (run_trainer_loop holds none; bandit/budget state lives in trainer.db,
        # untouched by a paused tick). UNKNOWN → is_paused()=False → keep running (surfaced
        # to stderr + pause_unknown_count, never swallowed) — a transport blip must never
        # phantom-halt a trainer that never trades.
        if pause_poll is not None and pause_poll.is_paused():
            paused_ticks += 1
            # [B1] alive-but-paused — and STILL degraded if it was. A paused tick that
            # reports clean would reopen the same silence through a side door.
            heartbeat.emit(error=_degraded_error(degraded_reason))
            if max_iterations is not None and iterations >= max_iterations:
                break
            _sliced_sleep(sleep_fn, sleep_seconds, pause_poll, wake_when_paused=False)
            continue

        # ── RF2-B3/W5: mid-run level-increment detector + SL6 anti-lobotomy sweep. Runs at the
        # TOP of the (not-paused) iteration so THIS iteration + W4's projection tag at the
        # correct (possibly just-flipped) level. Checked ONCE per iteration → ~1 ssh per loop
        # cadence (negligible at the 60s default; a hung ssh is bounded by _level_shim_timeout,
        # ~20s, and is non-fatal). It sits inside the not-paused path (after the pause continue)
        # because the sweep IS R8 work — a paused loop must not sweep. Flag OFF → level_detector
        # None → current_level stays the loop-START level → byte-identical to R9-B6.
        if level_detector is not None:
            level_detector.check()  # adopts N+1 on a flip; surfaces UNKNOWN/monotonic itself
            current_level = level_detector.current_level
            if level_detector.needs_sweep():
                sweep = client.sweep_stale_on_flip(level_detector.current_level)
                if sweep.get("ok"):
                    level_detector.mark_swept()
                    print(f"[trainer_loop] {sweep.get('reason')}", file=sys.stderr)
                else:
                    # 🚨 REFUSE-OR-ALERT — the anti-lobotomy sweep did NOT land. LOUD + RETRYABLE
                    # (last_swept_level NOT advanced → re-attempted next iteration). NEVER a
                    # silent no-op: a missed sweep leaves in-flight level-N shadows un-archived
                    # and un-reopened — the guarantee silently didn't run — the campaign's
                    # most-repeated defect class (three prior instances). The durable #qa-agent
                    # alert is VM-only (auto_trader.observability._insert_alert, NOT in-process-
                    # reachable from WSL) → PENDING, never faked (same posture as RF1-B2).
                    sl6_sweep_unreachable_count += 1
                    print(f"[trainer_loop] 🚨🚨 SL6 ANTI-LOBOTOMY SWEEP DID NOT RUN at level "
                          f"{level_detector.current_level}: {sweep.get('reason')}. RETRYABLE — "
                          f"re-attempting next iteration. #qa-agent alert PENDING (VM-only).",
                          file=sys.stderr)

        # ── 🚨 T1: the read-only level-move guard (observe mode only).
        # [B0] closed the level-omission hole at the SIGNATURE. This closes the same hole at
        # RUNTIME: observe mode starts at a level it resolved once (legitimately 0 during
        # paper) and tags every row it writes with it. If L1 mints WHILE this loop is running,
        # every subsequent row would be a level-0 row written into a level-1 world — B0's
        # unrecoverable corruption, arriving by the clock rather than by a missing argument.
        # So the level is re-read (READ-ONLY, the same level_query shim) each iteration and a
        # change STOPS the loop loudly. It never sweeps, never mints, and never writes.
        # An UNKNOWN read is NOT a stop: a transport blip must not halt a trainer that has
        # nothing at stake — it is surfaced and the loop continues at the level it holds.
        if observe_only:
            obs_lvl, obs_why = _resolve_observe_level(level_reader)
            if obs_lvl is None:
                print(f"[trainer_loop] observe: level re-read UNKNOWN ({obs_why}) — "
                      f"continuing at level {current_level}; nothing is at stake.",
                      file=sys.stderr)
            elif int(obs_lvl) != int(current_level):
                observe_stopped_reason = (
                    f"level_moved {current_level}->{obs_lvl}")
                print(
                    f"[trainer_loop] 🚨🚨 OBSERVE MODE STOPPING — the live level moved "
                    f"{current_level} -> {obs_lvl} while observing. Every row written from "
                    f"here would be tagged level_id={current_level} in a level-{obs_lvl} "
                    f"world, which is unrecoverable (level_id is in the PRIMARY KEY and "
                    f"there are no DELETEs). The paper window is over — hand off to the "
                    f"proposing path. Stopping cleanly; nothing was swept and nothing crossed.",
                    file=sys.stderr,
                )
                heartbeat.emit(error=RuntimeError(observe_stopped_reason))
                break

        err: Optional[BaseException] = None
        try:
            trace = _run_one_iteration(
                schema=schema, level=current_level, client=client, rng=rng,
                backtest_fn=backtest_fn, validate_fn=validate_fn, db_path=db_path,
                epoch=epoch, observe_only=observe_only)
            if trace.get("reward_folded"):
                rewards_folded += 1
            if on_iteration is not None:
                try:
                    on_iteration(trace)
                except Exception:
                    pass
        except Exception as exc:  # one bad iteration must never kill the daemon
            err = exc
        # emit the heartbeat every iteration (success or error) — the silent-death surface.
        # 🚨 [B1] THE DEGRADED STATE RIDES EVERY ITERATION, NOT JUST THE FIRST. A live
        # exception WINS the single `last_error` slot — it is the newer, more urgent signal —
        # and the degraded state is carried losslessly beside it in `degraded_reason`. That
        # split is precisely why one surface could never do both jobs: `last_error` is one
        # mutable slot shared with every transient fault, so a degraded string parked there
        # is both overwritable and (nothing ever clears it) permanent. Folding the degraded
        # error in HERE rather than adding a second emit keeps `iteration_count` semantics
        # byte-identical — one emit per iteration, exactly as before.
        heartbeat.emit(error=err or _degraded_error(degraded_reason))
        if observe_only:
            heartbeat.set_degraded(degraded_reason)
        # W4 (RF2-B2): after the decision, sweep the per-DECISION rejection_log (+ standing_
        # hypotheses, W10-fixed) into trainer_memory via the flag-gated wrapper
        # (refresh_reasoning_log keeps the MEMORY_REASONING_ENABLED gate — NOT a bare
        # run_projection). Flag OFF → no import, inert {0,0}, byte-identical. A projection error
        # is SURFACED to stderr + NEVER kills the daemon (honesty posture — not a silent
        # swallow). 🚨 RF2-B3 CLOSED the B2 stale-level constraint: the W5 detector above adopts
        # N+1 BEFORE the iteration, so _run_one_iteration writes rejection_log/hypotheses rows
        # at current_level (N+1) and THIS projection tags them at N+1 (not the stale loop-START
        # level). Rows written before a flip was observed correctly keep the old level.
        if memory_reasoning_enabled():
            try:
                import memory_reasoning
                memory_reasoning.refresh_reasoning_log(db_path)
            except Exception as exc:
                print(f"[trainer_loop] memory projection sweep failed (non-fatal): {exc}",
                      file=sys.stderr)
        if max_iterations is not None and iterations >= max_iterations:
            break
        # R13-P1: sliced sleep so a pause during the long inter-iteration sleep lands within
        # ~one TTL (not a full loop cadence). pause_poll None (flag off) → the original single
        # sleep, byte-identical.
        if pause_poll is not None:
            _sliced_sleep(sleep_fn, sleep_seconds, pause_poll, wake_when_paused=True)
        else:
            try:
                sleep_fn(sleep_seconds)
            except Exception:
                pass

    result = {"enabled": True, "iterations": iterations, "loop_name": heartbeat.loop_name}
    if observe_only:  # T1 — additive only in observe mode (propose-path return byte-identical)
        result["mode"] = "observe_only"
        # 🚨 The honest headline: `simulating` is FALSE without a provider, and the caller
        # must not have to infer that from an absent key. Paired with `proposed`/`promoted`
        # pinned False, this is the mode stating what it did AND what it did not do.
        result["simulating"] = simulating
        result["proposed"] = False
        result["promoted"] = False
        result["observe_violations"] = list(getattr(client, "violations", []))
        # 🚨 The honest discriminator. `rewards_folded == 0` with `iterations > 0` means it
        # SAMPLED but LEARNED NOTHING — and it will still have left bandit_posteriors rows
        # behind (untouched Beta(1,1), n_obs=0). Never read a row count as discovery.
        result["rewards_folded"] = rewards_folded
        # [B1] the machine-readable reason, mirroring `loop_heartbeat.degraded_reason`.
        # None when healthy — so a caller can branch without parsing prose.
        result["degraded_reason"] = degraded_reason
        if degraded_reason == DEGRADED_NO_SIMULATOR:
            result["degraded"] = (
                f"no simulator ({BACKTEST_PROVIDER_ENV} unset) — observed but did NOT learn: "
                f"no compass, no reward, no posterior fold ({rewards_folded} folds in "
                f"{iterations} iterations). ⚠️ bandit_posteriors rows ARE still written by "
                f"SAMPLING (untouched Beta(1,1), n_obs=0) — a row count is not discovery")
        elif degraded_reason == DEGRADED_SIMULATOR_UNKNOWN:
            result["degraded"] = (
                f"simulator UNKNOWN ({BACKTEST_PROVIDER_ENV} names a provider but "
                f"backtest_fn is None) — cannot tell operator intent from broken wiring, so "
                f"the state is neither True nor False ({rewards_folded} folds in "
                f"{iterations} iterations). Treat as NOT LEARNING until resolved")
        if observe_stopped_reason:
            result["stopped_reason"] = observe_stopped_reason
    if pause_poll is not None:  # additive diagnostics only when armed → flag-OFF return is byte-identical
        result["paused_ticks"] = paused_ticks
        result["pause_unknown_count"] = getattr(pause_poll, "unknown_count", 0)
    if level_detector is not None:  # RF2-B3/W5 — additive only when armed (flag-OFF byte-identical)
        result["final_level"] = level_detector.current_level
        result["level_flips_detected"] = level_detector.flips_detected
        result["level_read_unknown_count"] = level_detector.unknown_count
        result["sl6_sweep_pending"] = level_detector.needs_sweep()
        result["sl6_sweep_unreachable_count"] = sl6_sweep_unreachable_count
    return result


def _sliced_sleep(sleep_fn: Callable[[float], None], total: float, pause_poll: Any,
                  *, wake_when_paused: bool) -> None:
    """R13-P1: sleep ``total`` seconds in TTL-sized slices, re-polling pause between slices
    so a state change lands within ~one TTL rather than a full loop cadence. Returns early
    when ``pause_poll.is_paused()`` matches ``wake_when_paused`` — the RUNNING path wakes on
    a NEW pause (``True``); the PAUSED branch wakes on resume (``False``, incl. UNKNOWN →
    not-paused → resume, the keep-running failure semantics). Each slice boundary is a
    cache-served check, so ssh fires at most ~once per TTL, never once per slice. Never
    raises — a pause-read hiccup must not break the sleep."""
    remaining = float(total)
    ttl = getattr(pause_poll, "ttl", 0.0) or remaining
    slice_len = ttl if ttl > 0 else remaining
    while remaining > 1e-9:
        chunk = remaining if remaining < slice_len else slice_len
        try:
            sleep_fn(chunk)
        except Exception:
            pass
        remaining -= chunk
        if remaining <= 1e-9:
            break
        try:
            if pause_poll.is_paused() == wake_when_paused:
                return
        except Exception:
            pass  # a pause-read failure must never break the sleep loop


def _default_validate_fn(**kwargs: Any) -> Dict[str, Any]:
    """Default validation seam → B3's ``validate_candidate`` (imported lazily so the
    module stays import-safe even if the validation module's import chain is unhappy)."""
    import trainer_validation
    return trainer_validation.validate_candidate(None, **kwargs)


def _new_rng():
    import random
    return random.Random()


# ═══════════════════════════════════════════════════════════════════════════
# 3. RF1-B2 (BLOCK-2) — live-level resolution: resolve the minted level from the
#    VM chain, hard-UNKNOWN on any failure, REJECT < 1. NO numeric default, EVER.
# ═══════════════════════════════════════════════════════════════════════════
# The authoritative level lives ONLY in the VM chain (repo-root rebuild_tracker.db,
# read via scripts/level/level_query.py). MAX(level_id) in ANY WSL table is a LAGGING
# proxy (G9) and is NEVER read here. Mirrors memory_tiers._read_current_level_via_ssh
# discipline (read-only ssh, allowlist the 'current' reader subcommand, sudo -u trevor
# opens a mode=ro handle, hard subprocess timeout, ANY failure → UNKNOWN) PLUS the
# trainer-specific rule that a resolved value < 1 is UNKNOWN too. 🚨 0 IS THE CORRUPTION
# this blocker exists to stop — level_query.current_level() returns 0 on an empty table
# (TRAP A's door), so the trainer must REFUSE on < 1 rather than tag its whole corpus at
# level 0. The watcher_integrity precedent treats current_level >= 1 as "positively
# verified"; this matches that bar. The F8 door is closed CALLER-SIDE (this new reader),
# never by touching the VM-side current_level() or memory_tiers (which legitimately
# accepts 0 as "no demotion, safe" — a VM-side source hardening is a documented VM-tab
# follow-up, no code here).
_LEVEL_QUERY = os.environ.get("TRAINER_LEVEL_QUERY", "scripts/level/level_query.py")


def _level_shim_timeout() -> float:
    """Hard subprocess timeout (s) for the level read — a hung ssh becomes UNKNOWN.
    Env-overridable for the timeout failure-mode test."""
    raw = os.environ.get("TRAINER_LEVEL_SSH_TIMEOUT", "").strip()
    try:
        val = float(raw)
        return val if val > 0 else 20.0
    except (ValueError, TypeError):
        return 20.0


def _read_vm_level() -> Tuple[Optional[int], str]:
    """Read ``current_level`` over the read-only ssh shim → ``(level, detail)``.

    ``(int, "ok")`` on a clean read — the int MAY be 0 (the empty/unminted chain);
    the < 1 gate lives in ``_resolve_live_level``. ``(None, <detail>)`` on ANY
    transport/parse failure — spawn / timeout / nonzero / empty / malformed /
    non-object / non-int / bool. NEVER raises, NEVER a guessed level, NEVER a VM
    mutation (allowlist = the 'current' reader subcommand only; ``sudo -u trevor``
    opens a mode=ro handle). ``HOME=/home/ghost`` is DEFENSIVE ONLY — the child ssh
    resolves its key/config from the process UID (getpwuid), NOT $HOME, regardless of
    the spawning runtime; the "R12-B2 gotcha" named a mechanism that does not apply to
    ssh (RF3T2-B8, measured)."""
    remote = "cd %s && sudo -u trevor python3 %s current" % (
        shlex.quote(_VM_DIR), shlex.quote(_LEVEL_QUERY),
    )
    argv = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", _VM_HOST, remote]
    env = dict(os.environ)
    env["HOME"] = "/home/ghost"
    try:
        p = subprocess.run(argv, capture_output=True, text=True,
                           timeout=_level_shim_timeout(), env=env, check=False)
    except subprocess.TimeoutExpired:
        return None, "ssh_timeout"
    except (OSError, ValueError) as exc:  # ssh missing / bad argv
        return None, f"ssh_spawn_failed: {exc}"
    if p.returncode != 0:
        return None, f"ssh_nonzero (rc={p.returncode}): {(p.stderr or '').strip()[:200]}"
    out = (p.stdout or "").strip()
    if not out:
        return None, "empty_output"
    try:
        data = json.loads(out)
    except (ValueError, TypeError):
        return None, "malformed_json"
    if not isinstance(data, dict):
        return None, "non_object_body"
    lvl = data.get("current_level")
    # bool is an int subclass — reject it explicitly; reject any non-int.
    if isinstance(lvl, bool) or not isinstance(lvl, int):
        return None, f"non_int_current_level ({lvl!r})"
    return lvl, "ok"


def _resolve_live_level(
    reader: Optional[Callable[[], Tuple[Optional[int], str]]] = None,
) -> Tuple[Optional[int], str]:
    """Resolve the minted level for a daemon start → ``(level>=1, "ok")`` or
    ``(None, reason)``.

    🚨 HARD-UNKNOWN, NO NUMERIC DEFAULT. A resolved value < 1 (INCLUDING the empty-table
    0 that level_query returns) is UNKNOWN → refuse. ``reader`` is injectable for the
    isolated-copy acceptance test (default = the read-only ssh shim ``_read_vm_level``)."""
    read = reader or _read_vm_level
    lvl, detail = read()
    if lvl is None:
        return None, f"unresolved ({detail})"
    if lvl < 1:
        return None, (f"level<1 (current_level={lvl}; empty/unminted chain — "
                      f"the trainer never runs at level 0)")
    return lvl, "ok"


def _resolve_observe_level(
    reader: Optional[Callable[[], Tuple[Optional[int], str]]] = None,
) -> Tuple[Optional[int], str]:
    """T1: resolve the level for an OBSERVE-ONLY start → ``(level>=0, "ok")`` or ``(None, reason)``.

    🚨 THIS IS THE WHOLE DEADLOCK, AND IT IS ONE DISTINCTION.
    ``_resolve_live_level`` returns ``None`` for TWO different states — a hard-UNKNOWN (the
    VM could not be read) and a KNOWN, legitimate ``0`` (the chain is simply not minted yet).
    Collapsing them is correct for the PROPOSING path, where both mean "do not tag a corpus."
    It is what makes §D.9 step 3 unbuildable: the paper window IS the known-0 state, and the
    resolver has no way to say so.

    This reader splits them. A hard-UNKNOWN still REFUSES — observing at a level we cannot
    read would tag rows with a guess, which is B0's corruption by another road. A KNOWN level
    (including ``0``) is ACCEPTED and returned as-is, so every row the observe window writes
    carries the level that was actually live when it was written.

    🚨 It does NOT mint, and it cannot: the underlying shim is ``level_query.py current``,
    read-only, the same one ``_resolve_live_level`` uses. Observing changes no money path
    (§D.3), so it needs no level of its own — it borrows the one that already exists.

    ⚠️ This function is NEVER called by ``main()``. ``main()``'s below-L1 refusal is untouched
    and still governs the propose path in full."""
    read = reader or _read_vm_level
    lvl, detail = read()
    if lvl is None:
        return None, f"unresolved ({detail})"
    if lvl < 0:  # defensive: a negative level is not a state the chain can legitimately hold
        return None, f"level<0 (current_level={lvl}; not a valid level)"
    return lvl, "ok"


# ═══════════════════════════════════════════════════════════════════════════
# 3b. RF2-B3 (W5-U5) — the mid-run level-increment detector.
# ═══════════════════════════════════════════════════════════════════════════
class LevelDetector:
    """Detect a level flip WHILE the loop runs — the piece that makes the SL6 sweep reachable.

    v2 §D.12.7 requires the running loop to become aware of a flip mid-run (it keeps searching
    against the OLD champion UNTIL the level flips). But the built loop re-resolves the level
    ONLY at ``main()`` start (RF1-B2), so a long-running loop could never observe an increment
    — making the SL6 anti-lobotomy sweep unreachable in practice. This closes that: once per
    iteration the loop re-reads the VM level via the EXISTING read-only shim (``_read_vm_level``
    — the SAME seam, never a second reader, never a WSL ``MAX(level_id)`` lagging proxy),
    compares it to the level it holds, and on a flip adopts N+1 and signals the sweep.

    🚨 READS the level, NEVER writes one. ``MAX(level)`` is minted ONLY at go-live (R2), never
    here. The detector holds NO durable state: on a daemon restart, ``main()`` re-resolves the
    true level from the authoritative VM chain and a fresh detector inits from that — the
    in-memory held level need not survive a restart (the VM chain is the source of truth).

    🚨 START-vs-MID-RUN ASYMMETRY (keep this comment — a future reader gets it wrong without it):
    at START an unresolved level means 'don't know what to tag' → corpus corruption → the daemon
    REFUSES (``_resolve_live_level``). MID-RUN the level was ALREADY positively resolved (>=1)
    and the chain is MONOTONIC, so a transient unreachable only DELAYS observing a flip by one
    cadence — it NEVER corrupts, because the loop keeps tagging at a still-valid level. So a
    mid-run read failure is keep-running-VISIBLY (stderr + ``unknown_count``), NEVER a refuse and
    NEVER a silent skip.

    Idempotency: ``last_swept_level`` (init = ``start_level``) tracks the highest flip whose
    sweep LANDED. ``needs_sweep()`` = ``current_level > last_swept_level``; the caller calls
    ``mark_swept()`` ONLY on a successful sweep. A flip observed while a prior sweep is un-landed
    re-fires the sweep (retry); a landed sweep never re-fires (``current == last_swept``)."""

    def __init__(self, start_level: int,
                 reader: Optional[Callable[[], Tuple[Optional[int], str]]] = None) -> None:
        self.current_level = int(start_level)
        # the loop's OWN start-level in-flight shadows need no sweep → last_swept = start.
        self.last_swept_level = int(start_level)
        self._read = reader or _read_vm_level
        self.flips_detected = 0
        self.unknown_count = 0

    def check(self) -> Dict[str, Any]:
        """Re-read the VM level (called once per iteration) and adopt N+1 on a flip. Returns a
        small diagnostics dict. NEVER raises (a read hiccup must not kill an iteration)."""
        try:
            lvl, detail = self._read()
        except Exception as exc:  # defensive — the injected/real reader must never throw here
            self.unknown_count += 1
            print(f"[trainer_loop] level-detector read raised (non-fatal; keep running at level "
                  f"{self.current_level}): {exc!r}", file=sys.stderr)
            return {"flipped": False, "unknown": True, "current_level": self.current_level}
        if lvl is None:
            # 🚨 mid-run unreachable — NOT a silent skip. Keep running at the current known-good
            # (monotonic-safe) level; surface + count; retry next iteration.
            self.unknown_count += 1
            print(f"[trainer_loop] level-detector UNKNOWN ({detail}) — cannot confirm a flip this "
                  f"tick; keep running at level {self.current_level} (retry next iteration).",
                  file=sys.stderr)
            return {"flipped": False, "unknown": True, "current_level": self.current_level}
        if lvl > self.current_level:
            prev = self.current_level
            self.current_level = int(lvl)   # ADOPT N+1 immediately → this iteration + W4's
            self.flips_detected += 1        # projection tag at N+1 (closes B2's stale-level).
            print(f"[trainer_loop] 🔺 LEVEL FLIP DETECTED {prev} → {lvl} — adopting {lvl}; SL6 "
                  f"anti-lobotomy sweep pending.", file=sys.stderr)
            return {"flipped": True, "unknown": False, "prev": prev,
                    "current_level": self.current_level}
        if lvl < self.current_level:
            # monotonic violation — the level chain never decreases. Ignore (never lower the
            # level); surface defensively. Impossible on a healthy chain.
            print(f"[trainer_loop] level-detector read {lvl} BELOW held {self.current_level} "
                  f"(monotonic violation) — ignoring, staying at {self.current_level}.",
                  file=sys.stderr)
            return {"flipped": False, "unknown": False, "current_level": self.current_level}
        return {"flipped": False, "unknown": False, "current_level": self.current_level}

    def needs_sweep(self) -> bool:
        return self.current_level > self.last_swept_level

    def mark_swept(self) -> None:
        """Record that the SL6 sweep for ``current_level`` LANDED. Call ONLY on sweep success —
        a failed sweep leaves ``last_swept_level`` behind so ``needs_sweep()`` stays True (the
        retry that makes refuse-or-alert re-attempt, never forget)."""
        self.last_swept_level = self.current_level


# ── RP-C2: the backtest_fn socket ────────────────────────────────────────────
def _resolve_backtest_fn() -> Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]]:
    """Resolve the optional compass pre-score simulator named by
    ``TRAINER_BACKTEST_PROVIDER`` as ``"module:attr"``. Returns ``None`` when unset.

    🚨 THIS IS THE SOCKET, NOT THE SIMULATOR. Building `backtest_fn` is D-5 / RF-BACKTEST
    (contract: docs/design/BACKTEST_FN_SPEC.md); this only DELIVERS one to
    ``run_trainer_loop``. Before RP-C2 there was no delivery path at all: ``main`` called
    ``run_trainer_loop(level=level)``, ``backtest_fn`` defaulted to ``None``, and the
    ``if backtest_fn is not None`` branch in ``_run_one_iteration`` — the ONLY route to
    ``trainer_bandit.compass_reward`` and therefore to ``REWARD_K`` — could never be taken.
    A correct constant nothing reaches is this codebase's signature defect; this is the wire.

    ⚠️ ``attr`` must BE the ``backtest_fn(arm: dict, level: int) -> dict`` callable itself
    (no factory protocol — an ambiguous one is how unrecorded assumptions get in).

    🚨 A SET-BUT-UNRESOLVABLE provider REFUSES (raises) rather than falling back to ``None``.
    Silently running without the simulator the operator explicitly named would make the
    survival gates blind exactly as BACKTEST_FN_SPEC.md §0 warns — and silence is the
    failure mode this campaign exists to kill. Same posture as the below-L1 refusal: a loud
    stop is the fix WORKING. Unset is the default and can never reach this path.
    """
    spec = os.environ.get(BACKTEST_PROVIDER_ENV, "").strip()
    if not spec:
        return None  # byte-identical to the pre-RP-C2 call
    if ":" not in spec:
        raise ValueError(
            f"{BACKTEST_PROVIDER_ENV}={spec!r} is malformed — expected 'module:attr'")
    mod_name, _, attr_name = spec.partition(":")
    try:
        import importlib
        mod = importlib.import_module(mod_name.strip())
        fn = getattr(mod, attr_name.strip())
    except Exception as exc:
        raise ValueError(
            f"{BACKTEST_PROVIDER_ENV}={spec!r} did not resolve: {exc!r}") from exc
    if not callable(fn):
        raise ValueError(
            f"{BACKTEST_PROVIDER_ENV}={spec!r} resolved to a non-callable {type(fn).__name__}")
    return fn


# ── explicit entrypoint (NO import-time execution; flag-gated) ───────────────
def main(reader: Optional[Callable[[], Tuple[Optional[int], str]]] = None,
         backtest_fn: Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]] = None) -> int:
    """The R13 daemon entrypoint. Refuses to run unless ``TRAINER_LOOP_ENABLED`` AND the
    live level resolves to >= 1 from the VM chain (RF1-B2). ``reader`` is a test seam
    injected by the isolated-copy acceptance gate; production passes nothing (the real
    read-only ssh shim). NEVER passes a numeric default to ``run_trainer_loop``.

    ``backtest_fn`` (RP-C2) is the compass pre-score simulator, injected the same way
    ``reader`` is; when omitted it is resolved from ``TRAINER_BACKTEST_PROVIDER``
    (see ``_resolve_backtest_fn``). Both absent → ``None`` → byte-identical to R9-B6."""
    if not loop_enabled():
        print(json.dumps({"enabled": False,
                          "reason": f"{LOOP_FLAG} off — the trainer daemon does not start"}))
        return 0
    # RF1-B2 / BLOCK-2: resolve the live level from the authoritative VM chain and REFUSE
    # on hard-UNKNOWN. There is NO numeric default anywhere — 0 IS the corruption. A daemon
    # that refuses HERE is the fix WORKING (see the go-live runbook), not a failure.
    level, why = _resolve_live_level(reader)
    if level is None:
        # 🚨 Loud, durable-on-stderr refusal (the trainer's OWN daemon journal — the always-
        # available surface). The #qa-agent alert row (auto_trader.observability._insert_alert)
        # is a VM module, NOT in-process-reachable from WSL — and an ssh emit would itself fail
        # on the ssh-failure/timeout refusal cases — so it is marked PENDING, never faked here.
        print(
            f"[trainer_loop] REFUSING TO START — {LOOP_FLAG} on but the live level did not "
            f"resolve to >= 1: {why}. No numeric default; the trainer does NOT run at level 0.",
            file=sys.stderr,
        )
        print(json.dumps({"enabled": True, "started": False,
                          "reason": "level_unresolved", "detail": why}))
        return 1
    # RP-C2: deliver the compass pre-score simulator. An explicit `backtest_fn` argument
    # (the injection seam, mirroring `reader`) wins; otherwise resolve the env-named
    # provider. Both absent → None → byte-identical to the pre-RP-C2 `run_trainer_loop(
    # level=level)`. THIS LINE is what makes `REWARD_K` reachable from the entrypoint at all.
    result = run_trainer_loop(level=level,
                              backtest_fn=backtest_fn or _resolve_backtest_fn())
    print(json.dumps(result))
    return 0


def _install_observe_signal_handlers(state: Dict[str, Any]) -> None:
    """T1 / §D.0 — a killed observe daemon must SAY it was killed.

    Without this, SIGTERM (`systemctl stop`, an OOM reaper, a T2 operator) terminates the
    process mid-iteration and the ONLY trace is a `loop_heartbeat` row that simply stops
    advancing — indistinguishable, for up to the 2h stale threshold, from a daemon that is
    merely slow. §D.0: every autonomous component surfaces its own failure, never swallows
    it. So the handler prints a loud, dated, terminal line naming the signal and the
    iteration it died in, then re-raises the default disposition so the exit status stays
    honest (we do NOT swallow the signal and keep running)."""
    import signal

    def _handler(signum: int, _frame: Any) -> None:
        name = signal.Signals(signum).name
        print(
            f"[trainer_loop] 🚨🚨 OBSERVE DAEMON TERMINATED BY {name} at "
            f"{utc_now()} — during iteration {state.get('iteration', '?')} at level "
            f"{state.get('level', '?')}. This is a DEATH, not a pause: no further "
            f"observation happens and the loop_heartbeat row will now go stale. Reported "
            f"here because a dead daemon that stops discovery invisibly is the failure "
            f"this mode exists to make impossible (§D.0).",
            file=sys.stderr, flush=True,
        )
        signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _handler)
        except (ValueError, OSError) as exc:  # not the main thread / unsupported
            print(f"[trainer_loop] could not install {sig!r} handler: {exc!r}",
                  file=sys.stderr)


def observe_main(reader: Optional[Callable[[], Tuple[Optional[int], str]]] = None,
                 backtest_fn: Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]] = None,
                 max_iterations: Optional[int] = None) -> int:
    """🚨 T1 — THE OBSERVE-ONLY (PAPER WINDOW) ENTRYPOINT. §D.9 step 3.

    The designed middle state: the trainer runs, observes, simulates and learns, and
    **proposes nothing, promotes nothing, and mints nothing**. It exists because §D.9 step 3
    ("NO leveling · NO promotions") and ``main()``'s below-L1 refusal are individually
    correct and jointly a deadlock — the refusal has no mode, so the only way to run the
    loop was to mint a level the design forbids minting.

    🚨 THIS IS NOT ``main()`` AND IT DOES NOT WEAKEN IT. ``main()`` is byte-untouched: it
    still resolves the live level and still REFUSES below L1 with rc=1 on the proposing
    path. This is a SECOND door with a DIFFERENT policy and its OWN flag
    (``TRAINER_OBSERVE_ONLY_ENABLED``), so arming observation cannot arm proposing.

    🚨 IT MINTS NOTHING. ``MAX(level)`` is read, never written (``level_query.py current``
    is read-only). §D.3: a level versions the MONEY PATH, and observing changes no money
    path — so it borrows the level that already exists, which today is legitimately ``0``.
    A hard-UNKNOWN level still REFUSES with rc=1: observing at a level we cannot read would
    tag rows with a guess.

    Returns 0 on a clean run/inert flag, 1 on a refusal."""
    if not observe_only_enabled():
        print(json.dumps({"enabled": False, "mode": "observe_only",
                          "reason": f"{OBSERVE_FLAG} off — the observe daemon does not start"}))
        return 0
    level, why = _resolve_observe_level(reader)
    if level is None:
        print(
            f"[trainer_loop] REFUSING TO OBSERVE — {OBSERVE_FLAG} on but the live level did "
            f"not resolve: {why}. Observing needs no MINT, but it does need a KNOWN level to "
            f"tag its rows with; a guessed level is [B0]'s corruption by another road.",
            file=sys.stderr,
        )
        print(json.dumps({"enabled": True, "mode": "observe_only", "started": False,
                          "reason": "level_unresolved", "detail": why}))
        return 1
    state: Dict[str, Any] = {"level": level, "iteration": 0}
    _install_observe_signal_handlers(state)
    print(
        f"[trainer_loop] OBSERVE-ONLY MODE STARTING at level {level} — §D.9 step 3. This "
        f"loop will sample, simulate, push back and learn locally. It will NOT propose, "
        f"promote, teach, grade, validate, sweep or mint. {OBSERVE_FLAG} is on; {LOOP_FLAG} "
        f"governs the proposing path and is NOT read here.",
        file=sys.stderr,
    )
    result = run_trainer_loop(
        level=level, observe_only=True, level_reader=reader,
        max_iterations=max_iterations,
        backtest_fn=backtest_fn or _resolve_backtest_fn(),
        on_iteration=lambda t: state.__setitem__("iteration", state.get("iteration", 0) + 1))
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    # Guarded: NEVER runs the loop on import, and does NOTHING unless the flag is on.
    # 🚨 T1: `--observe` selects the paper-window entrypoint. Absent → main(), unchanged.
    # Two entrypoints, two flags, two policies — chosen explicitly at the command line so a
    # unit's ExecStart states which one it is running.
    raise SystemExit(observe_main() if "--observe" in sys.argv[1:] else main())
