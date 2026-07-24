#!/usr/bin/env python3
"""RF2-B4 compensating control — the gate the AST independence suite CANNOT be.

🚨 WHY THIS EXISTS (do NOT delete as "redundant with test_watcher_independence.py"):
``tests/test_watcher_independence.py`` is an AST scan of IMPORTS, SYMBOLS, and STRING LITERALS.
It proves the watcher's modules never cross-IMPORT each other's stores. It structurally CANNOT
see a RUNTIME argument-pass. ``watcher_integrity.run_integrity_cycle(conn=<watcher.db handle>)``
makes the integrity module read/write the MAIN store at runtime — a denial-1 crossing — while
the independence suite stays 5/5 GREEN (denial-4's known ``agent=None`` weakness generalized to
denial-1): the orchestrator's source shows a variable named ``watcher_conn``, NOT the symbol
``watcher_integrity_db``; integrity's source shows ``conn = conn or get_connection()`` with no
``watcher_db`` symbol. Neither trips the AST scan. THIS gate is the only thing that catches it.
The two are NOT redundant — one catches exactly what the other cannot.

THE RULE: ``run_integrity_cycle()`` is called with ZERO ARGUMENTS everywhere outside its own
definition (bare → it opens and CLOSES its OWN integrity store; a passed handle it does NOT
close, and uses in place of its own store). This gate parses every repo ``*.py``, finds every
Call to ``run_integrity_cycle`` (bare ``run_integrity_cycle(...)`` OR ``x.run_integrity_cycle(...)``),
and asserts 0 positional args + 0 keywords. The ``def`` is a FunctionDef, not a Call — excluded.

Dependency-free (pytest is NOT in the WSL venv): ``python3 tests/test_integrity_zero_arg_gate.py``.
pytest-compatible.
"""
import ast
import os

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SKIP_DIRS = {"node_modules", ".next", ".git", "venv", ".venv", "__pycache__", "data"}
_TARGET = "run_integrity_cycle"


def _py_files():
    """Every repo *.py, skipping vendored / build / venv trees."""
    out = []
    for root, dirs, files in os.walk(_REPO):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for f in files:
            if f.endswith(".py"):
                out.append(os.path.join(root, f))
    return sorted(out)


def _call_target_name(func):
    """The called name for a Call: bare ``name()`` -> 'name'; ``x.name()`` -> 'name'; else None."""
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def find_call_sites():
    """Return (violations, callsites) — each a list of (relpath, lineno, n_args, n_kwargs).
    A callsite is any Call to run_integrity_cycle; a violation is one with >0 args or kwargs."""
    violations, callsites = [], []
    for path in _py_files():
        rel = os.path.relpath(path, _REPO)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                tree = ast.parse(fh.read(), rel)
        except (SyntaxError, UnicodeDecodeError):
            continue  # unparseable / binary — skip (the repo compiles; not this gate's concern)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _call_target_name(node.func) == _TARGET:
                n_args, n_kw = len(node.args), len(node.keywords)
                callsites.append((rel, node.lineno, n_args, n_kw))
                if n_args or n_kw:
                    violations.append((rel, node.lineno, n_args, n_kw))
    return violations, callsites


def test_run_integrity_cycle_is_only_ever_called_with_zero_args():
    violations, callsites = find_call_sites()
    assert callsites, "no run_integrity_cycle call sites found — the gate would be vacuous"
    assert violations == [], (
        "🚨 run_integrity_cycle called with argument(s) — a passed handle makes the integrity "
        "module write the MAIN store at runtime while the AST suite stays green (a FALSE GREEN): "
        + "; ".join(f"{r}:{ln} ({a} arg(s), {k} kwarg(s))" for r, ln, a, k in violations)
    )
    print(f"  run_integrity_cycle: {len(callsites)} call site(s), ALL zero-arg: PASS")
    for r, ln, a, k in callsites:
        print(f"      {r}:{ln}  ({a} arg(s), {k} kwarg(s))")


_TESTS = [test_run_integrity_cycle_is_only_ever_called_with_zero_args]


if __name__ == "__main__":
    print("=== integrity-cycle zero-arg gate (RF2-B4 compensating control) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
