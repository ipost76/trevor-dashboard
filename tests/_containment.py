"""THE SINGLE CONTAINMENT DEFINITION SITE — forces every learning-layer store to scratch.

🚨 READ THIS BEFORE ADDING A TEST THAT TOUCHES A STORE.

There are TWO layers keeping a test off the live ``<repo>/data/*.db``, and they fail
in DIFFERENT directions. Neither is sufficient alone, which is why both exist:

  LAYER 1 — B11's ``_under_test()`` guard, inside ``get_connection()`` in all four
    ``lib/*_db.py`` modules. It REFUSES to resolve the live store when the process
    entry point looks like a test. It is the backstop, and it needs no cooperation
    from the test at all.
    🚨 ITS BLIND SPOT IS THE ENTRY POINT'S NAME. It keys on
    ``basename(sys.argv[0]).startswith("test_")``. A runner named anything else —
    ``run_tests.py``, ``all_tests.py``, ``harness.py`` — makes it return False for
    all four stores and every live path becomes resolvable again. MEASURED at B7:
    a runner named ``run_all_probe.py`` disarmed all four guards at once.
    THIS IS WHY ``scripts/run_tests.sh`` spawns each file as its own
    ``python3 tests/test_X.py`` subprocess instead of importing them into one
    parent process. argv[0] stays the test file; the guard stays armed.

  LAYER 2 — THIS FILE. An explicit ``*_DB_PATH`` redirect to a per-run scratch dir.
    It does not care what the entry point is called, so it survives the runner-name
    hazard that Layer 1 cannot see. It is what makes the belt independent of the
    braces.

🚨 IT FAILS CLOSED, AND THAT IS THE POINT. If any store still resolves to a path
under ``<repo>/data/``, ``activate()`` RAISES ``ContainmentError`` and the test run
dies loudly. There is deliberately NO fallback branch, no "warn and continue", no
env var that re-permits the live store from here. An activation that fails open onto
production is the exact defect class this repo keeps re-finding; a test run that
cannot establish containment must not run at all.

⚠️ Scope, stated so it is not rediscovered: this redirects the four store modules
that read a ``*_DB_PATH`` override. A site that calls ``sqlite3.connect(...)`` with a
literal path is invisible to BOTH layers and must be given a scratch path by hand.

Usage — at MODULE level, before importing anything that touches a store::

    import _containment; _containment.activate()

Module level, not inside a harness/``main()``: a test function added ABOVE the
harness would otherwise run before containment and escape silently. Ordering is not
a safety mechanism.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile

# The four stores, and the env var each module's resolve_db_path() honours.
# Keep in step with lib/*_db.py — one line per store, no cleverness.
_STORES = {
    "TRAINER_DB_PATH": "trainer.db",
    "WATCHER_DB_PATH": "watcher.db",
    "WATCHER_INTEGRITY_DB_PATH": "watcher_integrity.db",
    "MEMORY_DB_PATH": "memory.db",
}

# <repo>/data — the live store directory nothing under tests/ may resolve into.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LIVE_DATA_DIR = os.path.join(_REPO_ROOT, "data")

# House rule: scratch lives under /home, never /tmp (/tmp is noexec on the VM and
# the rule is kept uniform across both boxes).
_SCRATCH_PARENT = "/home/ghost/tmp"

_scratch_dir: str | None = None


class ContainmentError(RuntimeError):
    """Containment could not be established. The run must stop, not continue."""


def _is_live(path: str) -> bool:
    """True when ``path`` lands inside <repo>/data/ — the live store directory."""
    resolved = os.path.abspath(path)
    return (
        resolved == _LIVE_DATA_DIR
        or resolved.startswith(_LIVE_DATA_DIR + os.sep)
    )


def scratch_dir() -> str:
    """The per-run scratch directory. Call activate() first."""
    if _scratch_dir is None:
        raise ContainmentError("containment not activated — call activate() first")
    return _scratch_dir


def activate() -> str:
    """Redirect all four stores to a per-run scratch dir, then PROVE it took.

    Idempotent: a second call returns the same directory rather than minting a new
    one, so a test that imports another test does not silently repoint the stores
    mid-run.

    Raises ContainmentError if any store still resolves under <repo>/data/.
    """
    global _scratch_dir

    if _scratch_dir is None:
        parent = _SCRATCH_PARENT if os.path.isdir(_SCRATCH_PARENT) else None
        _scratch_dir = tempfile.mkdtemp(prefix="b7_contain_", dir=parent)
        atexit.register(shutil.rmtree, _scratch_dir, True)

    for env_var, filename in _STORES.items():
        os.environ[env_var] = os.path.join(_scratch_dir, filename)

    verify()
    return _scratch_dir


def verify() -> None:
    """Assert every store resolves OUTSIDE <repo>/data/. Raises, never warns.

    Asks each store module for its OWN resolved path rather than re-deriving one
    here — a re-implementation can agree with itself while disagreeing with the
    code under test, which would make this check decorative.
    """
    from lib import memory_db, trainer_db, watcher_db, watcher_integrity_db

    modules = {
        "TRAINER_DB_PATH": trainer_db,
        "WATCHER_DB_PATH": watcher_db,
        "WATCHER_INTEGRITY_DB_PATH": watcher_integrity_db,
        "MEMORY_DB_PATH": memory_db,
    }

    breaches = []
    for env_var, module in modules.items():
        resolved = module.resolve_db_path()
        if _is_live(resolved):
            breaches.append(f"  {env_var}: {module.__name__} resolves LIVE -> {resolved}")

    if breaches:
        raise ContainmentError(
            "🚨 CONTAINMENT FAILED — a test would have written a LIVE store.\n"
            + "\n".join(breaches)
            + f"\n\nLive store dir: {_LIVE_DATA_DIR}"
            "\nThe run is being ABORTED rather than allowed to reach production."
            "\nFix the redirect; there is deliberately no way to continue from here."
        )
