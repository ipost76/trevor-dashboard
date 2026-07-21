#!/usr/bin/env python3
"""trainer_hypotheses.py — the R9 STANDING-HYPOTHESIS mechanism [R9-B3, gap T6].

Level-dependent hypotheses that RE-EVALUATE every level and ACCUMULATE evidence
ACROSS levels — NOT one-shot. "Does autocorrelation help the compass at this level?"
is asked FRESH at each level (it may be true at one, false at another), and the
for/against evidence builds up in ``standing_hypotheses`` (B0's table) across levels.

═══════════════════════════════════════════════════════════════════════════════
 THE ACCUMULATION ENGINE = the (hypothesis_id, level_id) COMPOSITE PK (B0)
═══════════════════════════════════════════════════════════════════════════════
    standing_hypotheses(hypothesis_id, level_id, domain, claim,
                        evidence_json, n_obs, status, last_updated)
    PRIMARY KEY (hypothesis_id, level_id)

Each LEVEL gets its OWN row. The semantics (Ghost-locked):
  * RE-EVALUATE EACH LEVEL → at level N, ``evaluate_at_level`` UPSERTs the
    ``(hyp_id, N)`` row: INSERT on the first eval at N, UPDATE only that row on a
    within-level re-eval (n_obs grows within the level). It NEVER touches a
    prior level's row.
  * ACCUMULATE ACROSS LEVELS → ``(hyp_id, N-1)``, ``(hyp_id, N-2)`` … are
    inviolable. ``hypothesis_status`` reads ALL level rows (WHERE hyp_id spanning
    every level_id) and rolls up levels_tested + net_evidence + a for/against
    tally — the accumulated verdict, NEVER just the latest level.
  * ADDITIVE-ONLY → INSERT / targeted-UPSERT only. NO DELETE / DROP / overwrite of
    a prior level's evidence anywhere in this module. That is the "not one-shot"
    requirement made structural.

Evidence per level (``evidence_json``): {"delta": signed effect, "direction":
"for"|"against"|"neutral", "n_obs": int, "detail": {...}}. A POSITIVE delta = the
claim held at that level (evidence FOR); negative = AGAINST; ~0 = neutral. The
seed evaluator for the compass-domain hypotheses is a with-vs-without blend-score
delta (``compass_blend_delta``).

money_path=no. MAX(level) stays 0. Python 3, stdlib sqlite3 only (via B0).
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, NamedTuple, Optional

from lib.trainer_db import get_connection, utc_now

# A delta smaller than this in magnitude reads as "neutral" (no evidence either way).
NEUTRAL_EPS = 1e-9
# Below this many levels tested, the accumulated verdict stays "open" (never call a
# standing hypothesis on a single level — it is level-dependent BY DESIGN).
MIN_LEVELS_FOR_VERDICT = 2


class StandingHypothesis(NamedTuple):
    """A level-dependent claim the trainer re-asks every level."""
    hypothesis_id: str
    domain: str
    claim: str


# ── the SEED standing hypotheses (§D.7 / roadmap): the starting open set ──
SEED_HYPOTHESES: Dict[str, StandingHypothesis] = {
    h.hypothesis_id: h for h in (
        StandingHypothesis(
            "autocorr_helps", "signal",
            "autocorrelation improves the compass at this level"),
        StandingHypothesis(
            "aggression_sizing_helps", "sizing",
            "aggression-scaled sizing improves the compass at this level"),
    )
}


def open_hypotheses() -> List[StandingHypothesis]:
    """The set of standing hypotheses the trainer re-evaluates at EACH level.

    Seeded with the §D.7 pair (autocorrelation, aggression-sizing). These "exist"
    as a registry independent of any level row and are testable via
    ``evaluate_at_level`` — the level rows accrue only as evidence is recorded.
    """
    return list(SEED_HYPOTHESES.values())


def _direction(delta: float) -> str:
    if delta > NEUTRAL_EPS:
        return "for"
    if delta < -NEUTRAL_EPS:
        return "against"
    return "neutral"


def _resolve_meta(hypothesis_id: str, domain: Optional[str],
                  claim: Optional[str]) -> tuple[str, str]:
    """domain/claim from the seed registry unless explicitly overridden (a
    non-seed ad-hoc hypothesis MUST pass its own domain + claim)."""
    seed = SEED_HYPOTHESES.get(hypothesis_id)
    d = domain if domain is not None else (seed.domain if seed else None)
    c = claim if claim is not None else (seed.claim if seed else None)
    if d is None or c is None:
        raise ValueError(
            f"hypothesis '{hypothesis_id}' is not a seed; pass domain + claim.")
    return d, c


def record_level_evidence(
    hypothesis_id: str,
    level_id: int,
    *,
    evidence: Dict[str, Any],
    n_obs: int,
    domain: Optional[str] = None,
    claim: Optional[str] = None,
    status: str = "open",
    conn: Any = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """The additive UPSERT primitive — append/update ONE (hyp_id, level_id) row.

    INSERT on the first evidence at ``level_id``; UPDATE only that row on a
    within-level re-eval (evidence_json + n_obs + status + last_updated). Prior
    levels' rows are NEVER touched. NO DELETE anywhere. Returns the stored row.
    """
    d, c = _resolve_meta(hypothesis_id, domain, claim)
    own = conn is None
    if own:
        conn = get_connection(db_path)
    try:
        with conn:  # commit on success, rollback on error
            conn.execute(
                "INSERT INTO standing_hypotheses "
                "(hypothesis_id, level_id, domain, claim, evidence_json, n_obs, "
                " status, last_updated) VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(hypothesis_id, level_id) DO UPDATE SET "
                "  evidence_json=excluded.evidence_json, n_obs=excluded.n_obs, "
                "  status=excluded.status, last_updated=excluded.last_updated, "
                "  domain=excluded.domain, claim=excluded.claim",
                (hypothesis_id, int(level_id), d, c, json.dumps(evidence),
                 int(n_obs), status, utc_now()),
            )
        row = conn.execute(
            "SELECT hypothesis_id, level_id, domain, claim, evidence_json, n_obs, "
            "status, last_updated FROM standing_hypotheses "
            "WHERE hypothesis_id=? AND level_id=?", (hypothesis_id, int(level_id)),
        ).fetchone()
    finally:
        if own:
            conn.close()
    return {
        "hypothesis_id": row[0], "level_id": row[1], "domain": row[2],
        "claim": row[3], "evidence": json.loads(row[4]) if row[4] else {},
        "n_obs": row[5], "status": row[6], "last_updated": row[7],
    }


def evaluate_at_level(
    hypothesis_id: str,
    level_id: int,
    *,
    delta: float,
    n_obs: int,
    detail: Optional[Dict[str, Any]] = None,
    domain: Optional[str] = None,
    claim: Optional[str] = None,
    conn: Any = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Re-evaluate a standing hypothesis AT one level and record the evidence.

    ``delta`` is the measured signed effect at this level (e.g. the compass
    blend-score with-vs-without the feature — POSITIVE = the claim held here).
    The per-level ``status`` stores this level's OWN direction (for/against/
    neutral); the ACCUMULATED verdict is computed by ``hypothesis_status``. Same
    (hyp_id, level_id) → within-level UPDATE; new level_id → a new row (accrual).
    """
    direction = _direction(float(delta))
    evidence = {"delta": float(delta), "direction": direction, "n_obs": int(n_obs)}
    if detail:
        evidence["detail"] = detail
    return record_level_evidence(
        hypothesis_id, level_id, evidence=evidence, n_obs=int(n_obs),
        domain=domain, claim=claim, status=direction, conn=conn, db_path=db_path)


