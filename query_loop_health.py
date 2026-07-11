#!/usr/bin/env python3
"""query_loop_health.py — Memory & Intelligence (glance) backend.

Backs GET /api/memory/intel — the single-view "Memory & Intelligence" zone
that replaced the old 4 raw MEMORY sub-tabs (RM-HUB-INTEL B2). Returns a
quick-glance roll-up of the learning loops from the `loop_health` table:
per-loop stage (shadow|probation|live) + verdict (RED|GREEN|YELLOW) + a
one-line derived summary, plus stage/verdict rollups and the C1b
readiness card.

GLANCE-ONLY. `evidence_json` is parsed HERE (Python-side) into a small set
of summary fields + a derived one-liner — the raw blob is NEVER emitted to
the client. Deep Gate-2 statistics live on the Health page; shadow-table
inventory lives on Intel/Shadows; this is the at-a-glance "is the brain
learning / what's unlocked / what's ready" view.

READ-ONLY (`mode=ro`). Never writes the DB, never imports `hyperliquid`.
Mirrors query_shadow_registry.py (replica open pattern + main() shape).
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Optional

DB = "/home/trevor/trevor/trevor.db"  # symlink → /home/ghost/trevor-replica/trevor.db on WSL

# Ordering for the glance list: live loops first, then probation, then shadow.
_STAGE_ORDER = {"live": 0, "probation": 1, "shadow": 2}


def _replica_age() -> tuple[Optional[int], Optional[str]]:
    """Best-effort mtime/age of the replica file (freshness badge)."""
    try:
        mtime = os.path.getmtime(f"/home/ghost/trevor-replica/trevor.db")
        dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
        age = int((datetime.now(tz=timezone.utc) - dt).total_seconds())
        return max(0, age), dt.isoformat().replace("+00:00", "Z")
    except Exception:
        return None, None


def _load_json(raw: Optional[str]) -> dict[str, Any]:
    """Parse evidence_json defensively — never let a bad blob crash the sweep."""
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        return val if isinstance(val, dict) else {}
    except Exception:
        return {}


def _round(v: Any, n: int = 2) -> Any:
    try:
        return round(float(v), n)
    except Exception:
        return v


def _summarize(verdict: str, reason: str, streak: Any,
               ev: dict[str, Any]) -> str:
    """Derive a single-line glance summary from evidence_json — no raw blob."""
    # Calibrator (cache-freshness loop).
    if "cache_present" in ev or "age_hours" in ev:
        age_h = ev.get("age_hours")
        fresh = "fresh" if ev.get("cache_present") else "MISSING"
        if age_h is not None:
            return f"cache {fresh} · age {_round(age_h, 1)}h"
        return f"cache {fresh}"

    # C1b feature-fix accrual loop.
    if "n_obs" in ev and "criteria" in ev:
        n_obs = ev.get("n_obs")
        bar = ev.get("bar") or {}
        min_obs = bar.get("min_obs")
        span = ev.get("span_days")
        min_span = bar.get("min_span_days")
        crit = ev.get("criteria") or {}
        met = sum(1 for x in crit.values() if x is True)
        tot = len(crit) if crit else 0
        parts = []
        if n_obs is not None and min_obs is not None:
            parts.append(f"{n_obs}/{min_obs} obs")
        if span is not None and min_span is not None:
            parts.append(f"span {_round(span, 2)}/{min_span}d")
        if tot:
            parts.append(f"{met}/{tot} criteria")
        return "accruing · " + " · ".join(parts) if parts else "accruing"

    # B1/B2 Gate-2 consult loops.
    if "gate2_verdict" in ev:
        g = ev.get("gate2_verdict")
        req = ev.get("required_streak")
        ps = ev.get("pass_streak", streak)
        tail = f" · streak {ps}/{req}" if req is not None else ""
        return f"Gate-2 {g}{tail}"

    # Fallback: first clause of the stored verdict_reason.
    if reason:
        return reason.split(" — ")[0].split(";")[0].strip()[:80]
    return verdict


def _c1b_card(ev: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Dedicated readiness card for the C1b accrual loop (dual-axis gate)."""
    if "n_obs" not in ev or "criteria" not in ev:
        return None
    bar = ev.get("bar") or {}
    crit = ev.get("criteria") or {}
    n_obs = ev.get("n_obs")
    min_obs = bar.get("min_obs")
    span = ev.get("span_days")
    min_span = bar.get("min_span_days")
    met = sum(1 for x in crit.values() if x is True)
    tot = len(crit) if crit else 0
    return {
        "present": True,
        "n_obs": n_obs,
        "n_bar": min_obs,
        "count_met": bool(n_obs is not None and min_obs is not None and n_obs >= min_obs),
        "span_days": _round(span, 2),
        "span_bar": min_span,
        "time_met": bool(span is not None and min_span is not None and span >= min_span),
        "criteria": crit,          # small bool dict — safe to render as check rows
        "criteria_met": met,
        "criteria_total": tot,
        "ready_for_review": bool(tot and met == tot),
        "note": ev.get("note"),
    }


def main() -> int:
    age, mtime = _replica_age()
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        print(json.dumps({
            "loops": [], "stage_counts": {}, "verdict_counts": {},
            "total": 0, "c1b": None,
            "replica_age_seconds": age, "replica_mtime": mtime,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    try:
        rows = conn.execute(
            "SELECT loop_name, stage, verdict, verdict_reason, pass_streak, "
            "evidence_json, updated_at FROM loop_health"
        ).fetchall()
    except Exception as exc:
        conn.close()
        print(json.dumps({
            "loops": [], "stage_counts": {}, "verdict_counts": {},
            "total": 0, "c1b": None,
            "replica_age_seconds": age, "replica_mtime": mtime,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0
    conn.close()

    loops: list[dict[str, Any]] = []
    stage_counts: dict[str, int] = {}
    verdict_counts: dict[str, int] = {}
    c1b: Optional[dict[str, Any]] = None

    for r in rows:
        stage = (r["stage"] or "shadow").lower()
        verdict = (r["verdict"] or "RED").upper()
        reason = r["verdict_reason"] or ""
        streak = r["pass_streak"]
        ev = _load_json(r["evidence_json"])

        loops.append({
            "loop_name": r["loop_name"],
            "stage": stage,
            "verdict": verdict,
            "verdict_reason": reason[:160],   # short — not the full blob
            "pass_streak": streak,
            "summary": _summarize(verdict, reason, streak, ev),
            "updated_at": r["updated_at"],
        })
        stage_counts[stage] = stage_counts.get(stage, 0) + 1
        verdict_counts[verdict] = verdict_counts.get(verdict, 0) + 1

        if c1b is None:
            maybe = _c1b_card(ev)
            if maybe is not None:
                maybe["loop_name"] = r["loop_name"]
                maybe["verdict"] = verdict
                c1b = maybe

    loops.sort(key=lambda x: (_STAGE_ORDER.get(x["stage"], 9), x["loop_name"]))

    print(json.dumps({
        "loops": loops,
        "stage_counts": stage_counts,
        "verdict_counts": verdict_counts,
        "total": len(loops),
        "c1b": c1b,
        "replica_age_seconds": age,
        "replica_mtime": mtime,
    }, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (mirrors query_shadow_registry.py).
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
