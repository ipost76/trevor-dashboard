#!/usr/bin/env python3
"""query_servant_report.py — READ-ONLY rolling-report (.md) source for SERVANT (B5).

Backs /api/servant/report (the "Download report" button). Returns the current
rolling SERVANT report as markdown text for the route to stream as a download.

SOURCE CONTRACT (confirmed with B4):
  B4's `generate_rolling_md` writes its rendered markdown into
  `servant_report_state.state_json`. This helper streams that VERBATIM when present.
  Until B4 writes it, a Hub-side FALLBACK regenerates the same report from the open
  `servant_findings` (handled=0) so the download is never empty/broken.

`state_json` is tolerated in three shapes:
  • a JSON-encoded string        → decoded string is the markdown
  • a JSON object with a md key   → report_md / rolling_md / markdown / md / report
  • raw (non-JSON) markdown text  → used verbatim

Reads the litestream replica READ-ONLY (`mode=ro`). Never writes the DB. Always
emits ONE JSON object to stdout and exits 0 (fail-safe shape), so the route layer
never sees a non-zero exit / unparseable output.

Output: {"markdown": str, "source": "state_json"|"regenerated"|"empty",
         "filename": str, "open_count": int, "error": str|None}
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL

_MD_KEYS = ("report_md", "rolling_md", "markdown", "md", "report")

_FIELDS = [
    "id", "rank_score", "dimension", "title", "description", "evidence_json",
    "realized_dollars", "n_distinct_trades", "confidence", "job",
]


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
    conn.row_factory = sqlite3.Row
    return conn


def _filename(report_ts: Optional[int]) -> str:
    try:
        if isinstance(report_ts, (int, float)):
            day = datetime.fromtimestamp(report_ts, tz=timezone.utc).strftime("%Y-%m-%d")
        else:
            day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        day = "latest"
    return f"servant_report_{day}.md"


def _md_from_state_json(raw) -> Optional[str]:
    """Pull verbatim markdown out of state_json, tolerating the three shapes."""
    if raw is None:
        return None
    s = raw if isinstance(raw, str) else str(raw)
    if not s.strip():
        return None
    try:
        v = json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return s  # raw (non-JSON) markdown text → verbatim
    if isinstance(v, str):
        return v if v.strip() else None
    if isinstance(v, dict):
        for k in _MD_KEYS:
            val = v.get(k)
            if isinstance(val, str) and val.strip():
                return val
    return None  # structured state without a markdown key → regen fallback


def _fmt_usd(v) -> str:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "$0.00"
    return f"-${abs(n):,.2f}" if n < 0 else f"${n:,.2f}"


def _regen_md(conn, window_start: Optional[int]) -> tuple[str, int]:
    """Fallback: regenerate the rolling report from open findings (handled=0)."""
    rows = conn.execute(
        f"SELECT {', '.join(_FIELDS)} FROM servant_findings "
        f"WHERE COALESCE(handled,0)=0 ORDER BY rank_score DESC, created_at DESC"
    ).fetchall()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# TREVOR — SERVANT Edge Report",
        "",
        f"_Generated {now} · Hub-side regeneration (engine state_json not yet written)._",
    ]
    if isinstance(window_start, (int, float)):
        ws = datetime.fromtimestamp(window_start, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        lines.append(f"_Window since {ws}._")
    lines.append("")
    if not rows:
        lines += [
            "No open edges. SERVANT is hunting — new findings land here each hour.",
            "",
        ]
        return "\n".join(lines), 0
    lines.append(f"**{len(rows)} open edge(s)**, ranked best-first.")
    lines.append("")
    for i, r in enumerate(rows, start=1):
        try:
            ev = json.loads(r["evidence_json"]) if r["evidence_json"] else None
        except (json.JSONDecodeError, TypeError):
            ev = None
        src = ev.get("source") if isinstance(ev, dict) else None
        caveat = ev.get("caveat") or ev.get("coverage") if isinstance(ev, dict) else None
        lines.append(
            f"## #{i} — {r['dimension'] or '—'} · {_fmt_usd(r['realized_dollars'])} "
            f"realized over {r['n_distinct_trades'] or 0} trades"
        )
        lines.append(f"**{r['title'] or 'Untitled edge'}** — verdict: {r['confidence'] or 'unrated'}")
        if r["description"]:
            lines.append("")
            lines.append(str(r["description"]))
        meta = []
        if src:
            meta.append(f"source: {src}")
        if r["job"]:
            meta.append(f"job: {r['job']}")
        if meta:
            lines.append("")
            lines.append("_" + " · ".join(meta) + "_")
        if caveat:
            lines.append("")
            lines.append(f"> ⚠ {caveat}")
        lines.append("")
    lines.append("---")
    lines.append("_$ = realized dollars over DISTINCT trades (deduped), not a row-sum, "
                 "not '$ if flipped'._")
    lines.append("")
    return "\n".join(lines), len(rows)


def do_report() -> dict:
    try:
        conn = _connect()
    except Exception as exc:
        return {"markdown": "", "source": "empty", "filename": _filename(None),
                "open_count": 0, "error": f"{type(exc).__name__}: {exc}"}
    try:
        window_start = last_report = state_json = None
        try:
            st = conn.execute(
                "SELECT window_start_at, last_report_at, state_json "
                "FROM servant_report_state ORDER BY id LIMIT 1"
            ).fetchone()
            if st is not None:
                window_start = st["window_start_at"]
                last_report = st["last_report_at"]
                state_json = st["state_json"]
        except Exception:
            pass  # report-state missing → regen path

        md = _md_from_state_json(state_json)
        if md is not None:
            # open_count is informational alongside the verbatim engine .md.
            try:
                oc = conn.execute(
                    "SELECT COUNT(*) FROM servant_findings WHERE COALESCE(handled,0)=0"
                ).fetchone()[0]
            except Exception:
                oc = 0
            return {"markdown": md, "source": "state_json",
                    "filename": _filename(last_report), "open_count": int(oc), "error": None}

        md, oc = _regen_md(conn, window_start)
        return {"markdown": md, "source": "regenerated",
                "filename": _filename(last_report), "open_count": oc, "error": None}
    except Exception as exc:
        return {"markdown": "", "source": "empty", "filename": _filename(None),
                "open_count": 0, "error": f"{type(exc).__name__}: {exc}"}
    finally:
        conn.close()


def main() -> int:
    print(json.dumps(do_report(), default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling helpers)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
