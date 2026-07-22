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
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Sequence

# B0–B5 modules (import-safe on WSL; each gates its own live behavior behind a flag).
import trainer_bandit
import trainer_reasoning
import trainer_budget
import compass_metrics
from lib.trainer_db import get_connection, utc_now

# ── flags ───────────────────────────────────────────────────────────────────
LOOP_FLAG = "TRAINER_LOOP_ENABLED"                 # the daemon master gate (default OFF)
EXECUTOR_FLAG = "SHADOW_LOOP_EXECUTOR_ENABLED"     # the cross-box submission gate (default OFF)


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def loop_enabled() -> bool:
    """The daemon master gate (default OFF). Off → ``run_trainer_loop`` is inert."""
    return _truthy(LOOP_FLAG)


def submissions_enabled() -> bool:
    """WSL-side hint for the cross-box submission gate (default OFF). Off → the client
    short-circuits every RPC to a local no-op (nothing crosses to the VM)."""
    return _truthy(EXECUTOR_FLAG)


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


def sort_candidates_for_display(candidates: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sort surfaced candidates by EVIDENCE for the Hub's one-glance display ONLY.

    🚨 This is presentation, NOT a promotion decision — it issues no promotion and
    reorders no queue; Ghost+CC decide priority (§D.12.8). Ordering key: matched-data
    net_usd desc, then win_rate desc, then n desc — a stable, evidence-first display.
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
    epoch: Optional[str],
) -> Dict[str, Any]:
    """One full search step: sample → compass pre-score → self-pushback → submit →
    verdict → validate → narrate+log → update posteriors → surface. Returns a diagnostics
    dict. Raising is the caller's concern (it emits an error heartbeat + continues)."""
    trace: Dict[str, Any] = {"level": int(level)}

    # 1) sample arm (B2) — inert {enabled:False} when TRAINER_BANDIT_ENABLED is off.
    step = trainer_bandit.run_search_step(schema, int(level), rng=rng)
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
            trace["outcome"] = "compass_rejected"
            return trace
    else:
        trace["compass"] = "skipped (no backtest_fn — VM verdict authoritative)"

    # 3) self-pushback (B4) — skip known dead-ends + the optional advisory LLM sanity.
    pushback = trainer_reasoning.self_pushback(candidate, db_path=db_path)
    trace["pushback"] = {"proceed": pushback.get("proceed"), "source": pushback.get("source")}
    if not pushback.get("proceed"):
        # a proven dead-end / not-sensible → don't spend a slot. It was folded when first
        # rejected (rejection_log); nothing more to learn this trial.
        trace["outcome"] = f"pushback_block: {pushback.get('reason')}"
        return trace

    # 4) submit to the loop (Phase 1) — config→self-create shadow / capability→Hub row.
    #    Flag-OFF-safe: a no-op when the gate is off / executor down (queued locally).
    proposal = arm_to_proposal(arm)
    shadow_id = mint_shadow_id(ahash, int(level))
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
        trace["posterior"] = {"reward": round(reward, 4), "alpha": round(post[0], 4),
                             "beta": round(post[1], 4), "n_obs": post[2]}

    # 9) surface promotions (Phase 1) — SURFACE, never rank/promote (§D.12.8). Only a
    #    gate-passed shadow. Flag-OFF-safe.
    if gate_passed is True:
        surfaced = client.surface_candidate(shadow_id, config_diff=axes_json,
                                            stats=(validation or {}).get("verdict"),
                                            reasoning=rationale)
        trace["surface"] = {"surfaced": surfaced.get("surfaced"), "reason": surfaced.get("reason")}

    trace["outcome"] = "completed"
    return trace


def run_trainer_loop(
    *, schema: Optional[Dict[str, Any]] = None, level: int = 0,
    max_iterations: Optional[int] = None,
    client: Optional[R8HandoffClient] = None,
    heartbeat: Optional[TrainerHeartbeat] = None,
    backtest_fn: Optional[Callable[[Dict[str, Any], int], Dict[str, Any]]] = None,
    validate_fn: Optional[Callable[..., Dict[str, Any]]] = None,
    rng: Any = None, sleep_seconds: Optional[float] = None,
    sleep_fn: Optional[Callable[[float], None]] = None,
    db_path: Optional[str] = None, epoch: Optional[str] = None,
    on_iteration: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """The continuous always-on trainer search (decision 4), tying B1–B5 together.

    DORMANT unless ``TRAINER_LOOP_ENABLED`` — returns ``{enabled: False}`` and does NOT
    run (no auto-start; the caller is an explicit R13 entrypoint). Self-throttled by the
    alpha-budget (discovery, inside ``validate_candidate``) and the API budget (narration,
    inside ``narrate_verdict``/``self_pushback``) — always-on is safe.

    A single bad iteration NEVER kills the daemon: the iteration is wrapped, an error
    heartbeat is emitted, and the loop continues. ``max_iterations`` bounds the run for
    tests/one-shots (None = forever). ``backtest_fn``/``validate_fn``/``client``/
    ``heartbeat``/``sleep_fn`` are injectable seams (defaults are the real wirings)."""
    if not loop_enabled():
        return {"enabled": False, "reason": f"{LOOP_FLAG} off (inert; not auto-started)",
                "iterations": 0}

    schema = schema or trainer_bandit.default_axis_schema()
    client = client or R8HandoffClient()
    heartbeat = heartbeat or TrainerHeartbeat()
    validate_fn = validate_fn or _default_validate_fn
    rng = rng if rng is not None else _new_rng()
    sleep_fn = sleep_fn or time.sleep
    sleep_seconds = float(sleep_seconds) if sleep_seconds is not None else float(
        os.environ.get("TRAINER_LOOP_SLEEP_SECONDS", "60"))

    heartbeat.pre_register()  # create the loop_heartbeat row once (idempotent)

    iterations = 0
    while max_iterations is None or iterations < max_iterations:
        iterations += 1
        err: Optional[BaseException] = None
        try:
            trace = _run_one_iteration(
                schema=schema, level=int(level), client=client, rng=rng,
                backtest_fn=backtest_fn, validate_fn=validate_fn, db_path=db_path,
                epoch=epoch)
            if on_iteration is not None:
                try:
                    on_iteration(trace)
                except Exception:
                    pass
        except Exception as exc:  # one bad iteration must never kill the daemon
            err = exc
        # emit the heartbeat every iteration (success or error) — the silent-death surface.
        heartbeat.emit(error=err)
        if max_iterations is not None and iterations >= max_iterations:
            break
        try:
            sleep_fn(sleep_seconds)
        except Exception:
            pass

    return {"enabled": True, "iterations": iterations, "loop_name": heartbeat.loop_name}


def _default_validate_fn(**kwargs: Any) -> Dict[str, Any]:
    """Default validation seam → B3's ``validate_candidate`` (imported lazily so the
    module stays import-safe even if the validation module's import chain is unhappy)."""
    import trainer_validation
    return trainer_validation.validate_candidate(None, **kwargs)


def _new_rng():
    import random
    return random.Random()


# ── explicit entrypoint (NO import-time execution; flag-gated) ───────────────
def main() -> int:
    """The R13 daemon entrypoint. Refuses to run unless ``TRAINER_LOOP_ENABLED``."""
    if not loop_enabled():
        print(json.dumps({"enabled": False,
                          "reason": f"{LOOP_FLAG} off — the trainer daemon does not start"}))
        return 0
    result = run_trainer_loop()
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    # Guarded: NEVER runs the loop on import, and does NOTHING unless the flag is on.
    raise SystemExit(main())
