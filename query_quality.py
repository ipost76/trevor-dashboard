#!/usr/bin/env python3
"""
Hub helper for /api/quality — Signal Quality Intelligence reader + writer.

Read modes (mode=ro, safe for cached GET):
  summary    — counts by significance/recommendation, last discovery, top 5 boost/block
  patterns   — full list of patterns (ordered by active DESC, significance, |WR-0.5|)
  pattern <id> — single pattern detail
  ticker <T> — patterns matching ticker
  regime <R> — patterns matching regime
  recent_matches [n=20] — recent signal_pattern_matches joined to quality_patterns
  by_ticker  — aggregate WR by ticker (heatmap data)
  by_regime  — aggregate WR by regime
  by_confidence — aggregate WR by confidence bucket (calibration curve)

Write modes (writable, used by /api/quality/[id] POST):
  approve <id>  — flip pattern.active=1
  reject <id>   — flip pattern.active=0
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone, timedelta

DB_PATH = "/home/trevor/trevor/trevor.db"
DB_RO_URI = f"file:{DB_PATH}?mode=ro"
ET = timezone(timedelta(hours=-4))


def _conn_ro() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_RO_URI, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _conn_rw() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _now_et() -> str:
    return datetime.now(ET).isoformat()


def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


# ============================================================================
# Read commands
# ============================================================================


def cmd_summary() -> None:
    out: dict = {
        "total": 0, "active": 0,
        "by_significance": {}, "by_recommendation": {},
        "last_discovery": None,
        "top_boost": [], "top_block": [],
        "source_counts": {"paper": 0, "backfill": 0, "live": 0, "total": 0},
    }
    try:
        with _conn_ro() as conn:
            out["total"] = conn.execute("SELECT COUNT(*) FROM quality_patterns").fetchone()[0]
            out["active"] = conn.execute("SELECT COUNT(*) FROM quality_patterns WHERE active=1").fetchone()[0]
            for r in conn.execute("SELECT significance, COUNT(*) FROM quality_patterns GROUP BY significance"):
                out["by_significance"][r[0]] = r[1]
            for r in conn.execute("SELECT recommendation, COUNT(*) FROM quality_patterns GROUP BY recommendation"):
                out["by_recommendation"][r[0]] = r[1]
            row = conn.execute("SELECT MAX(discovered_at) FROM quality_patterns").fetchone()
            out["last_discovery"] = row[0] if row else None

            for r in conn.execute(
                "SELECT * FROM quality_patterns WHERE recommendation='BOOST' "
                "ORDER BY significance DESC, win_rate DESC LIMIT 5"
            ):
                out["top_boost"].append(_row_to_dict(r))
            for r in conn.execute(
                "SELECT * FROM quality_patterns WHERE recommendation='BLOCK' "
                "ORDER BY significance DESC, win_rate ASC LIMIT 5"
            ):
                out["top_block"].append(_row_to_dict(r))

            for r in conn.execute(
                "SELECT source, COUNT(*) FROM unified_outcomes WHERE aggressive_mode=0 GROUP BY source"
            ):
                out["source_counts"][r[0]] = r[1]
            out["source_counts"]["total"] = sum(
                out["source_counts"].get(k, 0) for k in ("paper", "backfill", "live")
            )
    except Exception as e:
        out["error"] = str(e)
    print(json.dumps(out, default=str))


def cmd_patterns(active_only: bool = False) -> None:
    out: list = []
    try:
        with _conn_ro() as conn:
            where = "WHERE active=1" if active_only else ""
            for r in conn.execute(
                f"SELECT * FROM quality_patterns {where} "
                f"ORDER BY active DESC, significance DESC, ABS(win_rate - 0.5) DESC LIMIT 200"
            ):
                out.append(_row_to_dict(r))
    except Exception as e:
        out = [{"error": str(e)}]
    print(json.dumps(out, default=str))


def cmd_pattern(pattern_id: int) -> None:
    out: dict = {}
    try:
        with _conn_ro() as conn:
            row = conn.execute(
                "SELECT * FROM quality_patterns WHERE id=?", (pattern_id,)
            ).fetchone()
            if row:
                out = _row_to_dict(row) or {}
            else:
                out = {"error": "not_found"}
    except Exception as e:
        out = {"error": str(e)}
    print(json.dumps(out, default=str))


def cmd_ticker(ticker: str) -> None:
    out: list = []
    try:
        with _conn_ro() as conn:
            for r in conn.execute(
                "SELECT * FROM quality_patterns WHERE pattern_key LIKE ? "
                "ORDER BY active DESC, significance DESC, win_rate DESC",
                (f"{ticker.upper()}%",),
            ):
                out.append(_row_to_dict(r))
    except Exception as e:
        out = [{"error": str(e)}]
    print(json.dumps(out, default=str))


def cmd_regime(regime: str) -> None:
    out: list = []
    try:
        rg = regime.upper()
        with _conn_ro() as conn:
            for r in conn.execute(
                "SELECT * FROM quality_patterns "
                "WHERE pattern_key LIKE ? OR pattern_key LIKE ? "
                "ORDER BY active DESC, significance DESC, win_rate DESC",
                (f"%_{rg}_%", f"{rg}_%"),
            ):
                out.append(_row_to_dict(r))
    except Exception as e:
        out = [{"error": str(e)}]
    print(json.dumps(out, default=str))


def cmd_recent_matches(limit: int = 20) -> None:
    out: list = []
    try:
        with _conn_ro() as conn:
            for r in conn.execute(
                """
                SELECT spm.id, spm.signal_id, spm.pattern_id, spm.matched_at,
                       spm.pattern_recommendation,
                       qp.pattern_type, qp.pattern_key, qp.win_rate, qp.sample_size,
                       qp.significance
                FROM signal_pattern_matches spm
                LEFT JOIN quality_patterns qp ON spm.pattern_id = qp.id
                ORDER BY spm.id DESC LIMIT ?
                """,
                (limit,),
            ):
                out.append(_row_to_dict(r))
    except Exception as e:
        out = [{"error": str(e)}]
    print(json.dumps(out, default=str))


def cmd_by_ticker() -> None:
    """Heatmap data: WR by ticker x direction."""
    out: list = []
    try:
        with _conn_ro() as conn:
            for r in conn.execute(
                """
                SELECT ticker, direction, COUNT(*) AS n,
                       SUM(was_win) AS wins,
                       AVG(pnl_pct) AS avg_pnl
                FROM unified_outcomes
                WHERE aggressive_mode=0 AND ticker IS NOT NULL AND direction IS NOT NULL
                GROUP BY ticker, direction
                ORDER BY ticker, direction
                """
            ):
                d = _row_to_dict(r)
                if d and d.get("n"):
                    d["win_rate"] = (d["wins"] / d["n"]) if d["n"] else 0.0
                out.append(d)
    except Exception as e:
        out = [{"error": str(e)}]
    print(json.dumps(out, default=str))


def cmd_by_regime() -> None:
    out: list = []
    try:
        with _conn_ro() as conn:
            for r in conn.execute(
                """
                SELECT regime, direction, COUNT(*) AS n,
                       SUM(was_win) AS wins,
                       AVG(pnl_pct) AS avg_pnl
                FROM unified_outcomes
                WHERE aggressive_mode=0 AND regime IS NOT NULL AND direction IS NOT NULL
                GROUP BY regime, direction
                ORDER BY regime, direction
                """
            ):
                d = _row_to_dict(r)
                if d and d.get("n"):
                    d["win_rate"] = (d["wins"] / d["n"]) if d["n"] else 0.0
                out.append(d)
    except Exception as e:
        out = [{"error": str(e)}]
    print(json.dumps(out, default=str))


def cmd_by_confidence() -> None:
    """Calibration curve: actual WR by confidence bucket."""
    out: list = []
    try:
        buckets = [
            ("30-40", 30, 40),
            ("40-50", 40, 50),
            ("50-60", 50, 60),
            ("60-70", 60, 70),
            ("70-80", 70, 80),
            ("80+", 80, 999),
        ]
        with _conn_ro() as conn:
            for label, lo, hi in buckets:
                row = conn.execute(
                    """
                    SELECT COUNT(*) AS n, SUM(was_win) AS wins, AVG(pnl_pct) AS avg_pnl
                    FROM unified_outcomes
                    WHERE aggressive_mode=0 AND confidence IS NOT NULL
                      AND confidence >= ? AND confidence < ?
                    """,
                    (lo, hi),
                ).fetchone()
                n = row[0] if row else 0
                wins = row[1] if row else 0
                wr = (wins / n) if n else 0.0
                avg_pnl = row[2] if row and row[2] is not None else 0.0
                out.append({
                    "bucket": label,
                    "n": n,
                    "wins": wins,
                    "win_rate": wr,
                    "avg_pnl": avg_pnl,
                })
    except Exception as e:
        out = [{"error": str(e)}]
    print(json.dumps(out, default=str))


# ============================================================================
# Write commands
# ============================================================================


def cmd_approve(pattern_id: int) -> None:
    try:
        with _conn_rw() as conn:
            cur = conn.execute(
                "UPDATE quality_patterns SET active=1, approved_at=?, approved_by=? WHERE id=?",
                (_now_et(), "hub", pattern_id),
            )
            conn.commit()
            ok = cur.rowcount > 0
        print(json.dumps({"ok": ok, "id": pattern_id, "action": "approve"}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


def cmd_reject(pattern_id: int) -> None:
    try:
        with _conn_rw() as conn:
            cur = conn.execute(
                "UPDATE quality_patterns SET active=0 WHERE id=?",
                (pattern_id,),
            )
            conn.commit()
            ok = cur.rowcount > 0
        print(json.dumps({"ok": ok, "id": pattern_id, "action": "reject"}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


# ============================================================================
# Main dispatcher
# ============================================================================


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no command"}))
        return 1
    cmd = sys.argv[1].lower()
    args = sys.argv[2:]

    if cmd == "summary":
        cmd_summary()
    elif cmd == "patterns":
        active_only = bool(args and args[0].lower() == "active")
        cmd_patterns(active_only=active_only)
    elif cmd == "pattern":
        if not args:
            print(json.dumps({"error": "missing id"}))
            return 1
        try:
            cmd_pattern(int(args[0]))
        except ValueError:
            print(json.dumps({"error": "invalid id"}))
            return 1
    elif cmd == "ticker":
        if not args:
            print(json.dumps({"error": "missing ticker"}))
            return 1
        cmd_ticker(args[0])
    elif cmd == "regime":
        if not args:
            print(json.dumps({"error": "missing regime"}))
            return 1
        cmd_regime(args[0])
    elif cmd == "recent_matches":
        limit = 20
        if args:
            try:
                limit = int(args[0])
            except ValueError:
                pass
        cmd_recent_matches(limit=limit)
    elif cmd == "by_ticker":
        cmd_by_ticker()
    elif cmd == "by_regime":
        cmd_by_regime()
    elif cmd == "by_confidence":
        cmd_by_confidence()
    elif cmd == "approve":
        if not args:
            print(json.dumps({"ok": False, "error": "missing id"}))
            return 1
        try:
            cmd_approve(int(args[0]))
        except ValueError:
            print(json.dumps({"ok": False, "error": "invalid id"}))
            return 1
    elif cmd == "reject":
        if not args:
            print(json.dumps({"ok": False, "error": "missing id"}))
            return 1
        try:
            cmd_reject(int(args[0]))
        except ValueError:
            print(json.dumps({"ok": False, "error": "invalid id"}))
            return 1
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
