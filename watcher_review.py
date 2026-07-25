#!/usr/bin/env python3
"""watcher_review.py — R10 watcher review-brain (the teacher in the society of agents) [R10-B1].

The watcher reviews the trainer's (R9) decisions AFTER the fact and comments ONLY on
problems ("that was rash / logged wrong / done wrong"). Its critiques become training
signal Ghost weighs and applies. This module is the review-brain: a HYBRID of a
deterministic MECHANICAL half (this file's checks — free, auditable, they DECIDE) and a
budget-gated LLM JUDGMENT half (Phase 2 — text only, can never flip a mechanical finding).

═══════════════════════════════════════════════════════════════════════════════
 GHOST'S LOCKED DESIGN (RECON-WATCHER-001)
═══════════════════════════════════════════════════════════════════════════════
  * The mechanical checks are the DECIDING half — they ALONE determine whether a
    critique surfaces (``has_problem`` below). Pure rules can never catch "rashness";
    the LLM (Phase 2) catches JUDGMENT and produces PROSE ONLY — it can neither set
    nor clear a mechanical ``fired`` nor change the surfacing decision.
  * Critique ONLY problems — a clean decision produces NO critique row (Phase 2). A
    watcher that logs every clean decision is noise.
  * The watcher NEVER trades and NEVER auto-halts. It observes and reports; Ghost
    decides. Teaching is Hub-only (Phase 2 writes ``watcher.db``; the trainer is
    STRUCTURALLY denied read access — B0's AST denial (2)).

═══════════════════════════════════════════════════════════════════════════════
 THE PRE-CUTOVER EMPTY-STREAM MANDATE (A1's biggest-risk finding)
═══════════════════════════════════════════════════════════════════════════════
Most review targets are legitimately empty until R13: ``rejection_log`` = 0 rows,
``promotion_candidates`` absent, the search loop unstarted. EVERY check treats
"no such table" / "0 rows" / a missing decision field as the EXPECTED pre-cutover
state — it returns ``not_applicable`` (never ``fired``), never a crash, never an alarm.
A watcher that alarms on the empty stream is exactly the alert-fatigue anti-pattern
it exists to end.

═══════════════════════════════════════════════════════════════════════════════
 INDEPENDENCE (structural, verified by tests/test_watcher_independence.py)
═══════════════════════════════════════════════════════════════════════════════
This module READS the trainer's reviewable surface (the watcher is DESIGNED to read
the trainer): ``lib.trainer_db`` (SELECT-only on ``trainer.db``), ``trainer_bandit``
(the live axis surface — a read of trainer code, never a write), ``trainer_budget``
(the trainer's ceiling). It WRITES only ``watcher.db`` (Phase 2). It references NO
integrity store (denial 1), NO trainer WRITER (no-nudge), and NO auto-halt lever —
no ``auto_trader.*`` / gateway-client import, no ``killswitch`` / ``set_enabled`` /
``force_close``, and it touches ``auto_config`` NOT AT ALL (denial 3).

Python 3, stdlib only (+ the trainer read-surface imports above). Nothing runs on
import. Feature flag ``WATCHER_REVIEW_ENABLED`` (Phase 3) default OFF.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sqlite3
import sys
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

from lib import trainer_db  # READ trainer.db via B0's get_connection (SELECT-only)
from lib import watcher_db  # WRITE the watcher's OWN critique store (Hub-only teaching)
import trainer_bandit       # the live axis surface (read of trainer code, no write)
import trainer_budget       # the trainer's daily ceiling (read of trainer config)
import watcher_budget       # the watcher's OWN $/day self-gate (mirrors trainer_budget)

# ── decision kinds (the three decision boundaries B1 reviews) ───────────────────
VERDICT = "verdict"
PROMOTION = "promotion"
LEVEL_CHANGE = "level_change"

# The 0444 read-only WSL replica of the VM's trevor.db (mode=ro), where the trainer's
# promotion_candidates land. Read-only source ONLY — the watcher never writes it.
_REPLICA_PATH = "/home/ghost/trevor-replica/trevor.db"

# ── severity taxonomy (the watcher_critiques.severity vocabulary) ───────────────
# note    — FYI                     concern — worth a look        problem — a real fault
# B1's mechanical checks are all structural faults -> they emit ``problem`` when fired.
# ``note`` / ``concern`` are reserved for the Phase-2 judgment layer + R11 + future checks.
SEV_NOTE = "note"
SEV_CONCERN = "concern"
SEV_PROBLEM = "problem"
_SEV_ORDER = {None: 0, SEV_NOTE: 1, SEV_CONCERN: 2, SEV_PROBLEM: 3}


# ── finding constructors ────────────────────────────────────────────────────────
def _finding(check: str, *, fired: bool, severity: str, evidence: Dict[str, Any]) -> Dict[str, Any]:
    """An APPLICABLE check result. ``severity`` is carried only when it fired."""
    return {
        "check": check,
        "applicable": True,
        "fired": bool(fired),
        "severity": severity if fired else None,
        "evidence": evidence,
    }


def _not_applicable(check: str, reason: str) -> Dict[str, Any]:
    """The check's source was absent / empty / not present on the decision — the
    EXPECTED pre-cutover state. NEVER ``fired``; NEVER an error. This is the whole
    empty-stream mandate, encoded at the check level."""
    return {
        "check": check,
        "applicable": False,
        "fired": False,
        "severity": None,
        "evidence": {"reason": reason},
    }


def _day_from_ts(ts: Any) -> Optional[str]:
    """Extract the YYYY-MM-DD UTC day prefix from a decision ts (ISO ``…T…Z`` or a
    space-separated stamp). None when absent/unparseable → the caller returns
    not_applicable."""
    if not ts or not isinstance(ts, str):
        return None
    m = re.match(r"^\s*(\d{4}-\d{2}-\d{2})", ts)
    return m.group(1) if m else None


# ═══════════════════════════════════════════════════════════════════════════════
#  THE FIVE MECHANICAL CHECKS (each maps to a live field — A1 §5)
#  Each is a pure function over a fetched ``decision`` dict + live trainer data,
#  returning a structured finding. Each returns not_applicable (never fired) on an
#  absent/empty source. None raises on a missing table.
# ═══════════════════════════════════════════════════════════════════════════════
def check_known_dead_end_repropose(
    decision: Dict[str, Any], *, conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Re-proposed a KNOWN DEAD-END: an EARLIER ``rejection_log`` row exists at the same
    ``(arm_hash, level_id)``. ``is_known_dead_end`` (the self-pushback guard) is an exact
    ``(arm_hash, level_id)`` match, so an earlier duplicate means the guard FAILED —
    a real "done wrong". A VERDICT decision excludes its own row (``id<row_id``); a
    PROMOTION checks for ANY prior rejection at that arm+level.

    not_applicable: the decision carries no ``arm_hash``/``level_id`` (the pre-cutover
    empty shape), or ``rejection_log`` is absent.
    """
    check = "known_dead_end_repropose"
    arm = decision.get("arm_hash")
    level = decision.get("level_id")
    if not arm or level is None:
        return _not_applicable(check, "no arm_hash/level_id on decision")

    if conn is not None:
        c: sqlite3.Connection = conn
        owned = False
    else:
        try:
            c = trainer_db.get_connection(db_path)
        except Exception as exc:  # trainer.db unreadable -> not a fire, surfaced honestly
            return _not_applicable(check, f"trainer.db unreadable: {exc}")
        owned = True
    try:
        try:
            if decision.get("kind") == VERDICT and decision.get("row_id") is not None:
                prior = c.execute(
                    "SELECT id, ts FROM rejection_log "
                    "WHERE arm_hash=? AND level_id=? AND id<? ORDER BY id LIMIT 1",
                    (str(arm), int(level), int(decision["row_id"])),
                ).fetchone()
            else:
                prior = c.execute(
                    "SELECT id, ts FROM rejection_log "
                    "WHERE arm_hash=? AND level_id=? ORDER BY id LIMIT 1",
                    (str(arm), int(level)),
                ).fetchone()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return _not_applicable(check, "rejection_log absent (pre-cutover)")
            raise
    finally:
        if owned and c is not None:
            c.close()

    if prior is None:
        return _finding(check, fired=False, severity=SEV_PROBLEM,
                        evidence={"arm_hash": arm, "level_id": int(level)})
    return _finding(check, fired=True, severity=SEV_PROBLEM, evidence={
        "arm_hash": arm, "level_id": int(level),
        "prior_rejection_id": prior[0], "prior_ts": prior[1],
        "note": "self-pushback (is_known_dead_end) should have blocked re-proposing this proven dead-end",
    })


