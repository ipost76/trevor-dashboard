#!/usr/bin/env python3
"""trainer_budget_adapter.py — the Layer-2 alpha-budget THROTTLE adapter [R9-B2].

The thin, single surface through which the R9 trainer touches ``alpha_budget``.
It exposes exactly ONE public callable — ``throttle_test`` (the FDR discovery
gate) — and has ZERO path to ``alpha_budget.reset``.

═══════════════════════════════════════════════════════════════════════════════
 WHY THIS EXISTS (A1 / RECON-TRAINER-001, decision-3 correction + rec #2)
═══════════════════════════════════════════════════════════════════════════════
The two-layer Thompson split (see ``trainer_bandit``): Layer 1 keeps per-arm Beta
posteriors and decides WHICH arm to try; Layer 2 — this adapter — is the
DOWNSTREAM throttle that decides whether an evaluated arm's edge counts as a
DISCOVERY, spending/replenishing ``alpha_budget``'s single GLOBAL wealth scalar
(LordState). The budget throttles HOW MANY arms reach a promotion verdict; the
posteriors decide WHICH arm to try next. That is decision-4's self-throttle.

THE reset() DENY (A1 rec #2 — the anti-farming hole, made structural):
  ``alpha_budget.reset()`` (alpha_budget.py:518) is a public, un-guarded wipe
  (``DELETE FROM alpha_budget WHERE id=1`` + re-seed). If the continuous daemon
  could reach it, it would learn to reset-and-refarm the budget. So this adapter
  imports/re-exports/references NOTHING but ``test()``. There is no code path from
  the trainer to ``reset``. A CI/test AST-assert (tests/test_trainer_budget_adapter.py)
  proves zero ``alpha_budget.reset`` references across every trainer module. The
  sound anti-farming CARRY (``apply_level_increment``, bounded top-up ≤0.025 < w0)
  is respected implicitly — the trainer only ever calls ``test()``, which
  spends/replenishes via the LORD schedule; it never tops-up or resets directly.

═══════════════════════════════════════════════════════════════════════════════
 THE CALL PATH (A1 §5.6 — validated-verdict math runs VM-side)
═══════════════════════════════════════════════════════════════════════════════
``alpha_budget`` lives in ``auto_trader.validation`` on the VM; importing it runs
the ``auto_trader/__init__`` chain (manager -> judgment -> config.load_dotenv),
which (a) trips on WSL and (b) reads trevor's ``0600 .env``. So the adapter is a
THIN RPC from WSL -> VM: ``ssh vm 'cd <bot> && sudo -u trevor venv/bin/python3 -c
<program> <json-kwargs>'``. The VM program imports ``alpha_budget`` and calls
``test()`` ONLY. Confirmed live at build (RECON-TRAINER-001): the import succeeds
as trevor, ``enabled()`` is readable, ``test``/``reset`` both exist on the module —
this adapter reaches ``test`` and never ``reset``.

B3 owns the full per-candidate R3 call sequence (dsr/pbo/git_fn wiring); B2 builds
this arm->throttle interface + the reset deny. B3 may replace the ssh-pipe with a
lighter in-process RPC — the ``throttle_test`` signature is the stable seam.

money_path=no. Python 3, stdlib only. ``git_fn`` is intentionally NOT plumbed
(un-serializable across the pipe; B3 wires it VM-side).
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
from typing import Any, Dict, Optional

# ── RPC target (env-overridable; defaults to the established `ssh vm` pipe) ──
_VM_HOST = os.environ.get("TRAINER_VM_HOST", "vm")
_VM_DIR = os.environ.get("TRAINER_VM_DIR", "/home/trevor/trevor")
_VM_PY = os.environ.get("TRAINER_VM_PY", "venv/bin/python3")
_DEFAULT_TIMEOUT = float(os.environ.get("TRAINER_RPC_TIMEOUT", "60"))

# The VM-side program. It imports alpha_budget and calls test() ONLY. It NEVER
# references reset (grep/AST-clean). Kept as a data string so this module's own
# AST has no `alpha_budget` attribute node at all — the trainer literally cannot
# reach reset through the adapter's Python surface.
_VM_PROGRAM = (
    "import json, sys\n"
    "from auto_trader.validation import alpha_budget\n"
    "kw = json.loads(sys.argv[1])\n"
    "kw = {k: v for k, v in kw.items() if v is not None}\n"
    "try:\n"
    "    print(json.dumps(alpha_budget.test(**kw)))\n"
    "except Exception as exc:\n"
    "    print(json.dumps({'adapter_error': str(exc), 'enabled': None,\n"
    "                      'discovery': None, 'wealth': None, 'level': None}))\n"
)


def _vm_call(payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    """Run the VM-side test() program over ssh (as trevor) and parse its JSON.

    Never raises to the caller — surfaces transport/parse failures as a
    ``{"adapter_error": ...}`` dict so a throttle miss can't crash the search.
    """
    args = json.dumps(payload)
    remote = (
        f"cd {shlex.quote(_VM_DIR)} && sudo -u trevor {shlex.quote(_VM_PY)} "
        f"-c {shlex.quote(_VM_PROGRAM)} {shlex.quote(args)}"
    )
    try:
        proc = subprocess.run(
            ["ssh", _VM_HOST, remote],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        return {"adapter_error": "rpc_timeout", "enabled": None, "discovery": None,
                "wealth": None, "level": None}
    except Exception as exc:  # ssh missing / OS error
        return {"adapter_error": f"rpc_failed: {exc}", "enabled": None,
                "discovery": None, "wealth": None, "level": None}
    out = (proc.stdout or "").strip()
    if not out:
        return {"adapter_error": f"rpc_no_output (rc={proc.returncode}): "
                f"{(proc.stderr or '').strip()[:400]}", "enabled": None,
                "discovery": None, "wealth": None, "level": None}
    # The program prints one JSON object; take the last non-empty line to skip
    # any benign VM-side import chatter on stdout.
    for line in reversed(out.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    return {"adapter_error": f"rpc_unparseable: {out[:400]}", "enabled": None,
            "discovery": None, "wealth": None, "level": None}


def throttle_test(p_value: Optional[float] = None, *, dsr: Optional[float] = None,
                  pbo: Optional[float] = None, db_path: Optional[str] = None,
                  timeout: Optional[float] = None) -> Dict[str, Any]:
    """The Layer-2 FDR throttle — spend from the alpha budget on one evaluated arm.

    Wraps ``alpha_budget.test(p_value, *, dsr, pbo, db_path)`` VM-side (as trevor).
    Given a p-value (or a DSR via ``dsr``, auto-converted VM-side), the LORD engine
    computes the current alpha-level, spends it, records the outcome, and returns
    the verdict. Called AFTER an arm is evaluated to decide if it earns a promotion
    verdict; the budget throttles how many arms reach that verdict (decision-4).

    Returns alpha_budget.test's dict: ``{discovery, alpha_t, wealth, level, enabled,
    ...}`` (``discovery=True`` = a real edge worth promoting). FLAG-OFF VM-side ->
    ``{"enabled": False, ...}`` and mutates NOTHING. Never raises: a transport
    failure surfaces as ``{"adapter_error": ...}``.

    ``db_path`` lets the caller (or a reachability test) target a throwaway budget
    ledger so the real discovery wealth is never touched. There is NO ``reset``
    parameter and NO reset path — by design.
    """
    payload = {"p_value": p_value, "dsr": dsr, "pbo": pbo, "db_path": db_path}
    return _vm_call(payload, float(timeout if timeout is not None else _DEFAULT_TIMEOUT))


# The adapter's PUBLIC surface, made explicit: throttle_test ONLY. `reset` is not
# here, is not importable through here, and is not referenced anywhere below.
__all__ = ["throttle_test"]


if __name__ == "__main__":
    # Guarded smoke: a safe reachability probe against a THROWAWAY VM ledger
    # (flag is OFF VM-side -> test() is a dormant no-op; the throwaway db_path is
    # belt-and-suspenders so the real budget is never touched either way).
    _verdict = throttle_test(p_value=0.5, db_path="/tmp/trainer_b2_throwaway_budget.db")
    print(json.dumps({"reachability": _verdict}, indent=2))
