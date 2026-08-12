#!/usr/bin/env python3
"""The G-5 replica publish gate, re-keyed off `auto_trades.MAX(id)`.

🚨 RM-REPAIR Wave B [B2], 2026-08-11 — finding B-01 / master Group 2.1.
=======================================================================
WHAT WAS WRONG
--------------
The gate that decides whether a freshly-pulled snapshot may be published over
the Hub's read-replica compared `SELECT COALESCE(MAX(id),0) FROM auto_trades` on
the two files and refused when the staged value was lower.

`auto_trades.id` is a per-database AUTOINCREMENT. It is NOT a cross-box key.
Measured 2026-08-11 on the two live ledgers:

    id 101826   VM = XRP|SHORT|2026-08-11 10:57:52
    id 101826   shadow = FARTCOIN|SHORT|2026-08-11 12:22:31

and at the RM-VERIFY compile both boxes simultaneously read MAX(id)=101824,
rows=1839, open=2 while holding DIFFERENT TRADES at those ids. Five independent
sameness checks passed on eight different trades. The equality is manufactured:
both counters were seeded at 101816 at t0, both are driven by trade volume alone
(sqlite_sequence == MAX(id) on both boxes, no deletions, no second inserter), and
both boxes run the same entry engine over the same universe on the same ~180 s
cadence — so the gap random-walks about zero and equality RECURS. It was observed
equal three times in two days.

That gave the old gate two failure modes, and the quiet one is the dangerous one:

  LOUD  : staged < published  -> ABORT, with a message about a "truncated/empty/
          stale" snapshot. At a cutover that message is simply WRONG: nothing is
          truncated, the snapshot merely came from a different ledger. A7 R-24
          records exactly this — "the message reads as corruption".
  QUIET : staged >= published -> PUBLISH, SILENTLY. If the pull source is
          switched to a different box (the Wave D repoint moves SSH_HOST) and
          that box's integer happens to be the larger one, the Hub's replica
          swaps to an entirely different ledger with NO MESSAGE AT ALL.

WHAT REPLACES IT
----------------
C5's D2 key — `ticker|direction|opened_at`, partitioned at the shadow start
instant t0 — which separates all eight of the rows the old key could not. It is
NOT reimplemented here: `tradekey.py` is the harness's own module, deployed
byte-identically and pinned by sha256 (see TradeKeyDrift below).

  INHERITED  (opened_at <= t0)  Pre-fork. Byte-identical on every box by
                               construction. The staged snapshot MUST contain
                               every inherited key the published replica has.
                               A missing one is a REAL regression — the exact
                               thing the gate was always for — and it is caught
                               regardless of which box the snapshot came from.
  POST-START (opened_at >  t0)  Each instance trades its own book. What may be
                               concluded here depends on WHERE the snapshot came
                               from, so the gate establishes that FIRST:

      SAME SOURCE      the newer snapshot of one box must be a superset of the
                       older one. A missing post-start key IS a regression.
                       (Strictly stronger than the MAX(id) check it replaces:
                       MAX(id) cannot see a row deleted below the maximum.)
      SOURCE CHANGED   a different ledger. Post-start differences are EXPECTED
                       and are reported UNCOMPARABLE, never DIVERGED. The
                       publish is refused until the change is ACKNOWLEDGED, so
                       the replica can never swap ledgers silently — but the
                       refusal says "cutover", not "corruption", and clears with
                       a one-line ack rather than blocking forever.
      SOURCE UNKNOWN   no provenance sidecar (the first run after this change).
                       Only the INHERITED assertion is made, and the report says
                       so. The gate never claims more than it checked.

`MAX(id)` is still READ and still LOGGED — as CONTEXT, labelled, and it CANNOT
gate a verdict. The one arm kept as an assertion is `MAX(id) <= 0`, which is a
VALIDITY check (an empty or unreadable auto_trades) and carries no cross-box
meaning at all.

USAGE
-----
  tailsync_gate.py check  --staged PUB --published DST --source "host:path" [--conf F]
  tailsync_gate.py record --published DST --source "host:path" [--conf F]

`check` exits 0 to publish, 1 to abort. `record` writes the provenance sidecar
and is called immediately AFTER a successful publish.
"""

import argparse
import json
import os
import sqlite3
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import tradekey                                             # noqa: E402

SIDECAR = ".replica-source.json"
ACK = ".source-change-ack"
DEFAULT_CONF = os.path.join(_HERE, "tailsync-gate.conf")


