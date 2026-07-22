#!/usr/bin/env python3
"""memory_reasoning.py — R11-B3: the queryable reasoning log + the watcher's memory namespace.

Two surfaces, one law: **nothing is ever deleted; the store forgets DETAIL, never CONCLUSIONS.**

  (1) THE REASONING LOG (M6) — "considered X → rejected because Y, at level N" — queryable,
      tiered, permanent. A READ layer over the R9 trainer reasoning C1 already ADOPTS into
      ``trainer_memory`` (via ``memory_projection``). It preserves the WHY: ``because`` carries
      the fired-gate names + the actual ``rationale_text`` — never a bare outcome label. A log
      that says "rejected" without "because" is useless to the trainer, so the WHY is the point.
      Standing hypotheses accumulate across levels ((hypothesis_id, level_id) composite PK,
      R9-B3); ``hypothesis_trail`` exposes that accumulation as ONE ROW PER LEVEL — never
      flattened into a single latest-state row.

  (2) THE WATCHER MEMORY NAMESPACE (M9) — the watcher (R10) is an LLM being trained too. Its
      GENERALIZED lessons ("mechanical checks reliably catch skipped gates at this level") land
      in ``watcher_memory`` via the per-agent ``watcher_scope()`` — tiered like trainer entries,
      accumulating across levels.

🚨 THE CRITIQUE-LEAK BOUNDARY (A1's biggest risk — B3 is the prompt most able to break it):
  * ``watcher_critiques`` (in ``watcher.db``, the raw per-decision critiques of the trainer's OWN
    arms) is **NEVER** read into ``memory.db``. This module imports NO watcher-critique reader,
    names NO ``watcher_critiques`` table, and NEVER opens ``watcher.db`` — grep-assert the absence.
  * ``watcher_memory`` receives ONLY the watcher's GENERALIZED lessons — about the watcher's own
    oversight PRACTICE, not about a specific trainer decision. ``write_watcher_lesson`` refuses a
    per-decision critique STRUCTURALLY: it exposes NO ``decision_ref`` parameter and rejects
    ``decision_ref`` / ``arm_hash`` / ``critique`` keys in ``subjects``. A boundary you cannot
    express is a boundary that erodes — so it is encoded in the signature.
  * C1's AST denial 4 (``trainer_*.py`` ↛ ``watcher_memory`` / ``watcher_scope``) still holds:
    this module is ``memory_reasoning.py`` — NOT a ``trainer_*.py`` glob member — so it may
    legitimately touch the watcher namespace, and no trainer module imports it.

SOURCE-EVIDENCE ENRICHMENT (read-only, the ``memory_projection`` precedent): to surface the raw
statistical evidence behind a rejection (``p_value`` / ``dsr`` / structured failing gates), the
reasoning log reads the ORIGINAL ``trainer.db`` source row **strictly read-only** (``mode=ro``),
resolved via ``lib.trainer_db.resolve_db_path()`` exactly as ``memory_projection`` does. B3 writes
NOTHING to ``trainer.db`` (grep-assert: zero INSERT/UPDATE/DELETE against it). Malformed JSON in a
source ``config_json`` / ``failing_gates_json`` / ``evidence_json`` is skipped + counted, never a
crash. ``because`` (from ``trainer_memory``) still carries the WHY even when the source is gone.

PARALLEL-SAFE WITH B1: imports ONLY ``lib.memory_db`` (the scoped accessors), ``memory_projection``
(C1), and ``lib.trainer_db`` (read-only source). It NEVER imports a B1 symbol at module load, so it
degrades gracefully / needs no rewiring when B1's ``have_we_tested`` lands. B1 owns the tag→verdict
lookup; B3 owns the reasoning-TRAIL view — they SHARE the ``memory_tags`` index + tier semantics,
they do not duplicate the query.

FLAG: ``MEMORY_REASONING_ENABLED`` (default OFF). OFF ⇒ every public function early-returns the
empty / no-op result BEFORE opening any connection; nothing runs on import. Byte-identical inert.

PRE-CUTOVER EMPTY IS EXPECTED: 0-row sources → an empty trail, never an alarm/error.

Python 3, stdlib sqlite3 only.
"""
import hashlib
import json
import os
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

import memory_projection
from lib import memory_db
from lib.memory_db import CONFIG_AXES, MECHANICAL_CHECKS, ROLE_HOT

