"""THE cross-box trade key for TREVOR — one authoritative implementation.

🚨 WHY THIS MODULE EXISTS (RM-REPAIR Wave B, [B2], 2026-08-11 — finding B-01)
============================================================================
`auto_trades.id` IS NOT A CROSS-BOX KEY. It is a per-database AUTOINCREMENT.
Two independently-trading instances seeded from the same copy advance their own
counters at their own rate, so box A's id 101824 and box B's id 101824 are
DIFFERENT TRADES. Measured 2026-08-11:

    id 101826  VM = XRP|SHORT|2026-08-11 10:57:52
    id 101826  shadow = FARTCOIN|SHORT|2026-08-11 12:22:31

and at the RM-VERIFY compile both boxes read MAX(id)=101824 / rows=1839 /
open=2 SIMULTANEOUSLY while holding different trades at those ids. Five
independent sameness checks passed on eight different trades. Equality on that
column is manufactured by coincidence: both counters are driven by trade volume
alone (sqlite_sequence == MAX(id) on both boxes, no deletions, no second
inserter), both were seeded at 101816 at t0, and both run the same entry engine
over the same universe on the same ~180 s cadence -- so the gap is a
mean-reverting random walk about zero and equality RECURS. It was observed equal
three times in two days.

The correct discriminator is (ticker, direction, opened_at), partitioned at t0:

  INHERITED  (opened_at <= t0)  came from the SAME COPIED BYTES on both boxes,
                               so they must match EXACTLY. A difference here is
                               a real defect.
  POST-START (opened_at >  t0)  each instance trades its own book. Matched on
                               (ticker, direction) inside a DERIVED window; an
                               unmatched row is UNCOMPARABLE, never DIVERGED.

That design is C5's D2 ruling. This module is that ruling's ONLY implementation.

🚨 THIS FILE IS DEPLOYED TO TWO BOXES AND MUST BE BYTE-IDENTICAL ON BOTH.
    ghostbox : /home/ghost/harness/lib/thc/tradekey.py   (imported by thc.checks.state)
    WSL hub  : ~/projects/trevor-dashboard/deploy/scripts/tradekey.py
               (imported by trevor-tailsync.sh and trevor-restore.sh)

They are two PHYSICAL copies because the harness and the tailsync gate run on
different machines and cannot share a process. A second copy of a value with
nothing enforcing agreement is the U-15 shape this project keeps finding, so
agreement IS enforced: every caller pins this file's sha256 and calls
`assert_pinned()` at load. A drifted copy raises TradeKeyDrift and the caller
FAILS CLOSED -- the tailsync gate refuses to publish, the harness reports
UNCOMPARABLE. Neither may proceed on an unverified key.

To change this file you must update the pin in BOTH callers:
    ghostbox : harness/etc/harness.conf  [shadow_state] tradekey_sha256
    WSL hub  : deploy/scripts/trevor-tailsync.sh and trevor-restore.sh (TK_SHA256)
The mismatch is loud by construction. That is the point.

Stdlib only, and deliberately Python-2/3-agnostic in style: the WSL side runs it
from a bash heredoc under the system python3 with no venv available.
"""

import hashlib
import os
import time

__all__ = ["TradeKeyDrift", "KEY_FIELDS", "trade_key", "row_key", "ts_epoch",
           "partition", "pair", "file_sha256", "assert_pinned"]


class TradeKeyDrift(Exception):
    """The deployed copy of this module does not match the caller's pin.

    🚨 Callers MUST fail closed on this. It means the two boxes are no longer
    using the same key, which is exactly the condition the pin exists to catch.
    """


#: The key's fields, in order. Named so a caller cannot silently key on
#: something else while claiming to use "the trade key".
KEY_FIELDS = ("ticker", "direction", "opened_at")


def trade_key(ticker, direction, opened_at):
    """-> 'ticker|direction|opened_at'.

    🚨 A7 allowlist A11: key on (ticker, direction, opened_at). NEVER on `oid`
    (synthetic oids come from a monotonic counter that resets per process) and
    NEVER on `id` (a per-database AUTOINCREMENT -- see the module docstring).
    """
    return "%s|%s|%s" % (ticker, direction, opened_at)


def row_key(row, colmap=None):
    """-> trade_key for a row dict, optionally through a column map.

    `colmap` maps the logical names in KEY_FIELDS to the live column names the
    schema resolver found, so a renamed column cannot silently key on None.
    """
    if colmap:
        return trade_key(*[row.get(colmap[f]) for f in KEY_FIELDS])
    return trade_key(*[row.get(f) for f in KEY_FIELDS])


def ts_epoch(v):
    """Parse TREVOR's naive-Eastern timestamps to a comparable float.

    🚨 CLOCK TRUTH. `opened_at` / `closed_at` are NAIVE EASTERN; `created_at`,
    `equity_snapshots.ts` and `auto_config.updated_at` are REAL UTC -- a 4-hour
    offset, with 28 tables carrying both. This function is for the NAIVE-EASTERN
    columns only. Both boxes write the same naive-Eastern convention (verified
    live 2026-08-11: VM and shadow both `now_local`=20:53:10 EDT, both writing
    opened_at in ET against a UTC created_at), so parsing both sides identically
    and diffing is valid.

    Returns None if unparseable. An unparseable stamp MUST degrade the caller to
    UNCOMPARABLE -- never to a false match, and never to a silent zero.
    """
    if v is None:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return time.mktime(time.strptime(s.split("+")[0][:26], fmt))
        except (ValueError, OverflowError):
            continue
    return None