# --------------------------------------------------------------------------
# config — read, never guessed
# --------------------------------------------------------------------------
def load_conf(path):
    """-> dict of the gate's declared constants.

    🚨 Nothing here has a default. t0 and the match window are MEASURED values
    with recorded provenance; a gate that invents either would be asserting on a
    boundary nobody derived. Absent -> the caller degrades, it does not guess.
    """
    conf = {}
    if not os.path.exists(path):
        return conf
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            conf[k.strip()] = v.strip()
    return conf


def read_trades(db_path):
    """-> list of {ticker, direction, opened_at} from a replica file, read-only.

    Reads the identity columns only. The gate never reads `id` for comparison —
    see the module docstring — and reads it separately, once, purely as context.
    """
    uri = "file:%s?mode=ro" % db_path
    con = sqlite3.connect(uri, uri=True)
    try:
        cur = con.execute(
            "SELECT ticker, direction, opened_at FROM auto_trades")
        return [{"ticker": r[0], "direction": r[1], "opened_at": r[2]}
                for r in cur.fetchall()]
    finally:
        con.close()


def read_max_id(db_path):
    """-> int MAX(id), or -1 if unreadable.

    🚨 CONTEXT ONLY. This value is per-database and means nothing across boxes.
    It is logged so an operator can still see it and correlate with older
    records; it MUST NOT gate anything except the `<= 0` validity arm.
    """
    try:
        con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
        try:
            v = con.execute(
                "SELECT COALESCE(MAX(id),0) FROM auto_trades").fetchone()[0]
            return int(v or 0)
        finally:
            con.close()
    except Exception:                                        # noqa: BLE001
        return -1


def ledger_fingerprint(db_path, t0):
    """-> the key of the EARLIEST trade opened after t0, or None.

    A second, CONTENT-DERIVED identity for the ledger, immune to configuration
    entirely. Once a box has opened its first post-cutover trade that key never
    changes, and two independently-trading instances open different ones.

    🚨 IT IS SECONDARY, AND HERE IS THE MEASUREMENT THAT SAYS WHY. On the two
    live ledgers it is FARTCOIN|LONG|2026-08-10 23:42:34 (VM) and
    FARTCOIN|LONG|2026-08-10 23:43:32 (shadow) -- the same ticker, the same
    direction, FIFTY-EIGHT SECONDS APART. That is well inside this gate's own
    190s match window, so anything that PAIRED these would read two different
    ledgers as one. It is therefore compared EXACTLY here, never windowed -- and
    even then, had both boxes opened their first post-cutover trade in the same
    second it would be blind. The authoritative discriminator is the runtime box
    identity in `--source`; this exists to catch the case where that is
    unresolvable or stale, not to replace it.
    """
    try:
        con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
        try:
            r = con.execute(
                "SELECT ticker, direction, opened_at FROM auto_trades "
                "WHERE opened_at > ? ORDER BY opened_at ASC, ticker ASC LIMIT 1",
                (time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t0)),)
            ).fetchone()
        finally:
            con.close()
        return tradekey.trade_key(*r) if r else None
    except Exception:                                        # noqa: BLE001
        return None


def sidecar_path(published):
    return os.path.join(os.path.dirname(os.path.abspath(published)), SIDECAR)


def read_sidecar(published):
    p = sidecar_path(published)
    if not os.path.exists(p):
        return None
    try:
        with open(p) as fh:
            return json.load(fh)
    except (ValueError, OSError):
        # 🚨 An unreadable sidecar is UNKNOWN provenance, never "same source".
        return None


def read_ack(published, source):
    """-> True if an operator has acknowledged a switch to `source`.

    The ack must NAME the new source. A bare "yes" file would acknowledge any
    future change too, which is how a deliberate one-time cutover turns into a
    permanently disarmed gate.
    """
    p = os.path.join(os.path.dirname(os.path.abspath(published)), ACK)
    if not os.path.exists(p):
        return False
    try:
        with open(p) as fh:
            return fh.read().strip() == source.strip()
    except OSError:
        return False