# ── Feature flag (default OFF) ──────────────────────────────────────────────────────────────────
FLAG_ENV = "MEMORY_REASONING_ENABLED"
_TRUTHY = frozenset(("1", "true", "yes", "on"))

# The reused vocabulary — the 12 config axes + the 5 mechanical-check names. Watcher-lesson tags are
# drawn ONLY from this set so there is ONE taxonomy across the store (no competing tag vocabulary).
_VOCAB = frozenset(CONFIG_AXES) | frozenset(MECHANICAL_CHECKS)

# Subject keys that mark a PER-DECISION critique — refused by write_watcher_lesson (generalized only).
_FORBIDDEN_SUBJECT_KEYS = frozenset(("decision_ref", "arm_hash", "critique"))

# Canonical-id prefixes the C1 projection stamps (memory_projection.project_trainer_*).
_REJECT_PREFIX = "trainer:reject:"
_HYPOTHESIS_PREFIX = "trainer:hypothesis:"

# trainer_memory columns read for a trail step (order matters — zipped into a dict below).
_READ_COLS: Tuple[str, ...] = (
    "id", "canonical_id", "role", "subjects_json", "action", "because", "level",
    "outcome", "confidence", "prose", "source_db", "source_table", "source_id", "created_ts",
)
_READ_SELECT = ", ".join(f"m.{c}" for c in _READ_COLS)


def _enabled() -> bool:
    """True iff MEMORY_REASONING_ENABLED is truthy. Default OFF (module fully inert)."""
    return os.environ.get(FLAG_ENV, "").strip().lower() in _TRUTHY


def _parse_json(raw: Any) -> Tuple[Any, bool]:
    """Parse a source JSON field defensively. Returns (value, malformed?). None / already-decoded
    passes through as not-malformed; a bad string → (None, True) so the caller can skip + count."""
    if raw is None or isinstance(raw, (dict, list, int, float)):
        return raw, False
    try:
        return json.loads(raw), False
    except (TypeError, ValueError, json.JSONDecodeError):
        return None, True


# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  READ-ONLY SOURCE ENRICHMENT — trainer.db, mode=ro, SELECT-only. Zero writes (grep-assert).
#  Surfaces the raw statistical evidence (p_value/dsr, structured gates, n_obs) behind an adopted
#  reasoning row. Fails safe: source missing / table absent / bad row → evidence None, never crash.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def _open_source_ro() -> Optional[sqlite3.Connection]:
    """Open trainer.db STRICTLY read-only (mode=ro), path resolved via lib.trainer_db (the
    memory_projection precedent). None on any failure → enrichment is simply skipped."""
    try:
        from lib import trainer_db  # local import: keeps module load free of a hard trainer dep
        path = trainer_db.resolve_db_path()
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:  # import / path / connect failure → skip enrichment, never crash
        return None


def _rejection_evidence(src: sqlite3.Connection, source_id: Optional[int]) -> Tuple[Dict[str, Any], int]:
    """Read the raw rejection_log row (read-only) → {p_value, dsr, failing_gates, config}. Returns
    (evidence, malformed_count). 'no such table' / missing row / bad JSON → best-effort + counted."""
    ev: Dict[str, Any] = {"p_value": None, "dsr": None, "failing_gates": [], "config": {}}
    malformed = 0
    if source_id is None:
        return ev, malformed
    try:
        row = src.execute(
            "SELECT p_value, dsr, failing_gates_json, config_json FROM rejection_log WHERE id = ?",
            (int(source_id),),
        ).fetchone()
    except sqlite3.OperationalError:
        return ev, malformed  # table absent on a fresh trainer.db — EXPECTED pre-cutover
    if row is None:
        return ev, malformed
    ev["p_value"] = row["p_value"]
    ev["dsr"] = row["dsr"]
    gates, bad = _parse_json(row["failing_gates_json"])
    malformed += 1 if bad else 0
    ev["failing_gates"] = gates if isinstance(gates, list) else ([gates] if gates else [])
    cfg, bad = _parse_json(row["config_json"])
    malformed += 1 if bad else 0
    ev["config"] = cfg if isinstance(cfg, dict) else {}
    return ev, malformed


