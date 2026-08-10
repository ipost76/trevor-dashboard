#!/usr/bin/env python3
"""W4b (2026-07-30) — the SIGNAL surface for /api/auto/signals.

Args:
  argv[1] = window hours: int 1..168 (default 24)
  argv[2] = limit:        int 1..500 (default 60)

🚨 WHY THIS EXISTS. During 18 hours of zero entries Ghost had no way to tell
these three states apart, because all three render as an empty screen:

  (a) no signals were produced
  (b) signals were produced and none converted to a trade
  (c) the replica has not caught up yet

That ambiguity IS the defect. This script's whole job is to make the three
distinguishable from the read-only replica alone.

═══════════════════════════════════════════════════════════════════════════
🚨 WHAT THIS CAN AND CANNOT HONESTLY SHOW — read before extending it.
═══════════════════════════════════════════════════════════════════════════

The funnel RP-W1 reconstructed came from JOURNAL SENTINELS ([SCAN-SUMMARY],
[FUNNEL], [SIGNAL-GUARD], [TREND-FLOOR], [P3-SCREEN], [LEVERAGE-DECOUPLE]).
The Hub cannot read journals. What it CAN read, measured on the WSL replica
2026-07-30 over an 18h window:

  ticker scans   3560   scan_cadence_timing_shadow.tickers_scanned   VISIBLE
  candidates      190   scan_cadence_timing_shadow.candidates        VISIBLE
  signals posted   29   scan_cadence_timing_shadow.signals_posted    VISIBLE
                        == COUNT(trade_insights) over the same window
  entry decisions  20   decision_log WHERE decision_type='entry'     PARTIAL
  trades opened     0   auto_trades.signal_id join                   VISIBLE

Two independent tables cross-validate the signal count: over 24h,
SUM(signals_posted)=35 and COUNT(trade_insights)=35 exactly. That agreement is
why the funnel numbers here can be trusted.

🚨 THREE THINGS ARE NOT VISIBLE, AND THE SURFACE MUST NOT IMPLY OTHERWISE:

  1. WHY any individual candidate died between a ticker scan and a posted
     signal. The DB records the COUNTS at each end (3560 -> 190 -> 29) but not
     the per-candidate reason. Every Stage-A kill — SIGNAL-GUARD, TREND-FLOOR,
     P3-SCREEN — happens before any row is written anywhere. Journal only.

  2. WHY roughly a third of posted signals never reach an entry decision. Over
     18h, 29 signals produced only 20 decision_log entry rows. Those 9 have NO
     recorded reason. They are reported as "not converted" with reason None,
     and the caller MUST render that as an honest blank — never a guess.

  3. WHICH GATE inside the entry path rejected, when the reason is
     `entry_failed` (14 of the 20). Its inputs_json carries only
     {stage, confidence, mode, direction} — no gate name. LEVERAGE-DECOUPLE in
     particular is NOT nameable from the DB. `entry_failed` is passed through
     VERBATIM. Do not map it to a friendlier string: that would manufacture a
     precision the data does not have.

⚠️ `decision_log.inputs_json` contains a "mode" key (e.g. "live"). It is the
bot's own configured-mode string and is NOT the paper-window state. It is
deliberately NOT read here — the Hub has exactly one mode authority
(src/lib/trading-mode.ts, W4a) and a second derivation is the defect W4a
closed.

═══════════════════════════════════════════════════════════════════════════
🚨 TWO CLOCKS (CLAUDE.md Law 7) — the recurring 4-hour bug in this codebase.
═══════════════════════════════════════════════════════════════════════════
  REAL UTC:   trade_insights.created_at, decision_log.ts,
              scan_cadence_timing_shadow.ts
  NAIVE EAST: auto_trades.opened_at / closed_at

PROVEN on one event (WSL replica): trade #101743 opened_at '2026-07-29
17:18:27' (ET); its signal trade_insights.id=7495 created_at '2026-07-29
21:17:52' (UTC, 35s earlier); its decision_log ACCEPT ts '2026-07-29 21:18:27'
(UTC = exactly the ET opened_at + 4h).

Every window here is computed in UTC against UTC columns ONLY. `opened_at` is
never compared to a UTC bound. Timestamps are emitted as raw UTC strings and
converted client-side — the Hub never re-localizes an ET column.

🚨 NO MODE FILTER. This script never filters trade_mode. W4a removed exactly
that filter from five readers because it made the paper run invisible; adding
one back here would recreate the defect on a new surface.

READ-ONLY (`file:...?mode=ro`). No writes, no schema change.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from lib.paper_mode import is_paper_row

DB = "/home/trevor/trevor/trevor.db"

# The published-replica age past which this view is materially behind. Matches
# src/lib/replica-age.tsx STALE_S — the two must agree or the card and its age
# line would tell different stories.
REPLICA_STALE_S = 45 * 60

# Measured scanner cadence is ~3 min (356 cycles / 18h on the WSL replica
# 2026-07-30). The gap below is computed AFTER subtracting replica lag, so it
# is a claim about the BOT, not about the Hub's copy. 15 min is 5x cadence —
# comfortably outside normal jitter.
SCANNER_SILENT_S = 15 * 60


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _replica_age_seconds() -> int | None:
    """Age of the published replica (mtime of the file DB resolves to).

    Same idiom as query_auto_state._replica_age and drift-state/route.ts, so
    every surface reports one age for one file. None on failure — the caller
    then renders no freshness claim rather than a fabricated one.
    """
    try:
        st = os.stat(os.path.realpath(DB))
        return max(0, int(datetime.now(timezone.utc).timestamp() - st.st_mtime))
    except Exception:
        return None


def _rows(cur) -> list[dict]:
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def fetch_scanner(conn: sqlite3.Connection, hours: int) -> dict:
    """Scan-cycle rollup — the (a)-vs-(c) discriminator.

    A scan cycle row is written per scanner pass (~3 min). Its presence proves
    the bot was alive and looking; `signals_posted` proves whether it found
    anything. Without this, "no signals" and "scanner dead" and "replica stale"
    are one indistinguishable empty screen.
    """
    row = conn.execute(
        """
        SELECT COUNT(*)                    AS cycles,
               COALESCE(SUM(tickers_scanned), 0) AS ticker_scans,
               COALESCE(SUM(candidates), 0)      AS candidates,
               COALESCE(SUM(signals_posted), 0)  AS signals_posted,
               MAX(ts)                     AS newest_scan_utc
        FROM scan_cadence_timing_shadow
        WHERE ts >= datetime('now', ?)
        """,
        (f"-{hours} hours",),
    ).fetchone()
    cycles, ticker_scans, candidates, posted, newest = row

    scan_age = None
    if newest:
        try:
            age = conn.execute(
                "SELECT CAST((julianday('now') - julianday(?)) * 86400 AS INT)",
                (newest,),
            ).fetchone()[0]
            scan_age = max(0, int(age))
        except Exception:
            scan_age = None

    return {
        "cycles": int(cycles or 0),
        "ticker_scans": int(ticker_scans or 0),
        "candidates": int(candidates or 0),
        "signals_posted": int(posted or 0),
        "newest_scan_utc": newest,
        "scan_age_seconds": scan_age,
    }


def fetch_signals(conn: sqlite3.Connection, hours: int, limit: int) -> list[dict]:
    """Recent posted signals, each carrying its own conversion outcome.

    🚨 THE CONVERSION JOIN IS EXACT, not heuristic. auto_trades.signal_id holds
    the trade_insights.id as TEXT; verified 11/11 with matching tickers across
    the whole paper window on the WSL replica. So "converted" is a fact here,
    not an inference — which is what lets the caller state it plainly.

    The decision half is a LEFT JOIN and is legitimately sparse (~69% of
    signals over 18h). A signal with no decision row yields decision_action
    None: not converted, reason genuinely unrecorded. That NULL is load-bearing
    — the caller must render it as unknown, never fill it in.

    One signal can produce several decision_log rows; the LAST one (highest id)
    is the outcome that stuck.

    B6-LEDGER: the converted row also carries `partial_pnl_realized` — realised
    net for a trade is ALWAYS `pnl_usd + COALESCE(partial_pnl_realized, 0)`, and
    shipping only `pnl_usd` made every scaled-out trade render smaller on its row
    than it contributed to the REALIZED card above it. `is_paper` is derived here
    from `lib.paper_mode` rather than from `trade_mode`, which lies for #101733.
    """
    cur = conn.execute(
        """
        SELECT t.id                AS signal_id,
               t.ticker            AS ticker,
               t.signal_type       AS direction,
               t.confidence        AS confidence,
               t.quality_tier      AS quality_tier,
               t.regime            AS regime,
               t.strategy          AS strategy,
               t.created_at        AS created_at_utc,
               a.id                AS trade_id,
               a.trade_mode        AS trade_mode,
               a.status            AS trade_status,
               a.pnl_usd           AS pnl_usd,
               a.partial_pnl_realized AS partial_pnl_realized,
               a.paper_window      AS paper_window,
               a.hl_order_id       AS hl_order_id,
               a.exit_reason       AS exit_reason,
               a.exit_layer        AS exit_layer,
               d.action            AS decision_action,
               d.reason            AS decision_reason
        FROM trade_insights t
        LEFT JOIN auto_trades a
               ON CAST(a.signal_id AS INTEGER) = t.id
        LEFT JOIN (
               SELECT signal_id, action, reason,
                      ROW_NUMBER() OVER (PARTITION BY signal_id ORDER BY id DESC) AS rn
               FROM decision_log
               WHERE decision_type = 'entry'
        ) d ON d.signal_id = CAST(t.id AS TEXT) AND d.rn = 1
        WHERE t.created_at >= datetime('now', ?)
        ORDER BY t.id DESC
        LIMIT ?
        """,
        (f"-{hours} hours", limit),
    )
    out = []
    for r in _rows(cur):
        conf = r.get("confidence")
        # trade_insights.confidence is 0..1 (measured min 0.0, max 0.912 over
        # 30d); signal_ab_results.production_score is the same value x100
        # (7532 -> 0.6205 and 62.05). Emit the 0-100 form as `score` so the UI
        # never has to know the convention, and keep the raw value alongside.
        # B6-LEDGER: classify PAPER here, from the authority, then drop the two
        # raw columns the rule needs so the wire payload does not grow a second
        # place the rule could be re-derived. `trade_mode` still ships (it is
        # displayed nowhere now, but other consumers read the shape) — it is NOT
        # what the badge branches on any more.
        row = {
            **r,
            "score": round(conf * 100, 2) if isinstance(conf, (int, float)) else None,
            "converted": r.get("trade_id") is not None,
            "is_paper": r.get("trade_id") is not None and is_paper_row(r),
        }
        row.pop("paper_window", None)
        row.pop("hl_order_id", None)
        out.append(row)
    return out


def fetch_reject_reasons(conn: sqlite3.Connection, hours: int) -> list[dict]:
    """Entry-rejection reasons in the window, verbatim and counted.

    Reasons are passed through EXACTLY as the bot wrote them. `entry_failed` is
    a generic bucket whose specific gate is not recorded anywhere in the DB —
    it stays `entry_failed`. Renaming it to something friendlier would invent
    precision that does not exist.
    """
    cur = conn.execute(
        """
        SELECT reason, COUNT(*) AS n
        FROM decision_log
        WHERE decision_type='entry' AND action='REJECT' AND ts >= datetime('now', ?)
        GROUP BY reason
        ORDER BY n DESC
        """,
        (f"-{hours} hours",),
    )
    return [{"reason": r["reason"], "n": int(r["n"])} for r in _rows(cur)]


def derive_state(scanner: dict, signals: list[dict]) -> str:
    """Which of Ghost's three states is this? Computed here so it is testable.

    Returns exactly one of:
      "converting"            signals produced AND at least one became a trade
      "signals_no_trades"     (b) signals produced, none converted
      "no_signals"            (a) the scanner ran and produced nothing
      "scanner_silent"        no scan cycles at all in the window

    🚨 STALENESS IS NOT ONE OF THESE. (c) is reported as a SEPARATE boolean,
    because a stale replica is orthogonal — the view can be both stale AND
    showing signals, and collapsing them into one enum would force a false
    choice. The caller renders staleness as a banner OVER whichever state
    applies, so "the data is old" never has to displace "and here is what it
    said".

    🚨 "scanner_silent" is deliberately NOT called "scanner dead". From the
    replica alone a silent window is indistinguishable from a replica that has
    not received those rows yet. It names the observation, not a diagnosis.
    """
    if scanner["cycles"] == 0:
        return "scanner_silent"
    if not signals:
        return "no_signals"
    return "converting" if any(s["converted"] for s in signals) else "signals_no_trades"


def main() -> int:
    try:
        hours = int(sys.argv[1]) if len(sys.argv) >= 2 else 24
    except ValueError:
        hours = 24
    hours = max(1, min(168, hours))
    try:
        limit = int(sys.argv[2]) if len(sys.argv) >= 3 else 60
    except ValueError:
        limit = 60
    limit = max(1, min(500, limit))

    replica_age = _replica_age_seconds()
    out: dict = {
        "window_hours": hours,
        "replica_age_seconds": replica_age,
        # Fail-safe shape: every consumer can render without a null check, and
        # `state` defaults to the one value that claims nothing.
        "state": "scanner_silent",
        "replica_stale": False,
        "scanner_silent_seconds": None,
        "scanner": {"cycles": 0, "ticker_scans": 0, "candidates": 0,
                    "signals_posted": 0, "newest_scan_utc": None,
                    "scan_age_seconds": None},
        "funnel": {"signals": 0, "with_decision": 0, "rejected": 0,
                   "converted": 0, "unexplained": 0},
        "reject_reasons": [],
        "signals": [],
        "data_available": False,
    }

    if not Path(DB).exists():
        out["error"] = f"DB not found: {DB}"
        sys.stdout.write(json.dumps(out))
        return 1

    try:
        with _connect_ro() as conn:
            conn.row_factory = None
            scanner = fetch_scanner(conn, hours)
            signals = fetch_signals(conn, hours, limit)
            reasons = fetch_reject_reasons(conn, hours)

        with_decision = sum(1 for s in signals if s["decision_action"])
        converted = sum(1 for s in signals if s["converted"])

        out.update({
            "state": derive_state(scanner, signals),
            "replica_stale": replica_age is not None and replica_age > REPLICA_STALE_S,
            # How long the SCANNER was quiet before the snapshot — replica lag
            # subtracted out, so this is a statement about the bot rather than
            # about the Hub's copy. None when either age is unknown: an
            # unknown minus a known is still unknown, and guessing it would
            # turn a fresh replica into a phantom scanner outage.
            "scanner_silent_seconds": (
                max(0, scanner["scan_age_seconds"] - replica_age)
                if scanner["scan_age_seconds"] is not None and replica_age is not None
                else None
            ),
            "scanner": scanner,
            "funnel": {
                "signals": len(signals),
                "with_decision": with_decision,
                "rejected": sum(
                    1 for s in signals if s["decision_action"] == "REJECT"
                ),
                "converted": converted,
                # 🚨 The honesty counter: signals with NO recorded decision.
                # Surfaced as a first-class number so the gap in the data is
                # visible ON the surface instead of being quietly absorbed.
                "unexplained": len(signals) - with_decision,
            },
            "reject_reasons": reasons,
            "signals": signals,
            "data_available": True,
        })
        sys.stdout.write(json.dumps(out, default=str))
        return 0
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        sys.stdout.write(json.dumps(out, default=str))
        return 1


if __name__ == "__main__":
    # OUTER-WRAP (silent-crash visibility), matching the sibling query_*.py.
    import traceback as _tb, sys as _sys
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb.print_exc(file=_sys.stderr)
        _sys.exit(1)
