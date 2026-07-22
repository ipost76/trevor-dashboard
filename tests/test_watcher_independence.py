#!/usr/bin/env python3
"""Tests for the R10-B0 Watcher independence guarantee (the structural denials).

Ghost's locked decision: the watcher's three modules — the fragile LLM review-brain
(B1), the must-NEVER-drift integrity sub-module (B2), and the error/health/budget
layer (B3) — are structurally isolated, so the fragile modules physically CANNOT
write the reliable integrity store and the watcher can NEVER trade or auto-halt.
This test PROVES three denials via an AST scan that ignores docstrings/comments/
ordinary string literals (so prose mentioning a forbidden name is NOT a false
positive — the whole point of going structural instead of grepping):

  (1) review-brain / error ↛ integrity DB (and the RECIPROCAL, integrity ↛ main DB):
      ZERO cross-import in BOTH directions. The integrity side is the module whose
      basename CONTAINS "integrity" (``lib/watcher_integrity_db.py`` and B2's
      ``watcher_integrity.py``) — the ONE side allowed to reference the integrity
      store; every OTHER watcher module is denied any integrity reference, and the
      integrity side is denied any main-store reference. A B2 module MUST keep
      "integrity" in its name to land under the rule cleanly.

  (2) trainer ↛ critique store: no ``trainer_*.py`` and no ``lib/trainer_db.py``
      references ``watcher_db`` / ``watcher.db`` / ``watcher_integrity_db`` /
      ``watcher_integrity.db`` — via import, name/attribute, OR a raw string path
      (a ``sqlite3.connect("data/watcher.db")``). RUNS NOW against the live trainer
      modules and MUST pass — the trainer must be structurally unable to read the
      watcher's critiques (teaching stays Hub-only, Ghost-gated).

  (3) watcher ↛ auto-halt: no watcher module imports ``auto_trader.*`` or a Hub
      gateway-client, none references ``set_enabled`` / ``killswitch`` / ``force_close``,
      and none touches ``auto_config`` AT ALL (never reads it, never writes it —
      stricter than "no writes").

  (4) trainer ↛ shared-memory WATCHER namespace (R11-C1 critique-leak boundary): the R11
      store (``lib/memory_db.py`` -> ``data/memory.db``) holds BOTH ``trainer_memory`` and
      ``watcher_memory`` in ONE db. A trainer reaching ``watcher_memory`` through that shared
      store would read the watcher's critiques of its own arms — breaking Hub-only,
      Ghost-gated teaching (denial 2 protects ``watcher.db``, NOT the new shared store). So
      no ``trainer_*.py`` / ``lib/trainer_db.py`` references the ``watcher_memory`` table, the
      ``watcher_scope`` accessor, or a raw string path to ``watcher_memory`` — via a
      hypothetical ``watcher_memory`` shim import, a name/attribute, OR a raw SQL string. The
      trainer's OWN namespace (``trainer_scope`` / ``trainer_memory`` via ``lib.memory_db``)
      stays fully allowed — importing ``lib.memory_db`` is NOT forbidden.

String-literal scanning (beyond the pure symbol scan of the R9 reset-deny) is
DELIBERATE: a DB is reached by PATH STRING, not just a symbol, so a symbol-only scan
would miss ``sqlite3.connect("data/watcher.db")``. Docstrings are excluded so a
denial documented in prose can't false-flag; the self-validation proves BOTH
directions (a real string-literal path IS caught, a docstring mention is NOT).

Dependency-free: ``python3 tests/test_watcher_independence.py``. pytest-compatible.
Establishes the scan; B1/B2/B3 land under it automatically (module sets are globbed).
"""
import ast
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── module discovery (globbed, so B1/B2/B3 auto-fall under the scan) ──
def _watcher_modules():
    """Every watcher module present: lib/watcher*.py + repo-root watcher_*.py."""
    paths = sorted(
        glob.glob(os.path.join(_REPO, "lib", "watcher*.py"))
        + glob.glob(os.path.join(_REPO, "watcher_*.py"))
    )
    return [os.path.relpath(p, _REPO) for p in paths]


def _trainer_modules():
    """Every trainer module: repo-root trainer_*.py + lib/trainer_db.py."""
    paths = sorted(glob.glob(os.path.join(_REPO, "trainer_*.py")))
    rel = [os.path.relpath(p, _REPO) for p in paths]
    rel.append(os.path.join("lib", "trainer_db.py"))
    return rel