# --------------------------------------------------------------------------
# the gate
# --------------------------------------------------------------------------
def check(staged, published, source, conf):
    """-> (ok_to_publish: bool, report: dict)."""
    rep = {"decision": None, "class": None, "why": None, "checks": {},
           "context": {}, "source": {"pulled_from": source}}

    # -- 0. the shared key must match its pin, or nothing below is trustworthy
    try:
        rep["checks"]["tradekey_sha256"] = tradekey.assert_pinned(
            conf.get("tradekey_sha256"))
    except tradekey.TradeKeyDrift as exc:
        rep.update(decision="ABORT", **{"class": "TRADEKEY_DRIFT"})
        rep["why"] = str(exc)
        return False, rep

    # -- MAX(id): context, plus the one validity arm that is not cross-box -----
    stage_max, pub_max = read_max_id(staged), read_max_id(published)
    rep["context"]["auto_trades_max_id"] = {
        "staged": stage_max, "published": pub_max,
        "🚨 NOTE": "CONTEXT ONLY — auto_trades.id is a per-database "
                   "AUTOINCREMENT and is NOT a cross-box key. It does not and "
                   "must not gate this decision. Do not re-promote it to an "
                   "assertion: two boxes read the same integer on different "
                   "trades (measured 2026-08-11, RM-VERIFY B-01)."}
    if stage_max <= 0:
        rep.update(decision="ABORT", **{"class": "STAGED_INVALID"})
        rep["why"] = (
            "the staged snapshot has no readable auto_trades rows "
            "(MAX(id)=%d). This is a VALIDITY check on one file — an empty or "
            "unreadable database — not a cross-box comparison." % stage_max)
        return False, rep

    if not os.path.exists(published):
        rep.update(decision="PUBLISH", **{"class": "FIRST_PUBLISH"})
        rep["why"] = ("no replica is published yet, so there is nothing to "
                      "regress against. Publishing and recording provenance.")
        return True, rep

    # -- 1. WHERE did the currently-published replica come from? --------------
    side = read_sidecar(published)
    declared = (side or {}).get("source")
    rep["source"]["published_was_from"] = declared
    # 🚨 AN UNRESOLVABLE SOURCE IS NOT A MATCHING SOURCE. The caller resolves
    # the identity from the REMOTE BOX at run time; if that lookup failed it
    # passes an UNRESOLVED marker, and the gate must degrade to the
    # inherited-only assertion rather than fall back to a local literal that
    # cannot change (see the SOURCE_ID note in trevor-tailsync.sh).
    if declared is None or str(source).startswith("UNRESOLVED"):
        src_class = "SOURCE_UNKNOWN"
    elif declared == source:
        src_class = "SAME_SOURCE"
    else:
        src_class = "SOURCE_CHANGED"
    rep["source"]["class"] = src_class

    # -- 2. the D2 partition, on both files ----------------------------------
    # 🚨 CLOCK TRUTH (constraint 11). t0 is declared as a NAIVE EASTERN wall-clock
    # string — the same convention `opened_at` uses — and is parsed with the SAME
    # tradekey.ts_epoch as the rows it is compared against. That makes the
    # boundary internally consistent on any box: an absolute epoch constant would
    # be silently 4 hours wrong the day this gate runs somewhere that is not ET,
    # and 4 hours of misclassified trades reads exactly like drift.
    t0 = tradekey.ts_epoch(conf.get("t0_naive_et"))
    if t0 is None:
        rep.update(decision="ABORT", **{"class": "T0_UNDECLARED"})
        rep["why"] = (
            "t0_naive_et is not declared (or not parseable) in the gate "
            "config, so the "
            "INHERITED/POST-START partition cannot be drawn and NO assertion "
            "about this snapshot can be made. This is a configuration gap, not "
            "a data defect: the replica is untouched and still valid.")
        return False, rep

    # -- the SECOND, content-derived identity signal ----------------------
    fp_pub = ledger_fingerprint(published, t0)
    fp_stg = ledger_fingerprint(staged, t0)
    declared_fp = (side or {}).get("ledger_fingerprint")
    rep["source"]["ledger_fingerprint"] = {
        "published_recorded": declared_fp, "published_now": fp_pub,
        "staged": fp_stg,
        "note": "the earliest post-cutover trade -- compared EXACTLY, never "
                "windowed. Secondary to the runtime box identity: the two live "
                "ledgers differ here by only 58 seconds on the same "
                "ticker/direction."}
    pubP = tradekey.partition(read_trades(published), t0)
    stgP = tradekey.partition(read_trades(staged), t0)
    pub_inh = set(e["key"] for e in pubP["inherited"])
    stg_inh = set(e["key"] for e in stgP["inherited"])
    rep["checks"]["t0_iso"] = conf.get("t0_iso")
    rep["checks"]["inherited"] = {"published": len(pub_inh),
                                  "staged": len(stg_inh)}
    rep["checks"]["post_start"] = {"published": len(pubP["post_start"]),
                                   "staged": len(stgP["post_start"])}
    if pubP["unparseable"] or stgP["unparseable"]:
        rep["checks"]["unparseable_opened_at"] = {
            "published": pubP["unparseable"][:6],
            "staged": stgP["unparseable"][:6]}

    # -- 3. INHERITED: source-independent, and a loss here is REAL ------------
    lost_inh = sorted(pub_inh - stg_inh)
    if lost_inh:
        rep.update(decision="ABORT", **{"class": "TRUNCATION"})
        rep["why"] = (
            "%d PRE-CUTOVER trade(s) present in the published replica are "
            "MISSING from the staged snapshot. Inherited trades come from the "
            "same copied bytes on every box, so this is a REAL regression — a "
            "truncated, partial or rolled-back source — and it is NOT a "
            "cutover artifact. Keeping the current replica. Lost keys: %s"
            % (len(lost_inh), ", ".join(lost_inh[:6])
               + (" …" if len(lost_inh) > 6 else "")))
        rep["checks"]["inherited_lost"] = lost_inh[:20]
        return False, rep

    # 🚨 ESCALATION REQUIRES BIDIRECTIONAL DIVERGENCE, AND THAT CONDITION WAS
    # FOUND BY A FAILING TEST, NOT BY REASONING. The first version escalated on a
    # fingerprint difference alone -- which ALSO fires when a same-source snapshot
    # simply LOST its earliest post-cutover trade. That reclassified a genuine
    # TRUNCATION as a source change, i.e. downgraded "your data is missing" to
    # "acknowledge this cutover", which an operator can wave through. Test (f)
    # caught it.
    #
    # The discriminator is direction: a truncation loses rows and invents none
    # (staged is a subset), whereas two independently-trading instances each hold
    # rows the other has never seen. So escalate ONLY when BOTH sides have rows
    # the other lacks -- that is what "a different book" actually looks like.
    ps_pub = set(e["key"] for e in pubP["post_start"])
    ps_stg = set(e["key"] for e in stgP["post_start"])
    bidirectional = bool((ps_pub - ps_stg) and (ps_stg - ps_pub))
    if src_class == "SAME_SOURCE" and bidirectional and fp_pub != fp_stg:
        # The source string claimed one box; the content says two books.
        src_class = "SOURCE_CHANGED"
        rep["source"]["class"] = src_class
        rep["source"]["escalated_by"] = (
            "ledger fingerprint disagreement WITH divergence in both directions "
            "(%d post-cutover trade(s) only on the published replica, %d only on "
            "the staged snapshot). The source identity claimed the same box, but "
            "each side holds trades the other never saw -- that is two books, not "
            "a truncation." % (len(ps_pub - ps_stg), len(ps_stg - ps_pub)))

    # -- 4. POST-START: what may be concluded depends on the source -----------
    lost_ps = sorted(set(e["key"] for e in pubP["post_start"])
                     - set(e["key"] for e in stgP["post_start"]))
    if src_class == "SAME_SOURCE":
        if lost_ps:
            rep.update(decision="ABORT", **{"class": "TRUNCATION"})
            rep["why"] = (
                "%d post-cutover trade(s) present in the published replica are "
                "MISSING from the staged snapshot, and BOTH were pulled from "
                "the SAME source (%s). A newer snapshot of one box must contain "
                "everything an older snapshot of that same box contained, so "
                "this is a REAL regression, not a cutover artifact. Keeping the "
                "current replica. Lost keys: %s"
                % (len(lost_ps), source, ", ".join(lost_ps[:6])
                   + (" …" if len(lost_ps) > 6 else "")))
            rep["checks"]["post_start_lost"] = lost_ps[:20]
            return False, rep
        rep.update(decision="PUBLISH", **{"class": "SAME_SOURCE_MONOTONIC"})
        rep["why"] = ("same source (%s); the staged snapshot contains every "
                      "trade the published replica holds, inherited and "
                      "post-cutover alike." % source)
        return True, rep

    # SOURCE_CHANGED / SOURCE_UNKNOWN: post-start is a different book.
    # Report the D2 pairing so an operator can SEE how much the two ledgers
    # actually share, but never let it gate. An unmatched row is UNCOMPARABLE.
    win = conf.get("open_match_window_seconds")
    try:
        win = float(win) if win not in (None, "") else None
    except (TypeError, ValueError):
        win = None
    if win and win > 0:
        pr = tradekey.pair(pubP["post_start"], stgP["post_start"], win)
        rep["checks"]["post_start_pairing"] = {
            "matched": len(pr["matched"]),
            "only_in_published": len(pr["unmatched_a"]),
            "only_in_staged": len(pr["unmatched_b"]),
            "window_s": win,
            "window_provenance": conf.get("scan_period_provenance",
                                          "provenance not recorded"),
            "verdict": "UNCOMPARABLE — after t0 each instance trades its own "
                       "book, so an unmatched position is the system working, "
                       "not a divergence"}
    else:
        rep["checks"]["post_start_pairing"] = {
            "verdict": "UNCOMPARABLE — no derived match window is declared, so "
                       "no post-cutover pairing was attempted. Not guessed."}

    if src_class == "SOURCE_UNKNOWN":
        rep.update(decision="PUBLISH", **{"class": "SOURCE_UNKNOWN"})
        rep["why"] = (
            "the published replica carries NO provenance record, so this gate "
            "cannot tell whether it came from %s or from another box. The "
            "INHERITED assertion PASSED (%d pre-cutover trades, none lost), "
            "which holds on any source. The post-cutover comparison was NOT "
            "made and nothing is claimed about it. Publishing and recording "
            "provenance so the next run can make the full check."
            % (source, len(pub_inh)))
        return True, rep

    # SOURCE_CHANGED — never silent, never called corruption.
    if read_ack(published, source):
        rep.update(decision="PUBLISH", **{"class": "SOURCE_CHANGE_ACKED"})
        rep["why"] = (
            "🚨 THE REPLICA'S SOURCE IS CHANGING: %s -> %s. This is a CUTOVER, "
            "not corruption — the inherited set is intact (%d pre-cutover "
            "trades, none lost) and the post-cutover difference is two "
            "instances trading their own books. An operator acknowledged this "
            "switch by name in %s, so it is being published."
            % (declared, source, len(pub_inh), ACK))
        return True, rep

    rep.update(decision="ABORT", **{"class": "SOURCE_CHANGE_UNACKED"})
    rep["why"] = (
        "🚨 THE REPLICA'S SOURCE HAS CHANGED and nobody acknowledged it. The "
        "published replica was produced from %s; this snapshot came from %s. "
        "THIS IS NOT CORRUPTION AND NOT A TRUNCATION: the inherited set is "
        "intact (%d pre-cutover trades, none lost, checked by trade identity "
        "and not by id). It is a DIFFERENT LEDGER — `auto_trades.id` is a "
        "per-database autoincrement, so the two boxes reuse each other's "
        "numbers on unrelated trades and publishing across them would silently "
        "swap the Hub onto another instance's book. Keeping the current "
        "replica. If this switch is intended, acknowledge it by name:\n"
        "    echo '%s' > %s"
        % (declared, source, len(pub_inh), source,
           os.path.join(os.path.dirname(os.path.abspath(published)), ACK)))
    return False, rep