def compass_blend_delta(with_verdict: Dict[str, Any],
                        without_verdict: Dict[str, Any]) -> float:
    """Signed compass-effect delta for the seed hypotheses: the with-feature blend
    score minus the without-feature blend score (from two B1 evaluate_compass
    verdicts). A rejected-at-the-wall candidate contributes blend_score 0.0
    (``survived=False`` → no consistency/magnitude), so a feature that keeps a
    candidate ALIVE where its absence dies scores a positive delta at that level.
    """
    def _score(v: Dict[str, Any]) -> float:
        if not v or not v.get("survived", False):
            return 0.0
        try:
            return float(v.get("blend_score", 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0
    return _score(with_verdict) - _score(without_verdict)


def hypothesis_status(
    hypothesis_id: str, *, conn: Any = None, db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Accumulated verdict for a standing hypothesis — reads ALL its level rows.

    Rolls up across every level (NEVER just the latest): levels_tested,
    total_n_obs, net_evidence (Σ per-level delta), a for/against/neutral tally,
    and the per-level breakdown. Status: 'supported' iff net>0 AND for>against AND
    levels_tested>=MIN_LEVELS_FOR_VERDICT; 'refuted' iff net<0 AND against>for AND
    same floor; else 'open'. A hypothesis with no level rows → 'open', 0 levels.
    """
    own = conn is None
    if own:
        conn = get_connection(db_path)
    try:
        rows = conn.execute(
            "SELECT level_id, domain, claim, evidence_json, n_obs, status "
            "FROM standing_hypotheses WHERE hypothesis_id=? ORDER BY level_id ASC",
            (hypothesis_id,),
        ).fetchall()
    finally:
        if own:
            conn.close()

    per_level: List[Dict[str, Any]] = []
    net = 0.0
    total_n = 0
    tally = {"for": 0, "against": 0, "neutral": 0}
    domain = claim = None
    for lvl, dom, cl, ejson, n_obs, st in rows:
        domain, claim = dom, cl
        ev = json.loads(ejson) if ejson else {}
        delta = float(ev.get("delta", 0.0) or 0.0)
        direction = ev.get("direction", _direction(delta))
        net += delta
        total_n += int(n_obs or 0)
        if direction in tally:
            tally[direction] += 1
        per_level.append({"level_id": lvl, "delta": delta, "direction": direction,
                          "n_obs": n_obs, "status": st})

    levels_tested = len(rows)
    status = "open"
    if levels_tested >= MIN_LEVELS_FOR_VERDICT:
        if net > NEUTRAL_EPS and tally["for"] > tally["against"]:
            status = "supported"
        elif net < -NEUTRAL_EPS and tally["against"] > tally["for"]:
            status = "refuted"

    return {
        "hypothesis_id": hypothesis_id, "domain": domain, "claim": claim,
        "levels_tested": levels_tested, "total_n_obs": total_n,
        "net_evidence": round(net, 6), "tally": tally, "status": status,
        "per_level": per_level,
    }


__all__ = [
    "StandingHypothesis", "SEED_HYPOTHESES", "open_hypotheses",
    "record_level_evidence", "evaluate_at_level", "compass_blend_delta",
    "hypothesis_status", "NEUTRAL_EPS", "MIN_LEVELS_FOR_VERDICT",
]


if __name__ == "__main__":
    # Guarded smoke — NEVER runs on import. Re-evaluates a seed across two levels
    # against a THROWAWAY db and prints the accumulated status (real db untouched).
    import tempfile
    import os as _os
    _dir = tempfile.mkdtemp()
    _db = _os.path.join(_dir, "trainer.db")
    evaluate_at_level("autocorr_helps", 0, delta=0.12, n_obs=40, db_path=_db)
    evaluate_at_level("autocorr_helps", 1, delta=-0.03, n_obs=55, db_path=_db)
    print(json.dumps(hypothesis_status("autocorr_helps", db_path=_db), indent=2))
    _os.remove(_db)
    _os.rmdir(_dir)