def _hypothesis_evidence(src: sqlite3.Connection, source_id: Optional[int]) -> Tuple[Dict[str, Any], int]:
    """Read the raw standing_hypotheses row (read-only) → {n_obs, status, evidence}. Returns
    (evidence, malformed_count). Uses the implicit rowid (project_trainer_hypothesis stored it)."""
    ev: Dict[str, Any] = {"n_obs": None, "status": None, "evidence": None}
    malformed = 0
    if source_id is None:
        return ev, malformed
    try:
        row = src.execute(
            "SELECT n_obs, status, evidence_json FROM standing_hypotheses WHERE rowid = ?",
            (int(source_id),),
        ).fetchone()
    except sqlite3.OperationalError:
        return ev, malformed  # table absent — EXPECTED pre-cutover
    if row is None:
        return ev, malformed
    ev["n_obs"] = row["n_obs"]
    ev["status"] = row["status"]
    parsed, bad = _parse_json(row["evidence_json"])
    malformed += 1 if bad else 0
    ev["evidence"] = parsed
    return ev, malformed


# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  THE REASONING LOG (M6) — the reasoning-TRAIL read surface over adopted trainer_memory rows.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def _build_step(row: Dict[str, Any], subjects: Any, tags: List[str]) -> Dict[str, Any]:
    """Assemble one reasoning-trail step from a trainer_memory row (source evidence merged later)."""
    return {
        "canonical_id": row["canonical_id"],
        "kind": row["action"],                       # 'reject' | 'hypothesize'
        "level": row["level"],
        "subjects": subjects,                        # what was CONSIDERED (X)
        "because": row["because"],                   # the WHY — fired gates + rationale, ALWAYS present
        "failing_gates": [],                         # structured, filled from source evidence
        "rationale": row["prose"],                   # the rejection rationale / hypothesis claim+evidence
        "outcome": row["outcome"],                   # 'rejected' | hypothesis status
        "confidence": row["confidence"],             # p/dsr- or n_obs-derived strength
        "evidence": None,                            # raw p_value/dsr/n_obs from source (where present)
        "tags": tags,
        "source": {"db": row["source_db"], "table": row["source_table"], "id": row["source_id"]},
        "role": row["role"],
        "created_ts": row["created_ts"],
    }


def reasoning_trail(
    *, arm_hash: Optional[str] = None, tag: Optional[str] = None, subject: Optional[str] = None,
    level: Optional[int] = None, action: Optional[str] = None, limit: Optional[int] = None,
    include_source_evidence: bool = True, return_stats: bool = False,
    db_path: Optional[str] = None,
):
    """The reasoning-trail view: "considered X → rejected because Y, at level N".

    Reads the adopted trainer reasoning (``trainer_memory``, via ``trainer_scope``) and returns one
    step per matching row — ``because`` ALWAYS carries the fired-gate names + rationale (the WHY),
    ``evidence`` carries raw ``p_value``/``dsr`` from the read-only source where present.

    Filters (all optional, AND-combined): ``arm_hash`` (precise ``canonical_id`` prefix match),
    ``tag`` (join the shared ``memory_tags`` index — the SAME index B1's ``have_we_tested`` uses),
    ``subject`` (substring over subjects/because/rationale), ``level``, ``action``.

    Returns ``List[step]``, or ``(List[step], stats)`` when ``return_stats`` — stats =
    ``{skipped_malformed, source_evidence_errors}``. OFF flag / empty source ⇒ empty trail, no error.
    """
    stats = {"skipped_malformed": 0, "source_evidence_errors": 0}
    if not _enabled():
        return ([], stats) if return_stats else []

    scope = memory_db.trainer_scope(db_path)
    src: Optional[sqlite3.Connection] = None
    try:
        conn = scope.conn
        table = scope._table  # bound to 'trainer_memory' by the scope — reads never leave the namespace
        params: List[Any] = []
        sql = f"SELECT {_READ_SELECT} FROM {table} m"
        if tag:
            sql += " JOIN memory_tags t ON t.entry_agent = ? AND t.entry_id = m.id AND t.tag = ?"
            params += [scope.agent, str(tag)]
        where: List[str] = []
        if arm_hash is not None:
            where.append("m.canonical_id LIKE ?")
            params.append(f"{_REJECT_PREFIX}{arm_hash}:%")
        if level is not None:
            where.append("m.level = ?")
            params.append(int(level))
        if action is not None:
            where.append("m.action = ?")
            params.append(str(action))
        if subject is not None:
            where.append("(m.subjects_json LIKE ? OR m.because LIKE ? OR m.prose LIKE ?)")
            like = f"%{subject}%"
            params += [like, like, like]
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY m.level, m.id"
        if limit is not None:
            sql += " LIMIT ?"
            params.append(int(limit))

        try:
            rows = [dict(zip(_READ_COLS, r)) for r in conn.execute(sql, params).fetchall()]
        except sqlite3.OperationalError:
            return ([], stats) if return_stats else []  # store not initialized — treat as empty

        if include_source_evidence and rows:
            src = _open_source_ro()

        steps: List[Dict[str, Any]] = []
        for row in rows:
            subjects, bad = _parse_json(row["subjects_json"])
            if bad:  # a malformed adopted row — skip it + count (projection guarantees valid, defensive)
                stats["skipped_malformed"] += 1
                continue
            tags = scope.tags_for(row["id"])
            step = _build_step(row, subjects, tags)
            if src is not None:
                if row["source_table"] == "rejection_log":
                    ev, bad_n = _rejection_evidence(src, row["source_id"])
                    step["evidence"] = {"p_value": ev["p_value"], "dsr": ev["dsr"]}
                    step["failing_gates"] = ev["failing_gates"]
                    stats["source_evidence_errors"] += bad_n
                elif row["source_table"] == "standing_hypotheses":
                    ev, bad_n = _hypothesis_evidence(src, row["source_id"])
                    step["evidence"] = {"n_obs": ev["n_obs"], "status": ev["status"], "detail": ev["evidence"]}
                    stats["source_evidence_errors"] += bad_n
            steps.append(step)
        return (steps, stats) if return_stats else steps
    finally:
        if src is not None:
            src.close()
        scope.close()


