#!/usr/bin/env python3
"""Tests for the R9-B2 Layer-2 throttle adapter (trainer_budget_adapter.py).

Proves the anti-farming guarantee (A1 rec #2): the adapter exposes ONLY
``throttle_test`` and there is ZERO ``alpha_budget.reset`` reference anywhere in
the trainer module set — enforced by an AST scan that ignores docstrings/comments
(the compass + trainer_db docstrings legitimately say the WORD "reset", which a
naive grep would false-flag). Also confirms the Layer-2 call path reaches
``alpha_budget.test`` VM-side (a safe reachability probe: flag is OFF -> dormant,
and a throwaway db_path is passed so the real budget ledger is never touched).

Dependency-free: ``python3 tests/test_trainer_budget_adapter.py``. pytest-compatible.
The live reachability test is skipped (not failed) if the VM pipe is unavailable.
"""
import ast
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

import trainer_budget_adapter as adapter  # noqa: E402

# Every trainer module that must have NO path to alpha_budget.reset.
_TRAINER_MODULES = [
    "trainer_bandit.py",
    "trainer_budget_adapter.py",
    "lib/trainer_db.py",
    "compass_metrics.py",
    "trainer_validation.py",    # R9-B3: CALLS the R3 engine, still zero reset path
    "trainer_hypotheses.py",    # R9-B3: standing hypotheses, no alpha_budget at all
]


# ── the AST reset-deny scanner (structural, ignores docstrings/comments) ──
def _refs_alpha_budget(node):
    """True iff an attribute-access value chain terminates in an ``alpha_budget`` name."""
    while isinstance(node, ast.Attribute):
        node = node.value
    return isinstance(node, ast.Name) and node.id == "alpha_budget"


def find_reset_references(source, filename):
    """Return [(filename, lineno), ...] for REAL references to alpha_budget.reset:
      * ``alpha_budget.reset`` (or ``x.alpha_budget.reset``) attribute access, or
      * ``from ...alpha_budget import ... reset ...`` / ``import ... reset`` from it.
    Docstrings / comments / ordinary string literals are AST-invisible -> ignored.
    """
    tree = ast.parse(source, filename)
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == "reset" and _refs_alpha_budget(node.value):
            hits.append((filename, node.lineno))
        if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[-1] == "alpha_budget":
            for alias in node.names:
                if alias.name == "reset":
                    hits.append((filename, node.lineno))
    return hits


def test_no_reset_reference_across_trainer_modules():
    all_hits = []
    for rel in _TRAINER_MODULES:
        path = os.path.join(_REPO, rel)
        with open(path, "r", encoding="utf-8") as fh:
            all_hits.extend(find_reset_references(fh.read(), rel))
    assert all_hits == [], f"alpha_budget.reset referenced in trainer modules: {all_hits}"
    print(f"  no-reset AST scan: 0 alpha_budget.reset refs across {len(_TRAINER_MODULES)} modules: PASS")


def test_ast_scanner_actually_catches_reset():
    # Guard against a scanner that trivially passes: both real reset forms must be caught.
    poison_attr = (            # attribute access on the imported module
        "from auto_trader.validation import alpha_budget\n"
        "def farm():\n"
        "    alpha_budget.reset()\n"
    )
    assert len(find_reset_references(poison_attr, "poison_attr.py")) == 1
    poison_import = "from auto_trader.validation.alpha_budget import reset\n"  # direct import of reset
    assert len(find_reset_references(poison_import, "poison_import.py")) == 1
    # ...and a docstring/comment mention is NOT flagged (the false-positive we avoid).
    prose = '"""this module never calls alpha_budget.reset()."""\nx = 1  # not reset\n'
    assert find_reset_references(prose, "prose.py") == []
    print("  no-reset AST scanner catches a real reset ref + ignores prose: PASS")


def test_adapter_public_surface_is_test_only():
    # The adapter exposes throttle_test and NOTHING that reaches reset.
    assert hasattr(adapter, "throttle_test")
    assert not hasattr(adapter, "reset")
    assert getattr(adapter, "__all__", None) == ["throttle_test"], adapter.__all__
    # No `reset` symbol anywhere in the module namespace.
    assert "reset" not in vars(adapter), [k for k in vars(adapter) if "reset" in k]
    print("  adapter public surface = throttle_test ONLY (no reset symbol): PASS")


def _vm_reachable():
    try:
        r = subprocess.run(["ssh", adapter._VM_HOST, "true"],
                           capture_output=True, timeout=20, check=False)
        return r.returncode == 0
    except Exception:
        return False


def test_throttle_test_reaches_alpha_budget_test_vm_side():
    if not _vm_reachable():
        print("  throttle_test reachability: SKIP (VM pipe unavailable)")
        return
    # Safe probe: flag is OFF VM-side -> test() is a dormant no-op; the throwaway
    # db_path means the real discovery ledger is never touched either way.
    verdict = adapter.throttle_test(p_value=0.5, db_path="/tmp/trainer_b2_throwaway_budget.db")
    assert isinstance(verdict, dict), verdict
    assert "adapter_error" not in verdict, verdict            # the RPC seam worked
    # The verdict is alpha_budget.test's own shape (Layer 2 reached).
    for key in ("enabled", "discovery", "wealth", "level"):
        assert key in verdict, (key, verdict)
    assert verdict["enabled"] is False, verdict               # dormant (flag off) -> safe
    print("  throttle_test reaches alpha_budget.test VM-side (dormant, no ledger touch): PASS")


_TESTS = [
    test_no_reset_reference_across_trainer_modules,
    test_ast_scanner_actually_catches_reset,
    test_adapter_public_surface_is_test_only,
    test_throttle_test_reaches_alpha_budget_test_vm_side,
]


if __name__ == "__main__":
    print("=== trainer_budget_adapter tests (R9-B2) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