def check_budget_overrun(
    decision: Dict[str, Any], *, conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Exceeded its budget: the trainer's ``trainer_api_budget`` spend for the decision's
    UTC day exceeded the TRAINER's ceiling (``trainer_budget.daily_budget()`` — $0.25 by
    default). A missing row = spend 0 = clean (not a fire).

    not_applicable: the decision has no parseable ``ts``, or ``trainer_api_budget`` is absent.
    """
    check = "budget_overrun"
    day = _day_from_ts(decision.get("ts"))
    if day is None:
        return _not_applicable(check, "no parseable ts on decision")

    if conn is not None:
        c: sqlite3.Connection = conn
        owned = False
    else:
        try:
            c = trainer_db.get_connection(db_path)
        except Exception as exc:
            return _not_applicable(check, f"trainer.db unreadable: {exc}")
        owned = True
    try:
        try:
            row = c.execute(
                "SELECT spend_usd FROM trainer_api_budget WHERE date=?", (day,)
            ).fetchone()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return _not_applicable(check, "trainer_api_budget absent (pre-cutover)")
            raise
    finally:
        if owned and c is not None:
            c.close()

    spend = float(row[0]) if row and row[0] is not None else 0.0
    try:
        ceiling = float(trainer_budget.daily_budget())
    except Exception:
        # ceiling unresolvable -> cannot assess an overrun; do NOT fabricate a fire.
        return _not_applicable(check, "trainer ceiling unresolvable")
    fired = spend > ceiling
    ev: Dict[str, Any] = {"day": day, "spend_usd": round(spend, 6),
                          "trainer_ceiling_usd": round(ceiling, 6)}
    if fired:
        ev["note"] = "trainer exceeded its OWN daily API-spend ceiling"
    return _finding(check, fired=fired, severity=SEV_PROBLEM, evidence=ev)


def check_skipped_gate(decision: Dict[str, Any]) -> Dict[str, Any]:
    """Skipped a gate. A VERDICT (rejection) MUST cite at least one failing gate
    (``failing_gates_json`` non-empty); a rejection that cites none skipped/lost its gate.
    A PROMOTION MUST have passed the gate (``gate_passed is True``); a surface without a
    passing gate skipped it.

    not_applicable: a VERDICT with no ``failing_gates_json`` field at all, a PROMOTION with
    no ``gate_passed`` field, or a non verdict/promotion kind (pre-cutover shapes).
    """
    check = "skipped_gate"
    kind = decision.get("kind")

    if kind == VERDICT:
        if "failing_gates_json" not in decision or decision.get("failing_gates_json") is None:
            return _not_applicable(check, "no failing_gates_json on verdict")
        cited = _gates_nonempty(decision.get("failing_gates_json"))
        if cited:
            return _finding(check, fired=False, severity=SEV_PROBLEM, evidence={"cited": True})
        return _finding(check, fired=True, severity=SEV_PROBLEM, evidence={
            "failing_gates_json": decision.get("failing_gates_json"),
            "note": "rejection logged with NO failing gate cited — gate skipped or lost",
        })

    if kind == PROMOTION:
        if "gate_passed" not in decision:
            return _not_applicable(check, "no gate_passed on promotion row")
        gp = decision.get("gate_passed")
        if gp is True:
            return _finding(check, fired=False, severity=SEV_PROBLEM, evidence={"gate_passed": True})
        return _finding(check, fired=True, severity=SEV_PROBLEM, evidence={
            "gate_passed": gp,
            "note": "promotion surfaced without a passing gate (gate_passed is not True)",
        })

    return _not_applicable(check, f"skipped_gate not applicable for kind={kind!r}")


def check_inconsistent_log(decision: Dict[str, Any]) -> Dict[str, Any]:
    """Logged an inconsistent row: required fields missing / malformed. A VERDICT row must
    carry a truthy ``arm_hash``, an integer ``level_id``, a valid-JSON ``config_json`` and a
    ``ts`` (the trainer DB enforces NOT NULL, so this is a defensive integrity check). A
    PROMOTION row must carry a ``ref`` (shadow_id) and a ``level_id``.

    not_applicable: an empty decision or a non verdict/promotion kind (nothing to shape-check).
    """
    check = "inconsistent_log"
    kind = decision.get("kind")
    if not decision or kind not in (VERDICT, PROMOTION):
        return _not_applicable(check, "no reviewable row shape")

    problems: List[str] = []
    if kind == VERDICT:
        if not decision.get("arm_hash"):
            problems.append("missing arm_hash")
        if decision.get("level_id") is None:
            problems.append("missing level_id")
        cfg = decision.get("config_json")
        if not cfg:
            problems.append("missing config_json")
        else:
            try:
                json.loads(cfg)
            except Exception:
                problems.append("config_json is not valid JSON")
        if not decision.get("ts"):
            problems.append("missing ts")
    else:  # PROMOTION
        if not decision.get("ref"):
            problems.append("missing shadow_id/ref")
        if decision.get("level_id") is None:
            problems.append("missing level_id")

    if problems:
        return _finding(check, fired=True, severity=SEV_PROBLEM,
                        evidence={"problems": problems, "note": "decision row is malformed/inconsistent"})
    return _finding(check, fired=False, severity=SEV_PROBLEM, evidence={"ok": True})


def check_axes_off_surface(decision: Dict[str, Any]) -> Dict[str, Any]:
    """Config axes don't match the surface: the proposed arm's axis keys are not all in the
    live sampleable axis surface (``trainer_bandit.default_axis_schema()`` →
    ``sampleable_axes``). An off-surface axis means the sampler produced an invalid arm.

    not_applicable: no ``config_json`` on the decision, an unparseable config, or the axis
    surface can't be loaded.
    """
    check = "axes_off_surface"
    cfg = decision.get("config_json")
    if not cfg:
        return _not_applicable(check, "no config_json on decision")
    try:
        arm_axes = trainer_bandit._axes_of_json(cfg)
    except Exception as exc:
        return _not_applicable(check, f"config_json unparseable: {exc}")
    if not arm_axes:
        return _not_applicable(check, "config_json carries no axis keys")
    try:
        surface = set(trainer_bandit.sampleable_axes(trainer_bandit.default_axis_schema()))
    except Exception as exc:
        return _not_applicable(check, f"axis surface unavailable: {exc}")
    if not surface:
        return _not_applicable(check, "axis surface empty")

    off = sorted(arm_axes - surface)
    ev: Dict[str, Any] = {"off_surface_axes": off, "surface": sorted(surface)}
    if off:
        ev["note"] = "config proposes axes not on the sampleable surface — invalid arm"
    return _finding(check, fired=bool(off), severity=SEV_PROBLEM, evidence=ev)


# ── orchestration ────────────────────────────────────────────────────────────────
def _safe(fn, *args, **kwargs) -> Dict[str, Any]:
    """Run a check; a check bug becomes a not_applicable (loud fail-open), never a false
    fire and never a crash — the empty-stream mandate at the orchestrator level."""
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        name = getattr(fn, "__name__", "unknown").replace("check_", "")
        return {"check": name, "applicable": False, "fired": False,
                "severity": None, "evidence": {"reason": f"check error: {exc}"}}


def run_mechanical(decision: Dict[str, Any], *, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """Run all five deterministic checks over one decision; return the list of findings.

    Opens ONE ``trainer.db`` connection for the two trainer.db-reading checks (dead-end,
    budget) and passes it in; the other three are pure. NEVER raises — an unreadable
    trainer.db makes the two db checks return not_applicable, never a false fire.
    """
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = trainer_db.get_connection(db_path)
    except Exception:
        conn = None  # the two db checks re-attempt + degrade to not_applicable
    try:
        return [
            _safe(check_known_dead_end_repropose, decision, conn=conn, db_path=db_path),
            _safe(check_budget_overrun, decision, conn=conn, db_path=db_path),
            _safe(check_skipped_gate, decision),
            _safe(check_inconsistent_log, decision),
            _safe(check_axes_off_surface, decision),
        ]
    finally:
        if conn is not None:
            conn.close()


def has_problem(findings: List[Dict[str, Any]]) -> bool:
    """THE DECIDING HALF: the mechanical findings ALONE decide whether a critique surfaces.
    True iff at least one deterministic check FIRED. The Phase-2 LLM can NEVER change this."""
    return any(f.get("fired") for f in findings)


def max_severity(findings: List[Dict[str, Any]]) -> Optional[str]:
    """The severity of a surfaced critique = the max severity among FIRED checks (None if
    nothing fired). All current mechanical checks fire at ``problem``."""
    fired = [f for f in findings if f.get("fired")]
    if not fired:
        return None
    return max((f.get("severity") for f in fired), key=lambda s: _SEV_ORDER.get(s, 0))


# ═══════════════════════════════════════════════════════════════════════════════
#  THE LLM JUDGMENT LAYER (Phase 2) — budget-gated, TEXT-ONLY, no-flip
#  Catches JUDGMENT problems ("that was rash") that pure rules can't. Runs ONLY on a
#  decision that already LOOKS OFF (a mechanical finding fired). Its output is prose
#  ONLY — it can neither set/clear a mechanical finding nor change the surfacing
#  decision (has_problem decided that from the mechanical half BEFORE this runs).
#  The Anthropic call shape MIRRORS trainer_reasoning._call_anthropic EXACTLY (stdlib
#  urllib; no SDK). Default OFF: WATCHER_JUDGE_ENABLED must be truthy to spend.
# ═══════════════════════════════════════════════════════════════════════════════
WATCHER_JUDGE_ENABLED_ENV = "WATCHER_JUDGE_ENABLED"
WATCHER_ANTHROPIC_KEY_ENV = "WATCHER_ANTHROPIC_API_KEY"
_ANTHROPIC_KEY_FALLBACK_ENV = "ANTHROPIC_API_KEY"
_JUDGE_MODEL = os.environ.get("WATCHER_JUDGE_MODEL", "claude-haiku-4-5")
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
# Haiku 4.5 pricing: $1.00 / 1M input, $5.00 / 1M output (USD per token) — same as B4.
_PRICE_IN_PER_TOK = 1.00 / 1_000_000
_PRICE_OUT_PER_TOK = 5.00 / 1_000_000
_JUDGE_EST_COST = 0.002   # conservative pre-call estimate for the can_afford gate
_JUDGE_MAX_TOKENS = 160
_JUDGE_TIMEOUT_S = float(os.environ.get("WATCHER_JUDGE_TIMEOUT", "20"))

# A judgment result is ALWAYS a dict {text, llm_used, cost}. The TEXT is prose only.
LlmCall = Callable[[str, str, int], Optional[Tuple[str, float]]]


def judge_enabled() -> bool:
    """True iff WATCHER_JUDGE_ENABLED is truthy. Off -> LLM path inert (template only)."""
    return os.environ.get(WATCHER_JUDGE_ENABLED_ENV, "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _judge_api_key() -> Optional[str]:
    """The watcher's OWN key, then the shared fallback. Absent -> template (no spend)."""
    key = os.environ.get(WATCHER_ANTHROPIC_KEY_ENV) or os.environ.get(_ANTHROPIC_KEY_FALLBACK_ENV)
    key = (key or "").strip()
    return key or None