def _is_integrity_module(rel):
    """The integrity side = the module whose basename contains 'integrity'.

    This is the load-bearing naming convention: the integrity side is the ONLY side
    allowed to touch the integrity store; a B2 module must keep 'integrity' in its
    name to land under the rule.
    """
    return "integrity" in os.path.basename(rel)


# ── the AST scanner (structural: ignores docstrings/comments/prose strings) ──
def _docstring_const_ids(tree):
    """id()s of the module/class/function docstring Constant nodes — excluded from
    the string-literal scan so a denial documented in prose can't false-flag."""
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None) or []
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def scan_source(source, filename, *, forbid_import=None, symbol_names=(), string_subs=()):
    """Return [(filename, lineno, kind, detail), ...] for REAL references:

      * ``forbid_import(mod)`` -> True for a forbidden ``import mod`` / ``from mod import``
        (structural — checks the dotted module name and its components).
      * a bare Name whose id is in ``symbol_names``, or an Attribute whose ``.attr`` is
        in ``symbol_names`` (catches ``x.set_enabled`` / a bare ``watcher_db`` ref).
      * a NON-docstring string literal containing any of ``string_subs`` (catches a
        raw ``sqlite3.connect("data/watcher.db")`` path).

    Docstrings / comments / prose are AST-invisible or explicitly excluded -> ignored.
    """
    tree = ast.parse(source, filename)
    doc_ids = _docstring_const_ids(tree)
    symbol_names = set(symbol_names)
    string_subs = tuple(string_subs)
    hits = []
    for node in ast.walk(tree):
        if forbid_import is not None:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if forbid_import(alias.name):
                        hits.append((filename, node.lineno, "import", alias.name))
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                if forbid_import(mod):
                    hits.append((filename, node.lineno, "from-import", mod))
        if symbol_names:
            if isinstance(node, ast.Name) and node.id in symbol_names:
                hits.append((filename, node.lineno, "name", node.id))
            elif isinstance(node, ast.Attribute) and node.attr in symbol_names:
                hits.append((filename, node.lineno, "attr", node.attr))
        if string_subs and isinstance(node, ast.Constant) and isinstance(node.value, str) \
                and id(node) not in doc_ids:
            for sub in string_subs:
                if sub in node.value:
                    hits.append((filename, node.lineno, "str", f"{sub!r} in {node.value[:40]!r}"))
    return hits


def scan_file(rel, **spec):
    with open(os.path.join(_REPO, rel), "r", encoding="utf-8") as fh:
        return scan_source(fh.read(), rel, **spec)


# Import-forbid predicates (exact dotted-component match — no false collisions
# between watcher_db / watcher_integrity_db / WATCHER_DB_PATH / WATCHER_INTEGRITY_DB_PATH).
def _imports_integrity_db(mod):
    return "watcher_integrity_db" in mod.split(".")


def _imports_main_db(mod):
    return "watcher_db" in mod.split(".")


def _imports_watcher_store(mod):
    comps = mod.split(".")
    return "watcher_db" in comps or "watcher_integrity_db" in comps


def _imports_halt_lever(mod):
    comps = mod.split(".")
    return comps[0] == "auto_trader" or any("gateway" in c for c in comps)


def _imports_watcher_memory_ns(mod):
    """R11-C1 denial 4: a trainer must never IMPORT a module that reaches the shared store's
    WATCHER namespace. Defensive against a hypothetical ``watcher_memory`` shim module. The
    realistic vector (``from lib.memory_db import watcher_scope`` + a use) is caught by the
    ``watcher_scope`` / ``watcher_memory`` symbol_names, NOT here — importing ``lib.memory_db``
    itself is allowed (the trainer needs it for its OWN ``trainer_scope``)."""
    return "watcher_memory" in mod.split(".")