def hypothesis_trail(
    hypothesis_id: str, *, include_source_evidence: bool = True,
    return_stats: bool = False, db_path: Optional[str] = None,
):
    """The accumulation trail of ONE standing hypothesis across levels — ONE ROW PER LEVEL, ordered
    by level, NEVER flattened into a single latest-state row. Each level carries its own claim
    (``because``), status (``outcome``), confidence, and (from the read-only source) ``n_obs`` +
    ``evidence``. OFF flag / no such hypothesis ⇒ empty list, no error."""
    stats = {"skipped_malformed": 0, "source_evidence_errors": 0}
    if not _enabled():
        return ([], stats) if return_stats else []

    scope = memory_db.trainer_scope(db_path)
    src: Optional[sqlite3.Connection] = None
    try:
        conn = scope.conn
        table = scope._table
        sql = (
            f"SELECT {_READ_SELECT} FROM {table} m "
            "WHERE m.canonical_id LIKE ? ORDER BY m.level, m.id"
        )
        try:
            rows = [dict(zip(_READ_COLS, r)) for r in
                    conn.execute(sql, (f"{_HYPOTHESIS_PREFIX}{hypothesis_id}:%",)).fetchall()]
        except sqlite3.OperationalError:
            return ([], stats) if return_stats else []

        if include_source_evidence and rows:
            src = _open_source_ro()

        steps: List[Dict[str, Any]] = []
        for row in rows:
            subjects, bad = _parse_json(row["subjects_json"])
            if bad:
                stats["skipped_malformed"] += 1
                continue
            tags = scope.tags_for(row["id"])
            step = _build_step(row, subjects, tags)
            if src is not None:
                ev, bad_n = _hypothesis_evidence(src, row["source_id"])
                step["evidence"] = {"n_obs": ev["n_obs"], "status": ev["status"], "detail": ev["evidence"]}
                stats["source_evidence_errors"] += bad_n
            steps.append(step)
        return (steps, stats) if return_stats else steps
    finally:
        if src is not None:
            src.close()
        scope.close()


def refresh_reasoning_log(db_path: Optional[str] = None) -> Dict[str, int]:
    """Convenience bridge to C1's adoption sweep (``memory_projection.run_projection``): pull any new
    ``rejection_log`` / ``standing_hypotheses`` rows into ``trainer_memory`` so the trail is current.
    Gated: OFF ⇒ no projection, no writes, ``{rejection_log:0, standing_hypotheses:0}`` (inert)."""
    if not _enabled():
        return {"rejection_log": 0, "standing_hypotheses": 0}
    return memory_projection.run_projection(db_path)


# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  THE WATCHER MEMORY NAMESPACE (M9) — write the watcher's GENERALIZED lessons ONLY.
#  🚨 A per-decision critique is refused STRUCTURALLY (no decision_ref param; forbidden subjects).
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def write_watcher_lesson(
    *, subjects: Dict[str, Any], action: str, because: str, level: int,
    tags: List[str], outcome: Optional[str] = None, confidence: Optional[str] = None,
    prose: Optional[str] = None, db_path: Optional[str] = None,
) -> int:
    """Append ONE GENERALIZED watcher lesson into ``watcher_memory`` (via ``watcher_scope``) and
    return its id. INSERT-only + idempotent (``entry_hash`` + ``INSERT OR IGNORE``); tiered to HOT.

    GENERALIZED LESSONS ONLY — a lesson about the watcher's own oversight PRACTICE, never a critique
    of a specific trainer decision. This is enforced in the signature: there is NO ``decision_ref``
    parameter, and ``subjects`` carrying ``decision_ref`` / ``arm_hash`` / ``critique`` is REFUSED
    (that shape belongs in ``watcher_critiques``, Hub-only, never here). Tags are enforced (untagged
    → raise) and must come from the reused 12+5 vocabulary. OFF flag ⇒ no-op (returns 0, no write).
    """
    if not _enabled():
        return 0

    # ── generalized-only enforcement (the load-bearing structural guard) ──
    if not isinstance(subjects, dict):
        raise ValueError("subjects must be a dict describing a GENERALIZED oversight subject")
    forbidden = _FORBIDDEN_SUBJECT_KEYS & set(subjects.keys())
    if forbidden:
        raise ValueError(
            f"per-decision critique REFUSED: subjects may not carry {sorted(forbidden)} — "
            "watcher_memory holds the watcher's generalized lessons only; a per-arm/per-decision "
            "critique stays Hub-only in the critique store"
        )

    # ── tags enforced at write (untagged → raise), drawn from the reused vocabulary ──
    tag_list = [str(t) for t in (tags or []) if str(t).strip()]
    if not tag_list:
        raise ValueError("write_watcher_lesson requires at least one tag (untagged lessons are refused)")
    off_surface = [t for t in tag_list if t not in _VOCAB]
    if off_surface:
        raise ValueError(
            f"tags must come from the reused vocabulary (12 config axes + 5 mechanical checks); "
            f"off-surface: {off_surface}"
        )

    lvl = int(level)
    subjects_json = json.dumps(subjects, sort_keys=True)
    # canonical_id keys the lesson SUBJECT (subjects+action+level) so re-reasoned variants of the
    # same lesson coexist under one canonical_id (HOT/WARM tier model). entry_hash keys the FULL
    # content (incl. because) so an identical re-write dedupes to one row.
    canonical_id = "watcher:lesson:" + hashlib.sha256(
        f"{subjects_json}|{action}|{lvl}".encode("utf-8")
    ).hexdigest()[:24]
    entry_hash = hashlib.sha256(
        f"watcher_memory|{canonical_id}|{because}".encode("utf-8")
    ).hexdigest()[:32]

    scope = memory_db.watcher_scope(db_path)
    try:
        entry_id = scope.insert_entry(
            canonical_id=canonical_id, role=ROLE_HOT, subjects=subjects, level=lvl,
            action=action, because=because, outcome=outcome, confidence=confidence, prose=prose,
            source_db=None, source_table=None, source_id=None, entry_hash=entry_hash, commit=True,
        )
        existing = set(scope.tags_for(entry_id))
        for t in tag_list:
            if t not in existing:  # idempotent: never re-tag a re-written lesson
                scope.tag(entry_id, t, commit=True)
        # tier pointer → HOT for this canonical_id (the ONE mutable knowledge-side state)
        memory_db.upsert_tier(canonical_id, ROLE_HOT, conn=scope.conn)
        scope.conn.commit()
        return entry_id
    finally:
        scope.close()


if __name__ == "__main__":
    # Smoke only — guarded, NEVER runs on import. Over the empty pre-cutover store (flag ON) this
    # prints an empty trail — the EXPECTED result.
    os.environ.setdefault(FLAG_ENV, "1")
    print("reasoning_trail:", reasoning_trail(return_stats=True))
    print("hypothesis_trail:", hypothesis_trail("none", return_stats=True))