def partition(rows, t0, colmap=None):
    """Split rows at t0 into the INHERITED / POST-START classes.

    rows  -- iterable of dicts carrying at least the KEY_FIELDS (or the columns
             `colmap` points at).
    t0    -- shadow start instant as an epoch float, or None.

    -> {"inherited": [...], "post_start": [...], "unparseable": [keys]}
       Each entry is {"key", "ticker", "direction", "opened_at", "epoch", "row"}.

    🚨 t0 is None is NOT an error and NOT a divergence. It means the partition
    CANNOT BE DRAWN, so everything degrades to POST-START -- which every caller
    reports UNCOMPARABLE. It must NEVER silently become "all inherited": that
    would exact-compare independently-opened trades and manufacture exactly the
    terminal false positive the D2 ruling removed.
    """
    inherited, post_start, unparseable = [], [], []
    for r in rows:
        if colmap:
            t, d, o = [r.get(colmap[f]) for f in KEY_FIELDS]
        else:
            t, d, o = [r.get(f) for f in KEY_FIELDS]
        ep = ts_epoch(o)
        k = trade_key(t, d, o)
        if ep is None:
            unparseable.append(k)
            continue
        entry = {"key": k, "ticker": t, "direction": d, "opened_at": o,
                 "epoch": ep, "row": r}
        # t0 unknown => no partition => everything is post-start (UNCOMPARABLE).
        if t0 is not None and ep <= t0:
            inherited.append(entry)
        else:
            post_start.append(entry)
    inherited.sort(key=lambda e: e["key"])
    post_start.sort(key=lambda e: (e["ticker"], e["direction"], e["epoch"]))
    return {"inherited": inherited, "post_start": post_start,
            "unparseable": sorted(unparseable)}


def pair(a_rows, b_rows, window):
    """Match POST-START rows across two instances on (ticker, direction) within
    `window` seconds of each other, nearest-first.

    -> {"matched": [(a, b, delta_s)], "unmatched_a": [...], "unmatched_b": [...]}

    🚨 An UNMATCHED row is UNCOMPARABLE, never DIVERGED. After t0 each instance
    trades its own book; "box A opened a trade box B did not" is the system
    working, not a fault. A tripwire that fires on legitimate difference gets
    muted, and a muted tripwire proves nothing.

    `window` must be a positive number DERIVED from measurement. There is no
    default here on purpose: a caller with no declared window must report
    UNCOMPARABLE rather than have this module invent one.
    """
    if window is None or window <= 0:
        raise ValueError("pair() requires a positive derived window; "
                         "an undeclared window must degrade to UNCOMPARABLE "
                         "in the caller, not be defaulted here")
    remaining = list(b_rows)
    matched, unmatched_a = [], []
    for a in a_rows:
        best, best_d = None, None
        for b in remaining:
            if b["ticker"] != a["ticker"] or b["direction"] != a["direction"]:
                continue
            d = abs(a["epoch"] - b["epoch"])
            if d <= window and (best_d is None or d < best_d):
                best, best_d = b, d
        if best is None:
            unmatched_a.append(a)
        else:
            remaining.remove(best)
            matched.append((a, best, best_d))
    return {"matched": matched, "unmatched_a": unmatched_a,
            "unmatched_b": remaining}


# --------------------------------------------------------------------------
# the pin
# --------------------------------------------------------------------------
def file_sha256(path=None):
    """-> sha256 hex of this module's SOURCE FILE.

    Hashes the .py, not the loaded objects: a stale .pyc or a partially-applied
    edit must both be visible. Reads in binary so a line-ending change (the
    `auto_commit.sh` CRLF class of defect) is caught rather than normalised away.
    """
    p = path or os.path.abspath(__file__.replace(".pyc", ".py"))
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def assert_pinned(pinned, path=None):
    """Raise TradeKeyDrift unless this file's sha256 equals `pinned`.

    🚨 FAIL CLOSED. The caller must treat the exception as "I do not know that
    both boxes are using the same key" and refuse to produce a verdict:
      - trevor-tailsync.sh -> ABORT, keep the current replica, exit non-zero
      - thc.checks.state   -> UNCOMPARABLE, never OK
    An empty or absent pin is a MISSING pin, not a passing one, and is rejected
    here rather than treated as "no pin configured, carry on".
    """
    if not pinned or not str(pinned).strip():
        raise TradeKeyDrift(
            "no tradekey_sha256 pin supplied -- an absent pin is NOT a pass. "
            "The whole point of the pin is that the two deployed copies of "
            "tradekey.py cannot drift silently; running unpinned reintroduces "
            "exactly that.")
    actual = file_sha256(path)
    if actual != str(pinned).strip():
        raise TradeKeyDrift(
            "tradekey.py DRIFT: this copy is sha256 %s but the caller pinned "
            "%s. The two boxes are no longer using the same trade key. This is "
            "NOT corruption and NOT a data defect -- it means one deployed copy "
            "of this file was edited without updating the other side's pin. "
            "Re-deploy the authoritative copy or update BOTH pins."
            % (actual, str(pinned).strip()))
    return actual