def _template_judgment(decision: Dict[str, Any], findings: List[Dict[str, Any]]) -> str:
    """The deterministic fallback prose — a legible summary of the FIRED mechanical checks.
    Recorded whenever the LLM path is inert (flag off / no key / budget exhausted / call
    fails). Never empty, never spends."""
    fired = [f for f in findings if f.get("fired")]
    checks = ", ".join(f["check"] for f in fired) or "none"
    sev = max_severity(findings) or "note"
    return (f"MECHANICAL: {len(fired)} {sev}(s) — {checks} "
            f"[{decision.get('kind', '?')} level {decision.get('level_id', '?')}].")


def _judge_prompt(decision: Dict[str, Any], findings: List[Dict[str, Any]]) -> Tuple[str, str]:
    """Build the (system, user) for the cheap-model judgment. The model describes JUDGMENT;
    it does NOT change the checks or the trainer's verdict."""
    system = (
        "You are the watcher's review-brain judging a trainer's ALREADY-DECIDED "
        "config-search decision. Deterministic checks have ALREADY flagged it (below) — "
        "you do NOT re-run or change them, and you do NOT change the trainer's verdict. "
        "Judge ONLY whether the decision was rash / over-eager / mis-reasoned, in one "
        "line a human can screenshot. Never invent numbers. One sentence, <=200 chars."
    )
    fired = [f for f in findings if f.get("fired")]
    user = (
        "Trainer decision (already decided — judge whether it was rash, do NOT change it):\n"
        + json.dumps({
            "decision_kind": decision.get("kind"),
            "level_id": decision.get("level_id"),
            "rationale_text": decision.get("rationale_text"),
            "metrics": {"p_value": decision.get("p_value"), "dsr": decision.get("dsr"),
                        "failing_gates_json": decision.get("failing_gates_json"),
                        "gate_passed": decision.get("gate_passed")},
            "mechanical_findings": [{"check": f["check"], "evidence": f.get("evidence")} for f in fired],
        }, default=str)[:1400]
        + "\n\nWrite the one-line judgment."
    )
    return system, user


