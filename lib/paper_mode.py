"""The ONE paper/real discriminator for the Hub's read path (B6-LEDGER, 2026-08-09).

🚨 THIS IS A MIRROR, NOT AN ORIGIN. The authority lives on the **VM**:

    /home/trevor/trevor/auto_trader/watchdog.py::_is_paper_position   (the rule)
    /home/trevor/trevor/auto_trader/live_executor.py::_PAPER_SYNTH_OID_FLOOR
                                                                      (the floor)

**WHY A MIRROR AND NOT AN IMPORT.** The VM keeps one boundary and one definition
by IMPORTING the floor rather than copying it. The Hub cannot join that scheme:
this is `ghost@Ghost` (WSL), `/home/trevor/trevor` exists here but carries **no
`auto_trader` package** — `sys.path.insert(0, "/home/trevor/trevor")` followed by
`from auto_trader.watchdog import _is_paper_position` raises `ModuleNotFoundError`
(measured 2026-08-09). So the rule is restated here ONCE, for every Hub consumer,
instead of being re-derived per query script.

🚨 **IF `_PAPER_SYNTH_OID_FLOOR` EVER MOVES ON THE VM, THIS FILE MUST MOVE WITH
IT — nothing will tell you.** Two independently-drifting copies of a boundary is
exactly the failure the VM's own comment warns about; the cross-box gap means the
Hub's copy is the one that can rot silently. Re-verify on any change to either
source symbol above.

THE RULE (verbatim from `_is_paper_position`)
---------------------------------------------
    paper_window truthy                      -> PAPER
    hl_order_id >= _PAPER_SYNTH_OID_FLOOR    -> PAPER
    anything else (NULL / empty / unparseable oid, paper_window falsy)
                                             -> REAL   (fail-safe)

Two eras, and neither column alone is trustworthy — which is the whole reason the
discriminator exists:
  * post-RF15-B2 rows persist `paper_window` truthfully;
  * pre-fix rows took the column DEFAULT 0, and #101733 (the first paper fill) is
    *also* stamped `trade_mode='live'`. Both columns lie for that row. The
    synthetic order id is the only field truthful across BOTH eras.

🚨 **THE ASYMMETRY, RECORDED DELIBERATELY (Ghost, B6-LEDGER).** Failing safe to
"real" is CORRECT for money routing — an unclassifiable row must keep its stop,
its alert and its live route — and it is WRONG for display archaeology on rows
that predate the columns. Measured on the WSL replica 2026-08-09: 53 closed rows
stamped `trade_mode='paper'` carry `paper_window=0` and NO `hl_order_id`, so this
predicate calls all 53 REAL, while a prior recon measured them as genuine
simulated paper. **All 53 are pre-cutover**, so every epoch-floored surface is
unaffected (the epoch-bounded delta is 0 in that direction) — but a WHOLE-TABLE
paper count built on this predicate would report 67 where the column reports 113,
a new wrong number pointing the other way. **Do not build one.** Before any new
consumer counts paper over an unfloored window, resolve the 53 by provenance
rather than by predicate.

`trade_mode` is NOT consulted. It is the column that lies for row #101733, and
switching to `paper_window` alone is the other obvious answer that is also wrong:
it recovers 6 of the 7 mislabelled post-cutover rows and leaves #101733 wrong —
a second wrong answer, harder to see than the first.

Read-only, side-effect free, no imports beyond the stdlib typing shim.
"""
from __future__ import annotations

from typing import Any, Mapping

__all__ = ["PAPER_SYNTH_OID_FLOOR", "is_paper_row", "is_paper_sql"]

# 🚨 THE SINGLE DECLARATION. Mirrors auto_trader/live_executor.py's
# `_PAPER_SYNTH_OID_FLOOR` (VM). Measured separation on the live book: real HL
# oids span 399,624,949,230 -> 498,246,873,125 (~5e11) against this 9e12 floor —
# an ~18x gap, zero overlap. Never write this number anywhere else in the Hub.
PAPER_SYNTH_OID_FLOOR = 9_000_000_000_000


def is_paper_row(row: Mapping[str, Any]) -> bool:
    """True iff this `auto_trades` row is a PAPER-window (simulated) fill.

    Mirrors `auto_trader.watchdog._is_paper_position`. NEVER raises; anything not
    PROVABLY paper returns False, matching the VM helper's fail-safe direction.
    """
    try:
        if row.get("paper_window"):
            return True
    except Exception:
        pass
    try:
        oid = row.get("hl_order_id")
        if oid is None or str(oid).strip() == "":
            return False          # unknown provenance -> treat as real
        return int(str(oid).strip()) >= PAPER_SYNTH_OID_FLOOR
    except Exception:
        return False              # unparseable -> treat as real


def is_paper_sql(prefix: str = "") -> str:
    """The same rule as a SQL boolean fragment, for COUNT/SELECT sites.

    `prefix` is a table alias including its dot (e.g. ``"a."``) — a STATIC
    caller-supplied fragment, never a user value. The floor is interpolated from
    the constant above so the number still exists in exactly one place.

    Equivalence with `is_paper_row`, per branch:
      * `COALESCE(paper_window,0) <> 0` == Python truthiness for the INTEGER
        column this actually is (measured: 1748x 0, 66x 1, all `typeof`
        'integer' — no TEXT '0' row exists to expose the one case where the two
        would disagree);
      * SQLite `CAST` of a NULL/empty/unparseable oid yields NULL or 0, both of
        which fail the `>=` — the same fail-safe-to-real landing as the Python
        `except`.
    """
    return (
        f"(COALESCE({prefix}paper_window, 0) <> 0 "
        f"OR ({prefix}hl_order_id IS NOT NULL "
        f"AND TRIM({prefix}hl_order_id) <> '' "
        f"AND CAST({prefix}hl_order_id AS INTEGER) >= {PAPER_SYNTH_OID_FLOOR}))"
    )