# ── Denial (1): fragile ↛ integrity store, and the RECIPROCAL integrity ↛ main ──
def test_denial_1_zero_cross_import_both_directions():
    watchers = _watcher_modules()
    assert watchers, "no watcher modules discovered — the scan would be vacuous"
    # Anchor: both B0 connection modules must be present (not a silently-empty scan).
    assert "lib/watcher_db.py" in watchers, watchers
    assert "lib/watcher_integrity_db.py" in watchers, watchers

    hits = []
    for rel in watchers:
        if _is_integrity_module(rel):
            # (1b) integrity side must NOT reference the fragile MAIN store.
            hits += scan_file(
                rel,
                forbid_import=_imports_main_db,
                symbol_names={"watcher_db"},
                string_subs={"watcher.db", "watcher_db", "WATCHER_DB_PATH"},
            )
        else:
            # (1a) fragile side (review-brain/error) must NOT reference the INTEGRITY store.
            hits += scan_file(
                rel,
                forbid_import=_imports_integrity_db,
                symbol_names={"watcher_integrity_db"},
                string_subs={"watcher_integrity.db", "watcher_integrity_db", "WATCHER_INTEGRITY_DB_PATH"},
            )
    assert hits == [], f"watcher cross-DB reference(s) — the guarantee is broken: {hits}"
    n_int = sum(_is_integrity_module(r) for r in watchers)
    print(f"  (1) zero cross-import both directions across {len(watchers)} watcher "
          f"module(s) ({n_int} integrity-side): PASS")


# ── Denial (2): trainer ↛ critique store — RUNS NOW against live trainer modules ──
def test_denial_2_trainer_cannot_read_watcher_store():
    trainers = _trainer_modules()
    assert trainers, "no trainer modules discovered — denial (2) would be vacuous"
    hits = []
    for rel in trainers:
        hits += scan_file(
            rel,
            forbid_import=_imports_watcher_store,
            symbol_names={"watcher_db", "watcher_integrity_db"},
            string_subs={"watcher.db", "watcher_integrity.db", "watcher_db", "watcher_integrity_db"},
        )
    assert hits == [], f"trainer references the watcher store — teaching is NOT Hub-only: {hits}"
    print(f"  (2) trainer ↛ watcher store: 0 refs across {len(trainers)} live trainer "
          f"module(s): PASS")


# ── Denial (3): watcher ↛ auto-halt (no lever, no auto_config at all) ──
def test_denial_3_watcher_never_auto_halts():
    watchers = _watcher_modules()
    assert watchers, "no watcher modules discovered — denial (3) would be vacuous"
    hits = []
    for rel in watchers:
        hits += scan_file(
            rel,
            forbid_import=_imports_halt_lever,
            symbol_names={"set_enabled", "killswitch", "force_close"},
            string_subs={"auto_config"},
        )
    assert hits == [], f"watcher reaches an auto-halt lever — it must only observe/report: {hits}"
    print(f"  (3) watcher ↛ auto-halt across {len(watchers)} watcher module(s): PASS")


# ── Denial (4): trainer ↛ shared-memory WATCHER namespace (R11-C1 critique-leak boundary) ──
def test_denial_4_trainer_cannot_reach_watcher_memory_namespace():
    trainers = _trainer_modules()
    assert trainers, "no trainer modules discovered — denial (4) would be vacuous"
    # Anchor: denial 4 must NOT sweep the C1 adoption layer. memory_projection.py legitimately
    # reads lib.trainer_db AND writes memory — it is NOT a trainer_*.py glob member, so it must
    # be ABSENT from the trainer module set (else a valid write path would be falsely denied).
    assert not any(os.path.basename(t) == "memory_projection.py" for t in trainers), (
        f"memory_projection.py was swept into the trainer glob — denial 4 must not scan it: {trainers}")
    hits = []
    for rel in trainers:
        hits += scan_file(
            rel,
            forbid_import=_imports_watcher_memory_ns,
            symbol_names={"watcher_memory", "watcher_scope"},
            string_subs={"watcher_memory"},
        )
    assert hits == [], f"trainer reaches the watcher memory namespace — leak boundary broken: {hits}"
    print(f"  (4) trainer ↛ watcher_memory namespace: 0 refs across {len(trainers)} live trainer "
          f"module(s): PASS")