def _judge_llm(system: str, user: str, max_tokens: int) -> Optional[Tuple[str, float]]:
    """The ONE Anthropic call (stdlib urllib; NEVER raises; returns (text, cost) or None on
    ANY failure). Mirrors trainer_reasoning._call_anthropic EXACTLY — no SDK, Haiku pricing."""
    key = _judge_api_key()
    if not key:
        return None
    body = json.dumps({
        "model": _JUDGE_MODEL,
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
        with urllib.request.urlopen(req, timeout=_JUDGE_TIMEOUT_S) as resp:
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


def judge_decision(
    decision: Dict[str, Any], mechanical_findings: List[Dict[str, Any]], *,
    db_path: Optional[str] = None, llm_call: Optional[LlmCall] = None,
) -> Dict[str, Any]:
    """Budget-gated LLM judgment on a decision that ALREADY looks off. Returns
    ``{"text": str, "llm_used": int, "cost": float}``. The TEXT is prose ONLY — it can
    neither set nor clear a mechanical finding nor change the surfacing decision (that was
    decided by ``has_problem`` from the mechanical half BEFORE this runs).

    Degrades to a deterministic template (``llm_used=0``, cost 0) when: WATCHER_JUDGE_ENABLED
    is off, no API key is configured, the watcher's budget can't afford it, OR the call
    fails — the critique is STILL recorded either way (never silently skipped).

    ``llm_call`` is a test seam (inject a stub); production passes None -> the real
    stdlib-urllib call. The three gates run BEFORE the call, so a stub is only reached
    once the flag+key+budget allow spend.
    """
    template = _template_judgment(decision, mechanical_findings)
    if not judge_enabled():
        return {"text": template, "llm_used": 0, "cost": 0.0}
    if _judge_api_key() is None:
        return {"text": template, "llm_used": 0, "cost": 0.0}
    if not watcher_budget.can_afford(_JUDGE_EST_COST, db_path=db_path):
        return {"text": template, "llm_used": 0, "cost": 0.0}  # broke -> template, still logged

    system, user = _judge_prompt(decision, mechanical_findings)
    call = llm_call or _judge_llm
    result = call(system, user, _JUDGE_MAX_TOKENS)
    if result is None:
        return {"text": template, "llm_used": 0, "cost": 0.0}  # call failed -> template
    text, cost = result
    try:
        watcher_budget.record_spend(cost, db_path=db_path)  # record ACTUAL spend
    except Exception:
        pass  # a recording failure must never lose the judgment we already have
    return {"text": (text.strip() or template), "llm_used": 1, "cost": float(cost)}


# ═══════════════════════════════════════════════════════════════════════════════
#  EVALUATION + CRITIQUE STORE (Phase 2) — mechanical decides, LLM annotates, log problems
# ═══════════════════════════════════════════════════════════════════════════════
def evaluate_decision(
    decision: Dict[str, Any], *, db_path: Optional[str] = None,
    llm_call: Optional[LlmCall] = None,
) -> Dict[str, Any]:
    """Run the mechanical half; if (and ONLY if) it flags a problem, run the budget-gated
    LLM judgment. Returns ``{findings, has_problem, severity, judgment}``.

    A CLEAN decision spends NOTHING — the LLM is reached only when ``has_problem`` is True
    (a mechanical finding fired). ``judgment`` is a template stub for a clean decision (never
    used, since a clean decision is not logged).
    """
    findings = run_mechanical(decision, db_path=db_path)
    problem = has_problem(findings)
    severity = max_severity(findings)
    if problem:
        judgment = judge_decision(decision, findings, db_path=db_path, llm_call=llm_call)
    else:
        judgment = {"text": "", "llm_used": 0, "cost": 0.0}  # never spent on a clean decision
    return {"findings": findings, "has_problem": problem, "severity": severity, "judgment": judgment}


def _r11_memory_shape(
    decision: Dict[str, Any], findings: List[Dict[str, Any]], severity: Optional[str],
    judgment: Dict[str, Any],
) -> Dict[str, Any]:
    """W6 HOOK ONLY — an R11-compatible ``memory`` shape embedded in mechanical_json so R11
    can formalize the store WITHOUT a migration. NOT a memory store (that's R11); no new
    column, no new table. Shape: subjects / action / because / level / outcome / confidence
    + prose."""
    fired = [f for f in findings if f.get("fired")]
    return {
        "subjects": {"arm_hash": decision.get("arm_hash"), "level_id": decision.get("level_id"),
                     "decision_ref": decision.get("ref")},
        "action": decision.get("kind"),          # the trainer decision reviewed
        "because": [f["check"] for f in fired],   # the fired checks (the WHY)
        "level": decision.get("level_id"),
        "outcome": severity,                      # note / concern / problem
        "confidence": "mechanical+llm" if judgment.get("llm_used") else "mechanical",
        "prose": judgment.get("text"),
    }


def log_critique(
    decision: Dict[str, Any], evaluation: Dict[str, Any], *,
    conn: Optional[sqlite3.Connection] = None, db_path: Optional[str] = None,
) -> int:
    """Append ONE row to ``watcher_critiques`` (the watcher's OWN Hub-only store) and return
    its id. Additive INSERT. ``mechanical_json`` carries the fired checks + all findings + the
    R11-compatible ``memory`` hook. ``judgment_text`` is the LLM/template prose; ``llm_used``
    records whether the LLM actually ran.

    Call ONLY for a problem decision (``evaluation['has_problem']`` True) — a clean decision is
    NEVER logged (critique-only-problems). When ``conn`` is provided the INSERT joins the
    caller's transaction (Phase 3 exactly-once: critique + cursor advance atomically) and is
    NOT committed here; when ``conn`` is None a standalone connection is opened + committed.
    """
    findings = evaluation["findings"]
    severity = evaluation["severity"] or SEV_PROBLEM
    judgment = evaluation["judgment"]
    mechanical = {
        "checks": [f for f in findings if f.get("fired")],   # the fired checks
        "all": findings,                                     # the full deterministic record
        "memory": _r11_memory_shape(decision, findings, severity, judgment),
    }
    row = (
        str(decision.get("ref", "")),
        str(decision.get("kind", "")),
        int(decision.get("level_id") or 0),
        severity,
        json.dumps(mechanical, default=str),
        judgment.get("text"),
        int(bool(judgment.get("llm_used"))),
        watcher_db.utc_now(),
    )
    sql = (
        "INSERT INTO watcher_critiques "
        "(decision_ref, decision_kind, level_id, severity, mechanical_json, judgment_text, "
        " llm_used, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    if conn is not None:  # join the caller's transaction (do NOT commit / close)
        cur = conn.execute(sql, row)
        return int(cur.lastrowid) if cur.lastrowid is not None else -1
    own = watcher_db.get_connection(db_path)
    try:
        with own:
            cur = own.execute(sql, row)
            row_id = cur.lastrowid
    finally:
        own.close()
    return int(row_id) if row_id is not None else -1


def review_decision(
    decision: Dict[str, Any], *, db_path: Optional[str] = None,
    llm_call: Optional[LlmCall] = None,
) -> Optional[Dict[str, Any]]:
    """Standalone review of ONE decision (Phase 2). Evaluate -> if clean, return None and log
    NOTHING (critique-only-problems, zero spend); if a problem, log the critique and return a
    summary. Phase 3's poll triggers call ``evaluate_decision`` + ``log_critique(conn=...)``
    directly to fold the cursor advance into the same transaction (exactly-once)."""
    ev = evaluate_decision(decision, db_path=db_path, llm_call=llm_call)
    if not ev["has_problem"]:
        return None  # CLEAN -> no critique row, no LLM spend
    critique_id = log_critique(decision, ev, db_path=db_path)
    return {
        "critique_id": critique_id,
        "severity": ev["severity"],
        "llm_used": ev["judgment"].get("llm_used"),
        "judgment_text": ev["judgment"].get("text"),
        "fired": [f["check"] for f in ev["findings"] if f.get("fired")],
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  THE POLL CURSOR (Phase 3) — additive watcher.db table, exactly-once watermark
#  A1 confirmed there is NO push surface anywhere; the watcher DETECTS its three
#  review-trigger events by polling the decision record for new rows past a
#  last-consumed cursor. The cursor is B1's OWN small additive table in watcher.db
#  (B2 keeps ``jsonl_cursor`` for its source) — created call-time by THIS module,
#  never by editing B0's watcher_db.py.
# ═══════════════════════════════════════════════════════════════════════════════
CURSOR_VERDICT = "rejection_log_id"    # last-consumed rejection_log.id
CURSOR_PROMOTION = "promotion_watermark"  # last-consumed promotion_candidates rowid
CURSOR_LEVEL = "level_max"             # last-seen MAX(level)

_CURSOR_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS watcher_cursor ("
    "  name TEXT PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)"
)


def _ensure_cursor_table(conn: sqlite3.Connection) -> None:
    """Idempotently create B1's cursor table (additive-DB law; CREATE IF NOT EXISTS only)."""
    conn.execute(_CURSOR_SCHEMA)


def get_cursor(name: str, *, conn: Optional[sqlite3.Connection] = None,
               db_path: Optional[str] = None) -> int:
    """The last-consumed position for a trigger (0 when never set — the fresh pre-cutover state)."""
    own = conn is None
    c = conn if conn is not None else watcher_db.get_connection(db_path)
    try:
        _ensure_cursor_table(c)
        row = c.execute("SELECT position FROM watcher_cursor WHERE name=?", (name,)).fetchone()
        return int(row[0]) if row and row[0] is not None else 0
    finally:
        if own:
            c.close()


def advance_cursor(conn: sqlite3.Connection, name: str, position: int) -> None:
    """Advance a cursor to ``position`` (MONOTONIC — never regresses). Joins the caller's
    transaction (no commit here) so the cursor advance is atomic with the critique write
    (exactly-once). A crash before the transaction commits leaves the cursor put -> re-review."""
    _ensure_cursor_table(conn)
    conn.execute(
        "INSERT INTO watcher_cursor (name, position, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(name) DO UPDATE SET position=MAX(position, excluded.position), "
        "updated_at=excluded.updated_at",
        (name, int(position), watcher_db.utc_now()),
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  THE THREE POLL TRIGGERS (Phase 3) — one review per decision-boundary row, once
#  Exactly-once: evaluate first (spend commits separately), then critique + cursor
#  advance in ONE watcher.db transaction. NEVER raise; the empty stream (no rows / no
#  such table / VM unreachable) is the EXPECTED pre-cutover state -> [], no alarm.
#
#  ⚠️ db_path is a TEST co-location override (points BOTH trainer.db reads and
#  watcher.db writes at one throwaway file). PRODUCTION passes None so trainer.db and
#  watcher.db resolve to their SEPARATE defaults (data/trainer.db, data/watcher.db).
# ═══════════════════════════════════════════════════════════════════════════════
def _review_and_commit(
    decision: Dict[str, Any], cursor_name: str, cursor_pos: int, *,
    db_path: Optional[str] = None, llm_call: Optional[LlmCall] = None,
) -> Optional[Dict[str, Any]]:
    """The EXACTLY-ONCE core. Evaluate the decision (mechanical + budget-gated judgment; any
    LLM spend commits to watcher.db in its OWN prior transaction), then atomically write the
    critique (only if a problem) AND advance the cursor in ONE watcher.db transaction. Returns
    a summary iff a critique was written; None for a clean decision (cursor still advances —
    the decision is consumed, never re-reviewed)."""
    ev = evaluate_decision(decision, db_path=db_path, llm_call=llm_call)
    conn = watcher_db.get_connection(db_path)
    summary: Optional[Dict[str, Any]] = None
    try:
        with conn:  # ATOMIC: critique (if any) + cursor advance commit together
            if ev["has_problem"]:
                cid = log_critique(decision, ev, conn=conn)
                summary = {
                    "critique_id": cid,
                    "decision_ref": decision.get("ref"),
                    "kind": decision.get("kind"),
                    "level_id": decision.get("level_id"),
                    "severity": ev["severity"],
                    "llm_used": ev["judgment"].get("llm_used"),
                    "fired": [f["check"] for f in ev["findings"] if f.get("fired")],
                }
            advance_cursor(conn, cursor_name, cursor_pos)
    finally:
        conn.close()
    return summary


def poll_verdicts(*, db_path: Optional[str] = None, limit: int = 200,
                  llm_call: Optional[LlmCall] = None) -> List[Dict[str, Any]]:
    """VERDICT boundary: poll ``rejection_log`` (trainer.db, SELECT-only) for rows with
    ``id > cursor``; review each ONCE; advance the cursor. 0 rows / absent table = the
    EXPECTED pre-cutover empty stream -> [] (no alarm)."""
    reviewed: List[Dict[str, Any]] = []
    cursor = get_cursor(CURSOR_VERDICT, db_path=db_path)
    try:
        tconn = trainer_db.get_connection(db_path)
    except Exception:
        return reviewed  # trainer.db unreadable -> nothing to review, no alarm
    try:
        try:
            rows = tconn.execute(
                "SELECT id, arm_hash, level_id, config_json, failing_gates_json, "
                "rationale_text, p_value, dsr, ts FROM rejection_log "
                "WHERE id > ? ORDER BY id LIMIT ?",
                (int(cursor), int(limit)),
            ).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return reviewed  # rejection_log absent (pre-cutover) -> expected empty
            raise
    finally:
        tconn.close()

    for r in rows:
        decision = {
            "kind": VERDICT, "ref": str(r[0]), "row_id": int(r[0]),
            "arm_hash": r[1], "level_id": r[2], "config_json": r[3],
            "failing_gates_json": r[4], "rationale_text": r[5],
            "p_value": r[6], "dsr": r[7], "ts": r[8],
        }
        s = _review_and_commit(decision, CURSOR_VERDICT, int(r[0]), db_path=db_path, llm_call=llm_call)
        if s is not None:
            reviewed.append(s)
    return reviewed


def poll_promotions(*, db_path: Optional[str] = None, replica_path: Optional[str] = None,
                    limit: int = 200, llm_call: Optional[LlmCall] = None) -> List[Dict[str, Any]]:
    """PROMOTION boundary: poll ``promotion_candidates`` (the read-only trevor.db REPLICA,
    ``mode=ro``) for rows with ``rowid > watermark``; review each ONCE. "no such table" =
    zero candidates, EXPECTED pre-cutover -> [] (no alarm). B1 reviews the trainer-decision
    side (did the surface skip the gate / is the row consistent)."""
    reviewed: List[Dict[str, Any]] = []
    rp = replica_path or _REPLICA_PATH
    watermark = get_cursor(CURSOR_PROMOTION, db_path=db_path)
    for p in _read_promotions(rp, watermark, limit):
        decision = {
            "kind": PROMOTION, "ref": str(p["shadow_id"]), "level_id": p.get("level_id"),
            "ts": p.get("surfaced_at"), "gate_passed": _coerce_bool(p.get("gate_passed")),
        }
        s = _review_and_commit(decision, CURSOR_PROMOTION, int(p["_wm"]), db_path=db_path, llm_call=llm_call)
        if s is not None:
            reviewed.append(s)
    return reviewed


def poll_level_change(*, db_path: Optional[str] = None,
                      level_reader: Optional[Callable[[], Optional[int]]] = None,
                      llm_call: Optional[LlmCall] = None) -> List[Dict[str, Any]]:
    """LEVEL-CHANGE boundary: detect a new ``levels`` row (``MAX(level) > last seen``) via the
    read-only ``ssh vm`` pipe. B1 reviews the TRAINER-DECISION side; B2 owns the integrity /
    apply-oversight side (do NOT duplicate B2's checks here). Pre-cutover MAX(level)=0 → the
    trigger is dormant (no new level -> []). VM unreachable -> None -> no change, no alarm.

    B1's mechanical checks are verdict/promotion-shaped, so a bare level-change decision yields
    all-not_applicable → no critique; the trigger still ADVANCES the cursor (records the level
    was seen) so a future level-specific trainer-decision check can slot in without re-review.
    """
    reviewed: List[Dict[str, Any]] = []
    reader = level_reader or _ssh_max_level
    try:
        current = reader()
    except Exception:
        current = None
    if current is None:
        return reviewed  # VM unreachable / no levels table -> no change, expected
    last_seen = get_cursor(CURSOR_LEVEL, db_path=db_path)
    if int(current) <= int(last_seen):
        return reviewed  # no new level

    decision = {"kind": LEVEL_CHANGE, "ref": f"level {int(current)}",
                "level_id": int(current), "ts": watcher_db.utc_now()}
    s = _review_and_commit(decision, CURSOR_LEVEL, int(current), db_path=db_path, llm_call=llm_call)
    if s is not None:
        reviewed.append(s)
    return reviewed


# ═══════════════════════════════════════════════════════════════════════════════
#  THE MASTER FLAG + CYCLE (Phase 3) — WATCHER_REVIEW_ENABLED default OFF, no auto-start
# ═══════════════════════════════════════════════════════════════════════════════
WATCHER_REVIEW_ENABLED_ENV = "WATCHER_REVIEW_ENABLED"
WATCHER_POLL_INTERVAL_SEC_ENV = "WATCHER_POLL_INTERVAL_SEC"
_DEFAULT_POLL_INTERVAL_SEC = 300  # A1-approved: event-driven semantics; bounds latency, not cost


def review_enabled() -> bool:
    """The master gate. Default OFF -> the whole poll/review path is inert (no poll, no LLM,
    no writes). Read at CALL TIME so flipping it pauses the watcher without a restart."""
    return os.environ.get(WATCHER_REVIEW_ENABLED_ENV, "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def poll_interval_sec() -> int:
    """The poll cadence (env WATCHER_POLL_INTERVAL_SEC, default 300s). Conservative: the
    watcher is event-driven in semantics, so the interval only bounds latency, not cost —
    no LLM call unless a decision already looks off."""
    raw = os.environ.get(WATCHER_POLL_INTERVAL_SEC_ENV)
    if raw and raw.strip():
        try:
            v = int(float(raw))
            if v > 0:
                return v
        except (TypeError, ValueError):
            pass
    return _DEFAULT_POLL_INTERVAL_SEC


def run_review_cycle(
    *, db_path: Optional[str] = None, replica_path: Optional[str] = None,
    level_reader: Optional[Callable[[], Optional[int]]] = None,
    llm_call: Optional[LlmCall] = None,
) -> Dict[str, Any]:
    """ONE poll cycle across the three decision boundaries. INERT (no reads, no writes, no
    LLM) when WATCHER_REVIEW_ENABLED is off. NEVER raises — a trigger error is caught and
    reported, never crashes the cycle."""
    if not review_enabled():
        return {"enabled": False, "verdict": [], "promotion": [], "level_change": []}
    out: Dict[str, Any] = {"enabled": True}
    triggers = (
        ("verdict", lambda: poll_verdicts(db_path=db_path, llm_call=llm_call)),
        ("promotion", lambda: poll_promotions(db_path=db_path, replica_path=replica_path, llm_call=llm_call)),
        ("level_change", lambda: poll_level_change(db_path=db_path, level_reader=level_reader, llm_call=llm_call)),
    )
    for name, fn in triggers:
        try:
            out[name] = fn()
        except Exception as exc:  # a trigger bug must never crash the cycle
            out[name] = {"error": str(exc)}
    return out


def run_forever(*, db_path: Optional[str] = None, replica_path: Optional[str] = None) -> None:
    """Explicit daemon entrypoint — NEVER auto-started on import. Polls at poll_interval_sec()
    while WATCHER_REVIEW_ENABLED is on; a flag-off cycle is a no-op sleep (checked every cycle
    so flipping the flag pauses/resumes without a restart). A cycle error never kills the loop."""
    import time
    while True:
        try:
            run_review_cycle(db_path=db_path, replica_path=replica_path)
        except Exception:
            pass
        time.sleep(poll_interval_sec())


# ── internal helpers ──────────────────────────────────────────────────────────────
def _coerce_bool(v: Any) -> Any:
    """Coerce a stored gate_passed (1/0/'true'/'false'/True/False/None) to a real bool, or
    leave None/unknown as-is (so check_skipped_gate can tell 'absent' from 'False')."""
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "on", "t"):
        return True
    if s in ("0", "false", "no", "off", "f"):
        return False
    return v


def _read_promotions(replica_path: str, watermark: int, limit: int) -> List[Dict[str, Any]]:
    """Read new ``promotion_candidates`` rows (rowid > watermark) from the read-only trevor.db
    replica (``mode=ro``). Returns [] on absent table / unreadable replica (the EXPECTED
    pre-cutover state). Robust to the R13 schema: reads every column by name, rowid = the
    monotonic watermark; resolves shadow_id/level_id/surfaced_at/gate_passed by whatever the
    row actually carries."""
    try:
        conn = sqlite3.connect(f"file:{replica_path}?mode=ro", uri=True, timeout=10)
    except Exception:
        return []  # replica missing / unreadable -> zero candidates, expected pre-cutover
    try:
        try:
            cur = conn.execute(
                "SELECT rowid AS _wm, * FROM promotion_candidates "
                "WHERE rowid > ? ORDER BY rowid LIMIT ?",
                (int(watermark), int(limit)),
            )
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return []  # promotion_candidates absent -> expected pre-cutover empty
            raise
    finally:
        conn.close()

    out: List[Dict[str, Any]] = []
    for row in rows:
        d = dict(zip(cols, row))
        out.append({
            "_wm": int(d.get("_wm") or 0),
            "shadow_id": d.get("shadow_id") or d.get("shadow_key") or d.get("_wm"),
            "level_id": d.get("level_id"),
            "surfaced_at": d.get("surfaced_at") or d.get("ts") or d.get("created_at"),
            "gate_passed": d.get("gate_passed"),
        })
    return out


# ── the VM level chain (RF3T2-B8) ─────────────────────────────────────────────
# Self-contained on purpose: `watcher_integrity` owns the SAME shim, but importing it
# from the fragile review-brain would put an integrity-side module on this side of the
# B0 independence boundary. Duplicating ~10 lines of argv is the cheaper price.
_VM_HOST = os.environ.get("WATCHER_REVIEW_VM_HOST", "vm")
_VM_CWD = "/home/trevor/trevor"
_LEVEL_QUERY = "scripts/level/level_query.py"


def _log_level_read_failure(reason: str) -> None:
    """Make a failed level read VISIBLE on stderr.

    🚨 This is the load-bearing half. A dead pipe and 'the level did not change' both
    return None, so WITHOUT this line an unreachable VM is indistinguishable from a
    quiet one — a daemon that stops knowing anything while still looking alive. That is
    the silent-lifecycle-failure pattern; the reason used to be discarded entirely.
    """
    print(
        "[watcher_review] level read UNKNOWN (%s) — treating as 'no change'" % reason,
        file=sys.stderr,
    )


def _ssh_max_level() -> Optional[int]:
    """Read the current minted level from the VM chain over the READ-ONLY ``ssh vm`` pipe,
    via the CANONICAL ``scripts/level/level_query.py current`` CLI.

    RF3T2-B8: was a raw ``sqlite3 -readonly 'SELECT COALESCE(MAX(level),0) FROM levels'``.
    ``watcher_integrity`` and ``memory_tiers`` both already went through the CLI — being the
    odd one out is exactly where a level-read bug hides, and G2 makes the level chain
    VM-only (never a WSL table). Equivalent by construction: ``level_query.current_level()``
    is documented as ``MAX(levels.level)``, 0 on an empty chain — the same number the old
    SELECT produced (verified side by side: both 0).

    🚨 Returns None on ANY failure (spawn / timeout / nonzero / empty / malformed / non-int)
    — NEVER 0. A daemon that refuses is correct; one that silently starts at level 0 is the
    corruption this campaign exists to prevent. The trigger treats None as 'no change', never
    an alarm — and every failure is now LOGGED (see ``_log_level_read_failure``).

    Read-only under ``sudo -u trevor``; NEVER mints a level. B2 owns the integrity/apply
    side; B1 only DETECTS.
    """
    import subprocess

    remote = "cd %s && sudo -u trevor python3 %s current" % (
        shlex.quote(_VM_CWD),
        shlex.quote(_LEVEL_QUERY),
    )
    argv = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", _VM_HOST, remote]

    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        _log_level_read_failure("timeout after 20s")
        return None
    except Exception as exc:  # ssh binary missing / OSError / bad argv
        _log_level_read_failure("spawn failed: %s: %s" % (type(exc).__name__, exc))
        return None

    if proc.returncode != 0:
        _log_level_read_failure(
            "nonzero exit %s: %s" % (proc.returncode, (proc.stderr or "").strip()[:200])
        )
        return None

    out = (proc.stdout or "").strip()
    if not out:
        _log_level_read_failure("empty stdout")
        return None

    try:
        data = json.loads(out)
    except (ValueError, TypeError) as exc:
        _log_level_read_failure("malformed json: %s" % exc)
        return None
    if not isinstance(data, dict):
        _log_level_read_failure("non-object json: %s" % type(data).__name__)
        return None

    lvl = data.get("current_level")
    # bool is an int subclass — reject it explicitly; reject negatives.
    if isinstance(lvl, bool) or not isinstance(lvl, int) or lvl < 0:
        _log_level_read_failure("non-int current_level: %r" % (lvl,))
        return None
    return lvl


def _gates_nonempty(failing_gates_json: Any) -> bool:
    """True iff ``failing_gates_json`` parses to a NON-empty list/dict (a real gate cited).
    A bare '[]' / '{}' / '' / null parses to empty -> the rejection cited no gate."""
    if failing_gates_json is None:
        return False
    if isinstance(failing_gates_json, (list, dict)):
        return len(failing_gates_json) > 0
    try:
        parsed = json.loads(failing_gates_json)
    except Exception:
        # a non-JSON non-empty string still names *something* — treat as cited.
        return bool(str(failing_gates_json).strip())
    if isinstance(parsed, (list, dict)):
        return len(parsed) > 0
    return parsed is not None and str(parsed).strip() != ""


__all__ = [
    "VERDICT", "PROMOTION", "LEVEL_CHANGE",
    "SEV_NOTE", "SEV_CONCERN", "SEV_PROBLEM",
    "check_known_dead_end_repropose", "check_budget_overrun", "check_skipped_gate",
    "check_inconsistent_log", "check_axes_off_surface",
    "run_mechanical", "has_problem", "max_severity",
    "judge_enabled", "judge_decision", "evaluate_decision", "log_critique", "review_decision",
    "CURSOR_VERDICT", "CURSOR_PROMOTION", "CURSOR_LEVEL",
    "get_cursor", "advance_cursor",
    "poll_verdicts", "poll_promotions", "poll_level_change",
    "review_enabled", "poll_interval_sec", "run_review_cycle", "run_forever",
]


if __name__ == "__main__":
    # Guarded smoke only — NEVER runs on import. Runs the five checks over a synthetic
    # decision + the live (empty) trainer.db, and shows the empty-stream not_applicable path.
    import json as _json

    _clean = {
        "kind": VERDICT, "ref": "1", "row_id": 1, "arm_hash": "deadbeef", "level_id": 0,
        "config_json": _json.dumps({"exit": 0.5, "leverage": 2}),
        "failing_gates_json": _json.dumps(["net_of_cost"]),
        "ts": "2026-07-22T00:00:00Z",
    }
    print("clean decision (empty trainer.db):")
    for f in run_mechanical(_clean):
        print(" ", _json.dumps(f))
    print("has_problem:", has_problem(run_mechanical(_clean)))

    _off = dict(_clean, config_json=_json.dumps({"BOGUS_AXIS": 1}),
                failing_gates_json=_json.dumps([]))
    print("\noff-surface + no-gate decision:")
    for f in run_mechanical(_off):
        print(" ", _json.dumps(f))
    print("has_problem:", has_problem(run_mechanical(_off)))