def record(published, source, conf=None):
    """Write the provenance sidecar next to the published replica."""
    t0 = tradekey.ts_epoch((conf or {}).get("t0_naive_et"))
    rec = {"ledger_fingerprint": (ledger_fingerprint(published, t0)
                                  if t0 is not None else None),
           "source": source,
           "published_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "auto_trades_max_id_CONTEXT_ONLY": read_max_id(published),
           "note": "🚨 `source` is the identity this gate compares. "
                   "auto_trades MAX(id) is recorded for human correlation only "
                   "— it is a per-database AUTOINCREMENT and is not a "
                   "cross-box key (RM-VERIFY B-01)."}
    p = sidecar_path(published)
    tmp = p + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(rec, fh, indent=1, sort_keys=True)
    os.replace(tmp, p)
    # 🚨 THE ACK IS SINGLE-USE. It authorises ONE transition, and it is
    # consumed the moment that transition is published. A surviving ack would
    # stand as a permanent pre-authorisation for that source string, so the NEXT
    # genuine change onto it would sail through unannounced -- which is the
    # silent-publish hole this gate exists to close, reintroduced by leftover
    # operational state rather than by code.
    ackp = os.path.join(os.path.dirname(os.path.abspath(published)), ACK)
    try:
        if os.path.exists(ackp):
            with open(ackp) as fh:
                if fh.read().strip() == str(source).strip():
                    os.remove(ackp)
                    rec["ack_consumed"] = True
    except OSError:
        pass
    return rec


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mode", choices=("check", "record"))
    ap.add_argument("--staged")
    ap.add_argument("--published", required=True)
    ap.add_argument("--source", required=True,
                    help="identity of the box this snapshot was pulled from, "
                         "e.g. 'vm:100.95.174.30:/home/trevor/trevor/trevor.db'")
    ap.add_argument("--conf", default=DEFAULT_CONF)
    a = ap.parse_args(argv)

    if a.mode == "record":
        print(json.dumps(record(a.published, a.source, load_conf(a.conf)),
                         indent=1, sort_keys=True))
        return 0

    if not a.staged:
        print("check requires --staged", file=sys.stderr)
        return 2
    ok, rep = check(a.staged, a.published, a.source, load_conf(a.conf))
    print(json.dumps(rep, indent=1, sort_keys=True, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