# ── Self-validation: the scanner MUST catch a real ref AND ignore prose ──
def test_scanner_catches_real_refs_and_ignores_prose():
    # (a) a fragile module importing the integrity store — denial (1a) MUST fire.
    poison_import = (
        "from lib.watcher_integrity_db import get_connection\n"
        "def farm():\n"
        "    return get_connection()\n"
    )
    assert scan_source(poison_import, "poison_import.py",
                       forbid_import=_imports_integrity_db), "import form not caught"

    # (b) a raw string DB path — denial (2)/string-literal MUST fire (the reason we scan
    #     strings, not just symbols: a DB is reached by PATH).
    poison_str = 'import sqlite3\nc = sqlite3.connect("data/watcher.db")\n'
    assert scan_source(poison_str, "poison_str.py",
                       string_subs={"watcher.db"}), "raw string path not caught"

    # (c) a trainer importing the watcher store — denial (2) import form MUST fire.
    poison_trainer = "from lib.watcher_db import get_connection\n"
    assert scan_source(poison_trainer, "poison_trainer.py",
                       forbid_import=_imports_watcher_store), "trainer import not caught"

    # (d) an auto-halt lever — denial (3) MUST fire on both the import and the attr call.
    poison_halt = (
        "import auto_trader.killswitch\n"
        "def go(x):\n"
        "    x.set_enabled(True)\n"
    )
    halt_hits = scan_source(poison_halt, "poison_halt.py",
                            forbid_import=_imports_halt_lever,
                            symbol_names={"set_enabled", "killswitch", "force_close"},
                            string_subs={"auto_config"})
    assert len(halt_hits) >= 2, f"auto-halt import+attr not both caught: {halt_hits}"

    # (f) R11-C1 denial 4 — a trainer USING the watcher scope MUST fire via symbol_names
    #     (the realistic vector); a hypothetical ``watcher_memory`` shim import MUST fire via
    #     forbid_import. Importing lib.memory_db for trainer_scope is deliberately NOT a hit.
    poison_ws_use = (
        "from lib.memory_db import trainer_scope, watcher_scope\n"
        "def farm():\n"
        "    return watcher_scope().count()\n"
    )
    assert scan_source(poison_ws_use, "poison_ws_use.py",
                       symbol_names={"watcher_memory", "watcher_scope"}), "watcher_scope use not caught"
    poison_ws_import = "from lib.watcher_memory import get_connection\n"
    assert scan_source(poison_ws_import, "poison_ws_import.py",
                       forbid_import=_imports_watcher_memory_ns), "watcher_memory shim import not caught"

    # (g) a raw string SELECT against the shared watcher namespace MUST fire (string_subs) —
    #     the reason we scan strings: a table is reached by a PATH/name, not just a symbol.
    poison_ws_sql = (
        'import sqlite3\nc = sqlite3.connect("data/memory.db")\n'
        'c.execute("SELECT * FROM watcher_memory")\n'
    )
    assert scan_source(poison_ws_sql, "poison_ws_sql.py",
                       string_subs={"watcher_memory"}), "raw watcher_memory SELECT not caught"

    # (e) PROSE in a docstring + a comment must NOT fire under ANY denial's spec.
    prose = (
        '"""This module never touches watcher_integrity_db, watcher.db, watcher_db,\n'
        'watcher_memory, watcher_scope, auto_config, killswitch, set_enabled, or\n'
        'auto_trader — all denied by design."""\n'
        "y = 1  # not killswitch, not auto_config, not watcher.db, not watcher_memory\n"
    )
    for spec in (
        dict(forbid_import=_imports_integrity_db, symbol_names={"watcher_integrity_db"},
             string_subs={"watcher_integrity.db", "watcher_integrity_db", "WATCHER_INTEGRITY_DB_PATH"}),
        dict(forbid_import=_imports_watcher_store, symbol_names={"watcher_db", "watcher_integrity_db"},
             string_subs={"watcher.db", "watcher_integrity.db", "watcher_db", "watcher_integrity_db"}),
        dict(forbid_import=_imports_halt_lever, symbol_names={"set_enabled", "killswitch", "force_close"},
             string_subs={"auto_config"}),
        dict(forbid_import=_imports_watcher_memory_ns, symbol_names={"watcher_memory", "watcher_scope"},
             string_subs={"watcher_memory"}),
    ):
        assert scan_source(prose, "prose.py", **spec) == [], f"prose false-flagged under {spec}"
    print("  self-validation: scanner catches real import/string/attr refs (incl. R11-C1 "
          "denial 4) + ignores docstring & comment prose: PASS")


_TESTS = [
    test_denial_1_zero_cross_import_both_directions,
    test_denial_2_trainer_cannot_read_watcher_store,
    test_denial_3_watcher_never_auto_halts,
    test_denial_4_trainer_cannot_reach_watcher_memory_namespace,
    test_scanner_catches_real_refs_and_ignores_prose,
]


if __name__ == "__main__":
    print("=== watcher independence tests (R10-B0) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
