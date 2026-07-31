#!/usr/bin/env python3
"""trainer_reasoning.py — R9-B4 hybrid reasoning + narration + rejection log.

THE math decides; a CHEAP LLM narrates; every rejection is logged so the trainer
never reconsiders a dead-end. This is the "reasons like a quant, pushes back on its
own ideas" layer (§9 depth note), and it ties to R11 memory via ``rejection_log``.

═══════════════════════════════════════════════════════════════════════════════
 THE HYBRID (Ghost's locked design — math decides, LLM narrates)
═══════════════════════════════════════════════════════════════════════════════
The NUMERIC gates make EVERY accept/reject call — B1's compass (evaluate_compass)
and B3's promotion_verdict / alpha_budget throttle (trainer_validation). Those are
deterministic, auditable, free. The LLM NEVER makes the statistical decision.

``narrate_verdict`` takes an ALREADY-DECIDED verdict as an INPUT and returns ONLY
TEXT about it — the human-readable rationale for the Hub/memory ("rejected: Sortino
cleared but CVaR floor failed at 3rd pctile"). The structural no-flip guarantee: the
signature is ``-> str``; the verdict is a parameter; there is NO return path that
changes accept/reject. A CHEAP model writes routine narration (§D.7 delegation).

Why the rejection log matters MORE here: the bandit (B2) is stochastic Thompson — a
non-deterministic search. ``rejection_log`` is the audit trail that makes it
debuggable AND stops the trainer from re-proposing a known dead-end (is_known_dead_end
+ self_pushback, run BEFORE a candidate reaches the loop, save budget + shadow slots).

═══════════════════════════════════════════════════════════════════════════════
 THE HARD BOUNDARIES
═══════════════════════════════════════════════════════════════════════════════
  * The LLM is DOWNSTREAM of every decision. narrate_verdict describes a verdict the
    math already produced; self_pushback's LLM sanity pass is ADVISORY — it can only
    make the pre-loop decision MORE conservative (proceed True->False), it NEVER
    promotes anything the numeric gates rejected (the gates still decide at B1/B3).
  * The $3/day ceiling is a HARD gate: every LLM call is gated by
    trainer_budget.can_afford BEFORE the call and recorded via record_spend AFTER —
    when broke, narration degrades to a deterministic template (no LLM call) but
    STILL logs (never silently skips).
  * Feature flag TRAINER_NARRATION_ENABLED (default OFF): with it off (or no key, or
    the budget spent) the numeric decisions + template rationale work byte-identically
    — the LLM path is inert.

Transport is stdlib ``urllib`` HTTPS POST to the Anthropic Messages API (the trainer's
own key, within the $3/day total) — NO ``anthropic`` SDK (every trainer module is
stdlib-only by discipline). money_path=no. MAX(level) stays 0. Python 3, stdlib only.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from lib.trainer_db import get_connection, utc_now
import trainer_bandit  # B2 — arm_hash / canonicalize_arm (same subset -> same hash)
import trainer_budget  # B4 Phase 1 — the daily API-spend self-gate

# ── flags / config ─────────────────────────────────────────────────────────────
# Feature flag (default OFF): no LLM calls until enabled; template rationale works off.
TRAINER_NARRATION_ENABLED_ENV = "TRAINER_NARRATION_ENABLED"
# The trainer's OWN key, then a fallback. Absent -> narration degrades to template.
TRAINER_ANTHROPIC_KEY_ENV = "TRAINER_ANTHROPIC_API_KEY"
_ANTHROPIC_KEY_FALLBACK_ENV = "ANTHROPIC_API_KEY"

# Cheap-model narrator (§D.7 routine narration). Env-overridable; default Haiku 4.5.
_CHEAP_MODEL = os.environ.get("TRAINER_NARRATION_MODEL", "claude-haiku-4-5")
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
# Haiku 4.5 pricing: $1.00 / 1M input, $5.00 / 1M output (USD per token).
_PRICE_IN_PER_TOK = 1.00 / 1_000_000
_PRICE_OUT_PER_TOK = 5.00 / 1_000_000
# Conservative pre-call estimate for the can_afford gate (one short narration is
# ~$0.0012 worst case; round up so an under-estimate never fools the hard gate).
_NARRATION_EST_COST = 0.002
_NARRATION_MAX_TOKENS = 160
_SANITY_MAX_TOKENS = 120
_NARRATION_TIMEOUT_S = float(os.environ.get("TRAINER_NARRATION_TIMEOUT", "20"))

# Candidate keys that are metadata, NOT arm axes (so a bare-dict candidate that carries
# a verdict/level alongside its axes still hashes on the axes only).
_RESERVED_CANDIDATE_KEYS = frozenset({
    "level_id", "level", "verdict", "compass", "compass_result", "shadow_key",
    "shadow_stats", "throttle", "n_trials", "arm_hash", "masks", "feature_names",
})


def narration_enabled() -> bool:
    """True iff TRAINER_NARRATION_ENABLED is truthy. Off -> LLM path inert (template)."""
    return os.environ.get(TRAINER_NARRATION_ENABLED_ENV, "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _api_key() -> Optional[str]:
    """The trainer's Anthropic key: TRAINER_ANTHROPIC_API_KEY, else ANTHROPIC_API_KEY.
    None when neither is set (live LLM path is then inert -> template)."""
    for env in (TRAINER_ANTHROPIC_KEY_ENV, _ANTHROPIC_KEY_FALLBACK_ENV):
        val = os.environ.get(env)
        if val and val.strip():
            return val.strip()
    return None


# ── candidate/arm extraction (reuse B2's canonical hashing — same subset, same hash) ──
def _arm_axes(candidate: Any) -> Dict[str, Any]:
    """The candidate's arm axes (the subset+values that identify it). Prefers an
    explicit ``axes`` / ``arm`` key; else treats the candidate dict itself as the arm
    minus reserved metadata keys."""
    if isinstance(candidate, dict):
        axes = candidate.get("axes")
        if isinstance(axes, dict):
            return axes
        arm = candidate.get("arm")
        if isinstance(arm, dict):
            return arm
        return {k: v for k, v in candidate.items() if k not in _RESERVED_CANDIDATE_KEYS}
    return {}


def _level_of(candidate: Any) -> int:
    """The candidate's level_id. RF1-B2: NO silent 0 default — an explicit level (incl. 0)
    is honored, but a candidate with NO resolvable level_id/level RAISES rather than
    silently tagging a reasoning entry at level 0 (the BLOCK-2 corruption class)."""
    if isinstance(candidate, dict):
        for key in ("level_id", "level"):
            val = candidate.get(key)
            if val is not None:
                try:
                    return int(val)
                except (TypeError, ValueError):
                    pass
    raise ValueError(
        "candidate has no resolvable level_id/level — refusing to silently tag a "
        "reasoning entry at level 0 (RF1-B2)")


def candidate_arm_hash(candidate: Any) -> str:
    """sha256[:32] of the candidate's canonical arm — B2's arm_hash on its axes, so the
    rejection log keys on the SAME hash the bandit uses (never a divergent reimpl)."""
    return trainer_bandit.arm_hash(_arm_axes(candidate))


def candidate_config_json(candidate: Any) -> str:
    """The canonical arm JSON (B2's canonicalize_arm) — the rejection_log config_json."""
    return trainer_bandit.canonicalize_arm(_arm_axes(candidate))


# ── verdict normalization (handles BOTH B1 compass + B3 validate/promotion shapes) ──
def _promotion_verdict(verdict: Any) -> Dict[str, Any]:
    """Extract the inner promotion_verdict dict from either the B3 validate_candidate
    envelope ({..., "verdict": {promotion_verdict}}) or a bare promotion_verdict
    ({"verdict": "READY", ...})."""
    if not isinstance(verdict, dict):
        return {}
    inner = verdict.get("verdict")
    if isinstance(inner, dict):
        return inner            # B3 envelope
    return verdict              # bare promotion_verdict (verdict is a str / absent)


def _summarize(verdict: Any, compass_result: Any) -> Dict[str, Any]:
    """Normalize a decided verdict (+ optional compass verdict) into the fields the
    template AND the LLM narration both read. Never re-decides — reads what's there."""
    env = verdict if isinstance(verdict, dict) else {}
    pv = _promotion_verdict(verdict)
    comp = compass_result if isinstance(compass_result, dict) else {}

    labels: List[str] = []
    pv_label = pv.get("verdict")
    if isinstance(pv_label, str):
        labels.append(pv_label)                     # READY / PROMISING / NOT_READY / REJECTED_LEAKAGE
    comp_label = comp.get("verdict")
    if isinstance(comp_label, str):
        labels.append(f"compass:{comp_label}")      # rejected / survived_unscorable / scored

    leakage = None
    if env.get("leakage_reject") or pv.get("leakage_reject"):
        leakage = {"layer": env.get("reject_layer") or pv.get("reject_layer"),
                   "reason": env.get("reason") or pv.get("reason")}
        if "REJECTED_LEAKAGE" not in labels:
            labels.append("REJECTED_LEAKAGE")

    # failing gates from every source that carries them (compass: failing_gates; B3: failing).
    failing: List[str] = []
    for src, key in ((pv, "failing"), (pv, "failing_gates"), (comp, "failing_gates")):
        vals = src.get(key)
        if isinstance(vals, (list, tuple)):
            failing.extend(str(g) for g in vals)
    seen: set = set()
    failing = [g for g in failing if not (g in seen or seen.add(g))]  # dedupe, keep order

    metrics: Dict[str, Any] = {}
    raw_metrics = pv.get("metrics")
    m = raw_metrics if isinstance(raw_metrics, dict) else {}
    dsr = m.get("deflated_sharpe")
    p_value = m.get("p_value", m.get("p"))
    pbo = m.get("pbo")
    for k, v in (("dsr", dsr), ("p_value", p_value), ("pbo", pbo),
                 ("confidence", pv.get("confidence"))):
        if v is not None:
            metrics[k] = v
    for k in ("consistency", "magnitude", "blend_score"):
        if comp.get(k) is not None:
            metrics[k] = comp[k]

    throttle = env.get("throttle") if isinstance(env.get("throttle"), dict) else None
    discovery = throttle.get("discovery") if throttle else None

    return {"labels": labels, "failing_gates": failing, "metrics": metrics,
            "leakage": leakage, "dsr": dsr, "p_value": p_value, "discovery": discovery}


# 🚨 F1 — plain English for the two identifier sets that reach the SCREEN.
#
# `rationale_text` is rendered verbatim by the Hub's TRAINER → reasoning sub-tab,
# so every identifier baked in here lands on Ghost's monitoring surface. This is
# the third instance of the same defect found in the Python layer: the leak is
# MINTED here, and a TSX sweep can never see it. Unmapped names degrade to a
# neutral word — never to the raw identifier.
_GATE_LABELS = {
    "dd_ceiling": "the drawdown limit",
    "cvar_floor": "the tail-risk floor",
    "sample_floor_n": "the sample-size floor",
    "n_trials": "the trials budget",
    "leakage_reject": "the data-leakage check",
}
_METRIC_LABELS = {
    "dsr": "deflated Sharpe",
    "p_value": "chance it was luck",
    "pbo": "overfit probability",
    "confidence": "confidence",
    "consistency": "consistency",
    "magnitude": "magnitude",
    "blend_score": "blend score",
}


def _gate_label(name: Any) -> str:
    """Plain English for a gate name, tolerating a "(reason)" suffix."""
    base = str(name).split("(", 1)[0].strip()
    return _GATE_LABELS.get(base, "another check")


def _template_rationale(summary: Dict[str, Any]) -> str:
    """A DETERMINISTIC legible rationale from the decided verdict's failing gates +
    numbers — the no-LLM fallback. Reads the verdict; never re-decides."""
    if summary["leakage"]:
        layer = summary["leakage"].get("layer")
        parts = [f"rejected: leakage gate tripped (layer {layer})"]
        reason = summary["leakage"].get("reason")
        if reason:
            parts.append(str(reason)[:120])
    else:
        label = summary["labels"][0] if summary["labels"] else "no verdict"
        gates = summary["failing_gates"]
        if gates:
            named = []
            for g in gates[:4]:
                lbl = _gate_label(g)
                if lbl not in named:
                    named.append(lbl)
            parts = [f"{label}: failing {', '.join(named)}"]
        else:
            parts = [f"{label}: no failing gates recorded"]
    nums = []
    for k in ("dsr", "p_value", "pbo", "confidence", "consistency", "magnitude", "blend_score"):
        v = summary["metrics"].get(k)
        if v is not None:
            lbl = _METRIC_LABELS.get(k)
            if lbl is None:
                continue
            try:
                nums.append(f"{lbl} {float(v):.4g}")
            except (TypeError, ValueError):
                nums.append(f"{lbl} {v}")
    if nums:
        parts.append("[" + ", ".join(nums[:4]) + "]")
    return " ".join(parts)[:400]


# ── the ONE Anthropic call (stdlib urllib; never raises; returns None on any failure) ──
def _call_anthropic(system: str, user: str, max_tokens: int) -> Optional[Tuple[str, float]]:
    """POST one cheap-model Messages request; return (text, actual_cost_usd) or None on
    ANY failure (no key / network / HTTP / parse / empty). NEVER raises — a broken pipe
    can't crash the search, and the caller degrades to the template. Haiku 4.5 takes no
    thinking/effort config."""
    key = _api_key()
    if not key:
        return None
    body = json.dumps({
        "model": _CHEAP_MODEL,
        "max_tokens": int(max_tokens),
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")
    req = urllib.request.Request(
        _ANTHROPIC_URL, data=body, method="POST",
        headers={"x-api-key": key, "anthropic-version": _ANTHROPIC_VERSION,
                 "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=_NARRATION_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    text = ""
    for block in payload.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            text += block.get("text", "")
    text = text.strip()
    if not text:
        return None
    usage = payload.get("usage") or {}
    cost = (int(usage.get("input_tokens", 0) or 0) * _PRICE_IN_PER_TOK
            + int(usage.get("output_tokens", 0) or 0) * _PRICE_OUT_PER_TOK)
    return text, cost


def narrate_verdict(
    candidate: Any, verdict: Any, compass_result: Any = None, *,
    db_path: Optional[str] = None,
) -> str:
    """Return a human-readable one-line rationale for an ALREADY-DECIDED verdict.

    THE STRUCTURAL NO-FLIP GUARANTEE: this returns ``str`` only. ``verdict`` /
    ``compass_result`` are INPUTS the math already produced; there is no return path
    that changes accept/reject. The LLM (when it runs) writes prose ABOUT the numbers.

    Numeric decision -> deterministic template rationale, UNLESS the narrator is
    enabled AND a key is configured AND the budget can afford it, in which case a
    cheap Haiku call writes the prose. ANY LLM failure (flag off / no key / broke /
    API error) -> the template. Never raises; never returns an empty string.
    """
    summary = _summarize(verdict, compass_result)
    template = _template_rationale(summary)

    # Three gates, all closed -> the template (byte-identical inert behavior):
    if not narration_enabled():
        return template
    if _api_key() is None:
        return template
    if not trainer_budget.can_afford(_NARRATION_EST_COST, db_path=db_path):
        return template  # broke -> template, still legible, NO LLM spend

    system = (
        "You are a quant risk reviewer writing a ONE-LINE rationale for why a "
        "strategy-config candidate was accepted or rejected by a numeric promotion "
        "gate. The MATH already decided — describe its verdict in plain, specific "
        "language a trader can screenshot. Never re-decide, never contradict the "
        "verdict, never invent numbers. One sentence, <=200 chars."
    )
    user = (
        "Numeric verdict (already decided — describe it, do NOT change it):\n"
        + json.dumps({"candidate_config": _arm_axes(candidate),
                      "labels": summary["labels"],
                      "failing_gates": summary["failing_gates"],
                      "metrics": summary["metrics"],
                      "leakage": summary["leakage"]}, default=str)[:1200]
        + "\n\nWrite the one-line rationale."
    )
    result = _call_anthropic(system, user, _NARRATION_MAX_TOKENS)
    if result is None:
        return template  # LLM failed -> template fallback (never crash)
    text, cost = result
    try:
        trainer_budget.record_spend(cost, db_path=db_path)  # record ACTUAL spend
    except Exception:
        pass  # a recording failure must never lose the narration we already have
    return text.strip() or template


def log_rejection(
    candidate: Any, verdict: Any, rationale: Optional[str], *,
    compass_result: Any = None, db_path: Optional[str] = None,
) -> int:
    """Append ONE row to rejection_log (additive) so the dead-end is never
    reconsidered. Records (arm_hash, level_id, config_json, failing_gates_json,
    rationale_text, p_value, dsr, ts). Returns the new row id."""
    summary = _summarize(verdict, compass_result)
    ahash = candidate_arm_hash(candidate)
    level = _level_of(candidate)
    config_json = candidate_config_json(candidate)
    failing_gates_json = json.dumps(summary["failing_gates"])
    p_value = summary.get("p_value")
    dsr = summary.get("dsr")
    ts = utc_now()
    conn = get_connection(db_path)
    try:
        with conn:  # commit on success, rollback on error
            cur = conn.execute(
                "INSERT INTO rejection_log "
                "(arm_hash, level_id, config_json, failing_gates_json, rationale_text, "
                " p_value, dsr, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (ahash, level, config_json, failing_gates_json,
                 str(rationale) if rationale is not None else None,
                 float(p_value) if p_value is not None else None,
                 float(dsr) if dsr is not None else None, ts),
            )
            row_id = cur.lastrowid
    finally:
        conn.close()
    return int(row_id) if row_id is not None else -1


def is_known_dead_end(candidate: Any, *, db_path: Optional[str] = None) -> bool:
    """EXACT arm_hash match at (arm_hash, level_id): has this candidate already been
    rejected? The definitive dead-end test the self-pushback consults so the trainer
    never re-proposes a proven dead-end."""
    ahash = candidate_arm_hash(candidate)
    level = _level_of(candidate)
    conn = get_connection(db_path)
    try:
        row = conn.execute(
            "SELECT 1 FROM rejection_log WHERE arm_hash=? AND level_id=? LIMIT 1",
            (ahash, level),
        ).fetchone()
    finally:
        conn.close()
    return row is not None


def near_variant_of(candidate: Any, *, db_path: Optional[str] = None) -> Optional[str]:
    """OPTIONAL soft near-variant flag: the arm_hash of a previously-rejected arm at
    this level whose axis KEY-SET matches this candidate's (same knobs, different
    values). ADVISORY only — NOT a hard dead-end (is_known_dead_end stays exact).
    Returns None when there's no such variant."""
    axes = _arm_axes(candidate)
    my_keys = frozenset(axes.keys())
    if not my_keys:
        return None
    ahash = candidate_arm_hash(candidate)
    level = _level_of(candidate)
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            "SELECT arm_hash, config_json FROM rejection_log "
            "WHERE level_id=? AND arm_hash != ?",
            (level, ahash),
        ).fetchall()
    finally:
        conn.close()
    for r_hash, r_cfg in rows:
        try:
            r_axes = json.loads(r_cfg) if r_cfg else {}
        except (TypeError, ValueError):
            continue
        if isinstance(r_axes, dict) and frozenset(r_axes.keys()) == my_keys:
            return r_hash
    return None


def _llm_sanity(axes: Dict[str, Any], level: int, *,
                db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """ADVISORY cheap-LLM sanity check run BEFORE evaluation. Returns
    {'sensible': bool, 'note': str} or None on any failure/ambiguity. Records spend.
    NEVER decides accept/reject — the numeric gates do that."""
    system = (
        "You are a quant reviewer sanity-checking a proposed strategy-config candidate "
        "BEFORE it is evaluated, to avoid wasting a shadow slot on a nonsensical one. "
        "Reply with a compact JSON object {\"sensible\": true|false, \"note\": \"...\"}. "
        "'sensible' is false ONLY for a clearly incoherent/degenerate config. You do NOT "
        "judge profitability — the numeric gates do. When unsure, sensible=true."
    )
    user = (f"Candidate axes (level {level}):\n"
            + json.dumps(axes, default=str)[:1000] + "\n\nReturn the JSON verdict.")
    result = _call_anthropic(system, user, _SANITY_MAX_TOKENS)
    if result is None:
        return None
    text, cost = result
    try:
        trainer_budget.record_spend(cost, db_path=db_path)
    except Exception:
        pass
    obj: Any = None
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            try:
                obj = json.loads(match.group(0))
            except (json.JSONDecodeError, ValueError):
                obj = None
    if not isinstance(obj, dict) or not isinstance(obj.get("sensible"), bool):
        return None  # ambiguous advisory -> no tightening (fail toward proceeding)
    return {"sensible": obj["sensible"], "note": str(obj.get("note", ""))[:200]}


def self_pushback(candidate: Any, *, db_path: Optional[str] = None) -> Dict[str, Any]:
    """The "pushes back on its own ideas" pass, run BEFORE the candidate reaches the
    loop (B6) — saving budget + shadow slots. Returns {proceed: bool, reason: str, ...}.

      (a) is_known_dead_end -> proceed=False (never re-propose a proven dead-end).
      (b) deterministic rule check (empty arm -> proceed=False).
      (c) OPTIONAL advisory cheap-LLM sanity pass (flag + key + budget gated) that can
          ONLY tighten to proceed=False — it flags, it NEVER promotes.

    proceed=True means "worth spending a shadow slot to evaluate", NOT an accept — the
    numeric gates (B1/B3) still decide accept/reject afterward. self_pushback NEVER
    promotes anything the math rejected.
    """
    axes = _arm_axes(candidate)
    level = _level_of(candidate)
    ahash = candidate_arm_hash(candidate)

    # (a) exact dead-end -> hard block (don't waste a slot re-proposing it).
    if is_known_dead_end(candidate, db_path=db_path):
        return {"proceed": False, "arm_hash": ahash, "level_id": level,
                "source": "rejection_log",
                "reason": f"known dead-end: arm {ahash} already rejected at level {level}"}

    # (b) sanity rule check.
    if not axes:
        return {"proceed": False, "arm_hash": ahash, "level_id": level,
                "source": "rule", "reason": "empty arm — no axes to vary"}

    nv = near_variant_of(candidate, db_path=db_path)  # soft advisory, not a block
    reason = ("novel candidate — clear to evaluate" if nv is None else
              f"near-variant of rejected arm {nv} (advisory; the math still decides)")
    result = {"proceed": True, "arm_hash": ahash, "level_id": level,
              "near_variant": nv, "source": "rule", "reason": reason}

    # (c) optional advisory LLM sanity pass — can ONLY make it MORE conservative.
    if (narration_enabled() and _api_key() is not None
            and trainer_budget.can_afford(_NARRATION_EST_COST, db_path=db_path)):
        advisory = _llm_sanity(axes, level, db_path=db_path)
        if advisory is not None and advisory.get("sensible") is False:
            return {"proceed": False, "arm_hash": ahash, "level_id": level,
                    "near_variant": nv, "source": "llm",
                    "reason": f"LLM sanity: {advisory.get('note') or 'flagged not sensible'} (advisory)"}
    return result


__all__ = [
    "narrate_verdict", "log_rejection", "is_known_dead_end", "near_variant_of",
    "self_pushback", "narration_enabled", "candidate_arm_hash", "candidate_config_json",
    "TRAINER_NARRATION_ENABLED_ENV", "TRAINER_ANTHROPIC_KEY_ENV",
]


if __name__ == "__main__":
    # Guarded smoke — NEVER runs on import. Uses a THROWAWAY trainer.db; narration is
    # OFF by default so NO LLM call fires. Walks the template + rejection-log + pushback.
    import tempfile

    _tmp = os.path.join(tempfile.mkdtemp(prefix="trainer_reasoning_smoke_"), "throwaway.db")
    get_connection(_tmp).close()

    _cand = {"axes": {"confidence_floor": 55, "trail_r": 0.75}, "level_id": 0}
    _verdict = {"enabled": True, "ok": True, "leakage_reject": False,
                "verdict": {"verdict": "NOT_READY", "failing": ["cvar_floor", "min_n"],
                            "confidence": 0.42, "metrics": {"deflated_sharpe": 0.31, "p_value": 0.18}},
                "throttle": {"discovery": False}, "n_trials": 12}
    _compass = {"survived": True, "verdict": "scored", "failing_gates": [],
                "consistency": 1.1, "magnitude": 0.4, "blend_score": 0.9}

    _rat = narrate_verdict(_cand, _verdict, _compass, db_path=_tmp)
    print(f"narration_enabled(): {narration_enabled()}  (template path)")
    print(f"rationale: {_rat}")
    _rid = log_rejection(_cand, _verdict, _rat, compass_result=_compass, db_path=_tmp)
    print(f"logged rejection row id: {_rid}")
    print(f"is_known_dead_end(same candidate): {is_known_dead_end(_cand, db_path=_tmp)}")
    _novel = {"axes": {"confidence_floor": 60, "trail_r": 0.9}, "level_id": 0}
    print(f"is_known_dead_end(novel): {is_known_dead_end(_novel, db_path=_tmp)}")
    print(f"self_pushback(dead-end): {self_pushback(_cand, db_path=_tmp)}")
    print(f"self_pushback(novel):    {self_pushback(_novel, db_path=_tmp)}")
